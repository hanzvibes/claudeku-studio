# Scene Engine — Mesin Scene Data-Driven (Hybrid Level 4)

Renderer dinamis: `public/templates/dynamic.html`.
Kontrak tipe (satu sumber kebenaran): `lib/scene-spec.ts`
(`CHARACTERS`, `PALETTES`, `CAMERAS`, `POSES`, `BEATS`, `PROPS`,
`MONITORS`, `TRANSITIONS`, `validateSceneSpec`, `normalizeSceneSpec`).

Berbeda dengan template bawaan (`public/templates/*.html`) yang ceritanya
sudah paten di kode, Scene Engine memainkan **cerita dari nol** berdasarkan
`SceneSpec` — shot kamera, beat adegan, pose, props, isi monitor, dan palet
semuanya datang dari JSON. AI hanya perlu menghasilkan JSON; renderer yang
memainkannya. Template bawaan tidak pernah disentuh.

Alur: AI menghasilkan `SceneSpec` → `lib/scene-spec.ts` memvalidasi +
menormalisasi (`validateSceneSpec` / `normalizeSceneSpec`) →
`/api/apply-scene` menempel JSON ke `dynamic.html` (baris `SPEC_RAW`) →
browser memainkan videonya. Bila file dibuka langsung tanpa ditempel spec,
dipakai spec default minimal (trio 30 detik) supaya tidak blank.

---

## 1. Struktur SceneSpec

```ts
type SceneSpec = {
  id: string;            // id unik, misal "scene-1734567890123"
  title: string;         // judul video (tampil di #title + tab browser)
  duration: number;      // durasi detik, 15..60
  palette: PaletteId;    // "arena" | "neon" | "sunset" | "office"
  characters: SceneCharacter[];  // 1..3 karakter
  shots: SceneShot[];    // menutupi SELURUH 0..duration, tanpa tumpang tindih
  beats: SceneBeat[];    // minimal 1 beat dialogue
  caps?: Cap[];          // diturunkan otomatis dari beat dialogue
  vo?: string[];         // voice-over, sejajar caps (default = teks dialog)
  notes?: string;
};
type SceneCharacter = { id: CharacterId; x?: number; accent?: string };
type SceneShot = {
  start: number; end: number; camera: CameraType; focus?: number;
  from?: [number, number, number]; to?: [number, number, number];
  lookAt?: [number, number, number]; transition?: TransitionId;
};
type SceneMonitor = { kind: MonitorKind; title?: string; lines?: string[]; value?: number };
type SceneBeat = {
  start: number; end: number; type: BeatType; character?: number;
  text?: string; pose?: PoseId; props?: PropId[]; monitor?: SceneMonitor;
  code?: string; fallbackText?: string;   // hanya untuk type "custom"
};
```

Aturan validasi (lihat `validateSceneSpec`):
- `duration` 15–60 detik; `shots[0].start` harus 0; shot terakhir harus
  berakhir tepat di `duration`; shot terurut, tidak tumpang tindih.
- `characters` 1–3; `x` -3..3 (default tersebar: 1 karakter → `[0]`,
  2 → `[-1.6, 1.6]`, 3 → `[-2.6, 0, 2.6]`).
- Setiap beat `dialogue` wajib punya `text`; dialog tidak boleh tumpang
  tindih; kecepatan bicara maks `MAX_WORDS_PER_SECOND` (lihat `lib/spec.ts`).
- Beat `custom` wajib punya `code` + `fallbackText`; `code` dicek
  `validateCustomCode` (maks 3000 karakter, blocklist, parse sintaks).

---

## 2. Karakter

| id | Label | Warna | Maskot | Monitor default |
|----|-------|-------|--------|-----------------|
| `claude` | Claude | `#d97757` (oranye) | Kotak oranye, mata hitam | `chat` |
| `codex` | Codex | `#7b8cff` (biru) | Awan biru + layar navy, wajah digambar | `terminal` |
| `gemini` | Gemini | `#b794f6` (ungu) | Bintang 4 sudut ungu | `scoreboard` |

