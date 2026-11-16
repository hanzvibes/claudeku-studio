"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEMPLATES, getTemplate } from "@/lib/templates";
import { CANNED_SPEC, cannedRevisionExample } from "@/lib/canned";
import { CANNED_SCENE, cannedSceneRevision } from "@/lib/canned-scene";
import type { SceneSpec } from "@/lib/scene-spec";
import {
  loadMine,
  saveMineEntry,
  updateMineEntry,
  deleteMineEntry,
  newMineId,
  type MineEntry,
} from "@/lib/mine";
import {
  loadProvider,
  saveProvider,
  clearProvider,
  type ProviderConfig,
} from "@/lib/provider";
import { wordsPerSecond, MAX_WORDS_PER_SECOND, type Spec } from "@/lib/spec";

type Status = { kind: "ok" | "err" | "info"; text: string } | null;

/** Event SSE dari /api/generate-scene-stream. */
type StreamEvent =
  | { type: "token"; text: string }
  | { type: "stage"; stage: string; text: string }
  | { type: "partial"; scene: SceneSpec }
  | { type: "repaired"; attempt: number }
  | { type: "done"; scene: SceneSpec; html: string; previewHtml: string; repaired: boolean; attempts: number }
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
  const [mode, setMode] = useState<"baru" | "revisi" | "scene">("revisi");
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
  const [mine, setMine] = useState<MineEntry[]>([]);
  const [activeMineId, setActiveMineId] = useState<string | null>(null);
  // Preview lazy: iframe TIDAK di-load saat pertama buka — baru dimuat saat
  // pengguna memilih template / video buatan / menekan tombol muat. Lebih ringan.
  const [previewOn, setPreviewOn] = useState(false);
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

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const meta = getTemplate(templateId) ?? TEMPLATES[0];
  // Saat scene aktif, durasi + judul mengikuti scene, bukan template.
  const duration = scene ? scene.duration : meta.duration;
  const previewTitle = scene?.title ?? spec?.title ?? meta.title;

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
  // SELALU keluar dari mode scene (scene tersimpan tetap ada di galeri).
  const loadTemplateSpec = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/template?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat template.");
      setLivePreview(false);
      setScene(null);
      setPrevScene(null);
      setActiveMineId(null);
      setSpec({ templateId: id, title: data.title, caps: data.caps, vo: data.vo });
      setGeneratedHtml(null);
      setPreviewHtml(null);
      setBlobUrl(null);
      setPrevSpec(null);
      setCurrentTime(0);
      setPlaying(false);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal memuat template." });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
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
    const clamped = Math.min(Math.max(t, 0), duration - 0.01);
    setCurrentTime(clamped);
    try {
      iframeWindow()?.renderAt?.(clamped);
    } catch {
      // iframe belum siap — abaikan, pengguna bisa seek lagi.
    }
  };

  const play = () => {
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
  const rememberResult = useCallback((entry: Omit<MineEntry, "id" | "createdAt">, updateId?: string | null) => {
    if (updateId) {
      const existing = loadMine().find((e) => e.id === updateId);
      if (existing) {
        const updated = updateMineEntry({ ...existing, ...entry, id: updateId, createdAt: existing.createdAt });
        setMine(updated);
        return updateId;
      }
    }
    const id = newMineId();
    setMine(saveMineEntry({ ...entry, id, createdAt: Date.now() }));
    setActiveMineId(id);
    return id;
  }, []);

  // --- Terapkan SceneSpec (jalur scene: generate / canned / undo / buka galeri) ---
  const applyScene = async (next: SceneSpec, label: string, opts?: { save?: boolean }) => {
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
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      setPreviewOn(true);
      setCurrentTime(0);
      setPlaying(false);
      cbfShownRef.current = "";
      if (opts?.save !== false) {
        const isUpdate = activeMineId && mine.some((e) => e.id === activeMineId && e.kind === "scene");
        rememberResult(
          { title: data.scene.title, kind: "scene", duration: data.scene.duration, scene: data.scene },
          isUpdate ? activeMineId : null,
        );
      }
      setStatus({ kind: "ok", text: `${label} berhasil — tersimpan di Video Buatan Saya, preview sudah berubah.` });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal menerapkan scene." });
    } finally {
      setBusy(false);
    }
  };

  // --- Terapkan spec lama (jalur bersama untuk edit manual / canned / undo) ---
  const applySpec = async (next: Spec, label: string) => {
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
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      setPreviewOn(true);
      if (data.templateId !== templateId) setTemplateId(data.templateId);
      // Edit manual / canned pada entri yang sedang dibuka memperbarui entri itu.
      if (activeMineId && mine.some((e) => e.id === activeMineId && e.kind === "spec")) {
        rememberResult(
          { title: data.spec.title, kind: "spec", baseTemplateId: data.spec.templateId, duration: getTemplate(data.spec.templateId)?.duration ?? 0, spec: data.spec },
          activeMineId,
        );
      }
      setStatus({ kind: "ok", text: `${label} berhasil — preview sudah berubah.` });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal menerapkan spec." });
    } finally {
      setBusy(false);
    }
  };

  // --- Buka entri Video Buatan Saya ---
  const openMineEntry = async (entry: MineEntry) => {
    setActiveMineId(entry.id);
    if (entry.kind === "scene" && entry.scene) {
      await applyScene(entry.scene, `Membuka "${entry.title}"`, { save: false });
      setActiveMineId(entry.id);
    } else if (entry.kind === "spec" && entry.spec) {
      await applySpec(entry.spec, `Membuka "${entry.title}"`);
      setActiveMineId(entry.id);
    }
  };

  const removeMineEntry = (id: string) => {
    setMine(deleteMineEntry(id));
    if (id === activeMineId) {
      setActiveMineId(null);
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
  const generateSceneStream = async () => {
    const saved = loadProvider();
    const isRevision = scene !== null;
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
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
        body: JSON.stringify({ prompt: prompt.trim(), provider: saved ?? provider, currentScene: isRevision ? scene : null }),
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
              setGeneratedHtml(ev.html);
              setPreviewHtml(ev.previewHtml ?? ev.html);
              setLivePreview(false);
              setPreviewOn(true);
              setCurrentTime(0);
              setPlaying(false);
              cbfShownRef.current = "";
              const isUpdate = isRevision && activeMineId && mine.some((e) => e.id === activeMineId && e.kind === "scene");
              rememberResult(
                { title: ev.scene.title, kind: "scene", duration: ev.scene.duration, scene: ev.scene },
                isUpdate ? activeMineId : null,
              );
              setStatus({
                kind: "ok",
                text: isRevision
                  ? "Revisi scene berhasil — tersimpan di Video Buatan Saya."
                  : `Scene baru berhasil dibuat — tersimpan di Video Buatan Saya sebagai template baru.${ev.repaired ? " (AI sempat memperbaiki sendiri.)" : ""}`,
              });
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
      abortControllerRef.current = null;
    }
  };

  // --- Batalkan streaming: simpan partial terakhir sebagai DRAFT bila ada ---
  const cancelStream = () => {
    abortControllerRef.current?.abort();
    const draft = lastPartialSceneRef.current;
    setLivePreview(false);
    setStreaming(false);
    setBusy(false);
    if (draft && draft.shots.length > 0) {
      rememberResult({ title: `${draft.title} (draft)`, kind: "scene", duration: draft.duration, scene: draft });
      setStatus({ kind: "info", text: "Dibatalkan — draft tersimpan di Video Buatan Saya." });
    } else {
      setStatus({ kind: "info", text: "Dibatalkan." });
    }
  };

  // --- Generate / revisi lewat AI (tiga mode) ---
  const generate = async () => {
    if (!prompt.trim()) {
      setStatus({ kind: "err", text: "Tulis dulu ide / instruksi revisinya di kotak prompt." });
      return;
    }
    const saved = loadProvider();
    setBusy(true);
    try {
      if (mode === "scene") {
        // Mode scene memakai streaming SSE (generateSceneStream mengatur
        // busy/streaming sendiri; finally di bawah hanya pengaman).
        await generateSceneStream();
        return;
      }

      // Mode lama (template): buat baru / revisi spec.
      const isRevision = mode === "revisi" && spec !== null;
      if (isRevision && !spec) return;
      setStatus({ kind: "info", text: isRevision ? "AI merevisi video ini…" : "AI membuat video baru…" });
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          templateId,
          provider: saved ?? provider,
          currentSpec: isRevision ? spec : null,
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
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      setPreviewOn(true);
      if (data.templateId !== templateId) setTemplateId(data.templateId);
      const isUpdate = isRevision && activeMineId && mine.some((e) => e.id === activeMineId && e.kind === "spec");
      rememberResult(
        {
          title: data.spec.title,
          kind: "spec",
          baseTemplateId: data.spec.templateId,
          duration: getTemplate(data.spec.templateId)?.duration ?? 0,
          spec: data.spec,
        },
        isUpdate ? activeMineId : null,
      );
      setStatus({
        kind: "ok",
        text: isRevision
          ? "Revisi berhasil — entri Video Buatan Saya diperbarui."
          : "Video baru berhasil dibuat — tersimpan di Video Buatan Saya sebagai template baru.",
      });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Generate gagal." });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (scene && prevScene) {
      const target = prevScene;
      setPrevScene(null);
      await applyScene(target, "Mengembalikan scene sebelumnya", { save: false });
      setPrevScene(null);
      return;
    }
    if (!prevSpec) return;
    const target = prevSpec;
    setPrevSpec(null);
    await applySpec(target, "Mengembalikan versi sebelumnya");
    // applySpec menimpa prevSpec dengan spec saat ini; untuk undo 1 langkah
    // itu sudah benar: tidak ada riwayat lebih jauh di v1.
    setPrevSpec(null);
  };

  const downloadHtml = () => {
    // Download memakai generatedHtml CANONICAL (CDN) — sengaja, supaya file
    // hasil download jalan standalone di browser normal. Preview memakai
    // previewHtml (/vendor/ lokal) dan tidak pernah diunduh.
    if (!generatedHtml || (!spec && !scene)) {
      setStatus({ kind: "err", text: "Belum ada hasil generate. Buat video dulu atau terapkan edit caption." });
      return;
    }
    const name = scene ? scene.title.replace(/[^\w\- ]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "scene" : `${spec?.templateId ?? "claudeku"}`;
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
        a.download = `${scene ? "scene" : (spec?.templateId ?? "claudeku")}-rekaman.webm`;
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
      ? scene
        ? "AI merevisi scene ini: shot, beat, pose, dan monitor bisa berubah — hasilnya tetap tersimpan sebagai video buatanmu."
        : "AI membuat scene BARU dari nol: adegan, kamera, pose, dan cerita ditentukan AI lewat mesin scene — bukan menempel di template lama."
      : mode === "baru"
        ? "AI membuat resep video baru dari nol di template yang dipilih. Hasilnya tersimpan sebagai template baru di Video Buatan Saya."
        : "AI menerima video saat ini sebagai konteks dan hanya mengubah yang kamu minta — sisanya dipertahankan. Bisa juga ganti template & judul.";

  return (
    <>
      <header className="topbar">
        <h1>🎬 Claudeku Studio</h1>
        <span className="sub">Short animasi Three.js 9:16 — pilih template, ketik ide, preview, export.</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowSettings(true)}>
          ⚙️ Settings Provider {providerSaved ? "✓" : "(belum diisi)"}
        </button>
      </header>

      <main className="layout">
        {/* Kolom kiri: galeri — Video Buatan Saya + Template Bawaan */}
        <aside className="card">
          <h2>Video Buatan Saya {mine.length > 0 ? `(${mine.length})` : ""}</h2>
          {mine.length === 0 && (
            <p className="note">Belum ada. Hasil generate (scene maupun template) otomatis tersimpan di sini sebagai template baru — template bawaan tidak pernah ketimpa.</p>
          )}
          {mine.map((entry) => (
            <div key={entry.id} className={`gallery-item mine-item ${entry.id === activeMineId ? "active" : ""}`}>
              <button className="mine-open" onClick={() => openMineEntry(entry)}>
                <b>{entry.title}</b>
                <span>
                  {entry.kind === "scene" ? "🎬 Scene" : "📄 Template"} · {entry.duration} dtk · {fmtDate(entry.createdAt)}
                </span>
              </button>
              <button className="mine-del" onClick={() => removeMineEntry(entry.id)} aria-label={`Hapus ${entry.title}`}>
                ✕
              </button>
            </div>
          ))}

          <h2 style={{ marginTop: 16 }}>Template Bawaan (9)</h2>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`gallery-item compact ${t.id === templateId && !scene ? "active" : ""}`}
              onClick={() => setTemplateId(t.id)}
              title={t.description}
            >
              <b>{t.title}</b>
              <span>
                {t.duration} detik · {t.characters} karakter · {t.speakers.join(" / ")}
              </span>
            </button>
          ))}
          <p className="note">Template disalin apa adanya dari skill threejs-cinematic-short v3.8. Semua lolos lint_short.py. Template bawaan tidak pernah diubah oleh generate.</p>
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
            </div>
            <div className="timeline">
              <button className="btn small" onClick={() => (playing ? pause() : play())} disabled={busy || !previewOn}>
                {playing ? "⏸ Jeda" : "▶ Putar"}
              </button>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={currentTime}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Timeline"
              />
              <span className="time">
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>
            <div className="btnrow">
              <button className="btn small" onClick={() => seek(0)} disabled={!previewOn}>⏮ Ulang dari awal</button>
              <button className="btn small" onClick={() => seek(Math.max(0, currentTime - 5))} disabled={!previewOn}>−5 dtk</button>
              <button className="btn small" onClick={() => seek(Math.min(duration, currentTime + 5))} disabled={!previewOn}>+5 dtk</button>
              <button className="btn small" onClick={downloadHtml}>⬇ Download HTML</button>
              {(prevSpec || prevScene) && (
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

        {/* Kanan: prompt + editor caption */}
        <aside className="card">
          <h2>Prompt AI</h2>
          <div className="mode-toggle" role="tablist" aria-label="Mode prompt">
            <button className={mode === "baru" ? "active" : ""} onClick={() => setMode("baru")}>
              ✨ Buat baru
            </button>
            <button className={mode === "revisi" ? "active" : ""} onClick={() => setMode("revisi")}>
              ✏️ Revisi video ini
            </button>
            <button className={mode === "scene" ? "active" : ""} onClick={() => setMode("scene")}>
              🎬 Scene baru
            </button>
          </div>
          <p className="note" style={{ marginTop: 8 }}>{modeHint}</p>
          {mode === "scene" && scene && (
            <p className="note">
              Scene aktif: <b>{scene.title}</b> ({scene.duration} dtk). Prompt di bawah akan merevisi scene ini.{" "}
              <button className="linklike" onClick={() => { setScene(null); setPrevScene(null); setActiveMineId(null); setStatus({ kind: "info", text: "Scene ditutup — prompt berikutnya membuat scene baru dari nol." }); }}>
                Tutup scene, buat baru
              </button>
            </p>
          )}
          <textarea
            className="prompt"
            placeholder={
              mode === "scene"
                ? "Contoh: Claude dan Codex balapan roket sambil minum kopi, endingnya trofi jatuh ke kepala Gemini…"
                : mode === "baru"
                  ? "Contoh: Claude vs Codex debat siapa paling cepat ngetik, endingnya kerja bareng…"
                  : "Contoh: ganti endingnya jadi ajakan kerja bareng, bikin dialog Codex lebih pendek…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={generate} disabled={busy}>
              {busy ? "Memproses…" : mode === "scene" ? (scene ? "Revisi Scene" : "Buat Scene") : mode === "baru" ? "Buat Video" : "Revisi Video"}
            </button>
            {mode === "scene" ? (
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
          </p>

          <details className="more">
            <summary>Editor Caption {spec ? `(${spec.caps.length} baris)` : ""}</summary>
            {!spec && <p className="note">Memuat template… (editor caption hanya untuk video template, bukan scene.)</p>}
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
          </details>
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
    </>
  );
}
