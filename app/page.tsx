"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { TEMPLATES, getTemplate } from "@/lib/templates";
import { CANNED_SPEC, cannedRevisionExample } from "@/lib/canned";
import { CANNED_SCENE, cannedSceneRevision } from "@/lib/canned-scene";
import type { SceneSpec } from "@/lib/scene-spec";
import {
  decideGenerate,
  resolveActiveEntry,
  updateIdForKind,
  type GenerateDecision,
  type GenerateMode,
} from "@/lib/revision";
import {
  loadMine,
  saveMineEntry,
  updateMineEntry,
  deleteMineEntry,
  newMineId,
  mineFitsBudget,
  MINE_QUOTA_MESSAGE,
  type MineEntry,
  type MineKind,
} from "@/lib/mine";
import {
  extractSkillLen,
  extractSkillTitle,
  retitleSkillHtml,
  retextSkillHtml,
  validateSkillHtml,
  type SkillVideo,
} from "@/lib/skill-validate";
import { rewriteThreeCdnToLocal } from "@/lib/cdn-rewrite";
import {
  loadProvider,
  saveProvider,
  clearProvider,
  type ProviderConfig,
} from "@/lib/provider";
import { wordsPerSecond, MAX_WORDS_PER_SECOND, parseTemplateHtml, type Spec, type TemplateShot } from "@/lib/spec";

/** Baris inspector Shot: waktu mulai + label kamera. */
type InspectorShot = { start: number; label: string };

/** Info template aktif untuk inspector (shots + sub + end), dari /api/template atau HTML skill. */
type TemplateInfo = { shots: InspectorShot[]; sub: string; end: string };

/** Ambil shots/sub/end dari HTML template skill (gagal -> null, inspector menampilkan catatan). */
function infoFromSkillHtml(html: string): TemplateInfo | null {
  try {
    const p = parseTemplateHtml(html);
    return {
      shots: p.shots.map((s: TemplateShot) => ({
        start: s.start,
        label: `cam ${s.pos.map((v) => v.toFixed(1)).join(", ")}`,
      })),
      sub: p.sub,
      end: p.end,
    };
  } catch {
    return null;
  }
}

type Status = { kind: "ok" | "err" | "info"; text: string } | null;

/** Event SSE dari /api/generate-scene-stream. */
type StreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: string; text: string }
  | { type: "partial"; scene: SceneSpec }
  | { type: "repaired"; attempt: number }
  | { type: "done"; scene: SceneSpec; html: string; previewHtml: string; repaired: boolean; attempts: number }
  | { type: "error"; error: string; validationErrors?: string[] };

