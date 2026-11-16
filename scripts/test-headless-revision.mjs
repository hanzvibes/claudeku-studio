// Tes headless (chrome-headless-shell + CDP) untuk alur revisi di UI nyata:
//   node scripts/test-headless-revision.mjs
// - Seed localStorage dengan 1 entri scene + 1 spec + 1 template (trio).
// - Buka tiap entri -> klik "Coba revisi contoh" -> jumlah entri TETAP,
//   entri yang SAMA yang berubah (judul + "— Revisi").
// - Tab "Revisi video ini" nonaktif bila tidak ada entri aktif.
// - Template skill ter-render di preview (THREE ter-load, canvas ada,
//   renderAt(5) jalan) + screenshot disimpan untuk cek visual.
// TIDAK memakai provider live / API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = "/tmp/claudeku-headless-test";
const DEV_PORT = 3125;
const CDP_PORT = 9223;
const CHROME = "/home/hatch/workspace/claude-vs-codex-video/chrome-headless-shell-linux64/chrome-headless-shell";
const SCREENSHOT = "/home/hatch/workspace/claudeku-skill-headless.png";
const TRIO = fs.readFileSync(path.join(ROOT, "public/templates/template-trio.html"), "utf-8");

// ---------- Kompilasi canned fixtures ----------
async function compileFixtures() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  await execFileAsync(
    "npx",
    ["tsc", "lib/canned.ts", "lib/canned-scene.ts", "--outDir", TMP, "--module", "commonjs", "--target", "es2020", "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop"],
    { cwd: ROOT },
  );
}