`x`: posisi horizontal di panggung (-2.6 kiri .. 2.6 kanan).
`accent`: warna aksen kustom, misal `"#ff8800"` (default = warna karakter).

---

## 3. Palet

| id | Label | Background | Catatan |
|----|-------|------------|---------|
| `arena` | Dark Arena | `#1a1917` | Panggung gelap klasik seperti template trio (default). |
| `neon` | Neon | `#0b0618` | Gelap ungu-pink, lampu neon kuat, cocok adegan malam/hackathon. |
| `sunset` | Sunset | `#2b1a12` | Hangat oranye-ungu, cahaya sore, cocok ending / momen haru. |
| `office` | Office Siang | `#e8e6e1` | Terang seperti kantor siang; maskot tetap berwarna, **bubble tetap gelap** (teks putih tetap terbaca). |

Palet mengganti warna background/fog, lantai, dinding, dan intensitas
ambient light. Bubble dialog selalu gelap (`rgba(20,20,19,.94)`) di semua
palet, jadi teks tetap terbaca di `office`.

---

## 4. Kamera (`shots[]`)

Satu shot = satu segmen waktu dengan satu jenis kamera. `focus` = index
karakter fokus (0..jumlah karakter-1, default 0). `from`/`to` = posisi
kamera awal/akhir kustom `[x, y, z]` (bila diisi, mengalahkan posisi
bawaan jenis kamera); `lookAt` = titik yang dilihat `[x, y, z]`
(default = posisi karakter fokus).

| camera | Label | Perilaku |
|--------|-------|----------|
| `glide` | Glide | Meluncur halus (lerp ~1,5 dtk) dari shot sebelumnya — gaya template lama, default. |
| `orbit` | Orbit | Mengorbit perlahan mengelilingi karakter fokus selama shot (±~70°). |
| `dolly` | Dolly-zoom | Kamera maju (z 8,6 → 5,6) sambil FOV menyempit 14° — efek dramatis/tegang. |
| `overhead` | Overhead | Dari atas (y 8,5) melihat meja + semua karakter sekaligus. |
| `closeup` | Close-up wajah | Dekat ke wajah fokus (jarak ~3,1) — untuk reaksi / punchline. |
| `twoshot` | Two-shot | Tengah-tengah karakter fokus dan sebelahnya — untuk debat/dialog berdua. |
| `low` | Low-angle | Rendah (y 0,45) melihat ke atas — karakter terlihat gagah/mengancam. |

FOV dasar mengikuti `fitFov` template trio (menyesuaikan rasio layar 9:16);
`dolly` dan transisi `zoom` memodifikasinya sementara.

### Transisi (`transition`, masuk ke shot)

| id | Label | Perilaku |
|----|-------|----------|
| `cut` | Cut | Pindah langsung tanpa transisi. |
| `fade` | Fade | Gelap sesaat (~0,5 dtk, via uniform `fade` shader cine) lalu terang. Paling aman untuk lompat waktu. |
| `slide` | Slide | Kamera bergeser cepat ke shot baru (lerp ~0,45 dtk). |
| `zoom` | Zoom | FOV membesar sesaat (+16°) lalu kembali normal. |

Default: `glide` untuk kamera `glide`, `cut` untuk lainnya.

---

## 5. Pose (`beats[].pose`)

Pose berlaku per karakter selama beat itu. Default: `talk` untuk beat
`dialogue`, `idle` untuk beat lain. Tanpa beat aktif → `idle` (bernapas
pelan + goyangan kecil).

