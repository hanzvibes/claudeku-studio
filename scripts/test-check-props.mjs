// Tes cek prop-kit v3.14 (scripts/check_props.mjs) — JALUR NYATA:
//   node scripts/test-check-props.mjs
// 1. CLI: check_props.mjs lolos (exit 0) pada template-code.html (100-prop kit).
// 2. CLI: check_props.mjs MENOLAK template-trio.html (tanpa prop-kit) —
//    jadi gating di lib/skill-lint.ts yang menyelamatkan template lain.
// 3. Route: mock provider mengembalikan template-code.html -> /api/generate-skill
//    sampai done attempts=1 (cek prop jalan di alur nyata dan lolos).
// 4. Route: mock provider mengembalikan template-trio.html -> done attempts=1
//    (template tanpa prop-kit TIDAK diblokir cek prop).
// 5. Guard sumber: lib/skill-lint.ts memanggil checkPropsKit hanya bila
//    hasPropKit(html) benar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PORT = 3125;
const CODE = fs.readFileSync(path.join(ROOT, "public/templates/template-code.html"), "utf-8");
const TRIO = fs.readFileSync(path.join(ROOT, "public/templates/template-trio.html"), "utf-8");

// ---------- Mock provider ----------
let scenario = "code";

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://mock");
      if (u.pathname === "/__scenario") {
        scenario = u.searchParams.get("name") ?? "code";
        res.writeHead(200);
        res.end("ok");
        return;
      }
      if (u.pathname === "/v1/chat/completions" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const content = scenario === "trio" ? TRIO : CODE;
          const j = JSON.parse(body || "{}");
          if (!j.stream) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content } }] }));
          } else {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
            const CH = 4000;
            for (let i = 0; i < content.length; i += CH) {
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + CH) } }] })}\n\n`);
            }
            res.write("data: [DONE]\n\n");
            res.end();
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function setScenario(mockPort, name) {
  const res = await fetch(`http://localhost:${mockPort}/__scenario?name=${name}`);
  assert.equal(res.status, 200);
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

// ---------- Klien SSE ----------
async function callGenerateSkill(base, body) {
  const res = await fetch(`${base}/api/generate-skill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { httpStatus: res.status, httpBody: j, events: [] };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          events.push(JSON.parse(line.slice(5).trim()));
        } catch {
          /* abaikan baris bukan JSON */
        }
      }
    }
  }
  return { httpStatus: res.status, events };
}

const doneEvent = (r) => r.events.find((e) => e.type === "done");

// ---------- Tes ----------
let mock;
let base;
let killDev;

test("CLI: check_props lolos pada template-code.html (100-prop kit)", async () => {
  const { stdout } = await execFileAsync("node", ["scripts/check_props.mjs", "public/templates/template-code.html"], { cwd: ROOT });
  assert.match(stdout, /props: 100/);
  assert.match(stdout, /OK: tidak ada potongan/);
});

test("CLI: check_props MENOLAK template-trio.html (tanpa prop-kit)", async () => {
  await assert.rejects(
    execFileAsync("node", ["scripts/check_props.mjs", "public/templates/template-trio.html"], { cwd: ROOT }),
    (e) => e.code === 1 && /jumlah props 0/.test(e.stdout ?? ""),
    "script harus exit 1 pada file tanpa prop-kit",
  );
});

test("guard: checkPropsKit hanya dipanggil bila hasPropKit benar", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/skill-lint.ts"), "utf-8");
  assert.ok(src.includes("if (!hasPropKit(html)) return"), "gate hasPropKit harus ada sebelum cek prop");
  assert.ok(src.includes("checkPropsKit(html)"), "pemanggilan checkPropsKit harus ada");
  assert.ok(src.includes("scripts", 0) && src.includes("check_props.mjs"), "path scripts/check_props.mjs harus ada");
});

test("setup: mock + dev server", async () => {
  mock = await startMock();
  ({ base, killAll: killDev } = await startDevServer(DEV_PORT));
});

test("route: template-code.html (prop-kit) -> done attempts=1, tanpa self-repair", async () => {
  await setScenario(mock.port, "code");
  const r = await callGenerateSkill(base, {
    prompt: "Buatkan video adu kode",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
  });
  assert.equal(r.httpStatus, 200);
  const done = doneEvent(r);
  assert.ok(done, "harus ada event done");
  assert.equal(done.title, "Claude vs Codex — Adu Kode");
  assert.equal(done.duration, 30);
  assert.equal(done.attempts, 1, "cek prop harus lolos di percobaan pertama (tanpa repair)");
  assert.equal(done.repaired, false);
  assert.equal(done.lintVia, "python");
  assert.deepEqual(done.lintWarnings, []);
});

test("route: template-trio.html (tanpa prop-kit) -> done attempts=1, tidak diblokir", async () => {
  await setScenario(mock.port, "trio");
  const r = await callGenerateSkill(base, {
    prompt: "Buatkan video debat tiga AI",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
  });
  const done = doneEvent(r);
  assert.ok(done, "trio tanpa prop-kit harus tetap done");
  assert.equal(done.attempts, 1, "cek prop tidak boleh memblokir template tanpa kit");
  assert.equal(done.title, "Claude vs Codex vs Gemini");
});

test("teardown", async () => {
  killDev();
  await new Promise((resolve) => mock.server.close(resolve));
});
