// Validasi keamanan + ekstraksi untuk HTML template jalur "Skill penuh".
// MURNI (tanpa DOM/fetch/fs) supaya bisa dites langsung dengan node:test.
//
// HTML hasil AI dirender di iframe Blob — dan dokumen Blob mewarisi origin
// halaman Studio, jadi skrip di dalamnya BISA mengakses localStorage / DOM
// halaman bila lolos. Karena itu HTML WAJIB lolos validasi ini SEBELUM
// disimpan di "Video Buatan Saya" maupun di-preview. Validasi dijalankan
// server-side di /api/generate-skill (sebelum lint + simpan) dan diulang
// client-side di applySkill sebagai defense-in-depth.
//
// Daftar blokir (aturan yang dilanggar -> error, HTML DITOLAK):
// - Network: fetch(, XMLHttpRequest, WebSocket, EventSource, sendBeacon,
//   import( (dynamic import kode remote), api.anthropic.com
// - Storage/cookie: localStorage, sessionStorage, document.cookie
// - Eksekusi dinamis: eval(, new Function(
// - Navigasi/frame: window.open(, top.location, location.href, <iframe
// - Form: <form (juga dicek lint_short.py)
// - Script src: hanya host CDN yang diizinkan skill (cdnjs, jsdelivr npm,
//   cdn.tailwindcss.com, code.jquery.com) — sama seperti lint_short.py;
//   three.js wajib r128 / 0.128.0 (dicek lint).
// - DOM berbahaya: document.write.
//   (innerHTML SENGAJA tidak diblokir: pola template bawaan memakainya
//   untuk SVG statis — `s.innerHTML=[...].join('')` di trio + player
//   galeri. Kanal eksfiltrasi sebenarnya — network, storage, cookie,
//   eval — sudah diblokir di atas, jadi innerHTML tanpa kanal itu tidak
//   bisa membocorkan apa pun keluar.)
//
// Yang TIDAK diblokir (dipakai template bawaan): WebGL/three.js, canvas,
// speechSynthesis (VO), requestAnimationFrame, setTimeout/setInterval
// (loop template), pointer events, document.getElementById /
// querySelector / createElement / fonts.
export type SkillVideo = {
  title: string;
  /** HTML lengkap (canonical, CDN) — disimpan di entri MineEntry kind "template". */
  html: string;
  /** LEN (durasi detik) dari HTML. */
  duration: number;
};

/** Host yang diizinkan untuk <script src> dan <link href> (aturan skill). */
export const ALLOWED_SCRIPT_HOSTS = [
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net/npm/",
  "cdn.tailwindcss.com",
  "code.jquery.com",
] as const;

