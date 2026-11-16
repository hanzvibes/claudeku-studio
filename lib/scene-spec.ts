// SceneSpec — resep video untuk MESIN SCENE data-driven (Hybrid Level 4).
//
// Berbeda dengan Spec lama (lib/spec.ts) yang hanya menukar teks/caption di
// template yang sudah paten, SceneSpec mendeskripsikan CERITA LENGKAP dari nol:
// shot kamera, beat adegan, pose, props, isi monitor, palet. Renderer dinamis
// (public/templates/dynamic.html) memainkan spec ini; template bawaan tidak
// pernah disentuh.
//
// Custom beat (type 'custom'): kode JS kecil dari AI untuk adegan di luar
// kosakata engine. Kode itu TIDAK dieksekusi di frame utama Studio — ia jalan
// di iframe sandbox terpisah di dalam template dinamis, hanya boleh memanggil
// API terbatas lewat postMessage (lihat dynamic.html). Di sini hanya ada
// validasi sintaks + blocklist; eksekusi + fallback ada di renderer.
import { MAX_WORDS_PER_SECOND, wordsPerSecond, type Cap } from "./spec";

// ---------- Kosakata engine (satu sumber kebenaran; dipakai prompt + docs) ----------

export type CharacterId = "claude" | "codex" | "gemini";
export const CHARACTERS: Record<CharacterId, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#d97757" },
  codex: { label: "Codex", color: "#7b8cff" },
  gemini: { label: "Gemini", color: "#b794f6" },
};

export type PaletteId = "arena" | "neon" | "sunset" | "office";
export const PALETTES: Record<PaletteId, { label: string; bg: string; fog: string; note: string }> = {
  arena: { label: "Dark Arena", bg: "#1a1917", fog: "#1a1917", note: "Panggung gelap klasik seperti template trio (default)." },
  neon: { label: "Neon", bg: "#0b0618", fog: "#0b0618", note: "Gelap ungu-pink, lampu neon kuat, cocok untuk adegan malam/hackathon." },
  sunset: { label: "Sunset", bg: "#2b1a12", fog: "#2b1a12", note: "Hangat oranye-ungu, cahaya sore, cocok untuk ending / momen haru." },
  office: { label: "Office Siang", bg: "#e8e6e1", fog: "#e8e6e1", note: "Terang seperti kantor siang; maskot tetap berwarna, bubble tetap gelap." },
};

export type CameraType = "glide" | "orbit" | "dolly" | "overhead" | "closeup" | "twoshot" | "low";
export const CAMERAS: Record<CameraType, { label: string; note: string }> = {
  glide: { label: "Glide", note: "Kamera meluncur halus dari shot sebelumnya (default, gaya template lama)." },
  orbit: { label: "Orbit", note: "Kamera mengorbit perlahan mengelilingi karakter fokus selama shot." },
  dolly: { label: "Dolly-zoom", note: "Kamera maju sambil FOV menyempit — efek dramatis / tegang." },
  overhead: { label: "Overhead", note: "Kamera dari atas, melihat meja + semua karakter sekaligus." },
  closeup: { label: "Close-up wajah", note: "Kamera dekat ke wajah karakter fokus — untuk reaksi / punchline." },
  twoshot: { label: "Two-shot", note: "Dua karakter dalam satu frame — untuk debat / dialog berdua." },
  low: { label: "Low-angle", note: "Kamera rendah melihat ke atas — karakter terlihat gagah / mengancam." },
};

export type PoseId =
  | "idle" | "talk" | "celebrate" | "panic" | "thinking" | "typing"
  | "sleep" | "point" | "win" | "lose";
