// "Video Buatan Saya" — galeri video hasil generate, tersimpan di browser.
//
// Setiap hasil generate OTOMATIS tersimpan sebagai entri BARU di sini.
// Template bawaan TIDAK PERNAH ditimpa: template pilihan hanya dicatat
// sebagai baseTemplateId (asal), revisi mengedit salinan tersimpan, bukan
// template aslinya.
//
// Tiga jenis entri:
// - "scene": hasil mesin scene (SceneSpec, HTML dibangun dari dynamic.html).
// - "spec": hasil jalur spec lama (Spec menempel template bawaan).
// - "template": hasil jalur "Skill penuh" (HTML lengkap buatan AI).
//
// Penyimpanan: localStorage browser (key claudeku.mine). Spec berupa JSON
// portabel — bila nanti pindah ke database, entri ini tinggal dipindah apa
// adanya.
//
// GUARD UKURAN: satu template skill ~35-75 KB, batas localStorage ~5 MB.
// Sebelum simpan, perkirakan ukuran total (mineStorageBytes); bila
// melewati budget, pemanggil WAJIB memberi tahu user + menawarkan hapus
// entri lama / export dulu — jangan diam-diam gagal simpan. persist()
// juga menangkap QuotaExceededError bila kuota habis di tengah jalan.
import type { Spec } from "./spec";
import type { SceneSpec } from "./scene-spec";

export type MineKind = "scene" | "spec" | "template";

export type MineEntry = {
  id: string;
  title: string;
  /** epoch ms. */
  createdAt: number;
  kind: MineKind;
  /** template bawaan yang jadi basis (hanya catatan asal — tidak pernah diubah). */
  baseTemplateId?: string;
  duration: number;
  /** terisi bila kind === 'scene'. */
  scene?: SceneSpec;
  /** terisi bila kind === 'spec'. */
  spec?: Spec;
  /** terisi bila kind === 'template': HTML lengkap hasil jalur Skill. */
  html?: string;
};

export const MINE_KEY = "claudeku.mine";
const MAX_ENTRIES = 50;
/** Budget penyimpanan: di bawah batas localStorage (~5 MB) dengan headroom. */
export const MINE_STORAGE_BUDGET_BYTES = 4_500_000;

export function loadMine(): MineEntry[] {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is MineEntry =>
        !!e && typeof e === "object" &&
        typeof (e as MineEntry).id === "string" &&
        typeof (e as MineEntry).title === "string" &&
        ((e as MineEntry).kind === "scene" ||
          (e as MineEntry).kind === "spec" ||
          ((e as MineEntry).kind === "template" && typeof (e as MineEntry).html === "string" && (e as MineEntry).html!.length > 0)),
    );
  } catch {
    return [];
  }
}

/** Perkiraan ukuran byte daftar entri bila di-JSON-kan (dipakai guard kuota). */
export function mineStorageBytes(entries: MineEntry[]): number {
  try {
    return new TextEncoder().encode(JSON.stringify(entries)).length;
  } catch {
    return JSON.stringify(entries).length;
  }
}

/**
 * Apakah `candidate` (entri baru / revisi) masih muat dalam budget bila
 * menggantikan entri lama ber-id sama (revisi) atau ditambahkan (baru)?
 * Kembalikan { fits, projectedBytes } — pemanggil menampilkan pesan jelas
 * bila !fits (lihat MINE_QUOTA_MESSAGE di bawah).
 */
export function mineFitsBudget(
  entries: MineEntry[],
  candidate: MineEntry,
): { fits: boolean; projectedBytes: number } {
  const rest = entries.filter((e) => e.id !== candidate.id);
  const projectedBytes = mineStorageBytes([candidate, ...rest].slice(0, MAX_ENTRIES));
  return { fits: projectedBytes <= MINE_STORAGE_BUDGET_BYTES, projectedBytes };
}

export const MINE_QUOTA_MESSAGE =
  "Penyimpanan browser hampir penuh — video ini tidak tersimpan. " +
  "Hapus beberapa video lama dari Video Buatan Saya atau Download HTML-nya dulu, lalu coba lagi.";

export type MinePersistResult = {
  entries: MineEntry[];
  /** false bila setItem gagal (misal kuota habis). */
  saved: boolean;
  quotaExceeded: boolean;
};

function persist(entries: MineEntry[]): { saved: boolean; quotaExceeded: boolean } {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    return { saved: true, quotaExceeded: false };
  } catch (e) {
    // localStorage penuh / tidak tersedia — JANGAN diam-diam: laporkan
    // lewat hasil supaya UI bisa memberi tahu user.
    const quota =
      (e instanceof Error && e.name === "QuotaExceededError") ||
      (typeof e === "object" && e !== null && (e as { code?: number }).code === 22);
    return { saved: false, quotaExceeded: quota };
  }
}

/** Simpan entri baru di PALING ATAS. */
export function saveMineEntry(entry: MineEntry): MinePersistResult {
  const entries = loadMine().filter((e) => e.id !== entry.id);
  entries.unshift(entry);
  const { saved, quotaExceeded } = persist(entries);
  return { entries: saved ? entries : loadMine(), saved, quotaExceeded };
}

/** Perbarui entri yang sudah ada (dipakai revisi video buatan). */
export function updateMineEntry(entry: MineEntry): MinePersistResult {
  const entries = loadMine();
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.unshift(entry);
  const { saved, quotaExceeded } = persist(entries);
  return { entries: saved ? entries : loadMine(), saved, quotaExceeded };
}

export function deleteMineEntry(id: string): MineEntry[] {
  const entries = loadMine().filter((e) => e.id !== id);
  persist(entries);
  return entries;
}

export function newMineId(): string {
  return `mine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
