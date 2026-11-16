import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getTemplate } from "@/lib/templates";
import { parseTemplateHtml } from "@/lib/spec";

// GET /api/template?id=versus — baca template asli dari disk, kembalikan
// LEN, judul, caps, dan VO yang sudah di-parse (untuk editor caption).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "versus";
  const meta = getTemplate(id);
  if (!meta) return NextResponse.json({ error: `templateId tidak dikenal: ${id}` }, { status: 404 });
  try {
    const html = await fs.readFile(path.join(process.cwd(), "public", "templates", meta.file), "utf-8");
    const parsed = parseTemplateHtml(html);
    return NextResponse.json({ meta, len: parsed.len, title: parsed.title, caps: parsed.caps, vo: parsed.vo, voDerived: parsed.voDerived });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal membaca template.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
