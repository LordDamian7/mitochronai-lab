import "./helpers.ts";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { applyFiles, buildPackage, compareVersions, isSafePath, LIMITS, readPackage, restoreBackup, sealPayload } from "@/lib/update";

const keys = () => { const k = generateKeyPairSync("ed25519"); return { pub: k.publicKey.export({ type: "spki", format: "pem" }).toString(), priv: k.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }; };
const K = keys(), OTHER = keys();
const files = [{ path: "lib/hello.ts", data: Buffer.from("export const hi = 1;\n") }, { path: "package.json", data: Buffer.from('{"name":"app-a","version":"1.1.0"}') }];
const opts = { publicKeyPem: K.pub, app: "app-a", currentVersion: "1.0.0" };
const reason = (r: { ok: boolean }) => (r as unknown as { reason: string }).reason;

test("versions compare numerically", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.4.2", "0.5.0"), -1);
});

test("a package signed with the lab's key, for this app and newer, is accepted", () => {
  const pkg = buildPackage({ app: "app-a", version: "1.1.0", notes: "Fixes", files, privateKeyPem: K.priv });
  const r = readPackage(pkg, opts);
  assert.ok(r.ok, reason(r));
  assert.equal(r.manifest.version, "1.1.0");
  assert.equal(r.files.find((f) => f.path === "lib/hello.ts")!.data.toString(), "export const hi = 1;\n");
});

test("one changed byte anywhere makes it invalid", () => {
  const pkg = buildPackage({ app: "app-a", version: "1.1.0", notes: "", files, privateKeyPem: K.priv });
  const bad = Buffer.from(pkg); bad[bad.length - 5] ^= 0xff;
  assert.match(reason(readPackage(bad, opts)), /signature|damaged/i);
});

test("a package signed by anyone else is refused", () => {
  const pkg = buildPackage({ app: "app-a", version: "1.1.0", notes: "", files, privateKeyPem: OTHER.priv });
  assert.match(reason(readPackage(pkg, opts)), /signature/i);
});

test("a package for the other lab's app is refused", () => {
  const pkg = buildPackage({ app: "app-b", version: "1.1.0", notes: "", files, privateKeyPem: K.priv });
  assert.match(reason(readPackage(pkg, opts)), /for app-b/);
});

test("the same or an older version is refused (no downgrades)", () => {
  for (const v of ["1.0.0", "0.9.0"]) {
    const pkg = buildPackage({ app: "app-a", version: v, notes: "", files, privateKeyPem: K.priv });
    assert.match(reason(readPackage(pkg, opts)), /newer/);
  }
});

test("only the app's own code can be touched: never patient data, libraries, builds or secrets", () => {
  for (const ok of ["app/page.tsx", "lib/x.ts", "public/brand/logo.png", "scripts/e2e.mjs", "package.json", "next.config.ts"]) assert.ok(isSafePath(ok), ok);
  for (const bad of ["../var/mitochronai.db", "var/mitochronai.db", "node_modules/next/index.js", ".next/BUILD_ID", "seed/demo-users.json",
    "/etc/passwd", "C:/Windows/x", "lib\\..\\..\\var\\x.db", "lib/../../var/x.db", "", "README.md", "lib/./x.ts"]) assert.equal(isSafePath(bad), false, bad);
  assert.throws(() => buildPackage({ app: "app-a", version: "1.1.0", notes: "", files: [{ path: "var/mitochronai.db", data: Buffer.from("x") }], privateKeyPem: K.priv }), /not allowed/);
  // A correctly signed package that still names an unsafe path (a compromised build machine) is refused on reading.
  const evil = sealPayload({ manifest: { format: "mitochronai-update/1", app: "app-a", version: "1.1.0", created: new Date().toISOString(), notes: "", files: [{ path: "../var/mitochronai.db", size: 1, sha256: "x" }] }, files: { "../var/mitochronai.db": "eA==" } }, K.priv);
  assert.match(reason(readPackage(evil, opts)), /not allowed/);
});

test("a decompression bomb is stopped at the size limit", () => {
  const huge = { manifest: { format: "mitochronai-update/1", app: "app-a", version: "1.1.0", created: "", notes: "", files: [] }, files: { "lib/a.ts": Buffer.alloc(LIMITS.unpackedBytes + 1024, 65).toString("base64") } };
  const pkg = sealPayload(huge, K.priv);
  assert.ok(pkg.length < 2_000_000, "small on the USB stick");
  assert.match(reason(readPackage(pkg, opts)), /too large/i);
});

test("a file that doesn't match its fingerprint in the manifest is refused", () => {
  const payload = { manifest: { format: "mitochronai-update/1", app: "app-a", version: "1.1.0", created: "", notes: "", files: [{ path: "lib/a.ts", size: 3, sha256: "0".repeat(64) }] }, files: { "lib/a.ts": Buffer.from("abc").toString("base64") } };
  assert.match(reason(readPackage(sealPayload(payload, K.priv), opts)), /fingerprint/);
});

test("rubbish is refused politely", () => {
  assert.match(reason(readPackage(Buffer.from("not a package"), opts)), /isn't an update package/);
  assert.match(reason(readPackage(gzipSync(Buffer.from("{}")), opts)), /isn't an update package/);
});

test("applying writes the new files, removes code the new version dropped, and a backup restores everything", () => {
  const web = mkdtempSync(path.join(os.tmpdir(), "mcl-apply-")), backup = path.join(web, "var", "backup");
  mkdirSync(path.join(web, "lib"), { recursive: true }); mkdirSync(path.join(web, "var"), { recursive: true });
  writeFileSync(path.join(web, "lib", "hello.ts"), "old\n"); writeFileSync(path.join(web, "lib", "gone.ts"), "remove me\n");
  writeFileSync(path.join(web, "package.json"), '{"version":"1.0.0"}'); writeFileSync(path.join(web, "var", "mitochronai.db"), "PATIENT DATA");
  applyFiles(web, files, backup);
  assert.equal(readFileSync(path.join(web, "lib", "hello.ts"), "utf8"), "export const hi = 1;\n");
  assert.equal(existsSync(path.join(web, "lib", "gone.ts")), false, "code removed in the new version is removed");
  assert.equal(readFileSync(path.join(web, "var", "mitochronai.db"), "utf8"), "PATIENT DATA", "patient data untouched");
  restoreBackup(web, backup);
  assert.equal(readFileSync(path.join(web, "lib", "hello.ts"), "utf8"), "old\n");
  assert.equal(readFileSync(path.join(web, "lib", "gone.ts"), "utf8"), "remove me\n");
  assert.equal(readFileSync(path.join(web, "package.json"), "utf8"), '{"version":"1.0.0"}');
});
