# Ringkasan SKILL.md — threejs-cinematic-short v3.8

Sumber lengkap: `~/workspace/claudeku-short-gallery/threejs-cinematic-short/SKILL.md`
(220 baris). File ini hanya ringkasan yang dipakai Studio untuk menyusun
system prompt AI — bukan pengganti SKILL.md.

## Produk
Satu file `.html` = satu film pendek 3D sinematik 9:16 (TikTok/Reels), dirender
live dengan three.js. Jangan tulis dari nol: salin template, lalu ganti karakter,
props, caption, dan palet.

## 9 template (di `public/templates/`)
| Template | Durasi | Karakter | Cerita |
|---|---|---|---|
| template.html (versus) | 28 dtk | 2 | Claude vs Codex debat siapa paling jago |
| template-trio.html | 32 dtk | 3 | Claude vs Codex vs Gemini, skor seri |
| template-rival.html | 34 dtk | 2 | Musuhan satu meja, sticky notes, prod down |
| template-typing.html | 26 dtk | 1 | Claude × Remotion, ngetik motion graphics |
| template-deploy.html | 29 dtk | 1 | Deploy Jumat sore, pipeline merah lalu hijau |
| template-bughunter.html | 33 dtk | 1 | Bug Hunter 02.00, git blame diri sendiri |
| template-bomb.html | 33 dtk | 1 | Misi Mustahil: Merge Conflict, bom 30 detik |
| template-meeting.html | 33 dtk | 1 | Rapat 5 Menit yang jadi hampir 4 jam |
| template-sleep.html | 36 dtk | 1 | Ketiduran di keyboard, dibangunkan bos |

## Arsitektur (yang dipakai Studio)
- Semua gerak adalah fungsi murni dari waktu: `frame(t)` mengatur pose, cahaya,
  layar, bubble, dan kamera untuk detik `t`. `window.renderAt(t)` men-pause dan
  me-render frame `t` — ini yang dipakai timeline Studio untuk seek.
- `LEN` = durasi detik. `caps=[[start,end,'teks',speaker],...]` — ada template
  yang caps-nya 3 elemen (tanpa speaker: typing, deploy).
- `VO[]` sejajar `caps[]`; ada template yang VO-nya turunan `caps.map(c=>c[2])`
  (versus, trio, deploy) dan ada yang eksplisit.
- Post-processing: Bokeh (DOF), Bloom, Afterimage (motion blur), FXAA, grade
  sinematik. Kamera meluncur antar shot (`shots`), tanpa hard cut.
- Player ala galeri HP di dalam template (`#go` start, `#gui` kontrol,
  `#gcc` play/pause, `#tc` jam berjalan) — Studio mengklik tombol-tombol ini
  lewat DOM iframe untuk Play/Pause.

## Aturan dialog & kualitas
- Alur: klaim → sanggahan → eskalasi → capek → twist (skor seri) → ajakan
  kerja bareng / pertanyaan ke penonton.
- Suara tiap pembicara: Claude tenang/sombong soal kode rapi; Codex blak-blakan,
  terminal dulu; Gemini pamer skala (konteks sejuta token).
- Maksimal 2,5 kata/detik per caption (Studio memvalidasi maks 2,6).
- Credit `@hanzvibes` WAJIB di semua video: watermark `#wm` + `by @hanzvibes`
  di end card — jangan pernah dihapus.
- Verifikasi: `python3 scripts/lint_short.py out.html` (credit, host script yang
  diizinkan, syntax via `node --check`, jebakan flicker, kecepatan caption).
