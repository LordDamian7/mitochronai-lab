/**
 * Signed offline updates (for example from a USB stick). Node built-ins only, so the same file is used by the
 * package builder on John's PC, by the app when the admin uploads a package, and by the supervisor that installs it.
 *
 * Package = "MCLUPD1\n" + header JSON + "\n" + gzip(payload JSON)
 *   header  = { app, version, sha256 (of the gzip bytes), sig }   sig = Ed25519 over FORMAT\napp\nversion\nsha256
 *   payload = { manifest: { format, app, version, created, notes, files: [{ path, size, sha256 }] }, files: { path: base64 } }
 */
import { createHash, sign, verify } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const FORMAT = "mitochronai-update/1";
const MAGIC = Buffer.from("MCLUPD1\n");
export const LIMITS = { packedBytes: 25 * 1024 * 1024, unpackedBytes: 60 * 1024 * 1024, files: 2000 };
/** What an update may change: the app's code only. Never var/ (patient data), node_modules/, .next/ or seed/. */
export const ROOTS = ["app", "components", "lib", "public", "scripts", "tests"];
export const ROOT_FILES = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json"];

export type FileEntry = { path: string; data: Buffer };
export type Manifest = { format: string; app: string; version: string; created: string; notes: string; files: { path: string; size: number; sha256: string }[] };
type Header = { app: string; version: string; sha256: string; sig: string };
type Result = { ok: true; manifest: Manifest; files: FileEntry[] } | { ok: false; reason: string };

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const signed = (app: string, version: string, digest: string) => Buffer.from(`${FORMAT}\n${app}\n${version}\n${digest}`);
const isVersion = (v: unknown): v is string => typeof v === "string" && /^\d{1,4}\.\d{1,5}\.\d{1,6}$/.test(v);

export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** A relative, forward-slash path inside the app's code folders, with no tricks. */
export function isSafePath(p: unknown): p is string {
  if (typeof p !== "string" || !p || p.length > 200) return false;
  if (p.includes("\\") || p.includes(":") || p.startsWith("/") || !/^[A-Za-z0-9._\-/()[\] @+]+$/.test(p)) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  return parts.length === 1 ? ROOT_FILES.includes(p) : ROOTS.includes(parts[0]);
}

/** Sign an already-built payload. buildPackage() validates first; tests use this directly to craft hostile packages. */
export function sealPayload(payload: { manifest: Manifest; files: Record<string, string> }, privateKeyPem: string): Buffer {
  const gz = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  const digest = sha256(gz), { app, version } = payload.manifest;
  const sig = sign(null, signed(app, version, digest), privateKeyPem).toString("base64");
  return Buffer.concat([MAGIC, Buffer.from(JSON.stringify({ app, version, sha256: digest, sig } satisfies Header) + "\n"), gz]);
}

export function buildPackage(o: { app: string; version: string; notes: string; files: FileEntry[]; privateKeyPem: string }): Buffer {
  if (!isVersion(o.version)) throw new Error(`Version must look like 1.2.3, not "${o.version}"`);
  for (const f of o.files) if (!isSafePath(f.path)) throw new Error(`Path not allowed in an update: ${f.path}`);
  const manifest: Manifest = { format: FORMAT, app: o.app, version: o.version, created: new Date().toISOString(), notes: o.notes.slice(0, 4000),
    files: o.files.map((f) => ({ path: f.path, size: f.data.length, sha256: sha256(f.data) })) };
  return sealPayload({ manifest, files: Object.fromEntries(o.files.map((f) => [f.path, f.data.toString("base64")])) }, o.privateKeyPem);
}