| pose | Label | Tampilan di renderer |
|------|-------|----------------------|
| `idle` | Diam | Bernapas pelan, gerakan kecil (default). |
| `talk` | Bicara | Lengan bergerak naik-turun mengikuti dialog (otomatis saat beat dialogue). |
| `celebrate` | Celebrate | Melompat + kedua lengan ke atas + tanda seru di atas kepala. Dipakai saat menang / deploy hijau. |
| `panic` | Panic | Gemetar cepat (getar x ~30 Hz) + mata membesar (skala 1,7×) + keringat menetes. Dipakai saat prod down / bom. |
| `thinking` | Thinking | Kepala miring + satu lengan ke dagu. Dipakai saat mikir / bingung. |
| `typing` | Typing cepat | Kedua lengan mengetik cepat bergantian (~18 Hz). Dipakai saat ngebut nulis kode. |
| `sleep` | Tidur | Kepala menunduk + teks `Zzz` melayang di atas kepala. Dipakai saat ketiduran. |
| `point` | Menunjuk | Satu lengan lurus menunjuk ke karakter lain. |
| `win` | Menang | Berdiri tegak + dada membusung (skala badan 1,06) + tanda seru. Dipakai saat skor unggul. |
| `lose` | Kalah | Menunduk lesu (kepala menunduk, badan mengecil 0,96). Dipakai saat kalah / skor jatuh. |

Untuk Codex (yang matanya digambar di CanvasTexture, bukan mesh),
ekspresi wajah ikut pose: `celebrate`/`win` → wajah senang, `panic` →
wajah khawatir, `lose`/`sleep` → wajah datar.

---

## 6. Jenis Beat (`beats[].type`)

| type | Label | Perilaku renderer | Field penting |
|------|-------|-------------------|---------------|
| `dialogue` | Dialog | Bubble bicara di atas kepala karakter (proyeksi 3D → DOM, seperti trio) + voice-over (Web Speech, suara per karakter). | `character`, `text` (wajib) |
| `countdown` | Countdown | Angka besar 3-2-1 di tengah layar, dihitung dari sisa waktu beat (`ceil(end - t)`). | `text` opsional (judul hitungan) |
| `confetti` | Confetti / ledakan | Partikel warna-warni meledak dari karakter (burst berulang tiap 1,2 dtk selama beat). | `text` opsional |
| `typewriter` | Typewriter | Teks mengetik sendiri di monitor karakter (`monitor.lines`, ~22 karakter/dtk). | `monitor.lines` |
| `glitch` | Glitch | Kamera bergetar acak + shader cine menggeser hue/grain sesaat. | `text` opsional (misal `ERROR 500`) |
| `slowmo` | Slow-mo | Gerakan maskot melambat 0,4× selama beat. Dihitung sebagai waktu ter-warp `te(t)` (fungsi murni dari `t`, jadi seek/export frame tetap konsisten); kamera, bubble, dan suara tidak melambat. | — |
| `scoreboard` | Scoreboard update | Papan skor berubah. `monitor.value`: bila **array 3 angka** → skor ketiga karakter; bila **satu angka** → skor karakter beat itu (lainnya tetap). Skor dihitung ulang dari nol tiap frame dari semua beat scoreboard yang sudah lewat, jadi seek mundur konsisten. | `monitor.value` |
| `toast` | Toast notifikasi | Banner kecil di atas layar selama beat. | `text` (misal `Deploy berhasil ✔`) |
| `custom` | Custom (kode) | Kode JS kecil di luar kosakata, jalan di iframe sandbox (lihat §9). | `code` + `fallbackText` (wajib) |

`character` = index karakter yang melakukan beat (default 0).
`props` = daftar prop yang muncul selama beat (lihat §7).
`monitor` = isi monitor karakter itu selama beat (lihat §8).

---

## 7. Props (`beats[].props`)

Prop muncul (visible) hanya selama beat yang menyebutnya, di dekat karakter
beat (x karakter + 0,9; y ~0,35–1,2; z 0,6). Semua mesh dibuat sekali saat
init — tidak ada geometri baru tiap frame.

| id | Label | Bentuk | Animasi |
|----|-------|--------|---------|
| `coffee` | Kopi | Silinder + pegangan torus + uap transparan | Uap berdenyut. |
| `rocket` | Roket | Cone + silinder + api | Meluncur ke atas selama beat. |
| `trophy` | Trofi | Piala emas + pegangan + alas | Diam (piala pemenang). |
| `bug` | Bug / kumbang | Sphere kecil + 6 kaki garis | Merangkak (goyang kiri-kanan). |
| `bomb` | Bom | Sphere hitam + sumbu + percikan | Percikan berkedip. |
| `laptop` | Laptop | Box tipis terbuka + layar menyala | Diam di meja. |
| `phone` | HP | Box kecil + layar menyala | Diam. |
| `paper` | Kertas | Plane putih | Diam melayang. |

