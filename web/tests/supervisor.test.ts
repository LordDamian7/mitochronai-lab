import "./helpers.ts";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPackage } from "@/lib/update";
// @ts-expect-error: plain JavaScript module shared with the supervisor
import { install, recoverInterrupted } from "../scripts/supervisor-core.mjs";

const k = generateKeyPairSync("ed25519");
const pub = k.publicKey.export({ type: "spki", format: "pem" }).toString(), priv = k.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** A tiny fake lab install: code, a build folder, a database and a staged package for version 1.1.0. */
function lab() {
  const web = mkdtempSync(path.join(os.tmpdir(), "mcl-sup-"));
  const w = (p: string, s: string) => { mkdirSync(path.dirname(path.join(web, p)), { recursive: true }); writeFileSync(path.join(web, p), s); };
  w("package.json", '{"name":"app-a","version":"1.0.0"}'); w("package-lock.json", "LOCK"); w("lib/hello.ts", "old code"); w(".next/BUILD_ID", "old build");
  w("var/mitochronai.db", "PATIENT DATA");
  const pkg = buildPackage({ app: "app-a", version: "1.1.0", notes: "n", privateKeyPem: priv,
    files: [{ path: "package.json", data: Buffer.from('{"name":"app-a","version":"1.1.0"}') }, { path: "package-lock.json", data: Buffer.from("LOCK") }, { path: "lib/hello.ts", data: Buffer.from("new code") }] });
  w("var/update/staged.mlup", ""); writeFileSync(path.join(web, "var/update/staged.mlup"), pkg);
  w("var/update/request.json", JSON.stringify({ version: "1.1.0", by: "STF-900" }));
  return { web, read: (p: string) => readFileSync(path.join(web, p), "utf8"), exists: (p: string) => existsSync(path.join(web, p)), w };
}
const events: string[] = [];
const hooks = (o: { buildOk?: boolean; selfTestOk?: boolean } = {}) => ({
  publicKeyPem: pub,
  freeBytes: () => 50 * 1024 ** 3,
  stop: async () => { events.push("stop"); },
  start: async () => { events.push("start"); },
  build: async (web: string) => { events.push("build"); if (o.buildOk === false) return false; writeFileSync(path.join(web, ".next", "BUILD_ID"), "new build"); return true; },
  selfTest: async () => o.selfTestOk !== false,
  audit: (action: string, detail: string) => events.push(`${action}: ${detail}`),
});

test("a good update is installed: new code, new build, data untouched, request cleared", async () => {
  const L = lab();
  const r = await install(L.web, hooks());
  assert.equal(r.state, "done", r.message);
  assert.equal(L.read("lib/hello.ts"), "new code");
  assert.equal(L.read(".next/BUILD_ID"), "new build");
  assert.equal(L.read("var/mitochronai.db"), "PATIENT DATA");
  assert.equal(JSON.parse(L.read("package.json")).version, "1.1.0");
  assert.equal(L.exists("var/update/request.json"), false);
  assert.equal(JSON.parse(L.read("var/update/status.json")).state, "done");
  assert.ok(events.some((e) => e.startsWith("update.installed")));
});

test("if the build fails, the old version is put back and started", async () => {
  const L = lab();
  const r = await install(L.web, hooks({ buildOk: false }));
  assert.equal(r.state, "rolled_back");
  assert.equal(L.read("lib/hello.ts"), "old code");
  assert.equal(L.read(".next/BUILD_ID"), "old build");
  assert.equal(JSON.parse(L.read("package.json")).version, "1.0.0");
  assert.equal(L.read("var/mitochronai.db"), "PATIENT DATA");
  assert.equal(events.at(-1)!.startsWith("update.rolled_back") || events.includes("start"), true);
});

test("if the new version doesn't come up, it's rolled back too", async () => {
  const L = lab();
  const r = await install(L.web, hooks({ selfTestOk: false }));
  assert.equal(r.state, "rolled_back");
  assert.equal(L.read("lib/hello.ts"), "old code");
  assert.equal(L.read(".next/BUILD_ID"), "old build");
});

test("a staged package altered on disk after upload is refused before anything is touched", async () => {
  const L = lab();
  const p = path.join(L.web, "var/update/staged.mlup"), b = readFileSync(p); b[b.length - 3] ^= 0xff; writeFileSync(p, b);
  events.length = 0;
  const r = await install(L.web, hooks());
  assert.equal(r.state, "failed");
  assert.match(r.message, /signature|damaged/i);
  assert.equal(L.read("lib/hello.ts"), "old code");
  assert.ok(!events.includes("stop"), "the running app was never stopped");
});

test("a power cut mid-install is recovered at the next start: the old version comes back", async () => {
  const L = lab();
  let started = false;
  await install(L.web, { ...hooks(), build: async () => { throw new Error("power cut"); } }).catch(() => {});
  // Simulate the cut: the install marker is still there and code may be half-written.
  L.w("var/update/installing.json", JSON.stringify({ backup: readFileSync(path.join(L.web, "var/update/last-backup.txt"), "utf8"), version: "1.1.0" }));
  L.w("lib/hello.ts", "half-written");
  const r = await recoverInterrupted(L.web, { ...hooks(), start: async () => { started = true; } });
  assert.equal(r?.state, "rolled_back");
  assert.equal(L.read("lib/hello.ts"), "old code");
  assert.equal(L.exists("var/update/installing.json"), false);
  assert.equal(started, false, "recovery doesn't start the app itself; the supervisor does next");
});

test("REVIEW U5: with too little free disk space the install doesn't start, so a half-done rollback can't happen", async () => {
  const L = lab();
  events.length = 0;
  const r = await install(L.web, { ...hooks(), freeBytes: () => 300 * 1024 * 1024 });
  assert.equal(r.state, "failed");
  assert.match(r.message, /disk space/i);
  assert.equal(L.read("lib/hello.ts"), "old code", "code untouched");
  assert.equal(L.read(".next/BUILD_ID"), "old build", "build untouched");
  assert.ok(!events.includes("stop"), "the running app was never stopped");
  assert.ok(L.exists("var/update/staged.mlup"), "the package stays ready to retry after space is freed");
  assert.ok(!L.exists("var/update/installing.json"));
});
