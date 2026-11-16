// "Resep" video: satu-satunya hal yang boleh diubah AI / editor.
// AI TIDAK PERNAH menulis ulang HTML mentah — ia hanya mengembalikan JSON ini,
// lalu lib/apply-spec.ts menempelkannya ke template dengan aman.
import { getTemplate, type TemplateMeta } from "./templates";

export type Cap = { start: number; end: number; text: string; speaker?: number };

export type Spec = {
  templateId: string;
  title: string;
  caps: Cap[];
  vo: string[]; // sejajar caps, satu teks voice-over per caption (boleh = teks caption)
  notes?: string;
};

export const MAX_WORDS_PER_SECOND = 2.6;

export function wordsPerSecond(cap: Cap): number {
  const words = cap.text.trim().split(/\s+/).filter(Boolean).length;
  const dur = cap.end - cap.start;
  return dur > 0 ? words / dur : Infinity;
}

/** Validasi spec. Kembalikan daftar error (kosong = lolos). */
export function validateSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== "object") return ["Spec harus berupa object JSON."];
  const s = spec as Partial<Spec>;
  const meta: TemplateMeta | undefined =
    typeof s.templateId === "string" ? getTemplate(s.templateId) : undefined;
  if (!meta) {
    errors.push(`templateId tidak dikenal: ${String(s.templateId)}.`);
    return errors;
  }
  if (!s.title || typeof s.title !== "string" || !s.title.trim()) {
    errors.push("title wajib diisi.");
  }
  if (!Array.isArray(s.caps) || s.caps.length === 0) {
    errors.push("caps wajib berupa array dan tidak boleh kosong.");
    return errors;
  }
  const caps = s.caps as Cap[];
  let prevEnd = -1;
  caps.forEach((c, i) => {
    const label = `caps[${i}]`;
    if (typeof c.start !== "number" || typeof c.end !== "number") {
      errors.push(`${label}: start/end harus angka.`);
      return;
    }
    if (!(c.start >= 0)) errors.push(`${label}: start tidak boleh negatif.`);
    if (!(c.end > c.start)) errors.push(`${label}: end harus lebih besar dari start.`);
    if (c.end > meta.duration) {
      errors.push(`${label}: end ${c.end} melewati durasi template ${meta.duration} dtk.`);
    }
    if (c.start < prevEnd) errors.push(`${label}: caption tumpang tindih / tidak terurut.`);
    prevEnd = Math.max(prevEnd, c.end);
    if (!c.text || typeof c.text !== "string" || !c.text.trim()) {
      errors.push(`${label}: teks tidak boleh kosong.`);
    } else {
      const wps = wordsPerSecond(c);
      if (wps > MAX_WORDS_PER_SECOND) {
        errors.push(
          `${label}: terlalu cepat (${wps.toFixed(1)} kata/dtk, maks ${MAX_WORDS_PER_SECOND}) — perpendek teks atau perpanjang waktunya.`,
        );
      }
    }
    if (meta.hasSpeakerField) {
      if (c.speaker !== undefined && (!Number.isInteger(c.speaker) || c.speaker < 0 || c.speaker >= meta.speakers.length)) {
        errors.push(`${label}: speaker ${c.speaker} tidak valid (0..${meta.speakers.length - 1}).`);
      }
    }
  });
  if (s.vo !== undefined) {
    if (!Array.isArray(s.vo) || s.vo.length !== caps.length) {
      errors.push(`vo harus berisi ${caps.length} teks (satu per caption).`);
    } else if (s.vo.some((v) => typeof v !== "string" || !v.trim())) {
      errors.push("vo tidak boleh berisi teks kosong.");
    }
  }
  return errors;
}

/** Normalisasi ringan (tanpa menyembunyikan error): trim teks, isi speaker/vo default. */
export function normalizeSpec(spec: Spec): Spec {
  const meta = getTemplate(spec.templateId);
  const caps = [...spec.caps]
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      start: c.start,
      end: c.end,
      text: c.text.trim(),
      speaker: meta?.hasSpeakerField ? (c.speaker ?? 0) : undefined,
    }));
  return {
    templateId: spec.templateId,
    title: spec.title.trim(),
    caps,
    vo: spec.vo && spec.vo.length === caps.length ? spec.vo.map((v) => v.trim()) : caps.map((c) => c.text),
    notes: spec.notes?.trim() || undefined,
  };
}

/** Ambil JSON dari jawaban AI yang mungkin dibungkus ```json / teks lain. */
export function extractJsonFromText(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Jawaban AI tidak mengandung object JSON.");
  const slice = cleaned.slice(start, end + 1);
  return JSON.parse(slice);
}

// ---------- Parsing template HTML asli (dipakai /api/template & apply) ----------

/** Scan array JS yang diawali `needle=[`, hormati string '...' (escape \'). */
export function findBracketArray(html: string, needle: string): { content: string; start: number; end: number } | null {
  const idx = html.indexOf(needle);
  if (idx < 0) return null;
  const open = html.indexOf("[", idx);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return { content: html.slice(open + 1, i), start: open, end: i + 1 };
    }
  }
  return null;
}

function unescapeJsString(s: string): string {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

/** Parse caps/VO/LEN/title dari HTML template asli. */
export function parseTemplateHtml(html: string): { len: number; title: string; caps: Cap[]; vo: string[]; voDerived: boolean } {
  const lenMatch = html.match(/\bLEN\s*=\s*(\d*\.?\d+)/);
  if (!lenMatch) throw new Error("LEN tidak ditemukan di template.");
  const len = Number(lenMatch[1]);
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch ? titleMatch[1] : "";
  const capsArr = findBracketArray(html, "caps=");
  if (!capsArr) throw new Error("caps tidak ditemukan di template.");
  const caps: Cap[] = [];
  const re = /\[(\d*\.?\d+),(\d*\.?\d+),'((?:[^'\\]|\\.)*)'(?:,(\d+))?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(capsArr.content)) !== null) {
    caps.push({
      start: Number(m[1]),
      end: Number(m[2]),
      text: unescapeJsString(m[3]),
      speaker: m[5] !== undefined ? Number(m[5]) : undefined,
    });
  }
  if (caps.length === 0) throw new Error("caps kosong / tidak bisa di-parse.");
  const voDerived = /VO\s*=\s*caps\.map/.test(html);
  let vo: string[] = [];
  if (!voDerived) {
    const voArr = findBracketArray(html, "VO=");
    if (voArr) {
      const vre = /'((?:[^'\\]|\\.)*)'/g;
      let vm: RegExpExecArray | null;
      while ((vm = vre.exec(voArr.content)) !== null) vo.push(unescapeJsString(vm[1]));
    }
  }
  if (vo.length !== caps.length) vo = caps.map((c) => c.text);
  return { len, title, caps, vo, voDerived };
}
