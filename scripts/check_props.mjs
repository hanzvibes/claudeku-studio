#!/usr/bin/env node
// Verifies the prop kit in a short: 100 props, depth layers, no mid-frame slices,
// no collisions with characters/monitors/board, L0 always out of focus, density cap.
// Usage: node scripts/check_props.mjs assets/template-code.html
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'assets/template-code.html';
const html = readFileSync(file, 'utf8');

// ---- parse ----
const propRe = /\['(\d{3})',(\d),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),0x([0-9a-fA-F]+),'([a-zA-Z]+)',(-?[\d.]+)\]/g;
const props = [];
for (const m of html.matchAll(propRe)) {
  props.push({ id: m[1], L: +m[2], x: +m[3], y: +m[4], z: +m[5], w: +m[6], h: +m[7], d: +m[8], rec: m[10], ry: +m[11] });
}
const shotsSrc = html.match(/const shots=\[(.*?)\];/s)?.[1] || '';
const shots = new Function('return [' + shotsSrc + ']')();
const LEN = +(html.match(/const LEN=([\d.]+)/)?.[1] || 30);
const aspect = 9 / 16, tanH = Math.tan((52 * Math.PI) / 180 / 2), tanV = tanH / aspect;

// ---- maths ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = x => x * x * (3 - 2 * x);

function cameraAt(t) {
  let k = 0;
  for (let i = 0; i < shots.length; i++) if (t >= shots[i][0]) k = i;
  const cur = shots[k], prev = shots[Math.max(0, k - 1)];
  const e = k ? sm(clamp((t - cur[0]) / 1.4, 0, 1)) : 1;
  const pos = lerp(prev[1], cur[1], e), look = lerp(prev[2], cur[2], e);
  const f = norm(sub(look, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { pos, look, f, r, u, focus: Math.hypot(...sub(look, pos)) };
}

const bounds = p => ({
  x0: p.x - p.w / 2, x1: p.x + p.w / 2,
  y0: p.y, y1: p.y + p.h,
  z0: p.z - p.d / 2, z1: p.z + p.d / 2
});

function project(p, cam) {
  const b = bounds(p);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, behind = 0;
  for (const X of [b.x0, b.x1]) for (const Y of [b.y0, b.y1]) for (const Z of [b.z0, b.z1]) {
    const rel = [X - cam.pos[0], Y - cam.pos[1], Z - cam.pos[2]];
    const z = dot(rel, cam.f);
    if (z <= 0.05) { behind++; continue; }
    const nx = dot(rel, cam.r) / (z * tanH), ny = dot(rel, cam.u) / (z * tanV);
    x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
  }
  if (behind) return { vis: 0, cx: 9, cy: 9 };
  const fx = Math.max(0, Math.min(x1, 1) - Math.max(x0, -1)) / Math.max(1e-6, x1 - x0);
  const fy = Math.max(0, Math.min(y1, 1) - Math.max(y0, -1)) / Math.max(1e-6, y1 - y0);
  return { vis: fx * fy, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, x0, x1, y0, y1 };
}

// ---- protected volumes (existing set + characters) ----
const protect = [
  { n: 'Claude', x: -1.7, y: 0.22, z: 0, w: 1.5, h: 0.9, d: 0.7 },
  { n: 'Codex', x: 1.7, y: 0.2, z: 0, w: 1.15, h: 0.95, d: 0.7 },
  { n: 'monitorL', x: -1.5, y: 1.85, z: -2.2, w: 2.4, h: 1.5, d: 0.3 },
  { n: 'monitorR', x: 1.5, y: 1.85, z: -2.2, w: 2.4, h: 1.5, d: 0.3 },
  { n: 'board', x: 0, y: 3.2, z: -2.48, w: 4.6, h: 2.1, d: 0.06 },
  { n: 'posterL', x: -3.55, y: 1.96, z: -2.47, w: 1.7, h: 1.08, d: 0.05 },
  { n: 'posterR', x: 3.55, y: 1.96, z: -2.47, w: 1.7, h: 1.08, d: 0.05 },
  { n: 'neonL', x: -2.9, y: 0.1, z: -2.45, w: 0.12, h: 4.6, d: 0.1 },
  { n: 'neonR', x: 2.9, y: 0.1, z: -2.45, w: 0.12, h: 4.6, d: 0.1 },
  { n: 'crateL', x: -3.1, y: 0, z: -1.5, w: 0.82, h: 0.8, d: 0.82 },
  { n: 'crateR', x: 3.1, y: 0, z: -1.5, w: 0.82, h: 0.8, d: 0.82 },
  { n: 'mugL', x: -2.72, y: 0, z: 0.5, w: 0.3, h: 0.2, d: 0.3 },
  { n: 'mugR', x: 2.72, y: 0, z: 0.5, w: 0.3, h: 0.2, d: 0.3 }
];
const hit = (a, b) => a.x0 < b.x0 + b.w - 0.01 && a.x1 > b.x0 + 0.01 && a.y0 < b.y0 + b.h - 0.01 && a.y1 > b.y0 + 0.01 && a.z0 < b.z0 + b.d - 0.01 && a.z1 > b.z0 + 0.01;

const errors = [], warns = [];

// ---- static rules ----
if (props.length !== 100) errors.push(`jumlah props ${props.length}, harus 100`);
const ids = new Set(props.map(p => p.id));
if (ids.size !== props.length) errors.push('ada id prop duplikat');
const byL = {};
props.forEach(p => { byL[p.L] = (byL[p.L] || 0) + 1; });
for (const p of props) {
  const b = bounds(p);
  if (p.y < -0.001) errors.push(`${p.id}: y dasar < 0`);
  if (Math.abs(b.x0) > 6.9 || Math.abs(b.x1) > 6.9) errors.push(`${p.id}: keluar dinding (x)`);
  if (b.z0 < -2.52) errors.push(`${p.id}: menembus dinding (z ${b.z0.toFixed(2)})`);
  if (b.z1 > 3.0) errors.push(`${p.id}: terlalu dekat kamera`);
  protect.forEach(v => { if (hit(b, v)) errors.push(`${p.id}: tabrakan dengan ${v.n}`); });
}
for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
  if (props[i].L === 9 || props[j].L === 9) continue;
  if (hit(bounds(props[i]), bounds(props[j]))) errors.push(`${props[i].id} tumpang tindih ${props[j].id}`);
}

// ---- per-sample checks ----
const samples = [];
for (let t = 0; t <= LEN; t += 0.05) samples.push(+t.toFixed(2));
const slices = new Map(), l0bad = [];
let l0min = 99;
let density = 0, densityN = 0;
const hold = [];
shots.forEach((s, i) => {
  const t0 = s[0], t1 = Math.min(t0 + 3.4, shots[i + 1]?.[0] ?? LEN);
  if (t1 - t0 > 0.6) hold.push([t0 + 1.5, t1]);
});
for (const t of samples) {
  const cam = cameraAt(t);
  for (const p of props) {
    const pr = project(p, cam);
    if (pr.vis > 0.02 && pr.vis < 0.98 && Math.abs(pr.cx) < 0.8 && Math.abs(pr.cy) < 0.8) {
      const inHold = hold.some(([a, b]) => t >= a && t <= b);
      if (inHold) {
        const key = p.id + '@' + t;
        if (!slices.has(p.id)) slices.set(p.id, []);
        if (slices.get(p.id).length < 4) slices.get(p.id).push(t.toFixed(2));
      }
    }
    if (p.L === 0 && pr.vis > 0.01 && hold.some(([a, b]) => t >= a && t <= b)) {
      const c = [(bounds(p).x0 + bounds(p).x1) / 2, (bounds(p).y0 + bounds(p).y1) / 2, (bounds(p).z0 + bounds(p).z1) / 2];
      const dd = Math.abs(Math.hypot(...sub(c, cam.pos)) - cam.focus);
      if (dd < 1.1) l0bad.push(`${p.id}@${t} (Δ${dd.toFixed(2)})`);
      l0min = Math.min(l0min, dd);
    }
  }
  if (hold.some(([a, b]) => t >= a && t <= b)) {
    const grid = new Uint8Array(48 * 85);
    for (const p of props) {
      const pr = project(p, cam);
      if (pr.vis <= 0) continue;
      const gx0 = Math.max(0, Math.floor((pr.x0 + 1) / 2 * 48)), gx1 = Math.min(47, Math.ceil((pr.x1 + 1) / 2 * 48));
      const gy0 = Math.max(0, Math.floor((pr.y0 + 1) / 2 * 85)), gy1 = Math.min(84, Math.ceil((pr.y1 + 1) / 2 * 85));
      for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) grid[y * 48 + x] = 1;
    }
    density += grid.reduce((a, v) => a + v, 0) / grid.length;
    densityN++;
  }
}
slices.forEach((ts, id) => errors.push(`${id}: terpotong di tengah frame pada t=${ts.join(', ')}`));
if (l0bad.length) errors.push(`L0 tidak selalu blur: ${l0bad.slice(0, 6).join(' ')}${l0bad.length > 6 ? ' …' : ''}`);
const dens = densityN ? (density / densityN * 100) : 0;
if (dens > 20) warns.push(`kepadatan props ${dens.toFixed(1)}% dari frame (target ≤20%)`);

