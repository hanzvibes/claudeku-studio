// Lint HTML template jalur "Skill penuh" — server-side.
//
// Jalur utama: scripts/lint_short.py (python3) — sumber kebenaran yang
// sama dengan yang dipakai 12 template bawaan. Dijalankan lewat child
// process pada file sementara di /tmp (file user TIDAK PERNAH ditulis ke
// repo). Bila python3 tidak tersedia (misal runtime Vercel), dipakai
// fallback port TypeScript dari cek yang sama (cek error saja — warning
// flicker/kecaption tetap dari python bila tersedia).
//
// Perbedaan dengan lint_short.py: cek sintaks memakai `node --check`
// pada script inline TERAKHIR (sama seperti python). Fallback TS memakai
// `new Function`? TIDAK — fallback TIDAK mengecek sintaks JS (tidak ada
// parser JS murni di sini); sintaks tetap dicek python bila tersedia, dan
// bila python tidak ada, sintaks dicek via `node --check` langsung dari
// Node (node selalu ada di runtime ini).
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type SkillLintResult = {
  /** Error = HTML DITOLAK (tidak boleh disimpan / di-preview sebagai sukses). */
  errors: string[];
  /** Warning = boleh lanjut, tapi ditampilkan ke user. */
  warnings: string[];
  /** "python" bila lint_short.py yang jalan, "ts" bila fallback. */
  via: "python" | "ts";
  /** true bila HTML mengandung prop-kit dan check_props.mjs ikut jalan. */
  propsChecked: boolean;
};

/** Timeout lint python (lint menjalankan node --check di dalamnya). */
const LINT_TIMEOUT_MS = 30000;

/** Timeout check_props.mjs (600 sampel x 100 props, node murni). */
const PROPS_TIMEOUT_MS = 60000;

/**
 * Deteksi prop-kit 100-prop (v3.10, template-code.html): entri
 * ['001',lapis,x,y,z,w,h,d,0x..., 'resep',ry]. Ambang 10 entri supaya
 * satu-dua kemiripan teks acak tidak memicu cek.
 */
const PROP_ENTRY_RE = /\['\d{3}',\d,-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+,0x[0-9a-fA-F]+,'[a-zA-Z]+',-?[\d.]+]/g;

export function hasPropKit(html: string): boolean {
  return (html.match(PROP_ENTRY_RE) || []).length >= 10;
}

/**
 * Jalankan scripts/check_props.mjs pada HTML. Throw bila node/script
 * gagal dijalankan (pemanggil mengubahnya jadi warning, bukan error keras
 * — cek prop tambahan tidak boleh merusak alur lint yang sudah ada).
 */
