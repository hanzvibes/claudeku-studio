// POST /api/generate-skill { prompt, provider, currentHtml? }
// Jalur "Skill penuh": AI menulis SATU FILE HTML template LENGKAP mengikuti
// skill threejs-cinematic-short v3.14 — BEBAS dari kosakata SceneSpec.
// Streaming SSE seperti /api/generate-scene-stream (pola yang sama:
// coba stream dulu, fallback non-streaming bila provider tidak dukung).
//
// Format event (satu JSON per baris `data:`):
//   { type: 'token', text }   — potongan HTML mentah AI (kode mengalir)
//   { type: 'stage', stage, text } — tahap ("AI menulis template…",
//     "cek keamanan…", "cek lint…", "perbaiki…")
//   { type: 'repaired', attempt }  — self-repair dimulai (percobaan ke-n)
//   { type: 'done', title, html, previewHtml, duration, repaired,
//     attempts, lintWarnings, lintVia }
//   { type: 'error', error, validationErrors? }
//
// Alur per percobaan (maks 3 percobaan total):
//  1. Ekstrak HTML lengkap dari jawaban AI (buang fence, potong
//     <!DOCTYPE html>..</html>).
//  2. Validasi KEAMANAN (lib/skill-validate.ts): blokir fetch/XHR/
//     WebSocket, storage/cookie, eval/Function, script src di luar CDN
//     yang diizinkan. Gagal -> self-repair.
//  3. Validasi LINT (lib/skill-lint.ts): scripts/lint_short.py server-side
//     (python3, file sementara di /tmp); fallback port TS bila python3
//     tidak ada. Error lint -> self-repair. Warning lint ikut di event done.
//  4. Rewrite CDN -> /vendor/ untuk preview (harus tepat 13 script
//     three.js r128 seperti template bawaan).
// Bila 3 percobaan tetap gagal -> event error yang JUJUR (pesan lint /
// batas provider) + UI menawarkan beralih ke mode Scene. TIDAK PERNAH
// tampil sebagai sukses.
//
// API key hanya diteruskan ke provider pengguna, tidak disimpan / di-log.
// Jangan pernah log apiKey / isi body provider ke console.
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";
import { lintSkillHtml } from "@/lib/skill-lint";
import { buildSkillSystemPrompt, buildSkillUserPrompt, extractSkillHtml } from "@/lib/skill-prompt";
import {
  extractSkillLen,
  extractSkillTitle,
  validateSkillHtml,
} from "@/lib/skill-validate";

type Provider = { baseUrl: string; model: string; apiKey: string };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type StreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: string; text: string }
  | { type: "repaired"; attempt: number }
  | {
      type: "done";
      title: string;
      html: string;
      previewHtml: string;
      duration: number;
      repaired: boolean;
      attempts: number;
      lintWarnings: string[];
      lintVia: "python" | "ts";
    }
  | { type: "error"; error: string; validationErrors?: string[] };

const MAX_ATTEMPTS = 3;
/** Template HTML panjang (~35-75 KB): output token besar + provider lambat. */
const MAX_TOKENS = 24000;
const TEMPERATURE = 0.7;
const STREAM_TIMEOUT_MS = 240000;
const NON_STREAM_TIMEOUT_MS = 180000;
/** Bila provider SSE tidak mengirim data apa pun dalam waktu ini, anggap
 *  stream tidak didukung -> fallback non-streaming. */
const FIRST_DATA_TIMEOUT_MS = 15000;

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
        ? "Provider waktu habis (180 detik). Template HTML panjang butuh waktu — coba lagi atau pakai mode Scene yang lebih ringan."
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
  signal: AbortSignal;
  send: (ev: StreamEvent) => void;
};

/**
 * Coba SATU KALI streaming dari provider. Kembalikan { text } bila stream
 * SSE berjalan sampai selesai (atau terpotong SESUDAH ada teks — teks itu
 * tetap dipakai untuk parse/repair). Kembalikan null bila provider
 * jelas-jelas tidak mendukung stream (respons bukan SSE, status error,
 * tidak bisa dihubungi, atau tidak ada data dalam 15 dtk pertama) —
 * pemanggil lalu memakai fallback. Throw ClientAbortedError bila client
 * membatalkan. (Pola sama seperti /api/generate-scene-stream, tanpa
 * partial — HTML parsial tidak bisa di-preview.)
 */
