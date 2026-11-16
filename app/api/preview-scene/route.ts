import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";
import { DYNAMIC_TEMPLATE_FILE, SCENE_SPEC_PLACEHOLDER } from "@/lib/apply-scene";

// GET /api/preview-scene — serve public/templates/dynamic.html untuk
// PREVIEW AWAL saat streaming dimulai (dokumen same-origin biasa, bukan
// blob — jadi /vendor/ resolve normal dan postMessage live-update dari
// parent bekerja).
//
// Placeholder SceneSpec diganti `null`: renderer punya DEFAULT_SPEC
// fallback bila SPEC_RAW falsy, jadi iframe langsung memainkan scene
// default sambil menunggu partial pertama via postMessage 'claudeku-scene'.
// Rewrite CDN -> /vendor/ lokal HARUS 13, sama seperti /api/preview.
export async function GET() {
  try {
    const template = await fs.readFile(
      path.join(process.cwd(), "public", "templates", DYNAMIC_TEMPLATE_FILE),
      "utf-8",
    );
    const occurrences = template.split(SCENE_SPEC_PLACEHOLDER).length - 1;
    if (occurrences !== 1) {
      return NextResponse.json(
        { error: `Placeholder ${SCENE_SPEC_PLACEHOLDER} ditemukan ${occurrences}x di template dinamis (harus tepat 1x).` },
        { status: 500 },
      );
    }
    const html = template.split(SCENE_SPEC_PLACEHOLDER).join("null");
    const { html: previewHtml, replaced } = rewriteThreeCdnToLocal(html);
    if (replaced !== 13) {
      return NextResponse.json(
        { error: `Rewrite CDN ke /vendor/ hanya mengganti ${replaced} script (harus 13).` },
        { status: 500 },
      );
    }
    return new NextResponse(previewHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Rewritten-Cdn-Scripts": String(replaced) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal membaca template dinamis.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
