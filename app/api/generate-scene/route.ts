// POST /api/generate-scene { prompt, provider, currentScene? }
// - Tanpa currentScene: MODE BUAT BARU (cerita baru dari nol).
// - Dengan currentScene: MODE REVISI — AI menerima scene aktif sebagai konteks
//   dan wajib mengembalikan SceneSpec LENGKAP yang sudah diperbarui (bukan patch).
// Bila spec AI gagal validasi: SELF-REPAIR — kirim lagi ke provider (maks 2x
// percobaan tambahan, total 3) dengan spec gagal + daftar error validasi.
// API key hanya diteruskan ke provider pengguna, tidak disimpan / di-log.
// Jangan pernah log apiKey / isi body provider ke console.
import { NextResponse } from "next/server";
import { extractJsonFromText } from "@/lib/spec";
import {
  normalizeSceneSpec,
  validateSceneSpec,
  type SceneSpec,
} from "@/lib/scene-spec";
import { buildSceneHtml } from "@/lib/apply-scene";
import { buildSceneSystemPrompt, buildSceneUserPrompt } from "@/lib/scene-prompt";

type Provider = { baseUrl: string; model: string; apiKey: string };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const MAX_ATTEMPTS = 3;
const PROVIDER_TIMEOUT_MS = 60000;
const MAX_TOKENS = 6000;
const TEMPERATURE = 0.7;

/** Satu panggilan ke provider OpenAI-compatible. Throw dengan pesan ramah bila gagal. */
async function callProvider(provider: Provider, baseUrl: string, messages: ChatMessage[]): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
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
      signal: ctrl.signal,
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes("abort");
    throw new Error(
      timedOut
        ? "Provider waktu habis (60 detik). Periksa Base URL dan koneksi internet."
        : "Provider tidak bisa dihubungi. Periksa Base URL dan koneksi internet.",
    );
  } finally {
    clearTimeout(t);
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

export async function POST(req: Request) {
  let body: { prompt?: string; provider?: Provider; currentScene?: SceneSpec };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body request bukan JSON yang valid." }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Prompt tidak boleh kosong." }, { status: 400 });

  const currentScene = body.currentScene ?? null;
  if (currentScene) {
    const curErrors = validateSceneSpec(currentScene);
    if (curErrors.length > 0) {
      return NextResponse.json(
        { error: "Scene saat ini tidak valid, tidak bisa direvisi.", validationErrors: curErrors },
        { status: 422 },
      );
    }
  }

  const provider = body.provider;
  if (!provider || !provider.baseUrl?.trim() || !provider.model?.trim()) {
    return NextResponse.json(
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
    return NextResponse.json({ error: "Base URL provider tidak valid." }, { status: 400 });
  }

  const system = buildSceneSystemPrompt(currentScene);
  const user = buildSceneUserPrompt(prompt, currentScene);

  // Riwayat percakapan untuk self-repair: [system, user, assistant(gagal),
  // user(perbaiki...), assistant(gagal), user(perbaiki...), ...]
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let raw = "";
  let parsed: unknown = null;
  let validationErrors: string[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      raw = await callProvider(provider, baseUrl, messages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider tidak bisa dihubungi.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    try {
      parsed = extractJsonFromText(raw);
    } catch {
      validationErrors = ["AI mengembalikan jawaban yang bukan JSON."];
      parsed = null;
    }
    if (parsed !== null) {
      validationErrors = validateSceneSpec(parsed);
    }
    if (validationErrors.length === 0 && parsed !== null) break;

    // Gagal validasi (atau gagal parse): siapkan percobaan self-repair.
    if (attempt < MAX_ATTEMPTS) {
      const failedSpecText =
        parsed !== null ? JSON.stringify(parsed, null, 2) : "(jawaban bukan JSON, tidak bisa ditampilkan sebagai spec)";
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          `SceneSpec yang kamu kembalikan TIDAK LOLOS validasi. Perbaiki error ini, ` +
          `kembalikan SceneSpec LENGKAP yang sudah diperbaiki (bukan patch, semua shot dan beat).\n\n` +
          `Spec sebelumnya yang gagal:\n${failedSpecText}\n\n` +
          `Daftar error validasi:\n- ${validationErrors.join("\n- ")}\n\n` +
          `Perbaiki SEMUA error di atas. Bila error soal kecepatan dialog, perpendek teks atau perpanjang waktunya. ` +
          `Bila error soal shot, pastikan shot menutupi 0 sampai duration tanpa tumpang tindih. ` +
          `Bila error soal kode custom, hapus pola terlarang atau ganti beat itu dengan beat dari kosakata.`,
      });
    }
  }

  if (validationErrors.length > 0 || parsed === null) {
    return NextResponse.json(
      {
        error: "SceneSpec dari AI tidak lolos validasi sesudah 3 percobaan.",
        validationErrors,
        rawPreview: raw.slice(0, 500),
      },
      { status: 422 },
    );
  }

  const normalized = normalizeSceneSpec(parsed as SceneSpec);
  // Revisi: id HARUS tetap id scene lama, apa pun id yang dikembalikan AI.
  if (currentScene) normalized.id = currentScene.id;

  try {
    const { html, previewHtml } = await buildSceneHtml(normalized);
    // html = canonical (CDN, untuk Download/export). previewHtml = rewrite
    // lokal /vendor (untuk preview di iframe). Jangan pernah tertukar.
    return NextResponse.json({
      scene: normalized,
      html,
      previewHtml,
      repaired: attempts > 1,
      attempts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menerapkan scene ke template dinamis.";
    return NextResponse.json(
      { error: `Scene lolos validasi tapi gagal diterapkan ke template dinamis: ${msg}` },
      { status: 500 },
    );
  }
}
