# Claudeku Studio

Studio web untuk membuat short animasi 3D 9:16 (TikTok/Reels/Shorts) dari
template **threejs-cinematic-short v3.14** — galeri template, preview ala
Remotion, kotak prompt AI, dan editor caption. Bisa self-host (Docker/VPS)
dan deploy Vercel.

> Bahasa antarmuka: Indonesia. Gaya: putih bersih (#F9F9FA + kartu putih).

## Cara menjalankan lokal

```bash
npm install
npm run dev      # buka http://localhost:3000
npm run build    # verifikasi production build
npm start        # jalankan hasil build (port 3000)
```

## Cara memakai

1. **Pilih template** di galeri kiri (12 template, 26–36 detik).
2. **Preview** di tengah: tombol Putar/Jeda, geser timeline untuk lompat ke
   detik tertentu, tombol −5/+5 dtk. Timeline memakai `window.renderAt(t)`
   bawaan template.
3. **Buat baru (prompt AI):** pilih mode “✨ Buat baru”, tulis ide, klik
   “Buat Video”. AI mengembalikan resep video (JSON), Studio menerapkan ke
   template dan preview langsung berubah.
4. **Revisi video yang sudah ada:** pilih mode “✏️ Revisi video ini”, tulis
   instruksi lanjutan — misalnya “ganti endingnya jadi ajakan kerja bareng”,
   “bikin dialog Codex lebih pendek”, atau “ganti template ke Rival tapi
   dialog tetap”. AI menerima spec saat ini sebagai konteks dan mengembalikan
   **spec lengkap yang sudah diperbarui** (bukan patch). Studio memvalidasi
   ulang (caption dalam durasi, laju kata, speaker, credit @hanzvibes) lalu
   menerapkan + preview berubah. Bisa juga ganti template dan judul lewat revisi.
5. **Edit manual:** ubah teks/waktu/speaker caption di Editor Caption, lalu
   “Terapkan Edit ke Preview”.
6. **Undo:** tombol “↩ Kembalikan ke versi sebelumnya” mengembalikan spec
   sebelum generate/revisi terakhir (1 langkah, v1).
7. **Tanpa AI:** tombol “Coba contoh (tanpa AI)” dan “Coba revisi contoh”
   memakai spec contoh — berguna untuk tes dan demo tanpa provider.

## Isi provider AI di UI (tidak perlu kirim key ke siapa pun)

AI-nya **custom provider kamu sendiri**, format OpenAI-compatible
(`POST {baseUrl}/chat/completions`).

1. Klik **⚙️ Settings Provider** di kanan atas.
2. Isi **Base URL** (contoh: `https://api.provider.com/v1` — tanpa
   `/chat/completions` di ujungnya), **Model ID**, dan **API Key** (boleh
   kosong bila providermu tidak butuh key).
3. Klik **Simpan**, lalu **Tes Koneksi** (server memanggil
   `GET {baseUrl}/models`, fallback chat completion minimal bila `/models`
   tidak tersedia).

Penyimpanan: **hanya di browser kamu** (localStorage, key
`claudeku.provider`). API key tidak pernah masuk repo, tidak pernah disimpan
di server, dan tidak pernah ditulis ke log. Server (`/api/generate`,
`/api/test-provider`) hanya meneruskan key ke provider kamu di dalam request
itu saja.

## Export

- **⬇ Download HTML** — unduh HTML hasil generate/revisi, bisa dibuka di
  browser mana pun. File ini **tetap memakai link CDN three.js r128**
  (canonical), sengaja — supaya jalan standalone di browser normal.

## Preview lokal vs export (pemilihan CDN vs vendor lokal — penting)

Template asli memuat three.js r128 + 12 file postprocessing dari CDN
(cdnjs + cdn.jsdelivr). CDN itu ke-block di beberapa lingkungan (mis. proxy
VM ini), sehingga preview jadi hitam total (`THREE is not defined`).

- **Preview di Studio TIDAK memakai CDN.** File vendor three.js yang sama
  (13 file, 704K) disalin ke `public/vendor/`, dan Studio me-rewrite 13 URL
  CDN itu ke `/vendor/<nama>` **saat serve preview saja**:
  - template mentah: `GET /api/preview?id=<templateId>` (baca canonical,
    rewrite, kembalikan HTML; urutan script tetap sama),
  - hasil generate/apply: `/api/apply` & `/api/generate` mengembalikan
    `html` (canonical, CDN) **dan** `previewHtml` (rewrite lokal); iframe
    preview memakai `previewHtml`, Download memakai `html`.
  Logika rewrite ada di `lib/cdn-rewrite.ts` (`rewriteThreeCdnToLocal`).
- **Export TETAP CDN.** File `public/templates/*.html` (canonical) tidak
  pernah diubah, dan HTML hasil Download tetap berisi link CDN — jadi file
  hasil download jalan standalone di browser normal/tablet.
- Catatan: font Google (Plus Jakarta Sans) masih dimuat dari CDN di
  template; bila ikut ke-block, template memakai font fallback sistem —
  tampilan 3D tetap jalan.
- **● Rekam di Browser (WebM)** — best-effort: merekam canvas preview via
  `canvas.captureStream` + `MediaRecorder`. Hasil WebM, **suara voice-over
  (Web Speech) tidak ikut terekam**. Cocok untuk draf cepat.
- **MP4 60fps (kualitas penuh)** — pakai script bawaan skill di mesin
  sendiri (butuh network + Playwright + Chromium + ffmpeg):

```bash
python3 scripts/export_mp4.py hasil.html hasil.mp4 60
# atau render frame demi frame: template menyediakan window.renderAt(t),
# screenshot tiap frame di t = i/60, lalu:
ffmpeg -framerate 60 -i f_%04d.png -c:v libx264 -pix_fmt yuv420p hasil.mp4
```

## Mesin scene (Hybrid Level 4) + live streaming

Selain generate berbasis template di atas, ada mode **“🎬 Scene baru”**:

- AI menulis **SceneSpec** lengkap dari nol — shot kamera, beat adegan, pose,
  props, isi monitor, palet — bukan sekadar ganti teks di template lama.
  Renderer dinamis (`public/templates/dynamic.html`) memainkannya. Kosakata
  lengkap ada di `docs/SCENE-ENGINE.md` (10 pose, 7 kamera, 9 beat, 8 props,
  6 jenis monitor, 4 palet, 4 transisi).
- **Escape hatch kode kustom:** bila adegan tidak bisa dibuat dari kosakata,
  AI boleh menulis kode JS kecil (beat `custom`). Kode itu jalan di iframe
  sandbox terpisah, hanya boleh memanggil `api.pose / api.prop / api.monitor
  / api.flash / api.toast`; sintaks + blocklist divalidasi server
  (`lib/scene-spec.ts`). Bila gagal saat jalan, renderer jatuh ke
  `fallbackText` (dialog aman) + toast “Adegan kustom gagal, diganti adegan
  aman”. Bila SceneSpec dari AI tidak lolos validasi, server meminta AI
  memperbaiki sendiri (self-repair, maks 2x).
- **Live streaming saat generate:** endpoint `/api/generate-scene-stream`
  (SSE) mencoba `stream:true` ke provider dan meneruskan token kata-per-kata
  ke panel streaming; preview ikut kebangun adegan per adegan lewat
  `postMessage` ke iframe (`/api/preview-scene`) tanpa reload penuh. Bila
  provider tidak mendukung stream, otomatis fallback ke mode tahapan
  (“lagi nulis cerita…”, “lagi atur kamera…”, “lagi cek adegan…”). Tombol
  **Batalkan** menghentikan stream dan menyimpan hasil parsial sebagai draft
  bila sudah ada minimal 1 shot valid. Streaming tidak menambah biaya (satu
  generasi yang sama, hanya ditampilkan progresif). Dukungan `stream:true`
  provider live pengguna belum terverifikasi (butuh kredensial pengguna).
- **Video Buatan Saya:** setiap hasil generate (scene maupun template)
  OTOMATIS tersimpan sebagai entri baru di galeri (localStorage, key
  `claudeku.mine`) — 12 template bawaan tidak pernah ditimpa. Entri bisa
  dibuka lagi, direvisi, dihapus, dan diekspor (Download HTML).

## Self-host (Docker)

```bash
docker build -t claudeku-studio .
docker run --rm -p 3000:3000 claudeku-studio
# buka http://localhost:3000
```

## Deploy Vercel

```bash
npx vercel
# atau hubungkan repo ke Vercel (framework: Next.js). Tidak ada env var wajib.
# Provider tetap diisi lewat UI Settings setelah deploy.
```

## Struktur

```
app/
  page.tsx                 Studio (galeri + preview + prompt + editor + settings)
  api/
    template/route.ts      GET ?id= — parse template asli (LEN/caps/VO)
    apply/route.ts         POST {templateId, spec} — validasi + terapkan spec
    generate/route.ts      POST {prompt, templateId, provider, currentSpec?}
    preview/route.ts       GET ?id= — serve template untuk preview (rewrite CDN -> /vendor/)
    test-provider/route.ts POST {baseUrl, model, apiKey} — tes koneksi provider
    apply-scene/route.ts   POST {scene} — validasi SceneSpec + terapkan ke dynamic.html
    generate-scene/route.ts POST {prompt, provider, currentScene?} — AI -> SceneSpec + self-repair
    generate-scene-stream/route.ts POST SSE — streaming token + partial + fallback non-stream
    preview-scene/route.ts GET — serve dynamic.html untuk preview live (rewrite CDN -> /vendor/)
lib/
  templates.ts             metadata 12 template (durasi, speaker, gaya caps/VO)
  cdn-rewrite.ts           rewrite 13 URL CDN three.js -> /vendor/ (PREVIEW saja; export tetap CDN)
  spec.ts                  tipe Spec + validateSpec + parseTemplateHtml (+ extractPartialJsonFromText untuk streaming)
  apply-spec.ts            menempelkan Spec ke HTML (hanya title/caps/VO)
  skill.ts                 system prompt AI (ringkasan SKILL.md)
  canned.ts                spec contoh + revisi contoh (tes tanpa AI)
  provider.ts              localStorage provider (client saja)
  scene-spec.ts            SceneSpec + kosakata engine + validasi (penuh + parsial) + blocklist kode custom
  scene-prompt.ts          system prompt AI untuk SceneSpec (Bahasa Indonesia, tanpa karakter Cina)
  apply-scene.ts           menempelkan SceneSpec ke dynamic.html (placeholder tepat 1x)
  canned-scene.ts          SceneSpec contoh + revisi contoh + fixture custom beat terlarang
  mine.ts                  "Video Buatan Saya" (localStorage claudeku.mine)
public/templates/          12 template HTML asli (disalin, tidak diubah) + dynamic.html (renderer scene)
public/vendor/             three.js r128 + 12 file postprocessing (13 file, 704K) — HANYA untuk preview
scripts/
  lint_short.py            lint bawaan skill (credit, syntax, flicker, caption)
  export_mp4.py            render MP4 60fps via Playwright (mesin sendiri)
docs/SKILL-RINGKAS.md      ringkasan SKILL.md v3.14
docs/SCENE-ENGINE.md       kosakata mesin scene lengkap (pose/kamera/beat/props/monitor/palet/transisi)
```

## Cara kerja AI (penting)

AI **tidak pernah** menulis ulang HTML mentah. Ia hanya mengembalikan JSON
“resep” video:

```json
{
  "templateId": "versus",
  "title": "Judul video",
  "caps": [{"start": 3, "end": 6, "text": "Teks caption", "speaker": 0}],
  "vo": ["Teks voice-over, sejajar dengan caps"],
  "notes": "catatan (opsional)"
}
```

Server memvalidasi resep itu (caption terurut, dalam 0..LEN, laju kata
≤ 2,6 kata/dtk, speaker valid, `vo` sejajar caps), lalu
`lib/apply-spec.ts` hanya mengganti baris `<title>`, array `caps=[...]`,
dan array `VO=[...]` (bila eksplisit) di template. Setelah itu hasil
divalidasi ulang: credit `@hanzvibes` (watermark `#wm` + `by @hanzvibes`,
minimal 2x) wajib utuh — kalau hilang, hasil ditolak.

## Batasan yang diketahui (jujur)

- **Panggilan AI live belum terverifikasi** — butuh kredensial provider
  pengguna (Base URL + Model + API Key) yang diisi lewat UI Settings.
- **Render WebGL live di VM headless** — sudah terverifikasi sesudah fix
  vendor lokal: preview 3D muncul di screenshot Chrome Headless Shell
  (lihat laporan fix preview). Template butuh Google Fonts saat dibuka;
  bila CDN font ke-block, dipakai font fallback sistem.
- **Export MP4 60fps belum dijalankan** — script `export_mp4.py` disalin apa
  adanya dari skill, butuh Playwright + Chromium + ffmpeg di mesin sendiri.
- **Rekam browser** adalah WebM best-effort, tanpa suara, dan kualitasnya
  tergantung performa browser.
- **Undo hanya 1 langkah** (v1). Riwayat lebih panjang belum ada.
- **Editor caption** hanya mengubah teks/waktu/speaker — layar monitor,
  gerakan maskot, dan shot kamera tetap mengikuti template.
