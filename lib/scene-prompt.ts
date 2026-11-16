// System prompt + user prompt untuk AI penulis SceneSpec (mesin scene
// data-driven, Hybrid Level 4). AI mengembalikan JSON SceneSpec LENGKAP,
// bukan HTML — HTML dibangun server-side dari public/templates/dynamic.html
// lewat lib/apply-scene.ts.
import { vocabSummary, type SceneSpec } from "./scene-spec";

const HARD_RULES = `ATURAN KERAS (jawaban yang melanggar salah satunya DITOLAK validasi):
- Bahasa Indonesia. Semua judul, dialog, toast, dan teks monitor dalam Bahasa Indonesia.
- JUDUL TANPA KARAKTER CINA: judul HANYA boleh memakai huruf Latin Indonesia
  (a-z, angka, spasi, tanda baca biasa). JANGAN PERNAH menyisipkan karakter
  Mandarin, Jepang, atau Korea ke judul maupun ke teks mana pun. Bila ragu,
  tulis ulang dengan kata Indonesia.
- Caption dari dialog: MAKSIMAL 2,6 kata per detik (misal dialog 4 detik =
  maks 10 kata). Perpendek teks atau perpanjang waktunya.
- Shots HARUS menutupi 0 sampai duration TANPA tumpang tindih dan TANPA jeda:
  shot pertama start = 0, shot terakhir end = duration, tiap shot berikutnya
  mulai tepat saat shot sebelumnya berakhir.
- Durasi 15 sampai 60 detik. Minimal 1 beat dialogue (video tanpa dialog
  = video bisu, ditolak).
- Dialog terurut dan tidak tumpang tindih satu sama lain.
- Karakter: maks 3 (claude, codex, gemini). Posisi x -3 sampai 3.
- Kredit @hanzvibes WAJIB ada di video — renderer yang menambahkannya, jadi
  kamu tidak perlu menulis kredit di dalam spec.`;

const CUSTOM_RULES = `KODE CUSTOM (beat type "custom") — HANYA bila adegan benar-benar TIDAK BISA
dibuat dari kosakata di atas:
- Beat custom WAJIB punya fallbackText (dialog pengganti bila kode gagal).
- Kode HANYA boleh memanggil: api.pose(indexKarakter, "poseId"),
  api.prop("propId"), api.monitor(indexKarakter, { kind, title, lines, value }),
  api.flash("warna"), api.toast("teks").
- DILARANG KERAS: fetch, eval, Function, XMLHttpRequest, WebSocket,
  localStorage, sessionStorage, document.*, window.*, parent.*, top.*,
  location.*, navigator.*, innerHTML, setTimeout, setInterval,
  requestAnimationFrame, alert, import(), require(), process.*, dan segala
  akses DOM / network / storage. Kode yang mengandung pola itu DITOLAK.
- Kode maksimal 3000 karakter, sintaks JavaScript valid, dan tidak boleh
  berasumsi ada variabel di luar parameter (api, t, beat).
- Bila ragu apakah adegan bisa dibuat dari kosakata — pakai kosakata.`;

const OUTPUT_FORMAT = `Kembalikan HANYA satu object JSON valid (tanpa teks lain, tanpa markdown):
{
  "id": "scene-<angka acak>",
  "title": "Judul video (Bahasa Indonesia, huruf Latin saja)",
  "duration": 30,
  "palette": "sunset",
  "characters": [{ "id": "claude", "x": -1.6 }, { "id": "codex", "x": 1.6 }],
  "shots": [{ "start": 0, "end": 6, "camera": "glide", "focus": 0 }],
  "beats": [
    { "start": 0, "end": 4, "type": "dialogue", "character": 0, "text": "Teks dialog.", "pose": "talk", "props": ["coffee"] },
    { "start": 4, "end": 7, "type": "countdown", "text": "Tiga, dua, satu..." }
  ]
}
Field "caps" dan "vo" TIDAK perlu kamu isi — server menurunkannya dari beat
dialogue secara otomatis. "notes" opsional, satu kalimat.`;

export function buildSceneSystemPrompt(currentScene?: SceneSpec | null): string {
  const intro = `Kamu menulis resep video animasi 3D sinematik 9:16 (TikTok/Reels) berbahasa Indonesia.
Kamu TIDAK menulis HTML. Kamu menulis SceneSpec: satu object JSON yang
mendeskripsikan CERITA LENGKAP dari nol — shot kamera, beat adegan, pose,
props, isi monitor, dan palet. Sebuah renderer dinamis (three.js) akan
memainkan resep ini. Setiap pembicara punya suara: Claude tenang dan sedikit
sombong soal kode rapi; Codex blak-blakan, terminal dulu; Gemini pamer skala
(konteks sejuta token). Lucu dan playful, jangan menghina produk atau orang
sungguhan. Satu ide per baris dialog, kata akhir yang kuat.
Alur yang bagus: klaim -> sanggahan -> eskalasi -> capek -> twist
-> ajakan kerja bareng / pertanyaan ke penonton.`;

  const mode = currentScene
    ? `MODE REVISI — pengguna sudah punya video scene dan meminta perubahan.
SceneSpec SAAT INI (JSON, ini konteks yang harus kamu pertahankan):
${JSON.stringify(currentScene, null, 2)}
Instruksi revisi:
- PERTAHANKAN semua yang TIDAK diminta diubah: cerita, dialog, timing, shot,
  pose, props, palet.
- Hanya ubah yang diminta pengguna. Kamu boleh mengubah title bila diminta /
  bila revisi mengubah cerita.
- "id" HARUS tetap "${currentScene.id}" — jangan membuat id baru.
- Kembalikan SELALU SceneSpec LENGKAP (semua shot dan beat, bukan hanya yang
  berubah).`
    : `MODE BUAT BARU — buat cerita baru dari nol dari ide pengguna: scene, alur,
shot, pose, dan isi monitor SEMUANYA baru. Jangan meniru template trio /
versus yang sudah ada (bukan debat skor seri yang sama, bukan alur yang sama).
Ciptakan premis, konflik, dan twist yang segar.`;

  return `${intro}

${vocabSummary()}

${HARD_RULES}

${CUSTOM_RULES}

${mode}

${OUTPUT_FORMAT}`;
}

export function buildSceneUserPrompt(prompt: string, currentScene?: SceneSpec | null): string {
  if (currentScene) {
    return `Revisi video scene ini sesuai instruksi berikut. Ingat: kembalikan SceneSpec LENGKAP yang sudah diperbaiki, bukan patch, dan id tetap "${currentScene.id}".\n\nInstruksi: ${prompt}`;
  }
  return `Buatkan resep video scene baru dari ide berikut:\n\n${prompt}`;
}