export const POSES: Record<PoseId, { label: string; note: string }> = {
  idle: { label: "Diam", note: "Bernapas pelan, gerakan kecil (default)." },
  talk: { label: "Bicara", note: "Lengan bergerak mengikuti dialog (otomatis saat beat dialogue)." },
  celebrate: { label: "Celebrate", note: "Melompat + lengan ke atas, dipakai saat menang / deploy hijau." },
  panic: { label: "Panic", note: "Gemetar cepat + mata membesar, dipakai saat prod down / bom." },
  thinking: { label: "Thinking", note: "Kepala miring + tangan ke dagu, dipakai saat mikir / bingung." },
  typing: { label: "Typing cepat", note: "Lengan mengetik cepat di keyboard, dipakai saat ngebut nulis kode." },
  sleep: { label: "Tidur", note: "Kepala menunduk + gelembung 'Zzz', dipakai saat ketiduran." },
  point: { label: "Menunjuk", note: "Lengan menunjuk ke karakter lain / ke monitor." },
  win: { label: "Menang", note: "Berdiri tegak + dada membusung, dipakai saat skor unggul." },
  lose: { label: "Kalah", note: "Menunduk lesu, dipakai saat kalah / skor jatuh." },
};

export type BeatType =
  | "dialogue" | "countdown" | "confetti" | "typewriter" | "glitch"
  | "slowmo" | "scoreboard" | "toast" | "custom";
export const BEATS: Record<BeatType, { label: string; note: string }> = {
  dialogue: { label: "Dialog", note: "Bubble bicara + voice-over. Wajib punya character + text." },
  countdown: { label: "Countdown", note: "Angka besar 3-2-1 di tengah layar. text opsional (judul hitungan)." },
  confetti: { label: "Confetti / ledakan", note: "Partikel perayaan / benturan meledak dari karakter. text opsional." },
  typewriter: { label: "Typewriter", note: "Teks mengetik sendiri di monitor. monitor.lines = baris yang diketik." },
  glitch: { label: "Glitch", note: "Layar bergetar / rusak sesaat. text opsional (misal 'ERROR 500')." },
  slowmo: { label: "Slow-mo", note: "Gerakan maskot melambat 0,4x selama beat — untuk momen dramatis." },
  scoreboard: { label: "Scoreboard update", note: "Papan skor berubah. monitor.value = skor 0-100 per karakter (urutan characters)." },
  toast: { label: "Toast notifikasi", note: "Banner notifikasi kecil di atas layar, misal 'Deploy berhasil ✔'." },
  custom: { label: "Custom (kode)", note: "Kode JS kecil di luar kosakata. Wajib punya code + fallbackText. Hanya bila benar-benar perlu." },
};

export type PropId = "coffee" | "rocket" | "trophy" | "bug" | "bomb" | "laptop" | "phone" | "paper";
export const PROPS: Record<PropId, { label: string; note: string }> = {
  coffee: { label: "Kopi", note: "Cangkir kopi di meja, ada uap." },
  rocket: { label: "Roket", note: "Roket kecil yang bisa meluncur ke atas." },
  trophy: { label: "Trofi", note: "Piala emas untuk pemenang." },
  bug: { label: "Bug / kumbang", note: "Kumbang kecil merangkak — untuk adegan berburu bug." },
  bomb: { label: "Bom", note: "Bom bundar dengan sumbu menyala — untuk adegan menegangkan." },
  laptop: { label: "Laptop", note: "Laptop terbuka di meja karakter." },
  phone: { label: "HP", note: "HP di tangan / meja, layar menyala." },
  paper: { label: "Kertas", note: "Selembar kertas / sticky note melayang." },
};

export type MonitorKind = "chat" | "terminal" | "scoreboard" | "diff" | "progress" | "chart";
export const MONITORS: Record<MonitorKind, { label: string; note: string }> = {
  chat: { label: "Chat", note: "Bubble chat seperti Claude. lines = isi chat." },
  terminal: { label: "Terminal", note: "Layar hitam + teks hijau, gaya Codex. lines = perintah/output." },
  scoreboard: { label: "Scoreboard", note: "Papan skor. value = skor 0-100." },
  diff: { label: "Code diff", note: "Baris kode - merah / + hijau. lines = baris diff (awali - / +)." },
  progress: { label: "Progress bar", note: "Bar kemajuan + persen. value = 0-100." },
  chart: { label: "Chart / grafik", note: "Grafik batang dari angka. lines = 'label:angka' per baris." },
};

