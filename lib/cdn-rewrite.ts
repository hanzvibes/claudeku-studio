// Rewrite CDN -> lokal KHUSUS UNTUK PREVIEW di Studio.
//
// Masalah: 12 template di public/templates/*.html memuat three.js r128 + 12
// file postprocessing dari CDN (cdnjs + cdn.jsdelivr, 13 script tag per file).
// CDN itu ke-block proxy di lingkungan ini, sehingga preview 3D hitam total
// ("THREE is not defined"). Di browser normal / tablet user CDN kemungkinan
// jalan, tapi preview lokal di VM mati.
//
// Solusi: file vendor three.js yang sama (13 file, 704K) disalin ke
// public/vendor/. Fungsi di sini menukar 13 URL CDN itu dengan /vendor/<nama>
// SAAT SERVE preview saja — urutan script tetap sama seperti aslinya.
//
// JANGAN dipakai untuk export: HTML canonical (public/templates/*.html) dan
// HTML hasil Download (data.html dari /api/apply & /api/generate) TETAP pakai
// link CDN, supaya file hasil download jalan standalone di browser normal.
// Pemisahan: preview = rewrite lokal, export = CDN asli.
export const CDN_THREE_MAIN =
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
export const CDN_THREE_EXAMPLES_PREFIX =
  "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/";

/** Jumlah script three.js CDN yang dikenali di sebuah HTML. */
export function countCdnThreeScripts(html: string): number {
  const main = html.includes(CDN_THREE_MAIN) ? 1 : 0;
  const examples = html.split(CDN_THREE_EXAMPLES_PREFIX).length - 1;
  return main + examples;
}

/**
 * Tukar 13 URL CDN three.js r128 dengan /vendor/<basename>.
 * Mengembalikan { html, replaced } — replaced harus 13 untuk template
 * canonical; bila 0, HTML bukan template three.js yang dikenal.
 * Hanya menyentuh URL script three.js; font Google, konten, dan urutan
 * script lainnya tidak diubah.
 */
export function rewriteThreeCdnToLocal(html: string): { html: string; replaced: number } {
  let replaced = 0;
  let out = html;
  if (out.includes(CDN_THREE_MAIN)) {
    out = out.split(CDN_THREE_MAIN).join("/vendor/three.min.js");
    replaced += 1;
  }
  out = out.replace(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/examples\/js\/(?:shaders|postprocessing)\/([A-Za-z0-9]+\.js)/g,
    (_m, file: string) => {
      replaced += 1;
      return `/vendor/${file}`;
    },
  );
  return { html: out, replaced };
}
