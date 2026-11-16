// POST /api/generate-scene-stream { prompt, provider, currentScene? }
// Versi STREAMING dari /api/generate-scene: jawaban AI mengalir ke client
// sebagai Server-Sent Events (text/event-stream) supaya preview parsial
// bisa dimainkan live di iframe selagi AI masih menulis.
//
// Format event (satu JSON per baris `data:`):
//   { type: 'token', text }              — potongan teks mentah AI
//   { type: 'stage', stage, text }       — tahap (fallback non-SSE)
//   { type: 'partial', scene }           — SceneSpec parsial valid (live preview)
//   { type: 'repaired', attempt }        — self-repair dimulai (percobaan ke-n)
//   { type: 'done', scene, html, previewHtml, repaired, attempts }
//   { type: 'error', error, validationErrors? }
//
// Alur:
//  1. Validasi input SAMA seperti /api/generate-scene — error di sini
//     dikembalikan sebagai JSON biasa (400/422/502) SEBELUM stream dimulai.
//  2. COBA STREAM dulu: POST {baseUrl}/chat/completions stream:true.
//     Bila respons OK + content-type SSE: parse baris `data: {...}`,
//     tiap delta content -> event token; tiap ~500ms / +400 karakter coba
//     extractPartialJsonFromText + validatePartialSceneSpec — bila lolos
//     DAN jumlah shot/beat bertambah -> event partial. Sesudah stream
//     selesai: parse JSON lengkap -> validateSceneSpec; bila lolos -> done.
//     Bila tidak lolos -> self-repair non-streaming (maks 2x) seperti
//     /api/generate-scene.
//  3. FALLBACK bila provider TIDAK mendukung stream (respons bukan SSE,
//     status error, atau tidak ada data dalam 10 dtk pertama): SATU
//     panggilan non-streaming biasa, lalu simulasikan streaming ke client
//     (stage + token per ~40 karakter + partial bila valid). Satu percobaan
//     stream + satu fallback per request — jangan spam retry.
//  4. Abort: bila client menutup koneksi (req.signal), fetch provider
//     ikut dibatalkan dan stream ditutup TANPA event error.
// API key hanya diteruskan ke provider pengguna, tidak disimpan / di-log.
// Jangan pernah log apiKey / isi body provider ke console.
import { extractJsonFromText, extractPartialJsonFromText } from "@/lib/spec";
import {
  normalizePartialSceneSpec,
  normalizeSceneSpec,
  validatePartialSceneSpec,
  validateSceneSpec,
  type SceneSpec,
} from "@/lib/scene-spec";
import { buildSceneHtml } from "@/lib/apply-scene";
import { buildSceneSystemPrompt, buildSceneUserPrompt } from "@/lib/scene-prompt";

type Provider = { baseUrl: string; model: string; apiKey: string };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type StreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: string; text: string }
  | { type: "partial"; scene: SceneSpec }
  | { type: "repaired"; attempt: number }
  | { type: "done"; scene: SceneSpec; html: string; previewHtml: string; repaired: boolean; attempts: number }
  | { type: "error"; error: string; validationErrors?: string[] };

const MAX_ATTEMPTS = 3;
const STREAM_TIMEOUT_MS = 90000;
const NON_STREAM_TIMEOUT_MS = 60000;
const MAX_TOKENS = 6000;
const TEMPERATURE = 0.7;
/** Bila provider SSE tidak mengirim data apa pun dalam waktu ini, anggap
 *  stream tidak didukung -> fallback non-streaming. */
const FIRST_DATA_TIMEOUT_MS = 10000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Error sentinel: client membatalkan — tutup stream diam-diam, tanpa event error. */
class ClientAbortedError extends Error {
  constructor() {
    super("Client aborted");
    this.name = "ClientAbortedError";
  }
}

/** Gabungkan signal client + timeout menjadi satu AbortSignal. */
function combinedSignal(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
    },
  };
}