export type TransitionId = "cut" | "fade" | "slide" | "zoom";
export const TRANSITIONS: Record<TransitionId, { label: string; note: string }> = {
  cut: { label: "Cut", note: "Pindah langsung tanpa transisi." },
  fade: { label: "Fade", note: "Gelap sesaat lalu terang (paling aman untuk lompat waktu)." },
  slide: { label: "Slide", note: "Kamera bergeser cepat ke shot baru." },
  zoom: { label: "Zoom", note: "Zoom cepat masuk ke shot baru." },
};

// ---------- Tipe SceneSpec ----------

export type SceneCharacter = {
  id: CharacterId;
  /** posisi horizontal di panggung, -2.6 (kiri) .. 2.6 (kanan). Default: tersebar merata. */
  x?: number;
  /** warna aksen kustom, misal "#ff8800". Default: warna karakter. */
  accent?: string;
};

export type SceneShot = {
  start: number;
  end: number;
  camera: CameraType;
  /** index karakter fokus (0..characters.length-1). Default 0. Dipakai closeup/orbit/twoshot/low. */
  focus?: number;
  /** posisi kamera awal/akhir kustom [x,y,z]. Bila kosong, renderer menghitung dari camera+focus. */
  from?: [number, number, number];
  to?: [number, number, number];
  /** titik yang dilihat kamera [x,y,z]. Default: posisi karakter fokus. */
  lookAt?: [number, number, number];
  /** transisi MASUK ke shot ini. Default 'glide' untuk glide, 'cut' untuk lainnya. */
  transition?: TransitionId;
};

export type SceneMonitor = {
  kind: MonitorKind;
  title?: string;
  lines?: string[];
  /** 0-100 untuk scoreboard/progress. */
  value?: number;
};

export type SceneBeat = {
  start: number;
  end: number;
  type: BeatType;
  /** index karakter yang melakukan beat (0..characters.length-1). */
  character?: number;
  /** teks dialog / toast / countdown. Wajib untuk dialogue. */
  text?: string;
  /** pose selama beat. Default: 'talk' untuk dialogue, 'idle' untuk lainnya. */
  pose?: PoseId;
  /** props yang muncul selama beat. */
  props?: PropId[];
  /** isi monitor selama beat (monitor milik karakter ini). */
  monitor?: SceneMonitor;
  /** kode JS untuk beat custom. Hanya dipakai bila type === 'custom'. */
  code?: string;
  /** teks dialog pengganti bila custom beat gagal (WAJIB untuk type 'custom'). */
  fallbackText?: string;
};

export type SceneSpec = {
  /** id unik, misal "scene-1734567890123". Diisi server bila kosong. */
  id: string;
  title: string;
  /** durasi detik, 15..60. */
  duration: number;
  palette: PaletteId;
  characters: SceneCharacter[];
  shots: SceneShot[];
  beats: SceneBeat[];
  /** caption diturunkan dari beat dialogue oleh normalizeSceneSpec. */
  caps?: Cap[];
  /** voice-over sejajar caps. */
  vo?: string[];
  notes?: string;
};

// ---------- Validasi kode custom beat ----------

// Kata/pola yang DILARANG di kode custom beat. Kode hanya boleh memanggil API
// yang diekspos runner (pose/prop/monitor/flash/toast) + util dasar JS.
// Daftar ini dicek server-side (apply-scene + generate-scene) SEBELUM disimpan.
export const FORBIDDEN_CUSTOM_CODE = [
  "eval", "Function", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "localStorage", "sessionStorage", "document.cookie", "document.write",
  "document.", "window.", "parent.", "top.", "self.", "globalThis",
  "import(", "require(", "process.", "location.", "navigator.",
  "innerHTML", "outerHTML", "setTimeout", "setInterval", "requestAnimationFrame",
  "alert", "prompt", "confirm", "__proto__", "constructor", "prototype",
];