---

## 8. Monitor (`beats[].monitor` / `SceneMonitor`)

Satu layar per karakter (CanvasTexture, seperti trio). Bila beat tidak
menyebut monitor, tampil konten default per karakter (lihat §2).
`monitor = { kind, title?, lines?, value? }` — `value` 0–100 untuk
`scoreboard`/`progress`.

| kind | Label | Isi layar | `lines` / `value` |
|------|-------|-----------|-------------------|
| `chat` | Chat | Bubble chat seperti Claude. | `lines` = isi chat (maks 4 tampil). |
| `terminal` | Terminal | Layar hitam + teks monospace hijau, gaya Codex + kursor berkedip. | `lines` = perintah/output (baris `+` hijau, `-` merah). |
| `scoreboard` | Scoreboard | Bar skor semua karakter. | `value` = skor karakter ini (0–100). |
| `diff` | Code diff | Baris kode `-` merah / `+` hijau. | `lines` = baris diff (awali `-` / `+`). |
| `progress` | Progress bar | Angka % besar + bar kemajuan. | `value` = 0–100; `lines` = keterangan (maks 2). |
| `chart` | Chart / grafik | Grafik batang. | `lines` = `"label:angka"` per baris (maks 5). |

Monitor digambar ulang hanya bila kontennya berubah (kunci = kind + lines +
value + waktu ketik + skor), jadi tidak ada redraw tiap frame.

---

## 9. Custom Beat (kode di luar kosakata)

Dipakai **hanya** bila adegan benar-benar tidak bisa dibuat dari kosakata
di atas. Kode custom TIDAK PERNAH dieksekusi di frame utama.

### Cara kerja

1. Renderer membuat hidden iframe `<iframe id="crun" sandbox="allow-scripts">`
   berisi runner kecil (diisi via `srcdoc` dari string di script utama).
   Sandbox tanpa `allow-same-origin`: runner tidak bisa menyentuh DOM
   parent sama sekali — satu-satunya jalur adalah `postMessage`.
2. Saat beat custom aktif, parent mengirim `{type:'run', code, beat}`.
   Runner meng-compile dengan `new Function('api','t','beat', code)` lalu
   membalas `{type:'ack'}`. Bila compile gagal → `{type:'error', message}`.
3. Selama beat aktif, parent mengirim `{type:'tick', t}` tiap ~100 ms.
   Runner memanggil fungsi hasil compile dengan `(api, t, beat)`.
4. API yang diekspos ke kode custom (hanya ini — tidak ada `document`,
   `window`, `fetch`, dsb.):

| API | Arti |
|-----|------|
| `api.pose(character, pose)` | Ubah pose karakter (index 0..2, pose harus ada di daftar §5). |
| `api.prop(id, visible, x?, y?)` | Tampilkan/sembunyikan prop (id harus ada di daftar §7). |
| `api.monitor(slot, kind, lines?, value?)` | Ubah isi monitor karakter (kind harus ada di daftar §8, value 0–100). |
| `api.flash(color)` | Kilat layar warna itu (`#rrggbb`, ~0,6 dtk). |
| `api.toast(text)` | Banner toast (maks 200 karakter, ~2,5 dtk). |

5. Parent **memvalidasi** setiap perintah yang masuk (allowlist nama +
   rentang nilai). Perintah tak valid diabaikan diam-diam. Override
   (pose/prop/monitor) dibersihkan saat beat selesai.

### Validasi server-side (sebelum disimpan)

