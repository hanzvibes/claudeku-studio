// Menempelkan Spec ke HTML template — satu-satunya tempat HTML diubah.
// Aturan: hanya ganti baris <title>, array caps=[...], dan array VO=[...] bila
// eksplisit. Kalau pola tidak ditemukan -> throw, jangan hasilkan HTML rusak.
// Credit @hanzvibes TIDAK PERNAH disentuh; hasil akhir divalidasi ulang.
import { getTemplate } from "./templates";
import { findBracketArray, parseTemplateHtml, type Spec } from "./spec";

export function escapeJsSingleQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function capsLiteral(spec: Spec): string {
  const meta = getTemplate(spec.templateId);
  return spec.caps
    .map((c) => {
      const text = escapeJsSingleQuoted(c.text);
      if (meta?.hasSpeakerField) return `[${c.start},${c.end},'${text}',${c.speaker ?? 0}]`;
      return `[${c.start},${c.end},'${text}']`;
    })
    .join(",");
}

function voLiteral(spec: Spec): string {
  return spec.vo.map((v) => `'${escapeJsSingleQuoted(v)}'`).join(",");
}

export function validateCredit(html: string): string[] {
  const errors: string[] = [];
  const count = (html.match(/@hanzvibes/g) || []).length;
  if (count < 2) errors.push(`Credit @hanzvibes hilang/rusak (ditemukan ${count}x, wajib minimal 2x).`);
  if (!html.includes("by @hanzvibes")) errors.push('Credit end card "by @hanzvibes" hilang.');
  if (!html.includes('id="wm"')) errors.push("Watermark #wm hilang.");
  return errors;
}

export function applySpecToHtml(html: string, spec: Spec): string {
  const meta = getTemplate(spec.templateId);
  if (!meta) throw new Error(`templateId tidak dikenal: ${spec.templateId}`);

  // 1. Judul
  if (!/<title>[^<]*<\/title>/.test(html)) throw new Error("<title> tidak ditemukan di template.");
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(spec.title)}</title>`);

  // 2. Caps — ganti isi array caps=[...] (scan bracket yang seimbang)
  const capsArr = findBracketArray(out, "caps=");
  if (!capsArr) throw new Error("caps=[...] tidak ditemukan di template.");
  out = out.slice(0, capsArr.start + 1) + capsLiteral(spec) + out.slice(capsArr.end - 1);

  // 3. VO — hanya bila template punya VO=[...] eksplisit; bila VO=caps.map(...),
  //    VO mengikuti caps otomatis, jadi tidak disentuh.
  if (!/VO\s*=\s*caps\.map/.test(out)) {
    const voArr = findBracketArray(out, "VO=");
    if (!voArr) throw new Error("VO=[...] tidak ditemukan di template (dan bukan VO turunan caps).");
    out = out.slice(0, voArr.start + 1) + voLiteral(spec) + out.slice(voArr.end - 1);
  }

  // 4. Validasi akhir: credit utuh + hasil parse kembali sama dengan spec.
  const creditErrors = validateCredit(out);
  if (creditErrors.length > 0) throw new Error(creditErrors.join(" "));
  const parsed = parseTemplateHtml(out);
  if (parsed.caps.length !== spec.caps.length) {
    throw new Error(`Hasil apply tidak konsisten: ${parsed.caps.length} caption, seharusnya ${spec.caps.length}.`);
  }
  for (let i = 0; i < spec.caps.length; i++) {
    if (parsed.caps[i].text !== spec.caps[i].text || parsed.caps[i].start !== spec.caps[i].start || parsed.caps[i].end !== spec.caps[i].end) {
      throw new Error(`Hasil apply tidak konsisten pada caption ${i + 1}.`);
    }
  }
  return out;
}