export function validateCustomCode(code: unknown): string[] {
  const errors: string[] = [];
  if (typeof code !== "string" || !code.trim()) {
    errors.push("custom beat wajib punya code (string JS).");
    return errors;
  }
  if (code.length > 3000) errors.push(`code terlalu panjang (${code.length} karakter, maks 3000).`);
  for (const bad of FORBIDDEN_CUSTOM_CODE) {
    if (code.includes(bad)) {
      errors.push(`code mengandung pola terlarang: "${bad}". Kode custom hanya boleh memanggil API beat (api.pose / api.prop / api.monitor / api.flash / api.toast).`);
    }
  }
  try {
    // Parse saja, jangan eksekusi.
    new Function("api", "t", "beat", code);
  } catch (e) {
    errors.push(`code tidak valid secara sintaks: ${e instanceof Error ? e.message : "syntax error"}.`);
  }
  return errors;
}

// ---------- Validasi SceneSpec ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateSceneSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== "object") return ["SceneSpec harus berupa object JSON."];
  const s = spec as Partial<SceneSpec>;

  if (!s.title || typeof s.title !== "string" || !s.title.trim()) errors.push("title wajib diisi.");
  if (!isNum(s.duration) || s.duration < 15 || s.duration > 60) {
    errors.push("duration harus angka 15..60 detik.");
    return errors;
  }
  const dur = s.duration;
  if (!s.palette || !(s.palette in PALETTES)) errors.push(`palette tidak dikenal: ${String(s.palette)} (pilihan: ${Object.keys(PALETTES).join(", ")}).`);
  if (!Array.isArray(s.characters) || s.characters.length === 0 || s.characters.length > 3) {
    errors.push("characters wajib array 1..3 karakter.");
    return errors;
  }
  const nChar = s.characters.length;
  s.characters.forEach((c, i) => {
    if (!c || !(c.id in CHARACTERS)) errors.push(`characters[${i}].id tidak dikenal: ${String((c as SceneCharacter | undefined)?.id)}.`);
    if (c?.x !== undefined && (!isNum(c.x) || c.x < -3 || c.x > 3)) errors.push(`characters[${i}].x harus -3..3.`);
  });

  if (!Array.isArray(s.shots) || s.shots.length === 0) {
    errors.push("shots wajib array dan tidak boleh kosong.");
    return errors;
  }
  let prevEnd = -1;
  s.shots.forEach((sh, i) => {
    const label = `shots[${i}]`;
    if (!isNum(sh.start) || !isNum(sh.end)) { errors.push(`${label}: start/end harus angka.`); return; }
    if (sh.start < 0) errors.push(`${label}: start tidak boleh negatif.`);
    if (!(sh.end > sh.start)) errors.push(`${label}: end harus lebih besar dari start.`);
    if (sh.end > dur) errors.push(`${label}: end ${sh.end} melewati durasi ${dur} dtk.`);
    if (sh.start < prevEnd) errors.push(`${label}: shot tumpang tindih / tidak terurut.`);
    prevEnd = Math.max(prevEnd, sh.end);
    if (!(sh.camera in CAMERAS)) errors.push(`${label}: camera tidak dikenal: ${String(sh.camera)}.`);
    if (sh.focus !== undefined && (!Number.isInteger(sh.focus) || sh.focus < 0 || sh.focus >= nChar)) {
      errors.push(`${label}: focus ${sh.focus} di luar jumlah karakter (${nChar}).`);
    }
    if (sh.transition !== undefined && !(sh.transition in TRANSITIONS)) errors.push(`${label}: transition tidak dikenal: ${String(sh.transition)}.`);
    for (const k of ["from", "to", "lookAt"] as const) {
      const v = sh[k];
      if (v !== undefined && (!Array.isArray(v) || v.length !== 3 || !v.every(isNum))) errors.push(`${label}.${k} harus [x, y, z] angka.`);
    }
  });
  if (s.shots[0]?.start !== 0) errors.push("shots[0].start harus 0 (shot pertama mulai dari detik 0).");
  const lastShot = s.shots[s.shots.length - 1];
  if (lastShot && lastShot.end < dur) errors.push(`shot terakhir harus berakhir di durasi penuh (${dur} dtk), saat ini ${lastShot.end}.`);

  if (!Array.isArray(s.beats) || s.beats.length === 0) {
    errors.push("beats wajib array dan tidak boleh kosong.");
    return errors;
  }
  const dialogues: Cap[] = [];
  s.beats.forEach((b, i) => {
    const label = `beats[${i}]`;
    if (!isNum(b.start) || !isNum(b.end)) { errors.push(`${label}: start/end harus angka.`); return; }
    if (b.start < 0) errors.push(`${label}: start tidak boleh negatif.`);
    if (!(b.end > b.start)) errors.push(`${label}: end harus lebih besar dari start.`);
    if (b.end > dur) errors.push(`${label}: end ${b.end} melewati durasi ${dur} dtk.`);
    if (!(b.type in BEATS)) { errors.push(`${label}: type tidak dikenal: ${String(b.type)}.`); return; }
    if (b.character !== undefined && (!Number.isInteger(b.character) || b.character < 0 || b.character >= nChar)) {
      errors.push(`${label}: character ${b.character} di luar jumlah karakter (${nChar}).`);
    }
    if (b.pose !== undefined && !(b.pose in POSES)) errors.push(`${label}: pose tidak dikenal: ${String(b.pose)}.`);
    (b.props ?? []).forEach((p) => {
      if (!(p in PROPS)) errors.push(`${label}: prop tidak dikenal: ${String(p)}.`);
    });
    if (b.monitor) {
      if (!(b.monitor.kind in MONITORS)) errors.push(`${label}.monitor.kind tidak dikenal: ${String(b.monitor.kind)}.`);
      if (b.monitor.value !== undefined && (!isNum(b.monitor.value) || b.monitor.value < 0 || b.monitor.value > 100)) {
        errors.push(`${label}.monitor.value harus 0..100.`);
      }
    }
    if (b.type === "dialogue") {
      if (!b.text || typeof b.text !== "string" || !b.text.trim()) {
        errors.push(`${label}: beat dialogue wajib punya text.`);
      } else {
        const cap: Cap = { start: b.start, end: b.end, text: b.text.trim(), speaker: b.character ?? 0 };
        const wps = wordsPerSecond(cap);
        if (wps > MAX_WORDS_PER_SECOND) {
          errors.push(`${label}: dialog terlalu cepat (${wps.toFixed(1)} kata/dtk, maks ${MAX_WORDS_PER_SECOND}) — perpendek teks atau perpanjang waktunya.`);
        }
        dialogues.push(cap);
      }
    }
    if (b.type === "custom") {
      if (!b.fallbackText || typeof b.fallbackText !== "string" || !b.fallbackText.trim()) {
        errors.push(`${label}: beat custom wajib punya fallbackText (dialog pengganti bila kode gagal).`);
      }
      errors.push(...validateCustomCode(b.code).map((e) => `${label}.code: ${e}`));
    }
  });
  if (dialogues.length === 0) errors.push("Minimal harus ada 1 beat dialogue (video tanpa dialog = video bisu).");
  // Caption turunan harus terurut & tidak tumpang tindih.
  dialogues.sort((a, b) => a.start - b.start);
  for (let i = 1; i < dialogues.length; i++) {
    if (dialogues[i].start < dialogues[i - 1].end) {
      errors.push(`Dialog beat tumpang tindih: "${dialogues[i].text.slice(0, 30)}" mulai sebelum dialog sebelumnya selesai.`);
    }
  }
  return errors;
}