`validateCustomCode` di `lib/scene-spec.ts`: maks 3000 karakter, parse
sintaks (`new Function` tanpa eksekusi), dan blocklist pola terlarang:
`eval`, `Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
`localStorage`, `sessionStorage`, `document.cookie`, `document.write`,
`document.`, `window.`, `parent.`, `top.`, `self.`, `globalThis`,
`import(`, `require(`, `process.`, `location.`, `navigator.`,
`innerHTML`, `outerHTML`, `setTimeout`, `setInterval`,
`requestAnimationFrame`, `alert`, `prompt`, `confirm`, `__proto__`,
`constructor`, `prototype`.

### Fallback (halaman tidak boleh hitam)

Bila runner mengirim `{type:'error', message}` **atau** tidak ada `ack`
dalam 1 detik setelah beat mulai, beat dinyatakan gagal:
- `fallbackText` ditampilkan sebagai bubble dialog karakter itu
  (sampai beat berakhir),
- toast DOM `Adegan kustom gagal, diganti adegan aman` tampil,
- pesan error ditulis ke elemen tersembunyi `#cbf`
  (`<div id="cbf" style="display:none">`) supaya Studio bisa membacanya
  (misal untuk self-repair loop AI),
- semua pemanggilan runner dibungkus `try/catch`; kegagalan runner tidak
  pernah menghentikan `frame()`.

---

## 10. Contoh JSON SceneSpec (singkat)

```json
{
  "id": "scene-contoh-1",
  "title": "Deploy Jumat Sore",
  "duration": 20,
  "palette": "sunset",
  "characters": [
    { "id": "claude", "x": -2.2 },
    { "id": "codex", "x": 2.2 }
  ],
  "shots": [
    { "start": 0, "end": 8, "camera": "twoshot", "focus": 0, "transition": "cut" },
    { "start": 8, "end": 14, "camera": "closeup", "focus": 1, "transition": "fade" },
    { "start": 14, "end": 20, "camera": "overhead", "focus": 0, "transition": "slide" }
  ],
  "beats": [
    { "start": 1, "end": 5, "type": "dialogue", "character": 0,
      "text": "Jumat sore, deploy terakhir minggu ini!", "pose": "talk" },
    { "start": 5, "end": 8, "type": "dialogue", "character": 1,
      "text": "Tenang, pipeline-ku hijau terus.", "pose": "typing",
      "monitor": { "kind": "terminal", "lines": ["> npm run deploy", "✔ build lulus", "✔ 50/50 tes lulus"] } },
    { "start": 8, "end": 11, "type": "countdown", "character": 0, "text": "Deploy dalam" },
    { "start": 11, "end": 14, "type": "confetti", "character": 1,
      "text": "Hijau!", "pose": "celebrate", "props": ["trophy", "coffee"] },
    { "start": 14, "end": 17, "type": "scoreboard", "character": 0,
      "monitor": { "kind": "scoreboard", "value": 90 } },
    { "start": 17, "end": 20, "type": "toast", "character": 1,
      "text": "Deploy berhasil ✔ Selamat akhir pekan!" }
  ]
}
```

Contoh beat custom:

```json
{ "start": 11, "end": 14, "type": "custom", "character": 1,
  "code": "if (t < beat.start + 1) { api.pose(1, 'celebrate'); api.flash('#7b8cff'); } api.prop('rocket', true);",
  "fallbackText": "Roketnya meluncur! Deploy berhasil!" }
```

---

## 11. Catatan renderer (`dynamic.html`)

- Format file sama seperti `template-trio.html`: `<title>` + CSS + DOM
  `#stage/#title/#wm/#bC/#bD/#bG/#end/#go/#gui`, 13 script tag CDN three.js
  r128 yang **sama persis** (supaya rewrite preview CDN→`/vendor/` jalan),
  script utama + script player (salinan trio: `window.renderAt`,
  `window.gTap/gSync/gShow`, kontrol galeri).
- `window.renderAt(t)` wajib ada — Studio memakainya untuk seek timeline
  dan export MP4 frame demi frame.
- Credit `@hanzvibes` wajib: `#wm` + `by @hanzvibes` di `#end`.
- Performa: semua geometri/prop/partikel dibuat sekali di init; monitor
  di-redraw hanya saat kuncinya berubah; slow-mo memakai waktu ter-warp
  murni-dari-`t` agar seek konsisten.
- Overlay DOM tambahan: `#count` (countdown), `#toast`, `#zzz` (tidur),
  `#flash` (kilat custom), `#cbf` (pesan error custom beat, tersembunyi).
