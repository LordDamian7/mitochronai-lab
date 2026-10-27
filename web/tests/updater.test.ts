import "./helpers.ts";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { db } from "@/lib/db";
import { buildPackage } from "@/lib/update";
import { appInfo, discardStaged, requestInstall, stagedUpdate, stageUpdate, updateDir } from "@/lib/updater";

const k = generateKeyPairSync("ed25519");
const pub = k.publicKey.export({ type: "spki", format: "pem" }).toString(), priv = k.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ADMIN = { id: "STF-900", role: "admin" }, CHIEF = { id: "STF-001", role: "chief_scientist" }, SCI = { id: "STF-002", role: "scientist" };
const lock = readFileSync(path.join(process.cwd(), "package-lock.json"));
const make = (version: string, extra: { path: string; data: Buffer }[] = [{ path: "package-lock.json", data: lock }]) =>
  buildPackage({ app: appInfo().app, version, notes: "Adds the update screen", files: [{ path: "lib/x.ts", data: Buffer.from("x") }, ...extra], privateKeyPem: priv });
const audits = (a: string) => (db().prepare("SELECT COUNT(*) n FROM audit_log WHERE action = ?").get(a) as { n: number }).n;

test("the app knows its own name and version", () => {
  const a = appInfo();
  assert.equal(a.app, "mitochronai-lab-web");
  assert.match(a.version, /^\d+\.\d+\.\d+$/);
});

test("only the administrator can upload an update; the chief scientist and scientists can't", () => {
  for (const who of [CHIEF, SCI]) assert.match((stageUpdate(make("9.0.0"), who, { publicKeyPem: pub }) as { reason: string }).reason, /administrator/);
});

test("a valid package is verified and kept ready, but nothing is installed yet", () => {
  const r = stageUpdate(make("9.0.0"), ADMIN, { publicKeyPem: pub });
  assert.ok(r.ok, (r as { reason: string }).reason);
  const s = stagedUpdate();
  assert.equal(s?.version, "9.0.0");
  assert.equal(s?.notes, "Adds the update screen");
  assert.equal(audits("update.staged"), 1);
  assert.equal(existsSync(path.join(updateDir(), "request.json")), false, "staging never starts an install");
});

test("a forged package is refused and the refusal is audited", () => {
  const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const forged = buildPackage({ app: appInfo().app, version: "9.1.0", notes: "", files: [{ path: "lib/x.ts", data: Buffer.from("x") }], privateKeyPem: other });
  assert.match((stageUpdate(forged, ADMIN, { publicKeyPem: pub }) as { reason: string }).reason, /signature/);
  assert.equal(audits("update.refused"), 1);
});

test("an update that changes the app's libraries is refused: installing them needs internet", () => {
  const r = stageUpdate(make("9.2.0", [{ path: "package-lock.json", data: Buffer.from('{"changed":true}') }]), ADMIN, { publicKeyPem: pub });
  assert.match((r as { reason: string }).reason, /internet/);
});

test("installing needs the supervisor (START-HERE) running; then it's requested, not done by the web page", () => {
  assert.ok(stageUpdate(make("9.3.0"), ADMIN, { publicKeyPem: pub }).ok);
  assert.match((requestInstall(ADMIN) as { reason: string }).reason, /START-HERE/);
  writeFileSync(path.join(updateDir(), "supervisor.json"), JSON.stringify({ pid: 1, beat: new Date().toISOString() }));
  assert.match((requestInstall(CHIEF) as { reason: string }).reason, /administrator/);
  assert.ok(requestInstall(ADMIN).ok);
  assert.equal(JSON.parse(readFileSync(path.join(updateDir(), "request.json"), "utf8")).version, "9.3.0");
  assert.equal(audits("update.requested"), 1);
});

test("a staged package can be discarded", () => {
  assert.ok(discardStaged(ADMIN).ok);
  assert.equal(stagedUpdate(), null);
});