// ---------- Normalisasi ----------

/** Turunkan caption + VO dari beat dialogue (terurut). */
export function deriveCaps(beats: SceneBeat[]): Cap[] {
  return beats
    .filter((b) => b.type === "dialogue" && b.text?.trim())
    .sort((a, b) => a.start - b.start)
    .map((b) => ({ start: b.start, end: b.end, text: b.text!.trim(), speaker: b.character ?? 0 }));
}

export function normalizeSceneSpec(spec: SceneSpec): SceneSpec {
  const nChar = spec.characters.length;
  const defaultX = nChar === 1 ? [0] : nChar === 2 ? [-1.6, 1.6] : [-2.6, 0, 2.6];
  const characters = spec.characters.map((c, i) => ({ id: c.id, x: c.x ?? defaultX[i], accent: c.accent }));
  const shots = [...spec.shots].sort((a, b) => a.start - b.start);
  const beats = [...spec.beats].sort((a, b) => a.start - b.start);
  // Kerapian (Bug 3): toast yang tumpang tindih dengan beat glitch atau beat
  // bermonitor (scoreboard/typewriter/dialogue bermonitor) digeser ke akhir
  // beat penghalang, supaya banner toast tidak menutupi teks beat / isi
  // monitor pada detik yang sama. Bila tidak ada ruang sampai akhir durasi,
  // toast dihapus (lebih baik hilang daripada menumpuk).
  const blockers = beats.filter((b) => b.type === "glitch" || (b.type !== "toast" && b.monitor));
  const tidyBeats: SceneBeat[] = [];
  for (const b of beats) {
    if (b.type !== "toast") { tidyBeats.push(b); continue; }
    const len = b.end - b.start;
    let start = b.start;
    for (const blk of blockers) {
      if (start < blk.end && blk.start < start + len) start = blk.end;
    }
    for (const t2 of tidyBeats) {
      if (t2.type === "toast" && start < t2.end && t2.start < start + len) start = t2.end;
    }
    if (start + len <= spec.duration + 1e-9) tidyBeats.push({ ...b, start, end: start + len });
  }
  tidyBeats.sort((a, b) => a.start - b.start);
  const caps = deriveCaps(tidyBeats);
  return {
    id: spec.id?.trim() || `scene-${Date.now()}`,
    title: spec.title.trim(),
    duration: spec.duration,
    palette: spec.palette,
    characters,
    shots,
    beats: tidyBeats,
    caps,
    vo: spec.vo && spec.vo.length === caps.length ? spec.vo.map((v) => v.trim()) : caps.map((c) => c.text),
    notes: spec.notes?.trim() || undefined,
  };
}