async function checkPropsKit(html: string): Promise<{ errors: string[]; warnings: string[] }> {
  const tmp = path.join(tmpdir(), `claudeku-props-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  await fs.writeFile(tmp, html, "utf-8");
  try {
    const { stdout } = await execFileAsync("node", [path.join(process.cwd(), "scripts", "check_props.mjs"), tmp], {
      timeout: PROPS_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return parsePropsOutput(stdout);
  } catch (e) {
    const err = e as { stdout?: string; code?: number | string };
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return parsePropsOutput(err.stdout);
    }
    throw e;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/** Parse output check_props.mjs: baris "error: ..." / "warn : ...". */
function parsePropsOutput(stdout: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("error: ")) errors.push("prop: " + line.slice("error: ".length));
    else if (line.startsWith("warn : ")) warnings.push("prop: " + line.slice("warn : ".length));
  }
  return { errors, warnings };
}

/** Jalankan scripts/lint_short.py pada HTML. Throw bila python gagal dijalankan. */
async function lintViaPython(html: string): Promise<{ errors: string[]; warnings: string[] }> {
  const tmp = path.join(tmpdir(), `claudeku-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  await fs.writeFile(tmp, html, "utf-8");
  try {
    const { stdout } = await execFileAsync(
      "python3",
      [path.join(process.cwd(), "scripts", "lint_short.py"), tmp],
      { timeout: LINT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    return parseLintOutput(stdout);
  } catch (e) {
    // lint_short.py exit 1 bila ada error — stdout tetap berisi hasilnya.
    const err = e as { stdout?: string; code?: number | string };
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return parseLintOutput(err.stdout);
    }
    throw e;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/** Parse output "OK/FAIL <file>" + baris "  error: ..." / "  warn: ...". */
function parseLintOutput(stdout: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("  error: ")) errors.push(line.slice("  error: ".length));
    else if (line.startsWith("  warn: ")) warnings.push(line.slice("  warn: ".length));
  }
  return { errors, warnings };
}

/**
 * Port TypeScript dari cek ERROR lint_short.py (dipakai bila python3 tidak
 * tersedia). Cek warning flicker/kecaption tidak di-port (tetap dari
 * python bila tersedia) — fallback hanya menjamin error keras tertangkap.
 */
export function lintViaTs(html: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  if (!html.includes('id="wm"') || (html.match(/@hanzvibes/g) || []).length < 2) {
    errors.push('credit: need #wm watermark AND end-card line with @hanzvibes');
  }
  if (!html.includes("by @hanzvibes")) errors.push('credit: end card must say "by @hanzvibes"');
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const u = m[1];
    if (!/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net\/npm\/|cdn\.tailwindcss\.com|code\.jquery\.com)/.test(u)) {
      errors.push("script host not allowed: " + u);
    }
    if (u.includes("three") && !/r128|0\.128\.0/.test(u)) errors.push("three.js not pinned to r128: " + u);
  }
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
    const u = m[1];
    if (!u.startsWith("https://fonts.googleapis.com") && !u.startsWith("https://fonts.gstatic.com")) {
      errors.push("stylesheet host not allowed: " + u);
    }
  }
  if (!html.includes("viewport-fit=cover")) errors.push("missing viewport meta with viewport-fit=cover");
  for (const bad of ["localStorage", "sessionStorage", "api.anthropic.com", "<form"]) {
    if (html.includes(bad)) errors.push("not allowed in hosted page: " + bad);
  }
  if (!/\bLEN\s*=/.test(html)) errors.push("no LEN (loop length) found");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length === 0) errors.push("no inline <script> found");
  return { errors, warnings: [] };
}

/** Cek sintaks script inline TERAKHIR via `node --check` (dipakai fallback TS). */
async function checkLastInlineScriptSyntax(html: string): Promise<string[]> {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length === 0) return ["no inline <script> found"];
  const tmp = path.join(tmpdir(), `claudeku-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`);
  await fs.writeFile(tmp, scripts[scripts.length - 1][1], "utf-8");
  try {
    await execFileAsync("node", ["--check", tmp], { timeout: 15000 });
    return [];
  } catch (e) {
    const err = e as { stderr?: string };
    const first = (err.stderr ?? "syntax error").trim().split("\n")[0];
    return [`syntax error: ${first}`];
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/**
 * Lint HTML template skill. Urutan: python lint_short.py dulu; bila
 * python3 tidak bisa dijalankan (ENOENT dsb.), fallback port TS +
 * node --check. Tidak pernah throw untuk HTML yang buruk — HTML buruk
 * dikembalikan sebagai errors, bukan exception.
 *
 * Cek TAMBAHAN (v3.14): bila HTML mengandung prop-kit 100-prop,
 * scripts/check_props.mjs ikut dijalankan dan error-nya digabung ke
 * errors (template ditolak / self-repair seperti error lint lain).
 * Bila check_props tidak bisa dijalankan, hanya warning — alur lint
 * yang sudah ada tidak pernah rusak karenanya.
 */
export async function lintSkillHtml(html: string): Promise<SkillLintResult> {
  let base: { errors: string[]; warnings: string[]; via: "python" | "ts" };
  try {
    const { errors, warnings } = await lintViaPython(html);
    base = { errors, warnings, via: "python" };
  } catch {
    // python3 tidak tersedia / gagal dijalankan — fallback TS.
    const ts = lintViaTs(html);
    const syntaxErrors = await checkLastInlineScriptSyntax(html).catch(() => ["syntax check gagal dijalankan"]);
    base = { errors: [...ts.errors, ...syntaxErrors], warnings: ts.warnings, via: "ts" };
  }
  if (!hasPropKit(html)) return { ...base, propsChecked: false };
  try {
    const props = await checkPropsKit(html);
    return { errors: [...base.errors, ...props.errors], warnings: [...base.warnings, ...props.warnings], via: base.via, propsChecked: true };
  } catch {
    return {
      ...base,
      warnings: [...base.warnings, "check_props tidak bisa dijalankan — cek prop dilewati."],
      propsChecked: false,
    };
  }
}