/** Event SSE dari /api/generate-skill. */
type SkillStreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: string; text: string }
  | { type: "repaired"; attempt: number }
  | { type: "done"; title: string; html: string; previewHtml: string; duration: number; repaired: boolean; attempts: number; lintWarnings: string[]; lintVia: "python" | "ts" }
  | { type: "error"; error: string; validationErrors?: string[] };

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Absolutkan URL root-relative (src="/...", href="/...", url(/...)) ke
// origin yang diberikan. Dipakai sebelum HTML preview dimasukkan ke Blob:
// dokumen blob: tidak bisa me-resolve URL root-relative (lihat useEffect
// Blob URL di bawah). URL absolut (https://, //, data:, blob:, #) dan
// URL relatif biasa (tanpa / di depan) tidak disentuh.
function absolutizeUrlsForBlob(html: string, origin: string): string {
  return html
    .replace(/((?:src|href)=["'])\/([^/"'\s])/g, `$1${origin}/$2`)
    .replace(/(url\(\s*["']?)\/([^/"'\s])/g, `$1${origin}/$2`);
}

export default function StudioPage() {
  const [templateId, setTemplateId] = useState("versus");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [prevSpec, setPrevSpec] = useState<Spec | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  // previewHtml = HTML yang sama, tapi 13 script CDN three.js sudah
  // di-rewrite ke /vendor/ lokal (untuk preview). generatedHtml TETAP
  // canonical (CDN) dan dipakai Download/export — jangan tertukar.
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  // Tiga mode prompt: dua jalur buat-baru (scene / skill) + revisi.
  // Mode "Buat baru" lama (spec menempel template) DIHAPUS untuk video baru:
  // /api/generate hanya merevisi entri spec yang sudah ada.
  const [mode, setMode] = useState<GenerateMode>("scene");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState<ProviderConfig>({ baseUrl: "", model: "", apiKey: "" });
  const [providerSaved, setProviderSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<Status>(null);
  const [testing, setTesting] = useState(false);

  // --- Mesin scene (Hybrid Level 4) + Video Buatan Saya ---
  const [scene, setScene] = useState<SceneSpec | null>(null);
  const [prevScene, setPrevScene] = useState<SceneSpec | null>(null);
  // --- Jalur Skill penuh: HTML template lengkap buatan AI ---
  const [skill, setSkill] = useState<SkillVideo | null>(null);
  const [prevSkill, setPrevSkill] = useState<SkillVideo | null>(null);
  const [mine, setMine] = useState<MineEntry[]>([]);
  const [activeMineId, setActiveMineId] = useState<string | null>(null);
  // Ref yang SELALU mirror activeMineId (Bug 1): semua keputusan
  // update-vs-baru dibaca dari REF ini (atau dari id eksplisit), BUKAN
  // dari closure state yang bisa basi sesudah setActiveMineId + await.
  const activeMineIdRef = useRef<string | null>(null);
  const setActiveMine = useCallback((id: string | null) => {
    activeMineIdRef.current = id;
    setActiveMineId(id);
  }, []);
  // Bila perubahan templateId datang dari revisi/apply (AI ganti template),
  // JANGAN muat ulang spec template asli — spec hasil revisi sudah benar.
  // Tanpa flag ini, efek templateId menimpa spec revisi dengan spec asli
  // template baru + membersihkan entri aktif (bug laten).
  const templateChangeFromApplyRef = useRef(false);
  // Token invalidasi loadTemplateSpec: setiap aksi pengguna yang mengubah
  // konten (buka entri, ganti mode, apply/generate) menaikkan token — bila
  // fetch template yang sedang berjalan resolve SESUDAH itu, hasilnya basi
  // dan TIDAK BOLEH menimpa state baru. Tanpa ini, load mount (~5 dtk saat
  // compile pertama) bisa menghapus entri yang baru dibuka pengguna.
  const templateLoadTokenRef = useRef(0);
  // Preview lazy: iframe TIDAK di-load saat pertama buka — baru dimuat saat
  // pengguna memilih template / video buatan / menekan tombol muat. Lebih ringan.
  const [previewOn, setPreviewOn] = useState(false);

  // --- Redesign layout (referensi studio/ pack v3.14) ---
  // Drawer galeri kiri (tutup/buka; overlay + scrim di layar sempit).
  const [drawerOpen, setDrawerOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1180,
  );
  // Inspector kanan: tab Teks / Shot / Caption.
  const [inspectorTab, setInspectorTab] = useState<"teks" | "shot" | "cap">("teks");
  // Transport pill: loop on = video mengulang seperti template aslinya.
  const [loop, setLoop] = useState(true);
  const loopStopRef = useRef(false);
  const prevTimeRef = useRef(0);
  // Skeleton shimmer sampai iframe preview selesai load.
  const [previewReady, setPreviewReady] = useState(false);
  // Toast (cermin status, hilang sendiri).
  const [toast, setToast] = useState<string | null>(null);
  // Info template aktif untuk inspector (shots + sub + end).
  const [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null);
  // Field tab Teks (judul/sub/end) — disinkronkan tiap ganti konten aktif.
  const [teksTitle, setTeksTitle] = useState("");
  const [teksSub, setTeksSub] = useState("");
  const [teksEnd, setTeksEnd] = useState("");
  const teksKeyRef = useRef("");
  // Streaming live saat AI generate scene: iframe memuat /api/preview-scene
  // (dokumen same-origin, spec default) dan menerima partial via postMessage.
  const [livePreview, setLivePreview] = useState(false);
  const cbfShownRef = useRef("");

  // --- Live streaming generate (mode scene) ---
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamStage, setStreamStage] = useState("");
  const [streamSummary, setStreamSummary] = useState("");
  const [streamLogOpen, setStreamLogOpen] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef<HTMLPreElement>(null);
  const lastPartialSceneRef = useRef<SceneSpec | null>(null);
  // Jalur stream yang sedang berjalan (scene / skill) — dipakai cancelStream
  // untuk membedakan draft scene (bisa disimpan) vs skill (HTML parsial
  // tidak bisa disimpan, batalkan saja).
  const streamKindRef = useRef<"scene" | "skill" | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const meta = getTemplate(templateId) ?? TEMPLATES[0];
  // Saat scene/skill aktif, durasi + judul mengikuti konten itu, bukan template.
  const duration = scene ? scene.duration : skill ? skill.duration : meta.duration;
  const previewTitle = scene?.title ?? skill?.title ?? spec?.title ?? meta.title;
  // Entri aktif (di-resolve dari daftar, untuk hint/label — bukan keputusan simpan).
  const activeEntry = mine.find((e) => e.id === activeMineId) ?? null;
  const hasActiveEntry = activeEntry !== null;

  // Muat provider + galeri Video Buatan Saya tersimpan (localStorage saja).
  useEffect(() => {
    const saved = loadProvider();
    if (saved) {
      setProvider(saved);
      setProviderSaved(true);
    }
    setMine(loadMine());
  }, []);

  // Muat spec asli template terpilih dari server. Memilih template bawaan
  // SELALU menutup entri aktif + scene/skill dan kembali ke mode scene
  // (template hanya basis baru, bukan revisi entri lama).
  const loadTemplateSpec = useCallback(async (id: string) => {
    const token = ++templateLoadTokenRef.current;
    setBusy(true);
    try {
      const res = await fetch(`/api/template?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat template.");
      // Load basi (pengguna sudah membuka entri / generate / apply selagi
      // fetch berjalan) — jangan timpa state baru.
      if (token !== templateLoadTokenRef.current) return;
      setLivePreview(false);
      setScene(null);
      setPrevScene(null);
      setSkill(null);
      setPrevSkill(null);
      setActiveMine(null);
      setMode("scene");
      setSpec({ templateId: id, title: data.title, caps: data.caps, vo: data.vo });
      setTemplateInfo({
        shots: (data.shots ?? []).map((s: TemplateShot) => ({
          start: s.start,
          label: `cam ${s.pos.map((v: number) => v.toFixed(1)).join(", ")}`,
        })),
        sub: data.sub ?? "",
        end: data.end ?? "",
      });
      setGeneratedHtml(null);
      setPreviewHtml(null);
      setBlobUrl(null);
      setPrevSpec(null);
      setCurrentTime(0);
      setPlaying(false);
      setStatus(null);
    } catch (e) {
      if (token === templateLoadTokenRef.current) {
        setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal memuat template." });
      }
    } finally {
      // Bila load sudah basi, busy dimiliki aksi lain — jangan sentuh.
      if (token === templateLoadTokenRef.current) setBusy(false);
    }
  }, [setActiveMine]);

  useEffect(() => {
    // Perubahan templateId dari revisi/apply (AI ganti template) TIDAK
    // memuat ulang spec asli — lihat templateChangeFromApplyRef.
    if (templateChangeFromApplyRef.current) {
      templateChangeFromApplyRef.current = false;
      return;
    }
    loadTemplateSpec(templateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // Blob URL untuk HTML hasil generate / apply — dari previewHtml (rewrite
  // /vendor/ lokal), BUKAN dari generatedHtml (CDN). Dicabut saat diganti.
  //
  // PENTING (bug preview hitam, 2026-11-16): URL relatif seperti
  // src="/vendor/three.min.js" TIDAK bisa di-resolve dari dalam dokumen
  // blob: URL — Chrome gagal memuatnya (THREE undefined → LEN undefined →
  // preview hitam). Absolutkan dulu ke origin situs sebelum membuat Blob.
  // generatedHtml (CDN, untuk Download) TIDAK disentuh.
  useEffect(() => {
    setPreviewReady(false);
    if (!previewHtml) {
      setBlobUrl(null);
      return;
    }
    const html = absolutizeUrlsForBlob(previewHtml, window.location.origin);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewHtml]);

  // Log teks AI mengalir: auto-scroll ke bawah tiap ada token baru.
  useEffect(() => {
    const el = streamTextRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamText]);

  // Toast: cermin status terbaru, hilang sendiri sesudah ~2,6 dtk.
  useEffect(() => {
    if (!status) return;
    setToast(status.text);
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [status]);

  // Esc menutup drawer (referensi studio/).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Info inspector untuk konten skill/scene (template bawaan dari /api/template).
  useEffect(() => {
    if (skill) {
      setTemplateInfo(infoFromSkillHtml(skill.html));
      return;
    }
    if (scene) {
      setTemplateInfo({
        shots: scene.shots.map((s) => ({
          start: s.start,
          label: `kamera ${s.camera}${s.focus !== undefined ? ` · fokus ${s.focus}` : ""}`,
        })),
        sub: "",
        end: "",
      });
    }
  }, [skill, scene]);

  // Sinkronkan field tab Teks tiap konten aktif berganti (bukan tiap ketik).
  useEffect(() => {
    const key = skill
      ? `skill:${skill.title}`
      : scene
        ? `scene:${scene.title}`
        : spec
          ? `spec:${spec.templateId}:${spec.title}`
          : `tpl:${templateId}`;
    if (key === teksKeyRef.current) return;
    teksKeyRef.current = key;
    setTeksTitle(previewTitle);
    setTeksSub(templateInfo?.sub ?? "");
    setTeksEnd(templateInfo?.end ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill, scene, spec, templateId, templateInfo]);

  // Loop off: begitu mencapai akhir (atau wrap ke 0), pause + tahan frame akhir.
  useEffect(() => {
    if (!loop && playing && !loopStopRef.current) {
      if (currentTime >= duration - 0.35 || currentTime < prevTimeRef.current - 1) {
        loopStopRef.current = true;
        pause();
        seek(duration - 0.01);
      }
    }
    prevTimeRef.current = currentTime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, loop, playing, duration]);

  // Poll waktu dari player di dalam iframe (#tc = jam berjalan template)
  // + baca #cbf (pesan kegagalan custom beat dari template dinamis).
  useEffect(() => {
    const t = setInterval(() => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const tc = doc.getElementById("tc") ?? doc.getElementById("gtc");
      const parsed = parseClock(tc?.textContent);
      if (parsed !== null) setCurrentTime(parsed);
      const cbf = doc.getElementById("cbf");
      const msg = cbf?.textContent?.trim() ?? "";
      if (msg && msg !== cbfShownRef.current) {
        cbfShownRef.current = msg;
        setStatus({ kind: "info", text: `Adegan kustom gagal, diganti adegan aman. (${msg})` });
      }
    }, 300);
    return () => clearInterval(t);
  }, [blobUrl, templateId]);

  // --- Kontrol preview: memakai API template yang sudah ada ---
  // window.renderAt(t) men-pause dan me-render frame t; tombol play/pause
  // template sendiri (#gob = mulai, #gcc = play/pause) diklik lewat DOM iframe.
  const iframeWindow = () => iframeRef.current?.contentWindow as unknown as { renderAt?: (t: number) => void } | null;
  const iframeDoc = () => iframeRef.current?.contentDocument ?? null;

  const seek = (t: number) => {
    loopStopRef.current = false;
    const clamped = Math.min(Math.max(t, 0), duration - 0.01);
    setCurrentTime(clamped);
    try {
      iframeWindow()?.renderAt?.(clamped);
    } catch {
      // iframe belum siap — abaikan, pengguna bisa seek lagi.
    }
  };

  const play = () => {
    loopStopRef.current = false;
    const doc = iframeDoc();
    if (!doc) return;
    const go = doc.getElementById("go");
    if (go && go.style.display !== "none") {
      (doc.getElementById("gob") as HTMLElement | null)?.click();
    } else {
      (doc.getElementById("gcc") as HTMLElement | null)?.click();
    }
    setPlaying(true);
  };

  const pause = () => {
    const doc = iframeDoc();
    if (!doc) return;
    (doc.getElementById("gcc") as HTMLElement | null)?.click();
    setPlaying(false);
  };

  // --- Simpan ke Video Buatan Saya ---
  // Setiap hasil generate OTOMATIS jadi entri baru (bukan menimpa template).
  // Revisi entri yang sedang dibuka memperbarui entri itu, bukan template aslinya.
  // Kembalikan id entri yang disimpan, atau null bila gagal (misal kuota
  // penyimpanan penuh — pemanggil menampilkan MINE_QUOTA_MESSAGE).
  // TIDAK PERNAH diam-diam gagal simpan.
  const rememberResult = useCallback((entry: Omit<MineEntry, "id" | "createdAt">, updateId?: string | null) => {
    const existing = updateId ? loadMine().find((e) => e.id === updateId) : undefined;
    const full: MineEntry = {
      ...entry,
      id: updateId ?? newMineId(),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    // Guard kuota SEBELUM simpan (satu template skill ~35-75 KB).
    const { fits } = mineFitsBudget(loadMine(), full);
    if (!fits) return null;
    const result = updateId ? updateMineEntry(full) : saveMineEntry(full);
    if (!result.saved) return null;
    setMine(result.entries);
    if (!updateId) setActiveMine(full.id);
    return full.id;
  }, [setActiveMine]);

  // --- Terapkan SceneSpec (jalur scene: generate / canned / undo / buka galeri) ---
  // opts.updateId: id entri yang diperbarui (undo) — bila tidak diisi,
  // di-resolve dari entri aktif (ref). Bila tidak ada entri aktif, hasil
  // disimpan sebagai entri BARU.
  const applyScene = async (next: SceneSpec, label: string, opts?: { save?: boolean; updateId?: string | null }) => {
    // Batalkan load template yang sedang berjalan (lihat templateLoadTokenRef).
    templateLoadTokenRef.current += 1;
    setBusy(true);
    setLivePreview(false);
    setStatus({ kind: "info", text: `${label}…` });
    try {
      const res = await fetch("/api/apply-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        const extra = data.validationErrors ? ` ${data.validationErrors.join(" ")}` : "";
        throw new Error((data.error ?? "Gagal menerapkan scene.") + extra);
      }
      setPrevScene(scene);
      setScene(data.scene);
      setSpec(null);
      setPrevSpec(null);
      setSkill(null);
      setPrevSkill(null);
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      setPreviewOn(true);
      setCurrentTime(0);
      setPlaying(false);
      cbfShownRef.current = "";
      if (opts?.save !== false) {
        // Keputusan update-vs-baru dari REF entri aktif (anti stale closure).
        // updateId eksplisit (undo) mengalahkan resolve otomatis.
        const activeEntry = resolveActiveEntry(loadMine(), activeMineIdRef.current);
        const updateId =
          opts?.updateId !== undefined ? opts.updateId : updateIdForKind(activeEntry, "scene");
        const savedId = rememberResult(
          { title: data.scene.title, kind: "scene", duration: data.scene.duration, scene: data.scene },
          updateId,
        );
        setStatus(
          savedId
            ? { kind: "ok", text: `${label} berhasil — tersimpan di Video Buatan Saya, preview sudah berubah.` }
            : { kind: "err", text: MINE_QUOTA_MESSAGE },
        );
      } else {
        setStatus({ kind: "ok", text: `${label} berhasil — preview sudah berubah.` });
      }
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal menerapkan scene." });
    } finally {
      setBusy(false);
    }
  };

  // --- Terapkan spec lama (jalur bersama untuk edit manual / canned / undo) ---
  // opts.updateId: id entri yang diperbarui (undo) — bila tidak diisi,
  // di-resolve dari entri aktif (ref). Tanpa entri aktif: TIDAK membuat
  // entri baru (contoh tanpa AI hanya preview) — itu perilaku yang
  // dipertahankan dari v1.
  const applySpec = async (next: Spec, label: string, opts?: { save?: boolean; updateId?: string | null }) => {
    // Batalkan load template yang sedang berjalan (lihat templateLoadTokenRef).
    templateLoadTokenRef.current += 1;
    setBusy(true);
    setLivePreview(false);
    setStatus({ kind: "info", text: `${label}…` });
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: next.templateId, spec: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        const extra = data.validationErrors ? ` ${data.validationErrors.join(" ")}` : "";
        throw new Error((data.error ?? "Gagal menerapkan spec.") + extra);
      }
      setPrevSpec(spec);
      setSpec(data.spec);
      setScene(null);
      setPrevScene(null);
      setSkill(null);
      setPrevSkill(null);
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      setPreviewOn(true);
      if (data.templateId !== templateId) {
        // AI ganti template saat revisi: jangan muat ulang spec asli template
        // baru (lihat templateChangeFromApplyRef) — spec hasil revisi sudah benar.
        templateChangeFromApplyRef.current = true;
        setTemplateId(data.templateId);
      }
      // Edit manual / canned pada entri yang sedang dibuka memperbarui entri itu.
      let saveFailed = false;
      if (opts?.save !== false) {
        const activeEntry = resolveActiveEntry(loadMine(), activeMineIdRef.current);
        const updateId =
          opts?.updateId !== undefined ? opts.updateId : updateIdForKind(activeEntry, "spec");
        if (updateId) {
          const savedId = rememberResult(
            { title: data.spec.title, kind: "spec", baseTemplateId: data.spec.templateId, duration: getTemplate(data.spec.templateId)?.duration ?? 0, spec: data.spec },
            updateId,
          );
          if (!savedId) saveFailed = true;
        }
      }
      setStatus(
        saveFailed
          ? { kind: "err", text: MINE_QUOTA_MESSAGE }
          : { kind: "ok", text: `${label} berhasil — preview sudah berubah.` },
      );
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal menerapkan spec." });
    } finally {
      setBusy(false);
    }
  };

  // --- Terapkan HTML template skill (jalur skill: generate / contoh / undo / buka galeri) ---
  // Sinkron (HTML sudah ada di tangan — tidak ada fetch). Validasi keamanan
  // diulang client-side sebagai defense-in-depth sebelum HTML ditampilkan.
  // opts.updateId: id entri yang diperbarui (undo / revisi) — bila tidak
  // diisi, di-resolve dari entri aktif (ref). Bila tidak ada entri aktif,
  // hasil disimpan sebagai entri BARU kind "template".
  const applySkill = (next: SkillVideo, label: string, opts?: { save?: boolean; updateId?: string | null; note?: string }) => {
    // Batalkan load template yang sedang berjalan (lihat templateLoadTokenRef).
    templateLoadTokenRef.current += 1;
    const errors = validateSkillHtml(next.html);
    if (errors.length > 0) {
      setStatus({ kind: "err", text: `Template tidak aman, tidak ditampilkan: ${errors[0]}` });
      return;
    }
    const { html: previewHtml, replaced } = rewriteThreeCdnToLocal(next.html);
    if (replaced !== 13) {
      setStatus({ kind: "err", text: `Template tidak memuat 13 script three.js r128 (ditemukan ${replaced}).` });
      return;
    }
    setLivePreview(false);
    setPrevSkill(skill);
    setSkill(next);
    setScene(null);
    setPrevScene(null);
    setSpec(null);
    setPrevSpec(null);
    setGeneratedHtml(next.html);
    setPreviewHtml(previewHtml);
    setPreviewOn(true);
    setCurrentTime(0);
    setPlaying(false);
    cbfShownRef.current = "";
    let saveFailed = false;
    if (opts?.save !== false) {
      const activeEntry = resolveActiveEntry(loadMine(), activeMineIdRef.current);
      const updateId =
        opts?.updateId !== undefined ? opts.updateId : updateIdForKind(activeEntry, "template");
      const savedId = rememberResult(
        { title: next.title, kind: "template", duration: next.duration, html: next.html },
        updateId,
      );
      if (!savedId) saveFailed = true;
    }
    const okText =
      opts?.save === false
        ? `${label} berhasil — preview sudah berubah.`
        : `${label} berhasil — tersimpan di Video Buatan Saya, preview sudah berubah.`;
    setStatus(
      saveFailed
        ? { kind: "err", text: MINE_QUOTA_MESSAGE }
        : { kind: "ok", text: opts?.note ? `${okText} (${opts.note})` : okText },
    );
  };

  // Contoh template skill tanpa AI (trio bawaan, sudah lolos lint).
  const applySkillExample = async () => {
    setBusy(true);
    setStatus({ kind: "info", text: "Menerapkan contoh template…" });
    try {
      const res = await fetch("/api/skill-example");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat contoh template.");
      applySkill({ title: data.title, html: data.html, duration: data.duration }, "Menerapkan contoh template");
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal memuat contoh template." });
    } finally {
      setBusy(false);
    }
  };

  // Revisi contoh template skill tanpa AI: ganti judul saja (HTML lain utuh).
  const cannedSkillRevision = (current: SkillVideo): SkillVideo => {
    const title = current.title.includes("—")
      ? `${current.title.split("—")[0].trim()} — Revisi`
      : `${current.title} — Revisi`;
    return { title, html: retitleSkillHtml(current.html, title), duration: current.duration };
  };

  // --- Terapkan teks (tab Teks inspector) ---
  // Skill/template (HTML aktif): judul + sub + end diganti di HTML lewat
  // retextSkillHtml, lalu applySkill (revisi entri aktif / entri baru).
  // Spec/scene: hanya judul yang bisa diganti (sub/end mengikuti template
  // bawaan / renderer scene) — applySpec / applyScene dengan judul baru.
  const applyTexts = () => {
    const title = teksTitle.trim();
    if (!title) {
      setStatus({ kind: "err", text: "Judul tidak boleh kosong." });
      return;
    }
    try {
      if (skill) {
        const html = retextSkillHtml(skill.html, { title, sub: teksSub, end: teksEnd });
        applySkill({ title, html, duration: skill.duration }, "Menerapkan teks");
        return;
      }
      if (spec) {
        applySpec({ ...spec, title }, "Menerapkan teks");
        return;
      }
      if (scene) {
        applyScene({ ...scene, title }, "Menerapkan teks");
        return;
      }
      setStatus({ kind: "err", text: "Belum ada video aktif — pilih template dulu." });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal menerapkan teks." });
    }
  };

  // --- Buka entri Video Buatan Saya ---
  // Membuka entri SELALU mengaktifkan mode revisi + mengisi ref entri aktif,
  // apa pun kind-nya — generate berikutnya MEREVISI entri itu (Bug 1).
  const openMineEntry = async (entry: MineEntry) => {
    // Batalkan load template yang sedang berjalan (lihat templateLoadTokenRef).
    templateLoadTokenRef.current += 1;
    setActiveMine(entry.id);
    setMode("revisi");
    if (entry.kind === "scene" && entry.scene) {
      await applyScene(entry.scene, `Membuka "${entry.title}"`, { save: false });
      setActiveMine(entry.id);
    } else if (entry.kind === "spec" && entry.spec) {
      await applySpec(entry.spec, `Membuka "${entry.title}"`, { save: false });
      setActiveMine(entry.id);
    } else if (entry.kind === "template" && entry.html) {
      applySkill(
        { title: entry.title, html: entry.html, duration: entry.duration },
        `Membuka "${entry.title}"`,
        { save: false },
      );
      setActiveMine(entry.id);
    }
  };

  // Menutup entri aktif (bukan menghapus — entrinya tetap di galeri).
  // Dipakai saat pengguna pindah ke mode buat-baru (scene/skill).
  const closeActiveEntry = (reason: string) => {
    const entry = resolveActiveEntry(loadMine(), activeMineIdRef.current);
    if (!entry) return;
    setActiveMine(null);
    if (entry.kind === "scene") {
      setScene(null);
      setPrevScene(null);
    }
    if (entry.kind === "template") {
      setSkill(null);
      setPrevSkill(null);
    }
    // Spec dibiarkan: editor caption tetap menampilkan spec terakhir (preview saja).
    setStatus({ kind: "info", text: `"${entry.title}" ditutup — ${reason}` });
  };

  // Ganti mode prompt. Mode buat-baru (scene/skill) SELALU mulai dari nol:
  // bila ada entri aktif, tutup dulu dengan status jelas, lalu buat baru.
  const switchMode = (next: GenerateMode) => {
    // Batalkan load template yang sedang berjalan (lihat templateLoadTokenRef).
    templateLoadTokenRef.current += 1;
    if (next === "revisi") {
      setMode("revisi");
      return;
    }
    if (activeMineIdRef.current) {
      closeActiveEntry(
        next === "scene"
          ? "prompt berikutnya membuat scene baru dari nol."
          : "prompt berikutnya membuat template skill baru dari nol.",
      );
    }
    setMode(next);
  };

  const removeMineEntry = (id: string) => {
    setMine(deleteMineEntry(id));
    if (id === activeMineIdRef.current) {
      setActiveMine(null);
      setMode("scene");
      setStatus({ kind: "info", text: "Video buatan dihapus dari galeri." });
    }
  };

  // --- Generate scene lewat AI dengan LIVE STREAMING (SSE) ---
  // Iframe HARUS sudah memuat /api/preview-scene (dokumen same-origin,
  // spec default) agar partial bisa dikirim via postMessage 'claudeku-scene'
  // TANPA reload penuh — itulah gunanya hook live-update di dynamic.html.
  // Partial yang datang sebelum iframe selesai dimuat dikirim ulang saat
  // iframe onLoad (lihat onLoad di bawah). /api/apply-scene TIDAK dipanggil
  // untuk partial — hanya event done yang memakai jalur normal.
  const generateSceneStream = async (decision: Extract<GenerateDecision, { route: "scene" }>) => {
    const saved = loadProvider();
    // isRevision + updateId datang dari decideGenerate (entri aktif via ref),
    // BUKAN dari `scene !== null` — scene bisa non-null tanpa entri aktif.
    const isRevision = decision.isRevision;
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    streamKindRef.current = "scene";
    lastPartialSceneRef.current = null;
    setStreaming(true);
    setStreamLogOpen(true);
    setStreamText("");
    setStreamStage(isRevision ? "AI merevisi scene ini…" : "AI membuat scene baru…");
    setStreamSummary("");
    setLivePreview(true);
    setPreviewOn(true);
    setBusy(true);
    setStatus({ kind: "info", text: isRevision ? "AI merevisi scene ini — teksnya mengalir di bawah preview…" : "AI membuat scene baru — teksnya mengalir di bawah preview…" });
    try {
      const res = await fetch("/api/generate-scene-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), provider: saved ?? provider, currentScene: isRevision ? decision.currentScene : null }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // Error JSON biasa (400/422) sebelum stream dimulai.
        let msg = "Generate scene gagal.";
        try {
          const data = await res.json();
          if (data.code === "PROVIDER_MISSING") setShowSettings(true);
          const extra = data.validationErrors ? ` ${data.validationErrors.join(" ")}` : "";
          msg = (data.error ?? msg) + extra;
        } catch {
          // Pakai pesan default.
        }
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Browser tidak mendukung streaming.");
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      while (!finished) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const rawEvent = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of rawEvent.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(payload) as StreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "token") {
              setStreamText((prev) => prev + ev.text);
            } else if (ev.type === "stage") {
              setStreamStage(ev.text);
            } else if (ev.type === "partial") {
              lastPartialSceneRef.current = ev.scene;
              setStreamSummary(`"${ev.scene.title}" — ${ev.scene.shots.length} shot · ${ev.scene.beats.length} beat · ${ev.scene.duration} dtk`);
              try {
                iframeRef.current?.contentWindow?.postMessage({ type: "claudeku-scene", scene: ev.scene }, "*");
              } catch {
                // Iframe belum siap — partial terakhir dikirim ulang saat onLoad.
              }
            } else if (ev.type === "repaired") {
              setStreamStage(`AI memperbaiki sendiri (percobaan ${ev.attempt})…`);
            } else if (ev.type === "done") {
              finished = true;
              setPrevScene(scene);
              setScene(ev.scene);
              setSpec(null);
              setPrevSpec(null);
              setSkill(null);
              setPrevSkill(null);
              setGeneratedHtml(ev.html);
              setPreviewHtml(ev.previewHtml ?? ev.html);
              setLivePreview(false);
              setPreviewOn(true);
              setCurrentTime(0);
              setPlaying(false);
              cbfShownRef.current = "";
              const savedId = rememberResult(
                { title: ev.scene.title, kind: "scene", duration: ev.scene.duration, scene: ev.scene },
                decision.updateId,
              );
              setStatus(
                savedId
                  ? {
                      kind: "ok",
                      text: isRevision
                        ? "Revisi scene berhasil — tersimpan di Video Buatan Saya."
                        : `Scene baru berhasil dibuat — tersimpan di Video Buatan Saya sebagai video baru.${ev.repaired ? " (AI sempat memperbaiki sendiri.)" : ""}`,
                    }
                  : { kind: "err", text: MINE_QUOTA_MESSAGE },
              );
            } else if (ev.type === "error") {
              finished = true;
              const extra = ev.validationErrors ? ` ${ev.validationErrors.join(" ")}` : "";
              throw new Error((ev.error ?? "Generate scene gagal.") + extra);
            }
          }
        }
      }
      try {
        await reader.cancel();
      } catch {
        // Stream sudah tertutup — abaikan.
      }
      if (!finished) {
        throw new Error("Koneksi streaming terputus sebelum selesai. Coba lagi.");
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        // Dibatalkan pengguna — status sudah diisi cancelStream, jangan timpa.
        return;
      }
      setLivePreview(false);
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Generate scene gagal." });
    } finally {
      setStreaming(false);
      setBusy(false);
      streamKindRef.current = null;
      abortControllerRef.current = null;
    }
  };

  // --- Generate template skill lewat AI dengan LIVE STREAMING (SSE) ---
  // Pola sama seperti generateSceneStream (coba stream dulu, fallback
  // non-streaming di server), tapi tanpa partial: HTML parsial tidak bisa
  // di-preview, jadi token yang mengalir hanya tampil sebagai kode di
  // panel streaming. Validasi keamanan + lint + self-repair (maks 3x)
  // jalan server-side di /api/generate-skill; event done baru menampilkan
  // preview + menyimpan entri.
  const generateSkillStream = async (decision: Extract<GenerateDecision, { route: "skill" }>) => {
    const saved = loadProvider();
    const isRevision = decision.isRevision;
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    streamKindRef.current = "skill";
    setStreaming(true);
    setStreamLogOpen(true);
    setStreamText("");
    setStreamStage(isRevision ? "AI merevisi template ini…" : "AI menulis template baru…");
    setStreamSummary("");
    setLivePreview(false);
    setPreviewOn(true);
    setBusy(true);
    setStatus({ kind: "info", text: isRevision ? "AI merevisi template ini — kodenya mengalir di bawah preview…" : "AI menulis template baru — kodenya mengalir di bawah preview…" });
    try {
      const res = await fetch("/api/generate-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), provider: saved ?? provider, currentHtml: isRevision ? decision.currentHtml : null }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // Error JSON biasa (400/422) sebelum stream dimulai.
        let msg = "Generate template gagal.";
        try {
          const data = await res.json();
          if (data.code === "PROVIDER_MISSING") setShowSettings(true);
          const extra = data.validationErrors ? ` ${data.validationErrors.join(" ")}` : "";
          msg = (data.error ?? msg) + extra;
        } catch {
          // Pakai pesan default.
        }
        throw new Error(msg);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Browser tidak mendukung streaming.");
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      while (!finished) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const rawEvent = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of rawEvent.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: SkillStreamEvent;
            try {
              ev = JSON.parse(payload) as SkillStreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "token") {
              setStreamText((prev) => prev + ev.text);
            } else if (ev.type === "stage") {
              setStreamStage(ev.text);
            } else if (ev.type === "repaired") {
              setStreamStage(`AI memperbaiki template (percobaan ${ev.attempt})…`);
            } else if (ev.type === "done") {
              finished = true;
              const notes = [
                ev.repaired ? `AI sempat memperbaiki sendiri (percobaan ${ev.attempts})` : null,
                ev.lintWarnings.length > 0 ? `Lint: ${ev.lintWarnings[0]}` : null,
              ]
                .filter(Boolean)
                .join(" ");
              // applySkill menampilkan preview + menyimpan (update bila revisi).
              applySkill(
                { title: ev.title, html: ev.html, duration: ev.duration },
                isRevision ? "Merevisi template" : "Membuat template baru",
                { updateId: decision.updateId, note: notes || undefined },
              );
            } else if (ev.type === "error") {
              finished = true;
              const extra = ev.validationErrors ? ` ${ev.validationErrors.join(" ")}` : "";
              throw new Error((ev.error ?? "Generate template gagal.") + extra);
            }
          }
        }
      }
      try {
        await reader.cancel();
      } catch {
        // Stream sudah tertutup — abaikan.
      }
      if (!finished) {
        throw new Error("Koneksi streaming terputus sebelum selesai. Coba lagi, atau pakai mode Scene.");
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        // Dibatalkan pengguna — status sudah diisi cancelStream, jangan timpa.
        return;
      }
      setLivePreview(false);
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Generate template gagal." });
    } finally {
      setStreaming(false);
      setBusy(false);
      streamKindRef.current = null;
      abortControllerRef.current = null;
    }
  };

  // --- Batalkan streaming ---
  // Scene: simpan partial terakhir sebagai DRAFT bila ada.
  // Skill: HTML parsial tidak bisa disimpan sebagai draft — batalkan saja.
  const cancelStream = () => {
    abortControllerRef.current?.abort();
    const kind = streamKindRef.current;
    setLivePreview(false);
    setStreaming(false);
    setBusy(false);
    streamKindRef.current = null;
    if (kind !== "scene") {
      setStatus({ kind: "info", text: "Dibatalkan." });
      return;
    }
    const draft = lastPartialSceneRef.current;
    if (draft && draft.shots.length > 0) {
      const id = rememberResult({ title: `${draft.title} (draft)`, kind: "scene", duration: draft.duration, scene: draft });
      setStatus(
        id
          ? { kind: "info", text: "Dibatalkan — draft tersimpan di Video Buatan Saya." }
          : { kind: "err", text: MINE_QUOTA_MESSAGE },
      );
    } else {
      setStatus({ kind: "info", text: "Dibatalkan." });
    }
  };

  // --- Generate / revisi lewat AI (tiga mode, dua jalur + revisi spec) ---
  // Keputusan HANYA dari entri aktif (via ref) + mode — lihat lib/revision.ts.
  // Buka entri dari galeri -> generate berikutnya MEREVISI entri itu.
  // Tanpa entri aktif: scene -> scene baru, skill -> template baru,
  // revisi -> ditolak (tombol dinonaktifkan di UI).
  const generate = async () => {
    if (!prompt.trim()) {
      setStatus({ kind: "err", text: "Tulis dulu ide / instruksi revisinya di kotak prompt." });
      return;
    }
    // Batalkan load template yang sedang berjalan (lihat templateLoadTokenRef).
    templateLoadTokenRef.current += 1;
    const activeEntry = resolveActiveEntry(loadMine(), activeMineIdRef.current);
    const decision = decideGenerate({ activeEntry, scene, spec, skill, mode });
    if (decision.route === "none") {
      setStatus({ kind: "err", text: decision.reason });
      return;
    }
    setBusy(true);
    try {
      if (decision.route === "scene") {
        // Mode scene memakai streaming SSE (generateSceneStream mengatur
        // busy/streaming sendiri; finally di bawah hanya pengaman).
        await generateSceneStream(decision);
        return;
      }
      if (decision.route === "skill") {
        await generateSkillStream(decision);
        return;
      }

      // Jalur spec lama: HANYA revisi entri spec — /api/generate menolak
      // request tanpa currentSpec (400).
      const saved = loadProvider();
      setStatus({ kind: "info", text: "AI merevisi video ini…" });
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          templateId,
          provider: saved ?? provider,
          currentSpec: decision.currentSpec,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "PROVIDER_MISSING") {
          setShowSettings(true);
          throw new Error(data.error ?? "Provider belum diisi.");
        }
        const extra = data.validationErrors ? ` ${data.validationErrors.join(" ")}` : "";
        throw new Error((data.error ?? "Generate gagal.") + extra);
      }
      setPrevSpec(spec);
      setSpec(data.spec);
      setScene(null);
      setPrevScene(null);
      setSkill(null);
      setPrevSkill(null);
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      setPreviewOn(true);
      if (data.templateId !== templateId) {
        // AI ganti template saat revisi: jangan muat ulang spec asli.
        templateChangeFromApplyRef.current = true;
        setTemplateId(data.templateId);
      }
      const savedId = rememberResult(
        {
          title: data.spec.title,
          kind: "spec",
          baseTemplateId: data.spec.templateId,
          duration: getTemplate(data.spec.templateId)?.duration ?? 0,
          spec: data.spec,
        },
        decision.updateId,
      );
      setStatus(
        savedId
          ? { kind: "ok", text: "Revisi berhasil — entri Video Buatan Saya diperbarui." }
          : { kind: "err", text: MINE_QUOTA_MESSAGE },
      );
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Generate gagal." });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    // Undo memperbarui entri aktif (bukan bikin baru); bila entri aktif
    // sudah dihapus, undo hanya mengembalikan preview (save: false).
    if (skill && prevSkill) {
      const target = prevSkill;
      setPrevSkill(null);
      const id = activeMineIdRef.current;
      if (id) applySkill(target, "Mengembalikan template sebelumnya", { updateId: id });
      else applySkill(target, "Mengembalikan template sebelumnya", { save: false });
      setPrevSkill(null);
      return;
    }
    if (scene && prevScene) {
      const target = prevScene;
      setPrevScene(null);
      const id = activeMineIdRef.current;
      if (id) await applyScene(target, "Mengembalikan scene sebelumnya", { updateId: id });
      else await applyScene(target, "Mengembalikan scene sebelumnya", { save: false });
      setPrevScene(null);
      return;
    }
    if (!prevSpec) return;
    const target = prevSpec;
    setPrevSpec(null);
    const id = activeMineIdRef.current;
    if (id) await applySpec(target, "Mengembalikan versi sebelumnya", { updateId: id });
    else await applySpec(target, "Mengembalikan versi sebelumnya", { save: false });
    // applySpec menimpa prevSpec dengan spec saat ini; untuk undo 1 langkah
    // itu sudah benar: tidak ada riwayat lebih jauh di v1.
    setPrevSpec(null);
  };

  const downloadHtml = () => {
    // Download memakai generatedHtml CANONICAL (CDN) — sengaja, supaya file
    // hasil download jalan standalone di browser normal. Preview memakai
    // previewHtml (/vendor/ lokal) dan tidak pernah diunduh.
    // Berlaku untuk ketiga kind (scene / spec / template skill): entri
    // template menyimpan HTML lengkap yang portabel.
    if (!generatedHtml || (!spec && !scene && !skill)) {
      setStatus({ kind: "err", text: "Belum ada hasil. Buat scene/skill baru atau buka video dari Video Buatan Saya." });
      return;
    }
    const title = scene?.title ?? skill?.title;
    const name = title
      ? title.replace(/[^\w\- ]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "video"
      : `${spec?.templateId ?? "claudeku"}`;
    const url = URL.createObjectURL(new Blob([generatedHtml], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-claudeku.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleRecord = () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    const canvas = iframeDoc()?.querySelector("canvas");
    if (!canvas) {
      setStatus({ kind: "err", text: "Canvas video belum siap (tunggu preview termuat dulu)." });
      return;
    }
    try {
      const stream = (canvas as HTMLCanvasElement).captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${skill ? "skill" : scene ? "scene" : (spec?.templateId ?? "claudeku")}-rekaman.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setRecording(false);
        setStatus({ kind: "ok", text: "Rekaman WebM terunduh. Catatan: suara voice-over tidak ikut terekam." });
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      play();
      setStatus({ kind: "info", text: "Merekam… tekan “Berhenti Rekam” untuk mengunduh WebM." });
    } catch (e) {
      setStatus({ kind: "err", text: `Rekam browser gagal: ${e instanceof Error ? e.message : "error tidak dikenal"}. Coba export MP4 via scripts/export_mp4.py (lihat README).` });
    }
  };

  const testProvider = async () => {
    setTesting(true);
    setTestResult({ kind: "info", text: "Menguji koneksi…" });
    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult({
          kind: "ok",
          text: `Terhubung${data.via ? ` (via ${data.via})` : ""}. Model tersedia: ${(data.models ?? []).slice(0, 5).join(", ") || provider.model}.`,
        });
      } else {
        setTestResult({ kind: "err", text: data.error ?? "Tes koneksi gagal." });
      }
    } catch {
      setTestResult({ kind: "err", text: "Tidak bisa menghubungi server Studio. Pastikan aplikasi berjalan." });
    } finally {
      setTesting(false);
    }
  };

  const saveProviderSettings = () => {
    if (!provider.baseUrl.trim() || !provider.model.trim()) {
      setTestResult({ kind: "err", text: "Base URL dan Model wajib diisi." });
      return;
    }
    saveProvider(provider);
    setProviderSaved(true);
    setTestResult({ kind: "ok", text: "Provider tersimpan di browser ini (localStorage). API Key tidak pernah dikirim ke repo/server lain." });
  };

  const updateCap = (i: number, patch: Partial<Spec["caps"][number]>) => {
    if (!spec) return;
    const caps = spec.caps.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    setSpec({ ...spec, caps, vo: spec.vo });
  };

  // Preview default lewat /api/preview (rewrite CDN -> /vendor/ lokal).
  // JANGAN pakai /templates/<file> langsung: itu file canonical CDN yang
  // ke-block proxy di lingkungan ini dan preview jadi hitam.
  // Saat streaming, iframe memuat /api/preview-scene (dynamic.html dengan
  // spec null -> DEFAULT_SPEC) supaya partial bisa di-postMessage live.
  const iframeSrc = livePreview ? "/api/preview-scene" : (blobUrl ?? `/api/preview?id=${encodeURIComponent(templateId)}`);

  const modeHint =
    mode === "scene"
      ? "AI membuat scene BARU dari nol: adegan, kamera, pose, dan cerita ditentukan AI lewat mesin scene — bukan menempel di template lama."
      : mode === "skill"
        ? "AI menulis SATU FILE HTML template lengkap mengikuti skill threejs-cinematic-short: adegan, kamera, pose, dan monitor bebas — tidak terikat kosakata scene. Hasil dicek lint + keamanan, lalu tersimpan sebagai template baru."
        : !activeEntry
          ? "Buka dulu video dari Video Buatan Saya — revisi butuh video aktif."
          : activeEntry.kind === "scene"
            ? `Merevisi scene "${activeEntry.title}": shot, beat, pose, dan monitor bisa berubah — hasilnya memperbarui video ini.`
            : activeEntry.kind === "template"
              ? `Merevisi template "${activeEntry.title}": AI menerima HTML lengkap sebagai konteks dan menulis ulang file-nya — hasilnya memperbarui video ini.`
              : `Merevisi video "${activeEntry.title}": AI menerima video ini sebagai konteks dan hanya mengubah yang kamu minta — sisanya dipertahankan. Bisa juga ganti template & judul.`;

  // Label tombol generate mengikuti (mode, entri aktif) — bukan mode saja.
  const generateLabel =
    mode === "revisi"
      ? activeEntry?.kind === "scene"
        ? "Revisi Scene"
        : activeEntry?.kind === "template"
          ? "Revisi Template"
          : "Revisi Video"
      : mode === "skill"
        ? "Buat Template"
        : "Buat Scene";

  // Tombol contoh tanpa AI mengikuti alur yang sedang dipakai: skill,
  // scene, atau spec (mode revisi mengikuti kind entri aktif).
  const exampleKind: "scene" | "skill" | "spec" =
    mode === "skill"
      ? "skill"
      : mode === "scene"
        ? "scene"
        : activeEntry?.kind === "template"
          ? "skill"
          : activeEntry?.kind === "scene"
            ? "scene"
            : "spec";

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setDrawerOpen(!drawerOpen)} aria-label="Buka atau tutup galeri" aria-expanded={drawerOpen}>
          ☰
        </button>
        <h1>🎬 Claudeku Studio</h1>
        <span className="sub">Short animasi Three.js 9:16 — pilih template, ketik ide, preview, export.</span>
        <div className="spacer" />
        <span className="chip" title={previewTitle}>{previewTitle}</span>
        <button className="btn" onClick={() => setShowSettings(true)}>
          ⚙️ Settings Provider {providerSaved ? "✓" : "(belum diisi)"}
        </button>
      </header>

      <main className={drawerOpen ? "layout" : "layout drawer-closed"}>
        <div className={`scrim${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        {/* Kolom kiri: galeri — Video Buatan Saya + Template Bawaan */}
        <aside className={`card drawer${drawerOpen ? " open" : ""}`}>
          <h2>Video Buatan Saya {mine.length > 0 ? `(${mine.length})` : ""}</h2>
          {mine.length === 0 && (
            <p className="note">Belum ada. Hasil generate otomatis tersimpan di sini sebagai video baru — template bawaan tidak pernah ketimpa.</p>
          )}
          {mine.map((entry, mi) => (
            <div
              key={entry.id}
              className={`gallery-item mine-item ${entry.id === activeMineId ? "active" : ""}`}
              style={{ "--i": mi } as CSSProperties}
            >
              <button className="mine-open" onClick={() => openMineEntry(entry)}>
                <b>{entry.title}</b>
                <span>
                  {entry.kind === "scene" ? "🎬 Scene" : entry.kind === "template" ? "🧩 Skill" : "📄 Spec"} · {entry.duration} dtk · {fmtDate(entry.createdAt)}
                </span>
              </button>
              <button className="mine-del" onClick={() => removeMineEntry(entry.id)} aria-label={`Hapus ${entry.title}`}>
                ✕
              </button>
            </div>
          ))}

          <h2 style={{ marginTop: 16 }}>Template Bawaan (12)</h2>
          {TEMPLATES.map((t, ti) => (
            <button
              key={t.id}
              className={`gallery-item compact ${t.id === templateId && !scene && !skill ? "active" : ""}`}
              onClick={() => setTemplateId(t.id)}
              title={t.description}
              style={{ "--i": ti } as CSSProperties}
            >
              <b>{t.title}</b>
              <span>
                {t.duration} detik · {t.characters} karakter · {t.speakers.join(" / ")}
              </span>
            </button>
          ))}
          <p className="note">Template disalin apa adanya dari skill threejs-cinematic-short v3.14. Semua lolos lint_short.py. Template bawaan tidak pernah diubah oleh generate.</p>
        </aside>

        {/* Tengah: preview + timeline */}
        <section className="card">
          <h2>Preview — {previewTitle}</h2>
          <div className="preview-wrap">
            <div className="preview-frame">
              {!previewOn ? (
                <button className="preview-placeholder" onClick={() => setPreviewOn(true)}>
                  <span className="preview-play">▶</span>
                  <span>Muat Preview</span>
                  <small>Preview dimuat hanya saat diminta, supaya halaman lebih ringan.</small>
                </button>
              ) : (
                <iframe
                  ref={iframeRef}
                  key={iframeSrc}
                  src={iframeSrc}
                  title="Preview video"
                  allow="autoplay"
                  loading="lazy"
                  onLoad={() => {
                    setPreviewReady(true);
                    // Partial yang datang sebelum iframe streaming selesai
                    // dimuat dikirim ulang sekarang (listener di dalam
                    // iframe baru terpasang sesudah load).
                    if (livePreview && lastPartialSceneRef.current) {
                      try {
                        iframeRef.current?.contentWindow?.postMessage(
                          { type: "claudeku-scene", scene: lastPartialSceneRef.current },
                          "*",
                        );
                      } catch {
                        // Iframe belum siap — partial berikutnya akan menyusul.
                      }
                    }
                  }}
                />
              )}
              {previewOn && !previewReady && (
                <div className="skeleton">Menyiapkan preview…</div>
              )}
            </div>
            <div className="player">
              <button className="play" onClick={() => (playing ? pause() : play())} disabled={busy || !previewOn} aria-label={playing ? "Jeda" : "Putar"}>
                {playing ? "❚❚" : "▶"}
              </button>
              <button className="player-btn" onClick={() => seek(Math.max(0, currentTime - 5))} disabled={!previewOn} aria-label="Mundur 5 detik">
                −5s
              </button>
              <button className="player-btn" onClick={() => seek(Math.min(duration, currentTime + 5))} disabled={!previewOn} aria-label="Maju 5 detik">
                +5s
              </button>
              <div className="seek">
                <div className="seekfill">
                  <i style={{ width: `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%` }} />
                </div>
                <input
                  id="seek"
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => seek(Number(e.target.value))}
                  aria-label="Timeline"
                />
              </div>
              <span className="time">
                {fmt(currentTime)} / {fmt(duration)}
              </span>
              <label className="switch">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                loop
              </label>
            </div>
            <div className="btnrow">
              <button className="btn small" onClick={downloadHtml}>⬇ Download HTML</button>
              {(prevSpec || prevScene || prevSkill) && (
                <button className="btn small" onClick={undo} disabled={busy}>
                  ↩ Kembalikan ke versi sebelumnya
                </button>
              )}
            </div>
            <details className="more">
              <summary>Export &amp; lainnya</summary>
              <div className="btnrow" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={toggleRecord} disabled={busy || !previewOn}>
                  {recording ? "⏹ Berhenti Rekam" : "● Rekam di Browser (WebM)"}
                </button>
              </div>
              <p className="note">
                Geser timeline untuk lompat ke detik tertentu (pakai <span className="kbd-hint">renderAt</span> bawaan template).
                Rekam browser itu best-effort: hasil WebM, suara voice-over tidak ikut terekam.
                Untuk MP4 60fps, pakai <span className="kbd-hint">scripts/export_mp4.py</span> — lihat README.
              </p>
            </details>
            {status && <div className={`status ${status.kind}`}>{status.text}</div>}
            {/* Panel live streaming: terlihat jelas saat AI generate berjalan. */}
            {(streaming || streamText) && (
              <div className="stream-panel">
                <div className="stream-head">
                  <b>{streaming ? "⏳ AI lagi generate…" : "Teks AI"}</b>
                  {streamSummary && <span className="stream-summary">{streamSummary}</span>}
                  {streaming && (
                    <button className="btn small" onClick={cancelStream}>
                      ✕ Batalkan
                    </button>
                  )}
                </div>
                {streamStage && <div className="stream-stage">{streamStage}</div>}
                <details
                  className="more"
                  open={streamLogOpen}
                  onToggle={(e) => setStreamLogOpen(e.currentTarget.open)}
                >
                  <summary>Lihat teks AI mengalir</summary>
                  <pre ref={streamTextRef} className="stream-text">
                    {streamText || "…"}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </section>

        {/* Kanan: prompt + inspector */}
        <aside className="right-col">
          <div className="card">
          <h2>Prompt AI</h2>
          <div className="mode-toggle" role="tablist" aria-label="Mode prompt">
            <button className={mode === "scene" ? "active" : ""} onClick={() => switchMode("scene")}>
              🎬 Scene baru
            </button>
            <button className={mode === "skill" ? "active" : ""} onClick={() => switchMode("skill")}>
              🧩 Skill penuh
            </button>
            <button
              className={mode === "revisi" ? "active" : ""}
              onClick={() => switchMode("revisi")}
              disabled={!hasActiveEntry}
              title={!hasActiveEntry ? "Buka dulu video dari Video Buatan Saya" : undefined}
            >
              ✏️ Revisi video ini
            </button>
          </div>
          <p className="note" style={{ marginTop: 8 }}>{modeHint}</p>
          {mode === "revisi" && activeEntry && (
            <p className="note">
              Video aktif: <b>{activeEntry.title}</b> ({activeEntry.duration} dtk). Prompt di bawah akan merevisi video ini.{" "}
              <button className="linklike" onClick={() => { closeActiveEntry("prompt berikutnya membuat video baru dari nol."); setMode("scene"); }}>
                Tutup video, buat baru
              </button>
            </p>
          )}
          <textarea
            className="prompt"
            placeholder={
              mode === "skill"
                ? "Contoh: maskot Claude ketiduran di keyboard pas deadline, dibangunkan bos, lalu ngebut ngetik sampai selesai…"
                : mode === "scene"
                  ? "Contoh: Claude dan Codex balapan roket sambil minum kopi, endingnya trofi jatuh ke kepala Gemini…"
                  : activeEntry?.kind === "template"
                    ? "Contoh: tambahkan adegan hujan di luar jendela, ganti endingnya jadi ajakan kerja bareng…"
                    : activeEntry?.kind === "scene"
                      ? "Contoh: ganti endingnya jadi trofi jatuh ke kepala Gemini, tambahkan adegan hujan…"
                      : activeEntry
                        ? "Contoh: ganti endingnya jadi ajakan kerja bareng, bikin dialog Codex lebih pendek…"
                        : "Buka dulu video dari Video Buatan Saya, lalu tulis revisinya di sini…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={generate} disabled={busy || (mode === "revisi" && !hasActiveEntry)}>
              {busy ? "Memproses…" : generateLabel}
            </button>
            {exampleKind === "skill" ? (
              <>
                <button className="btn small" disabled={busy} onClick={applySkillExample}>
                  Coba contoh template (tanpa AI)
                </button>
                <button
                  className="btn small"
                  disabled={busy || !skill}
                  onClick={() => {
                    if (!skill) return;
                    try {
                      applySkill(cannedSkillRevision(skill), "Menerapkan revisi contoh template");
                    } catch (e) {
                      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Revisi contoh gagal." });
                    }
                  }}
                >
                  Coba revisi contoh
                </button>
              </>
            ) : exampleKind === "scene" ? (
              <>
                <button className="btn small" disabled={busy} onClick={() => applyScene(CANNED_SCENE, "Menerapkan contoh scene")}>
                  Coba contoh scene (tanpa AI)
                </button>
                <button
                  className="btn small"
                  disabled={busy || !scene}
                  onClick={() => scene && applyScene(cannedSceneRevision(scene), "Menerapkan revisi contoh scene")}
                >
                  Coba revisi contoh scene
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => applySpec(CANNED_SPEC, "Menerapkan spec contoh")}
                >
                  Coba contoh (tanpa AI)
                </button>
                <button
                  className="btn small"
                  disabled={busy || !spec}
                  onClick={() => spec && applySpec(cannedRevisionExample(spec), "Menerapkan revisi contoh")}
                >
                  Coba revisi contoh
                </button>
              </>
            )}
          </div>
          <p className="note">
            Generate butuh provider (Settings). Kalau belum diisi, pakai tombol contoh di atas — tanpa AI live.
            {mode === "skill" && " Mode Skill menulis satu file HTML lengkap — lebih berat dari Scene; bila provider gagal, coba mode Scene."}
          </p>

          </div>

          {/* Inspector: tab Teks / Shot / Caption (referensi studio/ pack v3.14). */}
          <div className="card inspector">
            <div className="tabs" role="tablist" aria-label="Inspector video">
              <button className={inspectorTab === "teks" ? "tab on" : "tab"} role="tab" aria-selected={inspectorTab === "teks"} onClick={() => setInspectorTab("teks")}>
                Teks
              </button>
              <button className={inspectorTab === "shot" ? "tab on" : "tab"} role="tab" aria-selected={inspectorTab === "shot"} onClick={() => setInspectorTab("shot")}>
                Shot
              </button>
              <button className={inspectorTab === "cap" ? "tab on" : "tab"} role="tab" aria-selected={inspectorTab === "cap"} onClick={() => setInspectorTab("cap")}>
                Caption
              </button>
            </div>
            <div className="panes">
              {inspectorTab === "teks" && (
                <div className="pane">
                  <label className="field">
                    <span>Judul</span>
                    <input value={teksTitle} onChange={(e) => setTeksTitle(e.target.value)} placeholder="Judul video" />
                  </label>
                  <label className="field">
                    <span>Subjudul</span>
                    <input value={teksSub} onChange={(e) => setTeksSub(e.target.value)} placeholder="Subjudul di bawah judul" disabled={!skill} />
                  </label>
                  <label className="field">
                    <span>End card</span>
                    <textarea rows={2} value={teksEnd} onChange={(e) => setTeksEnd(e.target.value)} placeholder="Teks end card" disabled={!skill} />
                  </label>
                  {!skill && (
                    <p className="hint">Subjudul &amp; end card hanya bisa diubah untuk video template/skill (HTML). Untuk video spec/scene, hanya judul yang diubah.</p>
                  )}
                  <div className="btnrow">
                    <button className="btn primary" onClick={applyTexts} disabled={busy}>
                      Terapkan teks
                    </button>
                  </div>
                </div>
              )}
              {inspectorTab === "shot" && (
                <div className="pane">
                  {!templateInfo || templateInfo.shots.length === 0 ? (
                    <p className="hint">Belum ada daftar shot untuk video ini.</p>
                  ) : (
                    <div className="rows">
                      {templateInfo.shots.map((s, i) => (
                        <button key={i} className="row" onClick={() => seek(s.start)}>
                          <span className="k">{i + 1}</span>
                          <span className="t">
                            shot {s.start.toFixed(1)} dtk · {s.label}
                          </span>
                          <span className="at">{fmt(s.start)}</span>
                          <span className="play-ico">▶</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="hint">Klik baris shot untuk lompat ke waktunya.</p>
                </div>
              )}
              {inspectorTab === "cap" && (
                <div className="pane">
                  <p className="note" style={{ margin: 0 }}>
                    Editor Caption {spec ? `(${spec.caps.length} baris)` : ""}
                  </p>
                  {!spec && <p className="note">Editor caption hanya untuk video spec — pilih template bawaan atau buka video spec dari Video Buatan Saya. (Scene dan template skill direvisi lewat prompt.)</p>}
                  {spec?.caps.map((cap, i) => {
                    const wps = wordsPerSecond(cap);
                    return (
                      <div className="cap-row" key={i}>
                        <div className="cap-meta">
                          <label>
                            Mulai{" "}
                            <input
                              type="number"
                              step={0.1}
                              min={0}
                              max={duration}
                              value={cap.start}
                              onChange={(e) => updateCap(i, { start: Number(e.target.value) })}
                            />
                          </label>
                          <label>
                            Selesai{" "}
                            <input
                              type="number"
                              step={0.1}
                              min={0}
                              max={duration}
                              value={cap.end}
                              onChange={(e) => updateCap(i, { end: Number(e.target.value) })}
                            />
                          </label>
                          {meta.hasSpeakerField && (
                            <select value={cap.speaker ?? 0} onChange={(e) => updateCap(i, { speaker: Number(e.target.value) })}>
                              {meta.speakers.map((s, si) => (
                                <option key={si} value={si}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                          <button className="linklike" onClick={() => seek(cap.start)} aria-label={`Lompat ke ${fmt(cap.start)}`} title="Lompat ke waktu caption ini">
                            ▶ {fmt(cap.start)}
                          </button>
                          <span className={`wps ${wps > MAX_WORDS_PER_SECOND ? "bad" : ""}`}>
                            {wps.toFixed(1)} kata/dtk (maks {MAX_WORDS_PER_SECOND})
                          </span>
                        </div>
                        <input
                          type="text"
                          value={cap.text}
                          onChange={(e) => updateCap(i, { text: e.target.value })}
                          aria-label={`Caption ${i + 1}`}
                        />
                      </div>
                    );
                  })}
                  <div className="btnrow">
                    <button className="btn" disabled={busy || !spec} onClick={() => spec && applySpec(spec, "Menerapkan edit caption")}>
                      Terapkan Edit ke Preview
                    </button>
                  </div>
                  <p className="note">Edit di atas hanya mengubah teks/waktu/speaker caption. Layar monitor &amp; gerakan maskot tetap mengikuti template.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Modal Settings Provider */}
      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Settings Provider AI</h2>
            <p className="note">
              Provider custom kamu (format OpenAI-compatible, <code>/v1/chat/completions</code>).
              Disimpan <b>hanya di browser ini</b> (localStorage, key <code>claudeku.provider</code>) —
              tidak pernah masuk repo, server, atau log.
            </p>
            <label>Base URL</label>
            <input
              type="text"
              placeholder="https://api.provider.com/v1"
              value={provider.baseUrl}
              onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })}
            />
            <div className="hint">Tanpa <code>/chat/completions</code> di ujungnya. Contoh: https://api.provider.com/v1</div>
            <label>Model ID</label>
            <input
              type="text"
              placeholder="nama-model-kamu"
              value={provider.model}
              onChange={(e) => setProvider({ ...provider, model: e.target.value })}
            />
            <label>API Key</label>
            <div className="keyrow">
              <input
                type={showKey ? "text" : "password"}
                placeholder="••••••••"
                value={provider.apiKey}
                onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })}
                autoComplete="off"
              />
              <button className="btn small" onClick={() => setShowKey(!showKey)}>
                {showKey ? "Sembunyikan" : "Lihat"}
              </button>
            </div>
            <div className="hint">Kosongkan bila provider kamu tidak butuh key. Jangan pernah kirim key lewat chat.</div>
            {testResult && <div className={`status ${testResult.kind}`}>{testResult.text}</div>}
            <div className="btnrow" style={{ marginTop: 16 }}>
              <button className="btn primary" onClick={saveProviderSettings}>Simpan</button>
              <button className="btn" onClick={testProvider} disabled={testing}>
                {testing ? "Menguji…" : "Tes Koneksi"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  clearProvider();
                  setProvider({ baseUrl: "", model: "", apiKey: "" });
                  setProviderSaved(false);
                  setTestResult({ kind: "info", text: "Provider dihapus dari browser ini." });
                }}
              >
                Hapus
              </button>
              <button className="btn" onClick={() => setShowSettings(false)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast: cermin status terbaru (referensi studio/). */}
      {toast && (
        <div className="toast on" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}