// ---------- Validasi + normalisasi PARSIAL (streaming) ----------

/**
 * Validasi LENIENT untuk SceneSpec yang masih mengalir dari provider.
 * Dipakai /api/generate-scene-stream untuk memutuskan kapan sebuah JSON
 * yang belum lengkap sudah cukup bagus untuk di-preview live.
 *
 * Bedanya dengan validateSceneSpec (ketat, untuk hasil akhir):
 * - title BOLEH kosong (default "Video baru" di normalizePartialSceneSpec).
 * - duration BOLEH < 15 — cukup angka > 0; durasi parsial = max shot end.
 * - shots TIDAK wajib menutupi durasi penuh (yang penting terurut,
 *   tidak tumpang tindih, shot pertama mulai di 0).
 * - palette TIDAK wajib dikenal (default 'arena' bila tidak dikenal).
 * - Kamera/pose/prop/monitor TIDAK dicek ketat — renderer punya fallback
 *   aman untuk nilai yang tidak dikenal; yang dicek hanya struktur yang
 *   membuat preview tidak bisa jalan (shot/beat/dialog).
 * - Kode custom TIDAK dicek di sini — string kode yang masih mengalir
 *   hampir pasti gagal parse sintaks; validasi penuh tetap jalan di
 *   validateSceneSpec untuk hasil akhir, dan renderer men-sandbox-nya.
 * - Elemen TERAKHIR (shot/beat) yang belum lengkap diabaikan — parser
 *   parsial memotong di nilai lengkap terakhir, jadi ekor yang terpotong
 *   di tengah string/angka tidak menggagalkan seluruh spec.
 */
