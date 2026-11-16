// System prompt + user prompt untuk AI penulis template HTML (jalur
// "Skill penuh"). AI menulis SATU FILE HTML LENGKAP mengikuti skill
// threejs-cinematic-short v3.8 — BEBAS dari kosakata SceneSpec: adegan,
// kamera, pose, efek, props, dan isi monitor apa pun boleh, selama
// mengikuti pola template trio di bawah.
//
// Sumber: ~/workspace/claudeku-short-gallery/threejs-cinematic-short/
// SKILL.md (220 baris) + public/templates/template-trio.html (template
// paling up-to-date). Ringkasan di docs/SKILL-RINGKAS.md. JANGAN andalkan
// ingatan model tentang skill ini — semua aturan inti ada di prompt ini.
//
// Output: HTML MENTAH (bukan JSON) — HTML 30-75 KB di dalam JSON rawan
// rusak karena escaping. Ekstraksi di lib ini: buang fence markdown,
// potong dari <!DOCTYPE html> sampai </html> terakhir.
import type { SkillVideo } from "./skill-validate";

/**
 * Ambil SATU file HTML lengkap dari jawaban AI. AI diminta mengembalikan
 * HANYA HTML, tapi jawaban nyata sering dibungkus ```html / teks lain.
 * Kembalikan null bila tidak ada dokumen HTML lengkap (dipakai pemicu
 * self-repair, bukan throw).
 */
