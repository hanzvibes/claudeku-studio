// Tes revisi-vs-baru + judul layar + /api/generate guard — TANPA test runner:
//   node scripts/test-revision.mjs
// Bagian 1: logika murni (lib/revision.ts, lib/skill-validate.ts,
// lib/mine.ts) dikompilasi via tsc ke /tmp lalu di-assert dengan node:test.
// Bagian 2: API hidup (dev server): /api/generate tanpa currentSpec -> 400,
// /api/apply judul layar = spec.title, /api/skill-example lolos lint.
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
const TMP = "/tmp/claudeku-revision-test";
const DEV_PORT = 3123;

// ---------- Kompilasi helper ----------
test("kompilasi helper ke /tmp", async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  await execFileAsync(
    "npx",
    [
      "tsc",
      "lib/revision.ts",
      "lib/skill-validate.ts",
      "lib/mine.ts",
      "lib/canned.ts",
      "lib/canned-scene.ts",
      "--outDir",
      TMP,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { cwd: ROOT },
  );
  for (const f of ["revision.js", "skill-validate.js", "mine.js", "canned.js", "canned-scene.js"]) {
    assert.ok(fs.existsSync(path.join(TMP, f)), `${f} harus terkompilasi`);
  }
});

const revision = () => require(path.join(TMP, "revision.js"));
const skillValidate = () => require(path.join(TMP, "skill-validate.js"));
const canned = () => require(path.join(TMP, "canned.js"));
const cannedScene = () => require(path.join(TMP, "canned-scene.js"));