/**
 * Beat/shot terakhir dari JSON yang masih mengalir sering terpotong di
 * tengah (misal string text belum tertutup) — extractPartialJsonFromText
 * memotong di nilai lengkap terakhir, sehingga elemen terakhir bisa
 * kehilangan field. Buang elemen terakhir itu bila belum lengkap; elemen
 * tengah selalu lengkap karena parser hanya memotong di ujung. Dipakai
 * validatePartialSceneSpec + normalizePartialSceneSpec supaya keduanya
 * sepakat soal isi parsial yang sama.
 */
function isCompleteShot(sh: unknown): sh is SceneShot {
  const s = sh as Partial<SceneShot>;
  return !!s && isNum(s.start) && isNum(s.end) && s.end > s.start;
}

function isCompleteBeat(b: unknown): b is SceneBeat {
  const s = b as Partial<SceneBeat>;
  if (!s || !isNum(s.start) || !isNum(s.end) || !(s.end > s.start)) return false;
  if (!s.type || !(s.type in BEATS)) return false;
  if (s.type === "dialogue" && (!s.text || typeof s.text !== "string" || !s.text.trim())) return false;
  return true;
}

function dropIncompleteTail<T>(arr: T[], isComplete: (v: unknown) => boolean): T[] {
  const out = [...arr];
  if (out.length > 0 && !isComplete(out[out.length - 1])) out.pop();
  return out;
}

export function validatePartialSceneSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== "object") return ["SceneSpec harus berupa object JSON."];
  const s = spec as Partial<SceneSpec>;

  // title boleh kosong — default diisi normalizePartialSceneSpec.
  if (!isNum(s.duration) || s.duration <= 0) {
    errors.push("duration harus angka lebih besar dari 0.");
    return errors;
  }
  const dur = s.duration;
  if (!Array.isArray(s.characters) || s.characters.length === 0 || s.characters.length > 3) {
    errors.push("characters wajib array 1..3 karakter.");
    return errors;
  }
  s.characters.forEach((c, i) => {
    if (!c || !(c.id in CHARACTERS)) errors.push(`characters[${i}].id tidak dikenal: ${String((c as SceneCharacter | undefined)?.id)}.`);
  });

  if (!Array.isArray(s.shots) || s.shots.length === 0) {
    errors.push("shots wajib array dan tidak boleh kosong.");
    return errors;
  }
  // Shot terakhir yang belum lengkap (masih mengalir) diabaikan.
  const shots = dropIncompleteTail(s.shots, isCompleteShot);
  if (shots.length === 0) {
    errors.push("shots wajib array dan tidak boleh kosong.");
    return errors;
  }
  let prevEnd = -1;
  shots.forEach((sh, i) => {
    const label = `shots[${i}]`;
    if (sh.start < 0) errors.push(`${label}: start tidak boleh negatif.`);
    if (sh.end > dur) errors.push(`${label}: end ${sh.end} melewati durasi ${dur} dtk.`);
    if (sh.start < prevEnd) errors.push(`${label}: shot tumpang tindih / tidak terurut.`);
    prevEnd = Math.max(prevEnd, sh.end);
  });
  if (shots[0]?.start !== 0) errors.push("shots[0].start harus 0 (shot pertama mulai dari detik 0).");

  if (!Array.isArray(s.beats) || s.beats.length === 0) {
    errors.push("beats wajib array dan tidak boleh kosong.");
    return errors;
  }
  // Beat terakhir yang belum lengkap (masih mengalir) diabaikan.
  const beats = dropIncompleteTail(s.beats, isCompleteBeat);
  if (beats.length === 0) {
    errors.push("beats wajib array dan tidak boleh kosong.");
    return errors;
  }
  const dialogues: Cap[] = [];
  beats.forEach((b, i) => {
    const label = `beats[${i}]`;
    if (b.start < 0) errors.push(`${label}: start tidak boleh negatif.`);
    if (b.end > dur) errors.push(`${label}: end ${b.end} melewati durasi ${dur} dtk.`);
    if (b.type === "dialogue") {
      // Ekor yang belum lengkap sudah dibuang di atas — beat dialogue di
      // sini yang teksnya kosong adalah cacat beneran, bukan masih mengalir.
      if (!b.text || typeof b.text !== "string" || !b.text.trim()) {
        errors.push(`${label}: beat dialogue wajib punya text.`);
        return;
      }
      const cap: Cap = { start: b.start, end: b.end, text: b.text.trim(), speaker: b.character ?? 0 };
      const wps = wordsPerSecond(cap);
      if (wps > MAX_WORDS_PER_SECOND) {
        errors.push(`${label}: dialog terlalu cepat (${wps.toFixed(1)} kata/dtk, maks ${MAX_WORDS_PER_SECOND}) — perpendek teks atau perpanjang waktunya.`);
      }
      dialogues.push(cap);
    }
  });
  if (dialogues.length === 0) errors.push("Minimal harus ada 1 beat dialogue (video tanpa dialog = video bisu).");
  return errors;
}