/** Satu panggilan NON-streaming ke provider OpenAI-compatible. Throw pesan ramah bila gagal. */
async function callProvider(
  provider: Provider,
  baseUrl: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<string> {
  const { signal: sig, cleanup } = combinedSignal(signal, NON_STREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
      }),
      signal: sig,
    });
  } catch (e) {
    if (signal.aborted) throw new ClientAbortedError();
    const timedOut = e instanceof Error && e.message.includes("abort");
    throw new Error(
      timedOut
        ? "Provider waktu habis (60 detik). Periksa Base URL dan koneksi internet."
        : "Provider tidak bisa dihubungi. Periksa Base URL dan koneksi internet.",
    );
  } finally {
    cleanup();
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Provider mengembalikan status ${res.status}. Periksa Model ID dan API Key di Settings.` +
        (detail ? " Pesan provider: " + detail.slice(0, 300) : ""),
    );
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("Provider mengembalikan jawaban kosong. Coba lagi.");
  return raw;
}

type Ctx = {
  provider: Provider;
  baseUrl: string;
  messages: ChatMessage[];
  currentScene: SceneSpec | null;
  signal: AbortSignal;
  send: (ev: StreamEvent) => void;
};

/**
 * Coba SATU KALI streaming dari provider.
 * Kembalikan { text } bila stream SSE berjalan sampai selesai (atau
 * terpotong SESUDAH ada teks — teks itu tetap dipakai untuk parse/repair).
 * Kembalikan null bila provider jelas-jelas tidak mendukung stream
 * (respons bukan SSE, status error, tidak bisa dihubungi, atau tidak ada
 * data dalam 10 dtk pertama) — pemanggil lalu memakai fallback.
 * Throw ClientAbortedError bila client membatalkan.
 */
async function tryStreamOnce(ctx: Ctx): Promise<{ text: string } | null> {
  const { provider, baseUrl, messages, signal, send } = ctx;
  const { signal: sig, cleanup } = combinedSignal(signal, STREAM_TIMEOUT_MS);
  let gotAnyData = false;
  // Bila provider SSE tidak mengirim data apa pun dalam 10 dtk pertama,
  // dataCtrl membatalkan fetch — pemanggil lalu memakai fallback
  // non-streaming (bukan error).
  const dataCtrl = new AbortController();
  const dataTimer = setTimeout(() => {
    if (!gotAnyData) dataCtrl.abort();
  }, FIRST_DATA_TIMEOUT_MS);
  const onClientAbort = () => dataCtrl.abort();
  signal.addEventListener("abort", onClientAbort, { once: true });
  const onHardAbort = () => dataCtrl.abort();
  sig.addEventListener("abort", onHardAbort, { once: true });
  const fetchSignal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([sig, dataCtrl.signal])
      : dataCtrl.signal;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: true,
      }),
      signal: fetchSignal,
    });
  } catch {
    clearTimeout(dataTimer);
    signal.removeEventListener("abort", onClientAbort);
    sig.removeEventListener("abort", onHardAbort);
    cleanup();
    if (signal.aborted) throw new ClientAbortedError();
    return null; // tidak bisa dihubungi -> fallback non-streaming
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
    // Bukan SSE (misal provider mengembalikan JSON biasa / error HTTP):
    // baca body supaya koneksi tidak menggantung, lalu fallback.
    try {
      await res.text();
    } catch {
      /* abaikan */
    }
    clearTimeout(dataTimer);
    signal.removeEventListener("abort", onClientAbort);
    sig.removeEventListener("abort", onHardAbort);
    cleanup();
    if (signal.aborted) throw new ClientAbortedError();
    return null;
  }

  let text = "";
  let lastPartialLen = 0;
  // Diisi waktu mulai stream — supaya percobaan parsial pertama tidak
  // langsung jalan di token awal (JSON pasti belum lengkap), melainkan
  // menunggu +400 karakter atau +500ms. Tanpa ini, percobaan pertama yang
  // gagal "membuang" jendela throttle dan partial yang sudah valid
  // (beat pertama selesai) ikut tertahan.
  let lastPartialAt = Date.now();
  let lastSent = { shots: 0, beats: 0 };
  const maybePartial = () => {
    const now = Date.now();
    if (text.length - lastPartialLen < 400 && now - lastPartialAt < 500) return;
    lastPartialLen = text.length;
    lastPartialAt = now;
    try {
      const parsed = extractPartialJsonFromText(text);
      if (parsed === null) return;
      if (validatePartialSceneSpec(parsed).length !== 0) return;
      const scene = normalizePartialSceneSpec(parsed);
      if (scene.shots.length > lastSent.shots || scene.beats.length > lastSent.beats) {
        lastSent = { shots: scene.shots.length, beats: scene.beats.length };
        send({ type: "partial", scene });
      }
    } catch {
      // JSON belum lengkap — tunggu token berikut.
    }
  };

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* abaikan */
        }
        throw new ClientAbortedError();
      }
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        gotAnyData = true;
        clearTimeout(dataTimer);
        let delta = "";
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          delta = j.choices?.[0]?.delta?.content ?? "";
        } catch {
          continue;
        }
        if (delta) {
          text += delta;
          send({ type: "token", text: delta });
          maybePartial();
        }
      }
    }
  } catch (e) {
    if (e instanceof ClientAbortedError) throw e;
    if (signal.aborted) throw new ClientAbortedError();
    // Stream putus di tengah jalan: bila belum ada data sama sekali,
    // fallback non-streaming; bila sudah ada teks, pakai teks itu.
    if (!gotAnyData && !text) {
      clearTimeout(dataTimer);
      signal.removeEventListener("abort", onClientAbort);
      sig.removeEventListener("abort", onHardAbort);
      cleanup();
      return null;
    }
    // Lanjut dengan teks sejauh ini (parse/repair di bawah).
  } finally {
    clearTimeout(dataTimer);
    signal.removeEventListener("abort", onClientAbort);
    sig.removeEventListener("abort", onHardAbort);
    cleanup();
  }
  return { text };
}

/**
 * Fallback non-streaming: SATU panggilan biasa, lalu simulasikan streaming
 * ke client (stage + token per ~40 karakter + partial bila valid).
 * Throw ClientAbortedError bila client membatalkan.
 */
async function fallbackNonStreaming(ctx: Ctx): Promise<string> {
  const { provider, baseUrl, messages, signal, send } = ctx;
  send({ type: "stage", stage: "cerita", text: "Provider tidak mendukung streaming — AI lagi nulis cerita…" });
  const raw = await callProvider(provider, baseUrl, messages, signal);
  // Simulasikan token mengalir dari teks mentah jawaban.
  const CHUNK = 40;
  const DELAY_MS = 60;
  for (let i = 0; i < raw.length; i += CHUNK) {
    if (signal.aborted) throw new ClientAbortedError();
    send({ type: "token", text: raw.slice(i, i + CHUNK) });
    await sleep(DELAY_MS);
  }
  send({ type: "stage", stage: "kamera", text: "AI lagi atur kamera…" });
  await sleep(150);
  if (signal.aborted) throw new ClientAbortedError();
  send({ type: "stage", stage: "cek", text: "AI lagi cek adegan…" });
  try {
    const parsed = extractPartialJsonFromText(raw);
    if (parsed !== null && validatePartialSceneSpec(parsed).length === 0) {
      send({ type: "partial", scene: normalizePartialSceneSpec(parsed) });
    }
  } catch {
    /* abaikan — validasi penuh tetap jalan di bawah */
  }
  return raw;
}

const REPAIR_PROMPT =
  `SceneSpec yang kamu kembalikan TIDAK LOLOS validasi. Perbaiki error ini, ` +
  `kembalikan SceneSpec LENGKAP yang sudah diperbaiki (bukan patch, semua shot dan beat).\n\n` +
  `Perbaiki SEMUA error di bawah. Bila error soal kecepatan dialog, perpendek teks atau perpanjang waktunya. ` +
  `Bila error soal shot, pastikan shot menutupi 0 sampai duration tanpa tumpang tindih. ` +
  `Bila error soal kode custom, hapus pola terlarang atau ganti beat itu dengan beat dari kosakata.`;

/** Jalankan seluruh alur generate (stream / fallback / self-repair) dan kirim event. */
async function runGenerate(ctx: Ctx): Promise<void> {
  const { provider, baseUrl, messages, currentScene, signal, send } = ctx;

  let raw = "";
  const streamed = await tryStreamOnce(ctx);
  if (streamed) {
    raw = streamed.text;
  } else {
    raw = await fallbackNonStreaming(ctx);
  }

  // Parse + validasi + self-repair (maks 2x tambahan, non-streaming).
  let parsed: unknown = null;
  let validationErrors: string[] = [];
  let attempts = 1;

  const tryParse = (text: string) => {
    try {
      parsed = extractJsonFromText(text);
    } catch {
      validationErrors = ["AI mengembalikan jawaban yang bukan JSON."];
      parsed = null;
      return;
    }
    validationErrors = validateSceneSpec(parsed);
  };

  tryParse(raw);
  while ((validationErrors.length > 0 || parsed === null) && attempts < MAX_ATTEMPTS) {
    attempts += 1;
    send({ type: "repaired", attempt: attempts });
    const failedSpecText =
      parsed !== null
        ? JSON.stringify(parsed, null, 2)
        : "(jawaban bukan JSON, tidak bisa ditampilkan sebagai spec)";
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        `${REPAIR_PROMPT}\n\n` +
        `Spec sebelumnya yang gagal:\n${failedSpecText}\n\n` +
        `Daftar error validasi:\n- ${validationErrors.join("\n- ")}`,
    });
    try {
      raw = await callProvider(provider, baseUrl, messages, signal);
    } catch (e) {
      if (e instanceof ClientAbortedError) throw e;
      send({ type: "error", error: e instanceof Error ? e.message : "Provider tidak bisa dihubungi." });
      return;
    }
    tryParse(raw);
  }

  if (validationErrors.length > 0 || parsed === null) {
    send({
      type: "error",
      error: "SceneSpec dari AI tidak lolos validasi sesudah 3 percobaan.",
      validationErrors,
    });
    return;
  }

  const normalized = normalizeSceneSpec(parsed as SceneSpec);
  // Revisi: id HARUS tetap id scene lama, apa pun id yang dikembalikan AI.
  if (currentScene) normalized.id = currentScene.id;

  try {
    const { html, previewHtml } = await buildSceneHtml(normalized);
    send({
      type: "done",
      scene: normalized,
      html,
      previewHtml,
      repaired: attempts > 1,
      attempts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menerapkan scene ke template dinamis.";
    send({ type: "error", error: `Scene lolos validasi tapi gagal diterapkan ke template dinamis: ${msg}` });
  }
}

export async function POST(req: Request) {
  let body: { prompt?: string; provider?: Provider; currentScene?: SceneSpec };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body request bukan JSON yang valid." }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return Response.json({ error: "Prompt tidak boleh kosong." }, { status: 400 });

  const currentScene = body.currentScene ?? null;
  if (currentScene) {
    const curErrors = validateSceneSpec(currentScene);
    if (curErrors.length > 0) {
      return Response.json(
        { error: "Scene saat ini tidak valid, tidak bisa direvisi.", validationErrors: curErrors },
        { status: 422 },
      );
    }
  }

  const provider = body.provider;
  if (!provider || !provider.baseUrl?.trim() || !provider.model?.trim()) {
    return Response.json(
      {
        error:
          "Provider belum diisi. Buka Settings dan isi Base URL + Model (API Key bila provider kamu membutuhkannya).",
        code: "PROVIDER_MISSING",
      },
      { status: 400 },
    );
  }
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, "");
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
  } catch {
    return Response.json({ error: "Base URL provider tidak valid." }, { status: 400 });
  }

  const system = buildSceneSystemPrompt(currentScene);
  const user = buildSceneUserPrompt(prompt, currentScene);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (ev: StreamEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // Controller sudah ditutup (client pergi) — abaikan.
        }
      };
      try {
        await runGenerate({ provider, baseUrl, messages, currentScene, signal: req.signal, send });
      } catch (e) {
        if (e instanceof ClientAbortedError || req.signal.aborted) {
          // Client menutup koneksi — tutup stream tanpa event error.
        } else {
          send({ type: "error", error: e instanceof Error ? e.message : "Generate gagal." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Sudah ditutup — abaikan.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
