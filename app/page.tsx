"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEMPLATES, getTemplate } from "@/lib/templates";
import { CANNED_SPEC, cannedRevisionExample } from "@/lib/canned";
import {
  loadProvider,
  saveProvider,
  clearProvider,
  type ProviderConfig,
} from "@/lib/provider";
import { wordsPerSecond, MAX_WORDS_PER_SECOND, type Spec } from "@/lib/spec";

type Status = { kind: "ok" | "err" | "info"; text: string } | null;

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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
  const [mode, setMode] = useState<"baru" | "revisi">("revisi");
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

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const meta = getTemplate(templateId) ?? TEMPLATES[0];
  const duration = meta.duration;

  // Muat provider tersimpan (localStorage saja) saat pertama buka.
  useEffect(() => {
    const saved = loadProvider();
    if (saved) {
      setProvider(saved);
      setProviderSaved(true);
    }
  }, []);

  // Muat spec asli template terpilih dari server.
  const loadTemplateSpec = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/template?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat template.");
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
  useEffect(() => {
    if (!previewHtml) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([previewHtml], { type: "text/html" }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewHtml]);

  // Poll waktu dari player di dalam iframe (#tc = jam berjalan template).
  useEffect(() => {
    const t = setInterval(() => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const tc = doc.getElementById("tc");
      const parsed = parseClock(tc?.textContent);
      if (parsed !== null) setCurrentTime(parsed);
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

  // --- Terapkan spec (jalur bersama untuk edit manual / canned / undo) ---
  const applySpec = async (next: Spec, label: string) => {
    setBusy(true);
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
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      if (data.templateId !== templateId) setTemplateId(data.templateId);
      setStatus({ kind: "ok", text: `${label} berhasil — preview sudah berubah.` });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Gagal menerapkan spec." });
    } finally {
      setBusy(false);
    }
  };

  // --- Generate / revisi lewat AI ---
  const generate = async () => {
    if (!prompt.trim()) {
      setStatus({ kind: "err", text: "Tulis dulu ide / instruksi revisinya di kotak prompt." });
      return;
    }
    const isRevision = mode === "revisi" && spec !== null;
    if (isRevision && !spec) return;
    setBusy(true);
    setStatus({ kind: "info", text: isRevision ? "AI merevisi video ini…" : "AI membuat video baru…" });
    try {
      const saved = loadProvider();
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
      setGeneratedHtml(data.html);
      setPreviewHtml(data.previewHtml ?? data.html);
      if (data.templateId !== templateId) setTemplateId(data.templateId);
      setStatus({ kind: "ok", text: isRevision ? "Revisi berhasil — preview sudah berubah." : "Video baru berhasil dibuat — preview sudah berubah." });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Generate gagal." });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
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
    if (!generatedHtml || !spec) {
      setStatus({ kind: "err", text: "Belum ada hasil generate. Buat video dulu atau terapkan edit caption." });
      return;
    }
    const url = URL.createObjectURL(new Blob([generatedHtml], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.templateId}-claudeku.html`;
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
        a.download = `${spec?.templateId ?? "claudeku"}-rekaman.webm`;
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
  const iframeSrc = blobUrl ?? `/api/preview?id=${encodeURIComponent(templateId)}`;

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
        {/* Kolom kiri: galeri template */}
        <aside className="card">
          <h2>Template</h2>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`gallery-item ${t.id === templateId ? "active" : ""}`}
              onClick={() => setTemplateId(t.id)}
            >
              <b>{t.title}</b>
              <span>
                {t.duration} detik · {t.characters} karakter · {t.speakers.join(" / ")}
              </span>
              <p>{t.description}</p>
            </button>
          ))}
          <p className="note">Template disalin apa adanya dari skill threejs-cinematic-short v3.8. Semua lolos lint_short.py.</p>
        </aside>

        {/* Tengah: preview + timeline */}
        <section className="card">
          <h2>Preview — {spec?.title ?? meta.title}</h2>
          <div className="preview-wrap">
            <div className="preview-frame">
              <iframe
                ref={iframeRef}
                key={iframeSrc}
                src={iframeSrc}
                title="Preview video"
                allow="autoplay"
              />
            </div>
            <div className="timeline">
              <button className="btn small" onClick={() => (playing ? pause() : play())} disabled={busy}>
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
              <button className="btn small" onClick={() => seek(0)}>⏮ Ulang dari awal</button>
              <button className="btn small" onClick={() => seek(Math.max(0, currentTime - 5))}>−5 dtk</button>
              <button className="btn small" onClick={() => seek(Math.min(duration, currentTime + 5))}>+5 dtk</button>
              <button className="btn small" onClick={toggleRecord} disabled={busy}>
                {recording ? "⏹ Berhenti Rekam" : "● Rekam di Browser (WebM)"}
              </button>
              <button className="btn small" onClick={downloadHtml}>⬇ Download HTML</button>
              {prevSpec && (
                <button className="btn small" onClick={undo} disabled={busy}>
                  ↩ Kembalikan ke versi sebelumnya
                </button>
              )}
            </div>
            <p className="note">
              Geser timeline untuk lompat ke detik tertentu (pakai <span className="kbd-hint">renderAt</span> bawaan template).
              Rekam browser itu best-effort: hasil WebM, suara voice-over tidak ikut terekam.
              Untuk MP4 60fps, pakai <span className="kbd-hint">scripts/export_mp4.py</span> — lihat README.
            </p>
            {status && <div className={`status ${status.kind}`}>{status.text}</div>}
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
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            {mode === "baru"
              ? "AI membuat resep video baru dari nol di template yang dipilih."
              : "AI menerima video saat ini sebagai konteks dan hanya mengubah yang kamu minta — sisanya dipertahankan. Bisa juga ganti template & judul."}
          </p>
          <textarea
            className="prompt"
            placeholder={
              mode === "baru"
                ? "Contoh: Claude vs Codex debat siapa paling cepat ngetik, endingnya kerja bareng…"
                : "Contoh: ganti endingnya jadi ajakan kerja bareng, bikin dialog Codex lebih pendek…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={generate} disabled={busy}>
              {busy ? "Memproses…" : mode === "baru" ? "Buat Video" : "Revisi Video"}
            </button>
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
          </div>
          <p className="note">
            Generate butuh provider (Settings). Kalau belum diisi, pakai tombol contoh di atas — tanpa AI live.
          </p>

          <h3>Editor Caption {spec ? `(${spec.caps.length} baris)` : ""}</h3>
          {!spec && <p className="note">Memuat template…</p>}
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
          <p className="note">Edit di atas hanya mengubah teks/waktu/speaker caption. Layar monitor & gerakan maskot tetap mengikuti template.</p>
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
