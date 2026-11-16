// POST /api/apply-scene { scene }
// Terapkan SceneSpec (dari editor manual / contoh / revisi contoh) ke template
// dinamis lewat jalur validasi + apply yang SAMA dengan /api/generate-scene.
// Dipakai juga untuk uji revisi tanpa AI live.
// Body bukan JSON -> 400. Scene tidak lolos validasi -> 422 + validationErrors.
import { NextResponse } from "next/server";
import { normalizeSceneSpec, validateSceneSpec, type SceneSpec } from "@/lib/scene-spec";
import { buildSceneHtml } from "@/lib/apply-scene";

export async function POST(req: Request) {
  let body: { scene?: SceneSpec };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body request bukan JSON yang valid." }, { status: 400 });
  }
  const scene = body.scene;
  const validationErrors = validateSceneSpec(scene);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: "SceneSpec tidak lolos validasi.", validationErrors }, { status: 422 });
  }
  const normalized = normalizeSceneSpec(scene as SceneSpec);
  try {
    const { html, previewHtml } = await buildSceneHtml(normalized);
    // html = canonical (CDN, untuk Download/export). previewHtml = rewrite
    // lokal /vendor (untuk preview di iframe). Jangan pernah tertukar.
    return NextResponse.json({ scene: normalized, html, previewHtml });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menerapkan scene ke template dinamis.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
