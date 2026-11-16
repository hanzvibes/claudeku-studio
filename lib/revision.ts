// Logika keputusan revisi-vs-baru — MURNI, tanpa React/DOM/fetch.
//
// Aturan (Bug 1 + dua jalur generate):
// - Yang menentukan revisi adalah ENTRI AKTIF di "Video Buatan Saya",
//   BUKAN tombol mode. Bila ada entri aktif, generate HARUS merevisi
//   entri itu — scene -> SSE scene, spec -> /api/generate, template
//   (skill) -> /api/generate-skill dengan HTML lengkap sebagai konteks.
// - Entri BARU hanya bila tidak ada entri aktif: mode "scene" membuat
//   scene baru, mode "skill" membuat template skill baru.
// - Mode "revisi" tanpa entri aktif tidak bisa generate (tombol
//   dinonaktifkan di UI; di sini dikembalikan sebagai route "none").
// - /api/generate (jalur spec lama) hanya untuk REVISI entri spec yang
//   sudah ada (server menolak tanpa currentSpec, 400).
//
// File ini sengaja hanya memakai `import type`, supaya hasil kompilasi
// tsc-nya standalone dan bisa dites langsung dengan node:test tanpa
// test runner (lihat scripts/test-revision.mjs).
import type { MineEntry, MineKind } from "./mine";
import type { SceneSpec } from "./scene-spec";
import type { SkillVideo } from "./skill-validate";
import type { Spec } from "./spec";

/** Tiga mode prompt di UI: dua jalur buat-baru + satu mode revisi. */
export type GenerateMode = "scene" | "skill" | "revisi";

export type GenerateDecision =
  | {
      route: "scene";
      isRevision: true;
      /** id entri yang diperbarui (bukan dibuat baru). */
      updateId: string;
      currentScene: SceneSpec;
    }
  | { route: "scene"; isRevision: false; updateId: null; currentScene: null }
  | {
      route: "skill";
      isRevision: true;
      /** id entri yang diperbarui (bukan dibuat baru). */
      updateId: string;
      currentHtml: string;
    }
  | { route: "skill"; isRevision: false; updateId: null; currentHtml: null }
  | {
      route: "spec";
      isRevision: true;
      /** id entri yang diperbarui (bukan dibuat baru). */
      updateId: string;
      currentSpec: Spec;
    }
  | {
      route: "none";
      /** Alasan yang ditampilkan ke pengguna. */
      reason: string;
    };

export const NO_ACTIVE_ENTRY_REASON =
  "Buka dulu video dari Video Buatan Saya — revisi butuh video aktif.";

export const ACTIVE_ENTRY_NOT_LOADED_REASON =
  "Video aktif belum termuat — buka lagi dari Video Buatan Saya.";

/**
 * Tentukan jalur generate dari entri aktif + state saat ini + mode.
 * `activeEntry` = entri yang ditunjuk activeMineId (sudah di-resolve dari
 * daftar, atau null bila tidak ada entri aktif). `scene`/`spec`/`skill` =
 * state konten yang sedang tampil di preview.
 */
export function decideGenerate(input: {
  activeEntry: MineEntry | null;
  scene: SceneSpec | null;
  spec: Spec | null;
  skill: SkillVideo | null;
  mode: GenerateMode;
}): GenerateDecision {
  const { activeEntry, scene, spec, skill, mode } = input;
  if (activeEntry) {
    if (activeEntry.kind === "scene" && scene) {
      return { route: "scene", isRevision: true, updateId: activeEntry.id, currentScene: scene };
    }
    if (activeEntry.kind === "spec" && spec) {
      return { route: "spec", isRevision: true, updateId: activeEntry.id, currentSpec: spec };
    }
    if (activeEntry.kind === "template" && skill) {
      return { route: "skill", isRevision: true, updateId: activeEntry.id, currentHtml: skill.html };
    }
    // Entri aktif ada tapi kontennya belum termuat — jangan menebak jalur
    // (lewat UI normal ini tidak terjadi: openMineEntry selalu memuat konten).
    return { route: "none", reason: ACTIVE_ENTRY_NOT_LOADED_REASON };
  }
  if (mode === "scene") {
    return { route: "scene", isRevision: false, updateId: null, currentScene: null };
  }
  if (mode === "skill") {
    return { route: "skill", isRevision: false, updateId: null, currentHtml: null };
  }
  return { route: "none", reason: NO_ACTIVE_ENTRY_REASON };
}

/**
 * Id entri yang harus diperbarui saat menyimpan hasil `kind`, atau null
 * bila hasilnya entri BARU. Dipakai applyScene/applySpec/applySkill/
 * undo/cancelStream.
 */
export function updateIdForKind(activeEntry: MineEntry | null, kind: MineKind): string | null {
  return activeEntry && activeEntry.kind === kind ? activeEntry.id : null;
}

/** Cari entri aktif dari daftar berdasarkan id (null bila tidak ada). */
export function resolveActiveEntry(entries: MineEntry[], activeId: string | null): MineEntry | null {
  if (!activeId) return null;
  return entries.find((e) => e.id === activeId) ?? null;
}