export function extractSkillHtml(raw: string): string | null {
  let text = raw.replace(/```(?:html)?\s*/gi, "```").replace(/```/g, "").trim();
  const start = text.search(/<!DOCTYPE html>/i);
  const htmlStart = text.search(/<html[\s>]/i);
  const begin = start >= 0 ? start : htmlStart;
  if (begin < 0) return null;
  text = text.slice(begin);
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (end < 0) return null;
  return text.slice(0, end + "</html>".length).trim();
}

const SKILL_CORE = `Kamu menulis SATU FILE HTML lengkap: film pendek 3D sinematik 9:16
(TikTok/Reels) berbahasa Indonesia, dirender live dengan three.js r128.
JANGAN tulis dari nol: SALIN pola template trio di bawah, lalu ganti
karakter, props, caption, dan palet sesuai ide pengguna.

ATURAN ARSITEKTUR (wajib — ini yang membuat video jalan di Studio):
- Semua gerak adalah fungsi murni dari waktu: frame(t) mengatur pose,
  cahaya, layar, bubble, dan kamera untuk detik t. TIDAK ADA state
  tersembunyi. window.renderAt(t) men-pause dan me-render frame t.
- LEN = durasi detik (24-36). caps=[[start,end,'teks',speaker],...]
  (speaker = index pembicara). VO[] sejajar caps[] (teks voice-over,
  ejaan nama untuk suara: "Klod" untuk Claude). NARR=[[t,teks,detik],...]
  untuk narator. VP=[[pitch,rate],...] per speaker.
- shots=[[t0,[camPos],[lookAt]],...] — kamera MELUNCUR antar shot dengan
  sm(cl((t-t0)/1.4,0,1)) (posisi + look-at). JANGAN hard cut, JANGAN
  per-frame lerp(.07) (frame-rate dependent, patah-patah). Satu global
  drift: C.position.z -= Math.sin(t*.35)*.08. Jangan push-in per shot
  yang reset tiap ganti shot.
- Post-processing (jsDelivr three@0.128.0): EffectComposer dengan
  WebGLMultisampleRenderTarget, RenderPass, BokehPass (focus mengikuti
  jarak kamera-target), UnrealBloomPass (tipis, ~.14), AfterimagePass
  (damp konstan ~.38), FXAA (resolution 1/(w*pr)), grade ShaderPass
  (chromatic aberration, vignette, grain ~.012, fade).
- layout(): stage 9:16 letterbox, --u = lebar stage / 100, SEMUA ukuran
  DOM pakai calc(var(--u)*...). Portrait FOV: horizontal ~52 derajat,
  vertical diturunkan (fitFov). Lebar terlihat di jarak d ~ 0.975*d.
- Player ala galeri HP di dalam template: #go (start overlay, tombol
  #gob), #gui (kontrol: #gtop, #gcc play/pause, #gbot seek #gtr, #snd
  mute, #grw/#gff ±5 dtk, #pl replay), #tc jam berjalan, #wm watermark,
  #end end card. JANGAN kembalikan #bar lama (tombol teks fixed).
- Maskot = group primitif three.js. Claude: badan oranye lebar #d97757,
  dua mata celah hitam tinggi, lengan kecil, 4 kaki pendek. Codex: kepala
  awan lembut (ExtrudeGeometry rounded-rect + cincin 10 sphere), layar
  navy #1c2354 dengan ">_" cyan, badan mungil biru #3c64e1. Gemini:
  badan bintang 4 sudut #b794f6 (ExtrudeGeometry star), mata celah gelap.
- Monitor/layar/scoreboard = CanvasTexture. Redraw hanya bila cache key
  berubah (quantize waktu, misal Math.floor(t*30)). Layar dim
  (color.setScalar(.88)), vignette radial di canvas, kaca + scanline
  di depan, halo accent di belakang, LED di bawah, PointLight redup.
- Speech bubble: SATU DOM .bub per pembicara. Tiap frame proyeksikan
  posisi kepala (v.set(x,y,0).project(C) sesudah C.updateMatrixWorld()),
  konversi ke px stage, letakkan bubble di atas kepala, clamp di dalam
  stage, ekor menunjuk kepala (--tx). transition:none (CSS transition
  membuat bubble tertinggal dari kepala). Update textContent hanya bila
  berubah (dataset.k). Bubble gelap rgba(20,20,19,.94), teks cream,
  border 1px accent pembicara.
- Suara tiap pembicara: Claude tenang dan sedikit sombong soal kode rapi;
  Codex blak-blakan, terminal dulu; Gemini pamer skala (konteks sejuta
  token). Lucu dan playful, jangan menghina produk atau orang sungguhan.
- Alur dialog: klaim -> sanggahan -> eskalasi -> capek -> twist (skor
  seri) -> ajakan kerja bareng / pertanyaan ke penonton. Jawab baris
  sebelumnya (callback), bukan tiga boast yang tidak nyambung.
- MAKSIMAL 2,5 kata per detik per caption (jendela 3,2 dtk = maks 8 kata).
  Satu ide per baris, kata akhir yang kuat.
- JANGAN ada yang toggle di batas frame: semua muncul/hilang pakai
  envelope scale/opacity (pop(a,b)) yang mencapai 0 sebelum fase berakhir;
  .visible hanya bila envelope < .02. Jangan dua mesh coplanar. Shadow
  mapSize 1024, bias -.0004, normalBias .02.
- Timeline HARUS loop bersih; reset kamera ke shot 0 saat restart.
  Frame subjek utuh di setiap shot; jangan potong anggota badan.
- Tipografi: Plus Jakarta Sans (Google Fonts) + fallback system-ui.
  Judul ~9u, end card ~7u, bubble ~4.4u. Cek string terpanjang muat 100u.
- Credit @hanzvibes WAJIB di dua tempat, tanpa kecuali: watermark #wm
  (pojok kanan atas, "@hanzvibes") + "by @hanzvibes" di end card #end.
  Jangan pernah menghapusnya.
- Judul layar (#title) harus AUTO-FIT: kecilkan font sampai teks muat
  maksimal 2 baris dalam 92% lebar stage dan blok judul tidak menutupi
  papan skor (judul panjang JANGAN dibiarkan raksasa menutupi layar).

BATASAN PUBLISHING (jawaban yang melanggar DITOLAK lint):
- Script HANYA dari: cdnjs.cloudflare.com, cdn.jsdelivr.net/npm/,
  cdn.tailwindcss.com, code.jquery.com. three.js WAJIB r128 / 0.128.0.
- Stylesheet HANYA dari fonts.googleapis.com / fonts.gstatic.com.
- DILARANG: fetch, XMLHttpRequest, WebSocket, localStorage,
  sessionStorage, document.cookie, eval, new Function, <form>,
  <iframe>, window.open, api.anthropic.com, remote image.
- Meta viewport WAJIB: width=device-width, initial-scale=1,
  viewport-fit=cover. Satu file, tanpa download link.

ATURAN TEKS:
- Bahasa Indonesia. JUDUL HANYA huruf Latin Indonesia (a-z, angka,
  spasi, tanda baca biasa) — JANGAN PERNAH karakter Mandarin/Jepang/
  Korea di judul maupun teks mana pun.`;

const TRIO_PATTERN = `POLA TEMPLATE TRIO (salin struktur ini, ganti isi ceritanya):

<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Judul Video</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
<style>
:root{box-sizing:border-box;--bg:#141413;--fg:#fff}
html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;overflow:hidden}
#stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);overflow:hidden;background:#000;--u:4px}canvas{display:block;width:100%;height:100%}
#title{position:absolute;left:0;right:0;top:4%;padding:0 4%;box-sizing:border-box;text-align:center;font-family:"Plus Jakarta Sans",sans-serif;color:#faf9f5;font-weight:800;line-height:1.15;font-size:calc(var(--u)*9);text-shadow:0 4px 24px #000a;transition:opacity .6s;pointer-events:none}
#title small{display:block;color:#d97757;font-size:.28em;font-weight:500;margin-top:6px}
.bub{position:absolute;left:0;top:0;max-width:56%;box-sizing:border-box;padding:calc(var(--u)*2.2) calc(var(--u)*3.4);border-radius:calc(var(--u)*4);background:rgba(20,20,19,.94);color:#faf9f5;border:max(1px,calc(var(--u)*.2)) solid var(--ac,#faf9f5);font-family:"Plus Jakarta Sans",sans-serif;font-weight:700;font-size:calc(var(--u)*4.4);line-height:1.25;text-align:center;opacity:0;transition:none;pointer-events:none}
.bub::after{content:'';position:absolute;left:var(--tx,50%);bottom:calc(var(--u)*-1.2);width:calc(var(--u)*2);height:calc(var(--u)*2);background:rgba(20,20,19,.94);border:max(1px,calc(var(--u)*.2)) solid var(--ac,#faf9f5);border-top:0;border-left:0;transform:translateX(-50%) rotate(45deg)}
#wm{position:absolute;top:calc(var(--u)*3);right:calc(var(--u)*3);font-weight:700;font-size:calc(var(--u)*3.2);color:#faf9f5;opacity:.75;pointer-events:none}
#go{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0007}
#gui{position:absolute;inset:0;z-index:6;pointer-events:none;opacity:0;transition:opacity .25s;color:#fff}
#gui.on{opacity:1}
#end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1f1e1d;opacity:0;transition:opacity .8s;pointer-events:none;font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;font-size:calc(var(--u)*7);text-align:center}
#end small{font-weight:700;color:#d97757;font-size:calc(var(--u)*4);margin-top:calc(var(--u)*3)}
</style>
</head>
<body>
<div id="stage">
<div id="go"><button id="gob" aria-label="Putar">▶</button><small id="gos">Voice over bahasa Indonesia</small><span id="gdur"><i id="gdt">0:00</i></span></div>
<div id="title">Judul Video<small>subjudul</small></div>
<div id="wm">@hanzvibes</div><div class="bub" id="bC"></div><div class="bub" id="bD"></div><div class="bub" id="bG"></div>
<div id="gui"><div id="gtop"><button id="gbk" aria-label="Kembali">←</button><div id="gtt"><b id="gt1">Video</b><span id="gt2"></span></div></div><button id="gcc" aria-label="Putar atau jeda"></button><div id="gbot"><div id="gsk"><span id="gtc">0:00</span><div id="gtr"><div id="gfl"></div><div id="gkn"></div></div><span id="gtd">0:00</span></div><div id="gro"><button id="snd" aria-label="Suara"></button><div id="gmid"><button id="grw" aria-label="Mundur 5 detik"></button><button id="gff" aria-label="Maju 5 detik"></button></div><button id="pl" aria-label="Ulang"></button></div></div></div>
<div id="end">Pertanyaan penutup?<small>by @hanzvibes</small></div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/BokehShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/AfterimageShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/MaskPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/BokehPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/AfterimagePass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/FXAAShader.js"></script>
<script>
let SW=360,SH=640;
const R=new THREE.WebGLRenderer({antialias:true});
const stage=document.getElementById('stage');R.setPixelRatio(Math.min(devicePixelRatio,1.5));
R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
stage.prepend(R.domElement);
const S=new THREE.Scene();S.background=new THREE.Color(0x1a1917);
const C=new THREE.PerspectiveCamera(42,SW/SH,.1,80);
const fitFov=()=>{const a=SW/SH;C.fov=a<1?2*Math.atan(Math.tan(.5*52*Math.PI/180)/a)*180/Math.PI:46;C.aspect=a;C.updateProjectionMatrix()};
const M=(c,r=.6)=>new THREE.MeshStandardMaterial({color:c,roughness:r});
const box=(w,h,d,m,p=[0,0,0],par)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(...p);o.castShadow=o.receiveShadow=true;(par||S).add(o);return o};
// ... scene: lampu, lantai, dinding, papan skor (canvas), monitor mkMon(x,drawFn,accent), maskot (group), partikel ...
// ... post: EffectComposer(R, WebGLMultisampleRenderTarget), BokehPass, UnrealBloomPass, AfterimagePass, FXAA, grade ShaderPass ...
function layout(){const h=Math.min(innerHeight,innerWidth*16/9),w=h*9/16;SW=Math.round(w);SH=Math.round(h);stage.style.width=SW+'px';stage.style.height=SH+'px';stage.style.setProperty('--u',SW/100+'px');R.setSize(SW,SH);comp.setPixelRatio(R.getPixelRatio());comp.setSize(SW,SH);fitFov()}
const shots=[[0,[0,2.3,8.4],[0,1,0]],[3,[-2,1.4,5.4],[-1.9,.9,0]]];
const LEN=32,caps=[[3,6.2,'Teks caption',0],[6.2,9.4,'Balasan',1]];
let T=0,paused=false,last=performance.now(),FDT=1/60;
const cl=(v,a,b)=>Math.min(b,Math.max(a,v)),sm=x=>x*x*(3-2*x);
const B=[document.getElementById('bC'),document.getElementById('bD')],ttl=document.getElementById('title'),end=document.getElementById('end');
function frame(t){
 const s2=(a,b)=>sm(cl((t-a)/(b-a),0,1)),pop=(a,b)=>s2(a,a+.3)*(1-s2(b-.3,b));
 const sp=[0,0];caps.forEach(c=>{sp[c[3]]=Math.max(sp[c[3]],pop(c[0],c[1]))});
 // ... pose maskot dari sp + faktor (ar arguing, tr tired, jy joy), monitor draw(t), papan skor, partikel, kamera glide shots, bubble project ...
 ttl.style.opacity=1-s2(2.4,3);end.style.opacity=t>=LEN-2.5?1:0;
}
const VO=caps.map(c=>c[2]),NARR=[[.6,'Narasi pembuka?',2.3]],VP=[[1.25,1.05],[.7,1.1],[1,1]];
const syn=window.speechSynthesis;let vOn=false,vMute=false,vLast=-1,vV=[];
function say(x,k){if(!syn||vMute)return;syn.cancel();const u=new SpeechSynthesisUtterance(x),p=VP[k]||VP[0];u.lang='id-ID';if(vV.length)u.voice=vV[k%vV.length];u.pitch=p[0];u.rate=p[1];syn.speak(u)}
function vo(t){if(!vOn)return;let k=-1;for(let j=0;j<VW.length;j++)if(t>=VW[j][0]&&t<VW[j][1])k=j;if(k!==vLast){vLast=k;if(k>=0)say(VW[k][2],VW[k][3])}}
function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;FDT=dt||1/60;if(!paused){T+=dt;if(T>=LEN){T=0;vLast=-1;syn&&syn.cancel()}}frame(T);vo(T);comp.render(dt);requestAnimationFrame(loop)}
addEventListener('resize',layout);
R.domElement.addEventListener('click',()=>{window.gTap&&window.gTap()});
document.getElementById('gob').onclick=e=>{e.stopPropagation();vOn=true;vLast=-1;T=0;paused=false;document.getElementById('go').style.display='none'};
window.renderAt=t=>{paused=true;T=t;FDT=1/60;frame(t);comp.render(1/60)};
layout();requestAnimationFrame(loop);
</script>
<script>
/* gallery-style player controls (UI only; timeline dan voice over tetap di script utama) */
(function(){ /* #gui: show/hide 3 dtk, seek #gtr, #gcc play/pause, #snd mute, #grw/#gff ±5 dtk, #pl replay, #gbk kembali ke #go */ })();
</script>
</body>
</html>`;

const OUTPUT_FORMAT = `FORMAT JAWABAN (wajib):
- Kembalikan HANYA SATU FILE HTML LENGKAP, dari <!DOCTYPE html> sampai
  </html>. TANPA teks lain, TANPA markdown, TANPA fence \`\`\` — langsung
  HTML mentah. Jawabanmu akan dipotong dari <!DOCTYPE html> sampai
  </html> terakhir; apa pun di luar itu dibuang.
- HTML harus LENGKAP dan JALAN SENDIRI: semua 13 script three.js r128
  (seperti pola di atas), semua id yang dipakai script HARUS ada di DOM
  (#stage, #title, #wm, #go, #gob, #gui, #gcc, #snd, #grw, #gff, #pl,
  #gbk, #gtc, #gtd, #gtr, #gfl, #gkn, #end, .bub per pembicara).
- Judul di <title> HARUS sama dengan teks judul layar di #title.`;

export function buildSkillSystemPrompt(current?: SkillVideo | null): string {
  const mode = current
    ? `MODE REVISI — pengguna sudah punya template video dan meminta perubahan.
HTML SAAT INI (lengkap, ini konteks yang harus kamu pertahankan):
${current.html}
Instruksi revisi:
- PERTAHANKAN semua yang TIDAK diminta diubah: cerita, dialog, timing,
  shot, pose, props, palet, struktur file.
- Hanya ubah yang diminta pengguna. Kamu boleh mengubah title bila diminta /
  bila revisi mengubah cerita (title di <title> DAN di #title harus sama).
- Kembalikan SELALU HTML LENGKAP (seluruh file, bukan hanya yang berubah).
- Bila revisi meminta adegan yang butuh kode baru, tulis kodenya mengikuti
  pola di atas — jangan sisipkan pola terlarang (fetch, eval, localStorage).`
    : `MODE BUAT BARU — buat template video baru dari nol dari ide pengguna:
tulis SATU FILE HTML lengkap mengikuti pola trio di atas, dengan cerita,
adegan, kamera, pose, dan monitor yang BARU (bukan salinan trio).`;
  return `${SKILL_CORE}\n\n${TRIO_PATTERN}\n\n${mode}\n\n${OUTPUT_FORMAT}`;
}

export function buildSkillUserPrompt(prompt: string, current?: SkillVideo | null): string {
  if (current) {
    return `Revisi template video ini sesuai instruksi berikut. Ingat: kembalikan HTML LENGKAP yang sudah diperbarui, bukan patch.\n\nInstruksi: ${prompt}`;
  }
  return `Buatkan template video baru dari ide berikut:\n\n${prompt}`;
}
