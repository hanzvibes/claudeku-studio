import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getTemplate } from "@/lib/templates";
import { normalizeSpec, validateSpec, type Spec } from "@/lib/spec";
import { applySpecToHtml } from "@/lib/apply-spec";
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";

// POST /api/apply { templateId, spec }
// Terapkan spec (dari editor manual / spec contoh / revisi contoh) ke template
// lewat jalur validasi + apply yang SAMA dengan /api/generate.
// Dipakai juga untuk uji revisi tanpa AI live.
export async function POST(req: Request) {
  let body: { templateId?: string; spec?: Spec };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body request bukan JSON yang valid." }, { status: 400 });
  }
  const spec = body.spec;
  const validationErrors = validateSpec(spec);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: "Spec tidak lolos validasi.", validationErrors }, { status: 422 });
  }
  const normalized = normalizeSpec(spec as Spec);
  const meta = getTemplate(normalized.templateId);
  if (!meta) return NextResponse.json({ error: "templateId tidak dikenal." }, { status: 400 });
  try {
    const html = await fs.readFile(path.join(process.cwd(), "public", "templates", meta.file), "utf-8");
    const applied = applySpecToHtml(html, normalized);
    // html = canonical (CDN, untuk Download/export). previewHtml = rewrite
    // lokal /vendor (untuk preview di iframe). Jangan pernah tertukar.
    const { html: previewHtml } = rewriteThreeCdnToLocal(applied);
    return NextResponse.json({ spec: normalized, html: applied, previewHtml, templateId: normalized.templateId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menerapkan spec ke template.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