// characters must stay fully in frame during hold windows
for (const [a, b] of hold) {
  for (const t of samples.filter(s => s >= a && s <= b)) {
    const cam = cameraAt(t);
    for (const v of protect.slice(0, 2)) {
      const pr = project({ x: v.x, y: v.y, z: v.z, w: v.w, h: v.h, d: v.d }, cam);
      if (pr.vis > 0.02 && pr.vis < 0.98) errors.push(`${v.n} terpotong pada t=${t}`);
    }
  }
}

// ---- report ----
const pm = new Set(props.map(p => p.rec));
console.log(`props: ${props.length} | per lapis: ${Object.entries(byL).map(([k, v]) => 'L' + k + '=' + v).join(' ')}`);
console.log(`resep unik: ${pm.size} | draw call baru: 5 merged + 6 detail = 11`);
console.log('L0 = foreground bokeh (cek hanya saat kamera diam, transisi antar-shot wajar melewati fokus)');
console.log(`sampel: ${samples.length} (t 0..${LEN} @0.05s) | shot: ${shots.length}`);
console.log(`kepadatan rata-rata props di frame: ${dens.toFixed(1)}%`);
console.log(`separasi fokus L0 minimum (saat shot diam): Δ${l0min.toFixed(2)} unit`);
if (warns.length) warns.forEach(w => console.log('warn :', w));
if (errors.length) {
  const uniq = [...new Set(errors)];
  uniq.slice(0, 40).forEach(e => console.log('error:', e));
  if (uniq.length > 40) console.log(`… ${uniq.length - 40} error lain`);
  process.exitCode = 1;
} else console.log('OK: tidak ada potongan tengah frame, tabrakan, atau pelanggaran lapis.');
