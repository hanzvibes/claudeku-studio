// System prompt untuk AI — diringkas dari SKILL.md threejs-cinematic-short v3.14.
// AI hanya diminta mengembalikan JSON Spec (lihat lib/spec.ts), bukan HTML.
import type { TemplateMeta } from "./templates";
import type { Spec } from "./spec";

export const SKILL_SUMMARY = `Kamu menulis resep video animasi 3D sinematik 9:16 (TikTok/Reels) berbahasa Indonesia.
Template adalah film three.js: semua gerak adalah fungsi murni dari waktu, kamera
meluncur antar shot, ada maskot (Claude oranye, Codex biru, Gemini ungu), monitor
dengan UI asli, dan speech bubble yang mengikuti kepala maskot.
Aturan dialog: alur klaim -> sanggahan -> eskalasi -> capek -> twist (skor seri)
-> ajakan kerja bareng / pertanyaan ke penonton. Setiap pembicara punya suara:
Claude tenang dan sedikit sombong soal kode rapi; Codex blak-blakan, terminal dulu;
Gemini pamer skala (konteks sejuta token). Lucu dan playful, jangan menghina produk
atau orang sungguhan. Satu ide per baris, kata akhir yang kuat.
Aturan keras: MAKSIMAL 2,5 kata per detik per caption (jendela 3,2 dtk = maks 8 kata).
Caption terurut, tidak tumpang tindih, semua waktu dalam durasi video.
Kredit @hanzvibes WAJIB ada di video (watermark + end card) — jangan pernah menghapusnya.`;

export function buildSystemPrompt(meta: TemplateMeta, currentSpec?: Spec | null): string {
  const speakerLines = meta.speakers.map((s, i) => `  ${i} = ${s}`).join("\n");
  const mode = currentSpec
    ? `MODE REVISI — pengguna sudah punya video dan meminta perubahan.
Spec SAAT INI (JSON, ini konteks yang harus kamu pertahankan):
${JSON.stringify(currentSpec, null, 2)}
Instruksi revisi:
- PERTAHANKAN semua yang TIDAK diminta diubah: dialog, timing, urutan, template.
- Hanya ubah yang diminta pengguna. Kalau pengguna minta ganti template, kamu BOLEH
  mengubah templateId ke template lain di bawah, dan SESUAIKAN semua waktu caption
  ke durasi (LEN) template baru — jangan ada caption yang keluar dari durasi baru.
  Kalau tidak diminta ganti template, templateId HARUS tetap "${currentSpec.templateId}".
- Kamu juga boleh mengubah title bila diminta / bila revisi mengubah cerita.
  Title tampil sebagai judul LAYAR di dalam video (#title), bukan cuma judul
  file — buat singkat dan jelas supaya muat di layar.
- Kembalikan SELALU spec LENGKAP (semua caption, bukan hanya yang berubah).`
    : `MODE BUAT BARU — buat resep video baru dari nol dari ide pengguna.`;
  return `${SKILL_SUMMARY}

Template terpilih: ${meta.title} (${meta.file})
- Durasi (LEN): ${meta.duration} detik. Semua caption harus berada di 0..${meta.duration}.
- Jumlah karakter: ${meta.characters}. Speaker yang tersedia:
${speakerLines}
${meta.hasSpeakerField ? "- Setiap caption punya speaker (angka di atas)." : "- Template ini 1 karakter, caption tanpa speaker."}
${mode}

Kembalikan HANYA satu object JSON valid (tanpa teks lain, tanpa markdown):
{
  "templateId": "${meta.id}",
  "title": "Judul video",
  "caps": [{"start": 3, "end": 6, "text": "Teks caption", "speaker": 0}],
  "vo": ["Teks voice-over yang diucapkan, sejajar dengan caps (boleh sama dengan teks caption, ejaan nama untuk suara: Klod untuk Claude)"],
  "notes": "catatan singkat (opsional)"
}
Isi "vo" dengan jumlah yang sama persis dengan jumlah caps.`;
}

export function buildUserPrompt(prompt: string, currentSpec?: Spec | null): string {
  if (currentSpec) {
    return `Revisi video ini sesuai instruksi berikut. Ingat: kembalikan spec LENGKAP yang sudah diperbarui, bukan patch.\n\nInstruksi: ${prompt}`;
  }
  return `Buatkan resep video baru dari ide berikut:\n\n${prompt}`;
}