async function tryStreamOnce(ctx: Ctx): Promise<{ text: string } | null> {
  const { provider, baseUrl, messages, signal, send } = ctx;
  const { signal: sig, cleanup } = combinedSignal(signal, STREAM_TIMEOUT_MS);
  let gotAnyData = false;
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
        }
      }
    }
  } catch (e) {
    if (e instanceof ClientAbortedError) throw e;
    if (signal.aborted) throw new ClientAbortedError();
    if (!gotAnyData && !text) {
      clearTimeout(dataTimer);
      signal.removeEventListener("abort", onClientAbort);
      sig.removeEventListener("abort", onHardAbort);
      cleanup();
      return null;
    }
    // Stream putus di tengah jalan tapi sudah ada teks — pakai teks itu.
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
 * ke client (stage + token per ~400 karakter — HTML panjang, chunk besar
 * supaya panel tidak kebanjiran event). Throw ClientAbortedError bila
 * client membatalkan.
 */
async function fallbackNonStreaming(ctx: Ctx): Promise<string> {
  const { provider, baseUrl, messages, signal, send } = ctx;
  send({ type: "stage", stage: "tulis", text: "Provider tidak mendukung streaming — AI lagi nulis template…" });
  const raw = await callProvider(provider, baseUrl, messages, signal);
  const CHUNK = 400;
  const DELAY_MS = 30;
  for (let i = 0; i < raw.length; i += CHUNK) {
    if (signal.aborted) throw new ClientAbortedError();
    send({ type: "token", text: raw.slice(i, i + CHUNK) });
    await sleep(DELAY_MS);
  }
  return raw;
}

/** Validasi satu HTML hasil AI: ekstrak -> keamanan -> lint -> rewrite. */
async function validateSkillResult(raw: string): Promise<
  | { ok: true; html: string; previewHtml: string; title: string; duration: number; lintWarnings: string[]; lintVia: "python" | "ts" }
  | { ok: false; errors: string[] }
> {
  const html = extractSkillHtml(raw);
  if (!html) {
    return {
      ok: false,
      errors: [
        "AI tidak mengembalikan file HTML lengkap (tidak ada <!DOCTYPE html>..</html>). " +
          "Mungkin jawaban terpotong karena batas output provider — coba prompt yang lebih pendek atau pakai mode Scene.",
      ],
    };
  }
  const securityErrors = validateSkillHtml(html);
  if (securityErrors.length > 0) return { ok: false, errors: securityErrors };
  const title = extractSkillTitle(html);
  if (!title) return { ok: false, errors: ["Judul video (<title>) tidak ditemukan di HTML."] };
  const duration = extractSkillLen(html);
  if (duration === null) return { ok: false, errors: ["LEN (durasi video) tidak ditemukan di HTML."] };
  if (duration < 10 || duration > 120) {
    return { ok: false, errors: [`Durasi video ${duration} detik di luar 10-120 detik.`] };
  }
  const lint = await lintSkillHtml(html);
  if (lint.errors.length > 0) return { ok: false, errors: lint.errors };
  const { html: previewHtml, replaced } = rewriteThreeCdnToLocal(html);
  if (replaced !== 13) {
    return {
      ok: false,
      errors: [
        `Template hanya memuat ${replaced} script three.js r128 (harus 13 seperti template bawaan). ` +
          "Pastikan 13 script CDN three.js r128 dari pola trio dipakai semua.",
      ],
    };
  }
  return { ok: true, html, previewHtml, title, duration, lintWarnings: lint.warnings, lintVia: lint.via };
}

const REPAIR_PROMPT =
  `Template HTML yang kamu kembalikan TIDAK LOLOS validasi. Perbaiki SEMUA error di bawah, ` +
  `kembalikan HTML LENGKAP yang sudah diperbaiki (seluruh file, bukan patch). ` +
  `Jangan hapus credit @hanzvibes, jangan ganti host CDN, jangan tambahkan pola terlarang. ` +
  `Bila error soal script three.js, salin lagi 13 script tag dari pola trio apa adanya.`;

/** Jalankan seluruh alur generate (stream / fallback / self-repair) dan kirim event. */
async function runGenerate(ctx: Ctx): Promise<void> {
  const { provider, baseUrl, messages, signal, send } = ctx;

  send({ type: "stage", stage: "tulis", text: "AI menulis template…" });
  let raw = "";
  const streamed = await tryStreamOnce(ctx);
  if (streamed) {
    raw = streamed.text;
  } else {
    raw = await fallbackNonStreaming(ctx);
  }

  let attempts = 1;
  send({ type: "stage", stage: "cek", text: "Cek keamanan template…" });
  let result = await validateSkillResult(raw);
  while (!result.ok && attempts < MAX_ATTEMPTS) {
    attempts += 1;
    send({ type: "repaired", attempt: attempts });
    send({ type: "stage", stage: "perbaiki", text: `AI memperbaiki template (percobaan ${attempts})…` });
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `${REPAIR_PROMPT}\n\nDaftar error validasi:\n- ${result.errors.join("\n- ")}`,
    });
    try {
      raw = await callProvider(provider, baseUrl, messages, signal);
    } catch (e) {
      if (e instanceof ClientAbortedError) throw e;
      send({ type: "error", error: e instanceof Error ? e.message : "Provider tidak bisa dihubungi." });
      return;
    }
    send({ type: "stage", stage: "cek", text: "Cek keamanan + lint template…" });
    result = await validateSkillResult(raw);
  }

  if (!result.ok) {
    send({
      type: "error",
      error:
        "Template dari AI tidak lolos validasi sesudah 3 percobaan. " +
        "Coba prompt yang lebih sederhana, atau pakai mode Scene — Scene lebih ringan dan hampir selalu berhasil.",
      validationErrors: result.errors,
    });
    return;
  }

  send({
    type: "done",
    title: result.title,
    html: result.html,
    previewHtml: result.previewHtml,
    duration: result.duration,
    repaired: attempts > 1,
    attempts,
    lintWarnings: result.lintWarnings,
    lintVia: result.lintVia,
  });
}

export async function POST(req: Request) {
  let body: { prompt?: string; provider?: Provider; currentHtml?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body request bukan JSON yang valid." }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return Response.json({ error: "Prompt tidak boleh kosong." }, { status: 400 });

  // Revisi: HTML saat ini HARUS lolos validasi keamanan (tidak bisa direvisi
  // bila isinya sudah bermasalah).
  const currentHtml = body.currentHtml ?? null;
  if (currentHtml) {
    const curErrors = validateSkillHtml(currentHtml);
    if (curErrors.length > 0) {
      return Response.json(
        { error: "Template saat ini tidak lolos validasi keamanan, tidak bisa direvisi.", validationErrors: curErrors },
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

  const current = currentHtml
    ? { title: extractSkillTitle(currentHtml) ?? "Template Skill", html: currentHtml, duration: extractSkillLen(currentHtml) ?? 30 }
    : null;
  const system = buildSkillSystemPrompt(current);
  const user = buildSkillUserPrompt(prompt, current);
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
        await runGenerate({ provider, baseUrl, messages, signal: req.signal, send });
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