/**
 * Normalisasi spec parsial (sudah lolos validatePartialSceneSpec) menjadi
 * SceneSpec lengkap yang bisa di-render: isi default untuk field yang
 * boleh kosong (title, palette, id), turunkan caps/vo dari beat dialogue,
 * dan pakai duration = max shot end (minimal 1 dtk).
 * Memakai normalizeSceneSpec yang sudah ada untuk pengisian x karakter
 * + penurunan caps/vo — tidak ada logika duplikat.
 */
export function normalizePartialSceneSpec(spec: unknown): SceneSpec {
  const s = (spec ?? {}) as Partial<SceneSpec>;
  // Buang ekor yang belum lengkap (sama seperti validasi parsial) supaya
  // scene hasil normalisasi tidak membawa beat/shot setengah jadi.
  const shots = dropIncompleteTail(s.shots ?? [], isCompleteShot).sort((a, b) => a.start - b.start);
  const beats = dropIncompleteTail(s.beats ?? [], isCompleteBeat).sort((a, b) => a.start - b.start);
  const filled: SceneSpec = {
    id: typeof s.id === "string" && s.id.trim() ? s.id.trim() : `scene-partial-${Date.now()}`,
    title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : "Video baru",
    duration: Math.max(1, ...shots.map((sh) => sh.end)),
    palette: s.palette && s.palette in PALETTES ? s.palette : "arena",
    characters: (s.characters ?? [{ id: "claude" as CharacterId }]).slice(0, 3),
    shots,
    beats,
  };
  return normalizeSceneSpec(filled);
}

// ---------- Ringkasan kosakata untuk system prompt AI ----------

export function vocabSummary(): string {
  const lines = (rec: Record<string, { label: string; note: string }>) =>
    Object.entries(rec).map(([k, v]) => `  - ${k}: ${v.label} — ${v.note}`).join("\n");
  return `KOSAKATA ENGINE (pakai ini dulu — kode custom HANYA bila adegan benar-benar tidak bisa dibuat dari kosakata di bawah):
Karakter (id): claude (oranye), codex (biru), gemini (ungu). Maks 3 karakter.
Palet: ${Object.entries(PALETTES).map(([k, v]) => `${k} (${v.label})`).join(", ")}.
Kamera per shot:
${lines(CAMERAS)}
Pose:
${lines(POSES)}
Jenis beat:
${lines(BEATS)}
Props:
${lines(PROPS)}
Jenis layar monitor:
${lines(MONITORS)}
Transisi antar shot: ${Object.entries(TRANSITIONS).map(([k, v]) => `${k} (${v.label})`).join(", ")}.
Aturan: shots menutupi SELURUH durasi dari 0 sampai duration tanpa tumpang tindih;
setiap beat dialogue jadi satu caption (maks ${MAX_WORDS_PER_SECOND} kata/detik);
durasi 15..60 detik; minimal 1 beat dialogue.`;
}