const BLOCKED_PATTERNS: { re: RegExp; msg: string }[] = [
  { re: /\bfetch\s*\(/, msg: "fetch() tidak diizinkan di template (akses network)." },
  { re: /\bXMLHttpRequest\b/, msg: "XMLHttpRequest tidak diizinkan di template (akses network)." },
  { re: /\bWebSocket\b/, msg: "WebSocket tidak diizinkan di template (akses network)." },
  { re: /\bEventSource\b/, msg: "EventSource tidak diizinkan di template (akses network)." },
  { re: /navigator\s*\.\s*sendBeacon/, msg: "navigator.sendBeacon tidak diizinkan di template." },
  { re: /\bimport\s*\(/, msg: "import() dinamis tidak diizinkan di template (kode remote)." },
  { re: /\blocalStorage\b/, msg: "localStorage tidak diizinkan di template." },
  { re: /\bsessionStorage\b/, msg: "sessionStorage tidak diizinkan di template." },
  { re: /document\s*\.\s*cookie/, msg: "document.cookie tidak diizinkan di template." },
  { re: /\beval\s*\(/, msg: "eval() tidak diizinkan di template." },
  { re: /\bnew\s+Function\s*\(/, msg: "new Function() tidak diizinkan di template." },
  { re: /window\s*\.\s*open\s*\(/, msg: "window.open() tidak diizinkan di template." },
  { re: /\btop\s*\.\s*location\b/, msg: "top.location tidak diizinkan di template." },
  { re: /location\s*\.\s*href\s*=/, msg: "location.href tidak diizinkan di template." },
  { re: /<iframe[\s>]/i, msg: "Tag <iframe> tidak diizinkan di template." },
  { re: /<form[\s>]/i, msg: "Tag <form> tidak diizinkan di template." },
  { re: /api\.anthropic\.com/, msg: "Panggilan ke api.anthropic.com tidak diizinkan di template." },
  { re: /document\s*\.\s*write\s*\(/, msg: "document.write() tidak diizinkan di template." },
];

/**
 * Validasi keamanan HTML template skill. Kembalikan daftar error
 * (kosong = lolos). Pemeriksaan berbasis pola teks — sengaja konservatif:
 * pola yang TIDAK ADA di 9 template bawaan langsung ditolak, jadi template
 * hasil AI yang meniru pola trio akan lolos.
 */
export function validateSkillHtml(html: string): string[] {
  const errors: string[] = [];
  if (!html || !html.trim()) return ["HTML kosong."];
  if (!/<!DOCTYPE html>/i.test(html)) errors.push("HTML harus diawali <!DOCTYPE html>.");
  if (!/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) {
    errors.push("HTML tidak lengkap (tag <html> / </html> hilang).");
  }
  if (!/\bLEN\s*=/.test(html)) errors.push("LEN (durasi video) tidak ditemukan di template.");
  if (!/id="wm"/.test(html) || (html.match(/@hanzvibes/g) || []).length < 2) {
    errors.push('Credit @hanzvibes hilang/rusak (wajib #wm + minimal 2x "@hanzvibes").');
  }
  if (!html.includes("by @hanzvibes")) errors.push('Credit end card "by @hanzvibes" hilang.');
  if (!/viewport-fit=cover/.test(html)) {
    errors.push("Meta viewport dengan viewport-fit=cover hilang.");
  }
  for (const { re, msg } of BLOCKED_PATTERNS) {
    if (re.test(html)) errors.push(msg);
  }
  // Script src: hanya host yang diizinkan (aturan yang sama dengan lint).
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const src = m[1];
    const ok = ALLOWED_SCRIPT_HOSTS.some((h) => src.startsWith(`https://${h}`));
    if (!ok) errors.push(`Script src tidak diizinkan: ${src}`);
  }
  // Stylesheet: hanya Google Fonts (aturan yang sama dengan lint).
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
    const href = m[1];
    if (!href.startsWith("https://fonts.googleapis.com") && !href.startsWith("https://fonts.gstatic.com")) {
      errors.push(`Stylesheet tidak diizinkan: ${href}`);
    }
  }
  return errors;
}

/** Ambil judul dari <title> (null bila tidak ada). */
export function extractSkillTitle(html: string): string | null {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1].trim() || null : null;
}

/** Ambil LEN (durasi detik) dari HTML (null bila tidak ada / bukan angka). */
export function extractSkillLen(html: string): number | null {
  const m = html.match(/\bLEN\s*=\s*(\d*\.?\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Escape teks untuk disisipkan sebagai text node HTML. */
export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Ganti judul HTML skill (dipakai revisi contoh tanpa AI + validasi):
 * <title> dan TEKS judul layar di <div id="title"> diganti, subjudul
 * <small> dibiarkan. Throw bila pola tidak ditemukan.
 * Pola sama seperti lib/apply-spec.ts langkah 1/1b (template bawaan).
 */
export function retitleSkillHtml(html: string, title: string): string {
  if (!/<title>[^<]*<\/title>/.test(html)) throw new Error("<title> tidak ditemukan di HTML.");
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtmlText(title)}</title>`);
  const titleDiv = /(<div id="title"><svg class="st"><\/svg>)[\s\S]*?(<small)/.exec(out);
  if (!titleDiv) throw new Error('Judul layar <div id="title"> tidak ditemukan di HTML.');
  out =
    out.slice(0, titleDiv.index) +
    titleDiv[1] +
    escapeHtmlText(title) +
    titleDiv[2] +
    out.slice(titleDiv.index + titleDiv[0].length);
  return out;
}
