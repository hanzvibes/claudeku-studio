// Helper bersama untuk jalur SceneSpec -> HTML dinamis.
// Dipakai /api/apply-scene dan /api/generate-scene (dan hanya mereka).
// Pemisahan canonical vs preview sama seperti /api/apply & /api/generate:
// html = canonical (CDN, untuk Download/export), previewHtml = rewrite lokal
// /vendor (untuk preview di iframe). Jangan pernah tertukar.
import { promises as fs } from "fs";
import path from "path";
import { rewriteThreeCdnToLocal } from "./cdn-rewrite";
import type { SceneSpec } from "./scene-spec";

/** Placeholder di public/templates/dynamic.html yang diganti JSON SceneSpec. */
export const SCENE_SPEC_PLACEHOLDER = "__SCENE_SPEC_JSON__";

/** Nama file renderer dinamis di public/templates/. */
export const DYNAMIC_TEMPLATE_FILE = "dynamic.html";

/**
 * Tempel SceneSpec ke HTML template dinamis: ganti placeholder
 * `__SCENE_SPEC_JSON__` dengan JSON.stringify(scene).
 * Placeholder harus muncul TEPAT 1 kali — kalau tidak, throw (jangan
 * hasilkan HTML rusak / spec setengah menempel).
 */
export function applySceneSpecToHtml(html: string, scene: SceneSpec): string {
  const occurrences = html.split(SCENE_SPEC_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Placeholder ${SCENE_SPEC_PLACEHOLDER} ditemukan ${occurrences}x di template dinamis (harus tepat 1x).`,
    );
  }
  return html.split(SCENE_SPEC_PLACEHOLDER).join(JSON.stringify(scene));
}

/**
 * Baca public/templates/dynamic.html, terapkan scene, kembalikan sepasang
 * HTML: canonical (CDN) + preview (rewrite /vendor lokal).
 * Throw bila template tidak ada, placeholder tidak tepat 1x, atau rewrite
 * CDN tidak mengganti tepat 13 script three.js (template dinamis wajib
 * memuat 13 URL CDN yang sama seperti 9 template bawaan).
 */
export async function buildSceneHtml(scene: SceneSpec): Promise<{ html: string; previewHtml: string }> {
  const template = await fs.readFile(
    path.join(process.cwd(), "public", "templates", DYNAMIC_TEMPLATE_FILE),
    "utf-8",
  );
  const html = applySceneSpecToHtml(template, scene);
  const { html: previewHtml, replaced } = rewriteThreeCdnToLocal(html);
  if (replaced !== 13) {
    throw new Error(
      `Rewrite CDN ke /vendor/ hanya mengganti ${replaced} script (harus 13). ` +
        `Template dinamis mungkin tidak memuat 13 URL three.js r128 yang dikenal.`,
    );
  }
  return { html, previewHtml };
}
