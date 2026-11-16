// "Video Buatan Saya" — galeri video hasil generate, tersimpan di browser.
//
// Setiap hasil generate (scene engine maupun generate lama) OTOMATIS tersimpan
// sebagai entri BARU di sini. Template bawaan TIDAK PERNAH ditimpa: template
// pilihan hanya dicatat sebagai baseTemplateId (asal), revisi mengedit salinan
// tersimpan, bukan template aslinya.
//
// Penyimpanan: localStorage browser (key claudeku.mine). Spec berupa JSON
// portabel — bila nanti pindah ke database, entri ini tinggal dipindah apa adanya.
import type { Spec } from "./spec";
import type { SceneSpec } from "./scene-spec";

export type MineKind = "scene" | "spec";

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
};

export const MINE_KEY = "claudeku.mine";
const MAX_ENTRIES = 50;

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
        ((e as MineEntry).kind === "scene" || (e as MineEntry).kind === "spec"),
    );
  } catch {
    return [];
  }
}

function persist(entries: MineEntry[]): void {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage penuh / tidak tersedia — simpan gagal diam-diam, video di
    // layar tetap bisa dipakai; pengguna masih bisa Download HTML.
  }
}

/** Simpan entri baru di PALING ATAS. Kembalikan daftar terbaru. */
export function saveMineEntry(entry: MineEntry): MineEntry[] {
  const entries = loadMine().filter((e) => e.id !== entry.id);
  entries.unshift(entry);
  persist(entries);
  return entries;
}

/** Perbarui entri yang sudah ada (dipakai revisi video buatan). */
export function updateMineEntry(entry: MineEntry): MineEntry[] {
  const entries = loadMine();
  const idx = entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.unshift(entry);
  persist(entries);
  return entries;
}

export function deleteMineEntry(id: string): MineEntry[] {
  const entries = loadMine().filter((e) => e.id !== id);
  persist(entries);
  return entries;
}

export function newMineId(): string {
  return `mine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