// ---------- Stub localStorage untuk lib/mine.ts ----------
function installLocalStorageStub(quotaBytes = Infinity) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (String(v).length > quotaBytes) {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

// ---------- Bagian 1a: decideGenerate ----------
test("(a) buka entri spec -> generate merevisi entri yang sama (jumlah tetap)", () => {
  const { decideGenerate } = revision();
  const { CANNED_SPEC } = canned();
  const entry = { id: "mine-1", title: CANNED_SPEC.title, createdAt: 1, kind: "spec", spec: CANNED_SPEC, duration: 28 };
  const d = decideGenerate({ activeEntry: entry, scene: null, spec: CANNED_SPEC, skill: null, mode: "revisi" });
  assert.equal(d.route, "spec");
  assert.equal(d.isRevision, true);
  assert.equal(d.updateId, "mine-1");
  assert.equal(d.currentSpec, CANNED_SPEC);
  // Simulasi simpan (update di tempat, bukan push baru):
  const mine = [entry];
  const updated = { ...entry, title: "Judul Revisi" };
  const idx = mine.findIndex((e) => e.id === d.updateId);
  mine[idx] = updated;
  assert.equal(mine.length, 1, "jumlah entri tetap 1");
  assert.equal(mine[0].title, "Judul Revisi");
});

test("(b) buka entri scene -> generate merevisi scene (bukan jalur spec)", () => {
  const { decideGenerate } = revision();
  const { CANNED_SCENE } = cannedScene();
  const entry = { id: "mine-2", title: CANNED_SCENE.title, createdAt: 1, kind: "scene", scene: CANNED_SCENE, duration: 30 };
  for (const mode of ["revisi", "scene", "skill"]) {
    const d = decideGenerate({ activeEntry: entry, scene: CANNED_SCENE, spec: null, skill: null, mode });
    assert.equal(d.route, "scene", `mode ${mode} tetap dispatch ke scene karena entri aktif scene`);
    assert.equal(d.isRevision, true);
    assert.equal(d.updateId, "mine-2");
    assert.equal(d.currentScene, CANNED_SCENE);
  }
});

test("(b2) buka entri template -> generate merevisi template via skill", () => {
  const { decideGenerate } = revision();
  const html = fs.readFileSync(path.join(ROOT, "public/templates/template-trio.html"), "utf-8");
  const skill = { title: "Claude vs Codex vs Gemini", html, duration: 32 };
  const entry = { id: "mine-3", title: skill.title, createdAt: 1, kind: "template", html, duration: 32 };
  const d = decideGenerate({ activeEntry: entry, scene: null, spec: null, skill, mode: "revisi" });
  assert.equal(d.route, "skill");
  assert.equal(d.isRevision, true);
  assert.equal(d.updateId, "mine-3");
  assert.equal(d.currentHtml, html);
});

test("(c) tanpa entri aktif -> scene baru / skill baru; revisi ditolak", () => {
  const { decideGenerate, NO_ACTIVE_ENTRY_REASON } = revision();
  const dScene = decideGenerate({ activeEntry: null, scene: null, spec: null, skill: null, mode: "scene" });
  assert.equal(dScene.route, "scene");
  assert.equal(dScene.isRevision, false);
  assert.equal(dScene.updateId, null);
  const dSkill = decideGenerate({ activeEntry: null, scene: null, spec: null, skill: null, mode: "skill" });
  assert.equal(dSkill.route, "skill");
  assert.equal(dSkill.isRevision, false);
  const dRevisi = decideGenerate({ activeEntry: null, scene: null, spec: null, skill: null, mode: "revisi" });
  assert.equal(dRevisi.route, "none");
  assert.equal(dRevisi.reason, NO_ACTIVE_ENTRY_REASON);
});

test("entri aktif tapi konten belum termuat -> none (jangan tebak jalur)", () => {
  const { decideGenerate } = revision();
  const entry = { id: "mine-4", title: "x", createdAt: 1, kind: "scene", duration: 30 };
  const d = decideGenerate({ activeEntry: entry, scene: null, spec: null, skill: null, mode: "revisi" });
  assert.equal(d.route, "none");
});

test("updateIdForKind + resolveActiveEntry", () => {
  const { updateIdForKind, resolveActiveEntry } = revision();
  const entries = [
    { id: "a", kind: "scene", title: "S", createdAt: 1, duration: 30 },
    { id: "b", kind: "template", title: "T", createdAt: 2, duration: 32 },
  ];
  assert.equal(resolveActiveEntry(entries, "b")?.kind, "template");
  assert.equal(resolveActiveEntry(entries, null), null);
  assert.equal(resolveActiveEntry(entries, "tidak-ada"), null);
  assert.equal(updateIdForKind(entries[1], "template"), "b");
  assert.equal(updateIdForKind(entries[1], "scene"), null);
  assert.equal(updateIdForKind(null, "scene"), null);
});

// ---------- Bagian 1b: skill-validate ----------
test("skill-validate: template trio lolos; pola terlarang ditolak", () => {
  const { validateSkillHtml, extractSkillTitle, extractSkillLen, retitleSkillHtml } = skillValidate();
  const trio = fs.readFileSync(path.join(ROOT, "public/templates/template-trio.html"), "utf-8");
  assert.deepEqual(validateSkillHtml(trio), [], "trio bawaan harus lolos validasi keamanan");
  assert.equal(extractSkillTitle(trio), "Claude vs Codex vs Gemini");
  assert.equal(extractSkillLen(trio), 32);

  const bad = (snippet) => {
    const injected = trio.replace("</body>", `<script>${snippet}</script></body>`);
    assert.ok(injected.includes(snippet), "injeksi tes harus masuk");
    const errors = validateSkillHtml(injected);
    assert.ok(errors.length > 0, `pola terlarang harus ditolak: ${snippet}`);
  };
  bad("fetch('https://evil.example/x')");
  bad("localStorage.setItem('k','v')");
  bad("document.cookie");
  bad("eval('1')");
  bad("new Function('return 1')()");
  bad("new WebSocket('wss://evil.example')");
  const evilScript = trio.replace(
    'src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"',
    'src="https://evil.example/three.min.js"',
  );
  assert.ok(validateSkillHtml(evilScript).some((e) => e.includes("tidak diizinkan")), "script src asing ditolak");

  // retitle: <title> + judul layar berubah, subjudul <small> utuh.
  const retitled = retitleSkillHtml(trio, "Kamera Kebalik: Siapa yang Salah?");
  assert.ok(retitled.includes("<title>Kamera Kebalik: Siapa yang Salah?</title>"));
  const m = /<div id="title"><svg class="st"><\/svg>([\s\S]*?)<small/.exec(retitled);
  assert.ok(m, "div #title harus ada");
  assert.equal(m[1], "Kamera Kebalik: Siapa yang Salah?");
  assert.ok(!m[1].includes("Claude vs Codex"), "judul layar lama harus hilang");
});

// ---------- Bagian 1c: mine + guard kuota ----------
test("mine: guard kuota menolak template raksasa; QuotaExceededError dilaporkan", () => {
  installLocalStorageStub();
  const mine = require(path.join(TMP, "mine.js"));
  const small = { id: "s1", title: "Kecil", createdAt: 1, kind: "spec", duration: 28 };
  assert.equal(mine.mineFitsBudget([], small).fits, true);
  const huge = { id: "h1", title: "Raksasa", createdAt: 1, kind: "template", duration: 32, html: "x".repeat(6_000_000) };
  const check = mine.mineFitsBudget([], huge);
  assert.equal(check.fits, false, "template 6 MB tidak boleh muat dalam budget 4,5 MB");
  assert.ok(check.projectedBytes > mine.MINE_STORAGE_BUDGET_BYTES);
  assert.ok(mine.MINE_QUOTA_MESSAGE.includes("Penyimpanan browser"));

  // Simpan dengan stub kuota kecil -> saved=false + quotaExceeded=true (bukan diam-diam).
  installLocalStorageStub(1000);
  const r = mine.saveMineEntry({ id: "q1", title: "x".repeat(2000), createdAt: 1, kind: "spec", duration: 28 });
  assert.equal(r.saved, false);
  assert.equal(r.quotaExceeded, true);

  // Entri lama (scene/spec) tetap terbaca; template tanpa html ditolak.
  installLocalStorageStub();
  const store = globalThis.localStorage;
  store.setItem(
    "claudeku.mine",
    JSON.stringify([
      { id: "old1", title: "Scene Lama", createdAt: 1, kind: "scene", duration: 30, scene: { id: "s" } },
      { id: "old2", title: "Spec Lama", createdAt: 2, kind: "spec", duration: 28 },
      { id: "bad1", title: "Template Rusak", createdAt: 3, kind: "template", duration: 32 },
      { id: "ok1", title: "Template OK", createdAt: 4, kind: "template", duration: 32, html: "<html></html>" },
    ]),
  );
  const loaded = mine.loadMine();
  assert.deepEqual(
    loaded.map((e) => e.id),
    ["old1", "old2", "ok1"],
    "entri lama terbaca, template tanpa html dibuang",
  );
});

// ---------- Bagian 2: API hidup (dev server) ----------
async function startDevServer(port) {
  // Bersihkan server lama di port ini yang mungkin tertinggal dari run
  // sebelumnya (kill biasa hanya membunuh wrapper npx, bukan next-server).
  try {
    await execFileAsync("pkill", ["-f", `next dev -p ${port}`]);
    await new Promise((r) => setTimeout(r, 1000));
  } catch {
    /* tidak ada server lama */
  }
  const logFile = fs.openSync(`/tmp/next-dev-test-${port}.log`, "w");
  const child = spawn("npx", ["next", "dev", "-p", String(port)], { cwd: ROOT, stdio: ["ignore", logFile, logFile], detached: true });
  // Bunuh SELURUH process group (npx + next-server) saat selesai.
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
      if (res.ok) return { child, base, killAll };
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

test("(d) API hidup: /api/generate tanpa currentSpec -> 400; dengan currentSpec lolos guard", async () => {
  const { base, killAll } = await startDevServer(DEV_PORT);
  try {
    const noSpec = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "buat video baru", provider: { baseUrl: "", model: "", apiKey: "" } }),
    });
    assert.equal(noSpec.status, 400, "tanpa currentSpec harus 400");
    const noSpecBody = await noSpec.json();
    assert.match(noSpecBody.error, /hanya lewat Scene/);

    // Dengan currentSpec valid, guard 400 terlewati (berikutnya gagal di
    // provider karena baseUrl kosong — itu BUKTI guard-nya lolos).
    const { CANNED_SPEC } = canned();
    const withSpec = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "revisi", currentSpec: CANNED_SPEC, provider: { baseUrl: "", model: "", apiKey: "" } }),
    });
    const withSpecBody = await withSpec.json();
    assert.equal(withSpecBody.code, "PROVIDER_MISSING", "dengan currentSpec, error harus dari provider, bukan guard");

    // Bonus judul layar: apply spec contoh Rehan ke template versus.
    const spec = { ...CANNED_SPEC, title: "Kamera Kebalik: Siapa yang Salah?" };
    const apply = await fetch(`${base}/api/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: "versus", spec }),
    });
    assert.equal(apply.status, 200, "apply spec harus 200");
    const applied = await apply.json();
    assert.ok(applied.html.includes("<title>Kamera Kebalik: Siapa yang Salah?</title>"), "<title> = judul spec");
    const m = /<div id="title"><svg class="st"><\/svg>([\s\S]*?)<small/.exec(applied.html);
    assert.ok(m, "div #title harus ada di HTML hasil");
    assert.equal(m[1], "Kamera Kebalik: Siapa yang Salah?", "judul LAYAR = judul spec (bukan 'Claude vs Codex')");
    assert.ok(!m[1].includes("Claude vs Codex"));

    // Contoh skill: trio lolos validasi + lint_short.py asli.
    const ex = await fetch(`${base}/api/skill-example`);
    assert.equal(ex.status, 200, "/api/skill-example harus 200");
    const exBody = await ex.json();
    assert.equal(exBody.duration, 32);
    const { validateSkillHtml } = skillValidate();
    assert.deepEqual(validateSkillHtml(exBody.html), []);
    const tmpHtml = "/tmp/claudeku-skill-example.html";
    fs.writeFileSync(tmpHtml, exBody.html, "utf-8");
    await execFileAsync("python3", ["scripts/lint_short.py", tmpHtml], { cwd: ROOT });
  } finally {
    killAll();
  }
});
