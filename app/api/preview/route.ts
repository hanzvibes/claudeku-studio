import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getTemplate } from "@/lib/templates";
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";

// GET /api/preview?id=versus — serve template untuk PREVIEW di iframe Studio.
// Membaca HTML canonical dari public/templates/ (TIDAK diubah), lalu me-rewrite
// 13 URL CDN three.js r128 -> /vendor/<nama> agar preview jalan di lingkungan
// yang memblokir CDN (proxy VM). Urutan script tetap sama.
// HTML canonical + export Download TETAP pakai CDN (lihat lib/cdn-rewrite.ts).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "versus";
  const meta = getTemplate(id);
  if (!meta) return NextResponse.json({ error: `templateId tidak dikenal: ${id}` }, { status: 404 });
  try {
    const html = await fs.readFile(path.join(process.cwd(), "public", "templates", meta.file), "utf-8");
    const { html: previewHtml, replaced } = rewriteThreeCdnToLocal(html);
    if (replaced === 0) {
      return NextResponse.json({ error: "Template tidak mengandung script three.js CDN yang dikenal." }, { status: 500 });
    }
    return new NextResponse(previewHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Rewritten-Cdn-Scripts": String(replaced) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal membaca template.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
