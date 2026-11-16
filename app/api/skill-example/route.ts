// GET /api/skill-example — contoh template jalur "Skill penuh" TANPA AI.
// Mengembalikan HTML canonical template trio apa adanya (file bawaan yang
// sudah lolos lint) + judul + durasi, supaya jalur skill bisa dicoba,
// disimpan, dan direvisi tanpa provider live. Dipakai tombol
// "Coba contoh template (tanpa AI)" di mode Skill.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";
import { extractSkillLen, extractSkillTitle, validateSkillHtml } from "@/lib/skill-validate";

export async function GET() {
  try {
    const html = await fs.readFile(path.join(process.cwd(), "public", "templates", "template-trio.html"), "utf-8");
    const errors = validateSkillHtml(html);
    if (errors.length > 0) {
      return NextResponse.json({ error: "Template contoh tidak lolos validasi keamanan.", validationErrors: errors }, { status: 500 });
    }
    const { html: previewHtml, replaced } = rewriteThreeCdnToLocal(html);
    if (replaced !== 13) {
      return NextResponse.json({ error: `Template contoh hanya memuat ${replaced} script three.js (harus 13).` }, { status: 500 });
    }
    return NextResponse.json({
      title: extractSkillTitle(html) ?? "Claude vs Codex vs Gemini",
      html,
      previewHtml,
      duration: extractSkillLen(html) ?? 32,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal memuat template contoh.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
