// Tes end-to-end jalur Skill dengan PROVIDER TIRUAN (mock OpenAI-compatible):
//   node scripts/test-skill-mock.mjs
// Mock mengembalikan HTML template trio (file bawaan, sudah lolos lint)
// sebagai "jawaban AI", jadi endpoint asli /api/generate-skill teruji penuh
// (SSE stream + fallback non-streaming + self-repair + kegagalan jujur)
// TANPA provider live / API key.
// Skenario mock (diatur via GET /__scenario?name=...):
//   sse-good   — stream:true -> SSE delta HTML trio; non-stream -> JSON.
//   json-only  — selalu JSON (abaikan stream:true) -> fallback endpoint.
//   repair     — panggilan ke-1 HTML terlarang (fetch), ke-2+ trio bersih.
//   always-bad — selalu teks bukan-HTML -> endpoint harus error jujur (3x).
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
const DEV_PORT = 3124;
const TRIO = fs.readFileSync(path.join(ROOT, "public/templates/template-trio.html"), "utf-8");

// ---------- Mock provider ----------
let scenario = "sse-good";
let callCount = 0;

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://mock");
      if (u.pathname === "/__scenario") {
        scenario = u.searchParams.get("name") ?? "sse-good";
        callCount = 0;
        res.writeHead(200);
        res.end("ok");
        return;
      }
      if (u.pathname === "/v1/chat/completions" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const j = JSON.parse(body || "{}");
          callCount += 1;
          let content;
          if (scenario === "always-bad") content = "Maaf, saya tidak bisa membuat video.";
          else if (scenario === "repair" && callCount === 1) {
            content = TRIO.replace("</body>", "<script>fetch('https://evil.example/x')</script></body>");
          } else content = TRIO;
          if (scenario === "json-only" || !j.stream) {
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
const errorEvent = (r) => r.events.find((e) => e.type === "error");

// ---------- Tes ----------
let mock;
let base;
let killDev;

test("setup: mock + dev server", async () => {
  mock = await startMock();
  ({ base, killAll: killDev } = await startDevServer(DEV_PORT));
});

test("SSE: mock streaming -> done (judul + durasi + lint python + preview /vendor/)", async () => {
  await setScenario(mock.port, "sse-good");
  const r = await callGenerateSkill(base, {
    prompt: "Buatkan video debat tiga AI",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
  });
  assert.equal(r.httpStatus, 200);
  assert.ok(r.events.some((e) => e.type === "token"), "harus ada event token mengalir");
  const done = doneEvent(r);
  assert.ok(done, "harus ada event done");
  assert.equal(done.title, "Claude vs Codex vs Gemini");
  assert.equal(done.duration, 32);
  assert.equal(done.attempts, 1);
  assert.equal(done.repaired, false);
  assert.equal(done.lintVia, "python", "lint harus jalan via lint_short.py asli");
  assert.deepEqual(done.lintWarnings, []);
  assert.ok(done.html.includes("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"), "html canonical tetap CDN");
  assert.ok(done.previewHtml.includes("/vendor/three.min.js"), "previewHtml rewrite ke /vendor/");
  assert.ok(!done.previewHtml.includes("cdnjs.cloudflare.com"), "previewHtml tanpa CDN three.js");
});

test("fallback: mock JSON-only -> done (provider tak dukung stream tetap jalan)", async () => {
  await setScenario(mock.port, "json-only");
  const r = await callGenerateSkill(base, {
    prompt: "Buatkan video debat tiga AI",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
  });
  const done = doneEvent(r);
  assert.ok(done, "fallback non-streaming harus sampai done");
  assert.equal(done.title, "Claude vs Codex vs Gemini");
});

test("revisi: currentHtml diterima -> done", async () => {
  await setScenario(mock.port, "sse-good");
  const r = await callGenerateSkill(base, {
    prompt: "Ganti judulnya",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
    currentHtml: TRIO,
  });
  assert.ok(doneEvent(r), "revisi dengan currentHtml harus done");
});

test("self-repair: HTML terlarang (fetch) -> diperbaiki -> done attempts=2", async () => {
  await setScenario(mock.port, "repair");
  const r = await callGenerateSkill(base, {
    prompt: "Buatkan video debat tiga AI",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
  });
  assert.ok(r.events.some((e) => e.type === "repaired"), "harus ada event repaired");
  const done = doneEvent(r);
  assert.ok(done, "sesudah repair harus done");
  assert.equal(done.attempts, 2);
  assert.equal(done.repaired, true);
  assert.ok(!done.html.includes("evil.example"), "HTML hasil tidak boleh mengandung pola terlarang");
});

test("gagal jujur: AI tak kembalikan HTML 3x -> error (bukan sukses palsu)", async () => {
  await setScenario(mock.port, "always-bad");
  const r = await callGenerateSkill(base, {
    prompt: "Buatkan video debat tiga AI",
    provider: { baseUrl: `http://localhost:${mock.port}/v1`, model: "mock", apiKey: "" },
  });
  assert.equal(doneEvent(r), undefined, "tidak boleh ada event done");
  const err = errorEvent(r);
  assert.ok(err, "harus ada event error");
  assert.match(err.error, /3 percobaan/);
  assert.match(err.error, /Scene/);
});

test("validasi input: tanpa provider -> 400 PROVIDER_MISSING; tanpa prompt -> 400", async () => {
  const noProvider = await callGenerateSkill(base, { prompt: "x", provider: { baseUrl: "", model: "", apiKey: "" } });
  assert.equal(noProvider.httpStatus, 400);
  assert.equal(noProvider.httpBody.code, "PROVIDER_MISSING");
  const noPrompt = await callGenerateSkill(base, { prompt: "  ", provider: { baseUrl: "http://x/v1", model: "m", apiKey: "" } });
  assert.equal(noPrompt.httpStatus, 400);
});

test("teardown", async () => {
  killDev();
  await new Promise((resolve) => mock.server.close(resolve));
});