/** Verify everything before trusting anything: signature, app, version, size, every path and every file's fingerprint. */
export function readPackage(buf: Buffer, o: { publicKeyPem: string; app: string; currentVersion: string }): Result {
  const no = (reason: string): Result => ({ ok: false, reason });
  if (buf.length > LIMITS.packedBytes) return no("The file is too large to be an update package.");
  if (buf.length < MAGIC.length + 10 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return no("That file isn't an update package for this app.");
  const nl = buf.indexOf(0x0a, MAGIC.length);
  if (nl < 0 || nl - MAGIC.length > 4096) return no("That file isn't an update package for this app.");
  let h: Header;
  try { h = JSON.parse(buf.subarray(MAGIC.length, nl).toString("utf8")); } catch { return no("That file isn't an update package for this app."); }
  if (typeof h?.app !== "string" || !isVersion(h.version) || typeof h.sha256 !== "string" || typeof h.sig !== "string") return no("That file isn't an update package for this app.");
  const gz = buf.subarray(nl + 1);
  if (sha256(gz) !== h.sha256) return no("The package is damaged or has been altered (its contents don't match its fingerprint). Copy it again from the original.");
  let good = false;
  try { good = verify(null, signed(h.app, h.version, h.sha256), o.publicKeyPem, Buffer.from(h.sig, "base64")); } catch { good = false; }
  if (!good) return no("The signature doesn't match: this package wasn't made by the app's developer, or it has been altered. Don't install it.");
  if (h.app !== o.app) return no(`This package is for ${h.app}, not for this lab's app (${o.app}).`);
  if (compareVersions(h.version, o.currentVersion) <= 0) return no(`Version ${h.version} isn't newer than the installed version (${o.currentVersion}).`);
  let payload: { manifest: Manifest; files: Record<string, string> };
  try { payload = JSON.parse(gunzipSync(gz, { maxOutputLength: LIMITS.unpackedBytes }).toString("utf8")); }
  catch (e) { return no(e instanceof RangeError || /maxOutputLength|buffer/i.test(String(e)) ? "The package is too large when unpacked." : "The package is damaged."); }
  const m = payload?.manifest;
  if (!m || m.format !== FORMAT || m.app !== h.app || m.version !== h.version || !Array.isArray(m.files) || typeof payload.files !== "object") return no("The package is damaged.");
  if (m.files.length > LIMITS.files) return no("The package has too many files.");
  const listed = new Set(m.files.map((f) => f.path));
  for (const p of Object.keys(payload.files)) if (!listed.has(p)) return no(`The package contains a file it doesn't list: ${String(p).slice(0, 80)}`);
  const files: FileEntry[] = [];
  for (const f of m.files) {
    if (!isSafePath(f.path)) return no(`The package tries to change a file that updates are not allowed to touch: ${String(f.path).slice(0, 80)}`);
    const b64 = payload.files[f.path];
    if (typeof b64 !== "string") return no(`The package is missing ${f.path}.`);
    const data = Buffer.from(b64, "base64");
    if (data.length !== f.size || sha256(data) !== f.sha256) return no(`${f.path} doesn't match its fingerprint in the package.`);
    files.push({ path: f.path, data });
  }
  return { ok: true, manifest: m, files };
}

/** Every file an update manages, relative to the web folder (symlinks are never followed). */
export function managedFiles(webDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(webDir, rel))) {
      const r = `${rel}/${name}`, st = lstatSync(path.join(webDir, r));
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(r); else if (st.isFile()) out.push(r);
    }
  };
  for (const root of ROOTS) if (existsSync(path.join(webDir, root))) walk(root);
  for (const f of ROOT_FILES) if (existsSync(path.join(webDir, f))) out.push(f);
  return out;
}

/** Back up the current code, then install the new files and remove code the new version no longer has. */
export function applyFiles(webDir: string, files: FileEntry[], backupDir: string) {
  const current = managedFiles(webDir);
  mkdirSync(backupDir, { recursive: true });
  for (const rel of current) { const to = path.join(backupDir, "files", rel); mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(path.join(webDir, rel), to); }
  writeFileSync(path.join(backupDir, "files.json"), JSON.stringify(current));
  const keep = new Set(files.map((f) => f.path));
  for (const rel of current) if (!keep.has(rel)) rmSync(path.join(webDir, rel), { force: true });
  for (const f of files) { const to = path.join(webDir, f.path); mkdirSync(path.dirname(to), { recursive: true }); writeFileSync(to, f.data); }
}

/** Put the backed-up code back exactly as it was. */
export function restoreBackup(webDir: string, backupDir: string) {
  const saved: string[] = JSON.parse(readFileSync(path.join(backupDir, "files.json"), "utf8"));
  const keep = new Set(saved);
  for (const rel of managedFiles(webDir)) if (!keep.has(rel)) rmSync(path.join(webDir, rel), { force: true });
  for (const rel of saved) { const to = path.join(webDir, rel); mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(path.join(backupDir, "files", rel), to); }
}
