import { NextResponse } from "next/server";

// POST /api/test-provider { baseUrl, model, apiKey? }
// Tes koneksi ke provider custom OpenAI-compatible.
// API key TIDAK PERNAH di-log dan tidak pernah dikembalikan di respons.
export async function POST(req: Request) {
  let body: { baseUrl?: string; model?: string; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body request bukan JSON yang valid." }, { status: 400 });
  }
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  const model = (body.model ?? "").trim();
  const apiKey = body.apiKey ?? "";

  let url: URL;
  try {
    url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Base URL tidak valid. Contoh yang benar: https://api.provider.com/v1" },
      { status: 400 },
    );
  }
  if (!model) {
    return NextResponse.json({ ok: false, error: "Model ID wajib diisi." }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const fetchWithTimeout = async (input: string, init: RequestInit, ms: number) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };

  // 1. Coba GET /models dulu (cara standar mengecek provider OpenAI-compatible).
  try {
    const res = await fetchWithTimeout(`${baseUrl}/models`, { headers }, 15000);
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      const models = Array.isArray(data.data) ? data.data.map((d) => d.id).filter(Boolean) : [];
      return NextResponse.json({ ok: true, via: "models", models });
    }
    // 2. /models gagal (mis. provider tidak menyediakan) -> fallback chat completion minimal.
    const chat = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      },
      15000,
    );
    if (chat.ok) {
      return NextResponse.json({ ok: true, via: "chat", models: [model], note: "Endpoint /models tidak tersedia di provider ini, tapi chat completion berhasil." });
    }
    const detail = await chat.text().catch(() => "");
    return NextResponse.json({
      ok: false,
      error: `Provider menolak koneksi (status ${chat.status}). Periksa Base URL, Model ID, dan API Key di Settings.${detail ? " Pesan provider: " + detail.slice(0, 200) : ""}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const reason = msg.includes("abort") ? "waktu habis (15 detik)" : msg;
    return NextResponse.json({
      ok: false,
      error: `Tidak bisa menghubungi provider di ${url.host} (${reason}). Periksa Base URL dan koneksi internet.`,
    });
  }
}