// ---------- Dev server ----------
async function startDevServer(port) {
  try {
    await execFileAsync("pkill", ["-f", `next dev -p ${port}`]);
    await new Promise((r) => setTimeout(r, 1000));
  } catch {
    /* tidak ada server lama */
  }
  const logFile = fs.openSync(`/tmp/next-dev-test-${port}.log`, "w");
  const child = spawn("npx", ["next", "dev", "-p", String(port)], { cwd: ROOT, stdio: ["ignore", logFile, logFile], detached: true });
  const killAll = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* sudah mati */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* sudah mati */
    }
  };
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 180000;
  for (;;) {
    try {
      const res = await fetch(base + "/api/skill-example", { signal: AbortSignal.timeout(30000) });
      if (res.ok) return { base, killAll };
    } catch {
      /* belum siap */
    }
    if (Date.now() > deadline) {
      killAll();
      throw new Error("dev server tidak siap dalam 180 dtk");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------- CDP ----------
async function launchChrome() {
  try {
    await execFileAsync("pkill", ["-f", "remote-debugging-port=9223"]);
    await new Promise((r) => setTimeout(r, 1000));
  } catch {
    /* tidak ada chrome lama */
  }
  const child = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "about:blank",
  ], { stdio: "ignore", detached: true });
  const killAll = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* sudah mati */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* sudah mati */
    }
  };
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (res.ok) return { killAll };
    } catch {
      /* belum siap */
    }
    if (Date.now() > deadline) {
      killAll();
      throw new Error("chrome-headless-shell tidak siap dalam 30 dtk");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function connectPage() {
  const list = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  assert.ok(page, "harus ada target page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`evaluate gagal: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
  return r.result?.value;
}

async function waitFor(send, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await evaluate(send, expression);
      if (v) return v;
    } catch {
      /* coba lagi */
    }
    if (Date.now() > deadline) throw new Error(`timeout menunggu: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function readMine(send) {
  return evaluate(send, `JSON.parse(localStorage.getItem('claudeku.mine') || '[]')`);
}

async function clickButtonByText(send, text, label) {
  const r = await evaluate(
    send,
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()`,
  );
  assert.equal(r, "ok", `${label}: tombol "${text}" harus bisa diklik (dapat: ${r})`);
}

async function clickMineEntry(send, index) {
  const r = await evaluate(
    send,
    `(() => { const b = document.querySelectorAll('.mine-open')[${index}]; if (!b) return 'no-button'; b.click(); return 'ok'; })()`,
  );
  assert.equal(r, "ok", `entri galeri #${index} harus bisa diklik`);
  // Tunggu mode revisi aktif (note "Video aktif:" muncul).
  await waitFor(send, `document.body.textContent.includes('Video aktif:')`, 30000, "note Video aktif");
  // Tunggu preview selesai dimuat (status berisi "berhasil").
  await waitFor(send, `document.body.textContent.includes('berhasil')`, 30000, "status berhasil buka entri");
}

// ---------- Tes ----------
let base;
let killDev;
let killChrome;
let send;
let ws;

test("setup: fixtures + dev server + chrome", async () => {
  await compileFixtures();
  ({ base, killAll: killDev } = await startDevServer(DEV_PORT));
  ({ killAll: killChrome } = await launchChrome());
  ({ ws, send } = await connectPage());
  await send("Page.enable");
  await send("Page.navigate", { url: `${base}/` });
  await waitFor(send, `document.body.textContent.includes('Video Buatan Saya')`, 60000, "galeri Video Buatan Saya");
});

test("seed 3 entri; tab revisi nonaktif tanpa entri aktif", async () => {
  const { CANNED_SPEC } = require(path.join(TMP, "canned.js"));
  const { CANNED_SCENE } = require(path.join(TMP, "canned-scene.js"));
  const entries = [
    { id: "mine-scene-1", title: CANNED_SCENE.title, createdAt: Date.now(), kind: "scene", duration: CANNED_SCENE.duration, scene: CANNED_SCENE },
    { id: "mine-spec-1", title: CANNED_SPEC.title, createdAt: Date.now(), kind: "spec", baseTemplateId: "versus", duration: 28, spec: CANNED_SPEC },
    { id: "mine-template-1", title: "Claude vs Codex vs Gemini", createdAt: Date.now(), kind: "template", duration: 32, html: TRIO },
  ];
  await evaluate(send, `localStorage.setItem('claudeku.mine', ${JSON.stringify(JSON.stringify(entries))})`);
  await send("Page.navigate", { url: `${base}/` });
  await waitFor(send, `document.querySelectorAll('.mine-open').length === 3`, 60000, "3 entri galeri");
  const disabled = await evaluate(
    send,
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Revisi video ini')); return b ? b.disabled : 'no-button'; })()`,
  );
  assert.equal(disabled, true, "tab 'Revisi video ini' harus nonaktif bila tidak ada entri aktif");
});

test("(A) buka entri scene -> revisi contoh -> jumlah tetap, entri sama berubah", async () => {
  await clickMineEntry(send, 0);
  await clickButtonByText(send, "Coba revisi contoh scene", "revisi scene");
  await waitFor(send, `document.body.textContent.includes('Menerapkan revisi contoh scene berhasil')`, 30000, "status revisi scene");
  const mine = await readMine(send);
  assert.equal(mine.length, 3, "jumlah entri tetap 3 sesudah revisi scene");
  const scene = mine.find((e) => e.id === "mine-scene-1");
  assert.ok(scene.title.endsWith("— Revisi"), `judul scene harus berakhir "— Revisi" (dapat: ${scene.title})`);
});

test("(B) buka entri template -> render THREE jalan -> revisi contoh -> jumlah tetap", async () => {
  await clickMineEntry(send, 2);
  // Preview template skill ter-render: THREE ter-load + canvas ada.
  await waitFor(
    send,
    `(() => { const f = document.querySelector('iframe'); return f && f.contentWindow && f.contentWindow.THREE ? true : false; })()`,
    60000,
    "THREE ter-load di iframe preview",
  );
  const canvas = await evaluate(
    send,
    `(() => { const f = document.querySelector('iframe'); const c = f && f.contentDocument ? f.contentDocument.querySelector('canvas') : null; return c ? { w: c.width, h: c.height } : null; })()`,
  );
  assert.ok(canvas && canvas.w > 0 && canvas.h > 0, "canvas WebGL harus ada di preview");
  // Judul layar di dalam video = judul entri (bukan judul template lain).
  const screenTitle = await evaluate(
    send,
    `(() => { const f = document.querySelector('iframe'); const t = f && f.contentDocument ? f.contentDocument.getElementById('title') : null; return t ? t.textContent : null; })()`,
  );
  assert.ok(screenTitle && screenTitle.includes("Claude vs Codex"), `judul layar harus tampil (dapat: ${screenTitle})`);
  // Render frame t=5 lalu screenshot untuk cek visual (tidak hitam).
  await evaluate(send, `(() => { const f = document.querySelector('iframe'); f.contentWindow.renderAt(5); return true; })()`);
  await new Promise((r) => setTimeout(r, 2000));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(SCREENSHOT, Buffer.from(shot.data, "base64"));
  assert.ok(fs.statSync(SCREENSHOT).size > 10000, "screenshot harus berisi gambar (bukan frame kosong)");

  await clickButtonByText(send, "Coba revisi contoh", "revisi template skill");
  await waitFor(send, `document.body.textContent.includes('Menerapkan revisi contoh template berhasil')`, 30000, "status revisi template");
  const mine = await readMine(send);
  assert.equal(mine.length, 3, "jumlah entri tetap 3 sesudah revisi template");
  const tpl = mine.find((e) => e.id === "mine-template-1");
  assert.ok(tpl.title.endsWith("— Revisi"), `judul template harus berakhir "— Revisi" (dapat: ${tpl.title})`);
  assert.ok(tpl.html.includes("<title>Claude vs Codex vs Gemini — Revisi</title>"), "HTML tersimpan harus berisi judul revisi");
});

test("(C) buka entri spec -> revisi contoh -> jumlah tetap, entri sama berubah", async () => {
  await clickMineEntry(send, 1);
  await clickButtonByText(send, "Coba revisi contoh", "revisi spec");
  await waitFor(send, `document.body.textContent.includes('Menerapkan revisi contoh berhasil')`, 30000, "status revisi spec");
  const mine = await readMine(send);
  assert.equal(mine.length, 3, "jumlah entri tetap 3 sesudah revisi spec");
  const spec = mine.find((e) => e.id === "mine-spec-1");
  assert.ok(spec.title.endsWith("— Revisi") || spec.title.includes("Kerja Bareng"), `judul spec harus berubah (dapat: ${spec.title})`);
});

test("teardown", async () => {
  try {
    ws.close();
  } catch {
    /* abaikan */
  }
  killChrome();
  killDev();
});
