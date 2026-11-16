// Spec contoh (canned) — supaya generate/revisi bisa dites TANPA AI live,
// dan supaya pengguna bisa melihat hasil tanpa mengisi provider dulu.
import type { Spec } from "./spec";

/** Spec awal contoh untuk template versus (Claude vs Codex, 28 dtk). */
export const CANNED_SPEC: Spec = {
  templateId: "versus",
  title: "Claude vs Codex — Siapa Paling Cepat?",
  caps: [
    { start: 3, end: 6, text: "Aku paling cepat nulis kode!", speaker: 0 },
    { start: 6, end: 9, text: "Cepat doang? Aku langsung jalan!", speaker: 1 },
    { start: 9.2, end: 11.8, text: "Benchmark aku lebih tinggi!", speaker: 0 },
    { start: 11.8, end: 14.4, text: "Punyaku yang paling tinggi!", speaker: 1 },
    { start: 14.4, end: 16.8, text: "Aduh, capek debat…", speaker: 2 },
    { start: 17, end: 20.5, text: "Eh, skornya sama?!", speaker: 2 },
    { start: 21.2, end: 25, text: "Mending kerja bareng aja!", speaker: 2 },
  ],
  vo: [
    "Aku paling cepat nulis kode!",
    "Cepat doang? Aku langsung jalan!",
    "Benchmark aku lebih tinggi!",
    "Punyaku yang paling tinggi!",
    "Aduh, capek debat.",
    "Eh, skornya sama?!",
    "Mending kerja bareng aja!",
  ],
  notes: "Spec contoh (canned) untuk tes tanpa AI.",
};

/**
 * Revisi contoh (canned) dari sebuah spec: ubah 1 caption (ending) + judul.
 * Dipakai tombol "Coba revisi contoh" dan uji otomatis — melewati jalur
 * validasi + apply yang sama dengan revisi dari AI.
 */
export function cannedRevisionExample(spec: Spec): Spec {
  const caps = spec.caps.map((c) => ({ ...c }));
  const last = caps[caps.length - 1];
  if (last) {
    last.text = "Kerja bareng, itu yang paling cepat!";
    last.end = Math.min(last.end, 25);
  }
  const vo = [...spec.vo];
  if (vo.length > 0) vo[vo.length - 1] = "Kerja bareng, itu yang paling cepat!";
  return {
    ...spec,
    title: spec.title.includes("—") ? `${spec.title.split("—")[0].trim()} — Kerja Bareng` : `${spec.title} — Kerja Bareng`,
    caps,
    vo,
    notes: "Revisi contoh: ending diganti jadi ajakan kerja bareng.",
  };
}
