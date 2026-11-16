import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getTemplate } from "@/lib/templates";
import { normalizeSpec, validateSpec, extractJsonFromText, type Spec } from "@/lib/spec";
import { applySpecToHtml } from "@/lib/apply-spec";
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/skill";

type Provider = { baseUrl: string; model: string; apiKey: string };

// POST /api/generate { prompt, templateId?, provider, currentSpec? }
// - Tanpa currentSpec: MODE BUAT BARU.
// - Dengan currentSpec: MODE REVISI — AI menerima spec aktif sebagai konteks dan
//   wajib mengembalikan spec LENGKAP yang sudah diperbarui (bukan patch).
// API key hanya diteruskan ke provider pengguna, tidak disimpan / di-log.
export async function POST(req: Request) {
  let body: { prompt?: string; templateId?: string; provider?: Provider; currentSpec?: Spec };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body request bukan JSON yang valid." }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Prompt tidak boleh kosong." }, { status: 400 });

  const currentSpec = body.currentSpec ?? null;
  if (currentSpec) {
    const curErrors = validateSpec(currentSpec);
    if (curErrors.length > 0) {
      return NextResponse.json({ error: "Spec saat ini tidak valid, tidak bisa direvisi.", validationErrors: curErrors }, { status: 422 });
    }
  }

  const templateId = body.templateId ?? currentSpec?.templateId ?? "versus";
  const meta = getTemplate(templateId);
  if (!meta) return NextResponse.json({ error: `templateId tidak dikenal: ${templateId}` }, { status: 400 });

  const provider = body.provider;
  if (!provider || !provider.baseUrl?.trim() || !provider.model?.trim()) {
    return NextResponse.json({
      error: "Provider belum diisi. Buka Settings dan isi Base URL + Model (API Key bila provider kamu membutuhkannya).",
      code: "PROVIDER_MISSING",
    }, { status: 400 });
  }
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, "");
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
  } catch {
    return NextResponse.json({ error: "Base URL provider tidak valid." }, { status: 400 });
  }

  const system = buildSystemPrompt(meta, currentSpec);
  const user = buildUserPrompt(prompt, currentSpec);

  let raw: string;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
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
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({
        error: `Provider mengembalikan status ${res.status}. Periksa Model ID dan API Key di Settings.${detail ? " Pesan provider: " + detail.slice(0, 300) : ""}`,
      }, { status: 502 });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    raw = data.choices?.[0]?.message?.content ?? "";
    if (!raw.trim()) {
      return NextResponse.json({ error: "Provider mengembalikan jawaban kosong. Coba lagi." }, { status: 502 });
    }
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("abort") ? "waktu habis (60 detik)" : "tidak bisa dihubungi";
    return NextResponse.json({ error: `Provider ${msg}. Periksa Base URL dan koneksi internet.` }, { status: 502 });
  }

  // Parse + validasi spec dari AI (spec bisa pindah template bila diminta di revisi).
  let parsed: unknown;
  try {
    parsed = extractJsonFromText(raw);
  } catch {
    return NextResponse.json({
      error: "AI mengembalikan jawaban yang bukan JSON. Coba lagi dengan prompt yang lebih jelas.",
      rawPreview: raw.slice(0, 500),
    }, { status: 422 });
  }
  const validationErrors = validateSpec(parsed);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: "Spec dari AI tidak lolos validasi.", validationErrors }, { status: 422 });
  }
  const spec = normalizeSpec(parsed as Spec);
  const targetMeta = getTemplate(spec.templateId);
  if (!targetMeta) return NextResponse.json({ error: "Spec AI memakai templateId yang tidak dikenal." }, { status: 422 });

  try {
    const html = await fs.readFile(path.join(process.cwd(), "public", "templates", targetMeta.file), "utf-8");
    const applied = applySpecToHtml(html, spec);
    // html = canonical (CDN, untuk Download/export). previewHtml = rewrite
    // lokal /vendor (untuk preview di iframe). Jangan pernah tertukar.
    const { html: previewHtml } = rewriteThreeCdnToLocal(applied);
    return NextResponse.json({ spec, html: applied, previewHtml, templateId: spec.templateId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menerapkan spec ke template.";
    return NextResponse.json({ error: `Spec lolos validasi tapi gagal diterapkan ke template: ${msg}` }, { status: 500 });
  }
}
