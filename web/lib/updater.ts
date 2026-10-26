import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { audit, db } from "./db";
import { readPackage } from "./update";
import { UPDATE_PUBLIC_KEY } from "./update-key";

/**
 * The web side of offline updates. The admin uploads a package: it's verified and kept ready ("staged"), nothing more.
 * Installing is done by the supervisor (scripts/run.mjs, started by START-HERE), which verifies the package again,
 * backs everything up, installs, rebuilds, self-tests and rolls back on failure. The web page only asks it to.
 */
type Actor = { id: string; role: string };
type Fail = { ok: false; reason: string };
const ADMIN_ONLY = "Only the lab's administrator account can install updates.";
const isAdmin = (a: Actor) => a.role === "admin";

/** var/update next to the database (a throwaway folder in tests). */
export function updateDir(): string {
  const dbFile = process.env.MCL_DB_PATH ?? path.join(process.cwd(), "var", "mitochronai.db");
  const dir = path.join(path.dirname(dbFile), "update");
  mkdirSync(dir, { recursive: true });
  return dir;
}
const file = (name: string) => path.join(updateDir(), name);
const readJson = <T,>(name: string): T | null => { try { return JSON.parse(readFileSync(file(name), "utf8")) as T; } catch { return null; } };

export function appInfo(): { app: string; version: string } {
  const p = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  return { app: p.name, version: p.version };
}

export type Staged = { version: string; notes: string; created: string; files: number; stagedAt: string; stagedBy: string };
export const stagedUpdate = (): Staged | null => (existsSync(file("staged.mlup")) ? readJson<Staged>("staged.json") : null);

export function stageUpdate(buf: Buffer, by: Actor, opts: { publicKeyPem?: string } = {}): ({ ok: true } & Staged) | Fail {
  if (!isAdmin(by)) return { ok: false, reason: ADMIN_ONLY };
  const { app, version } = appInfo();
  const r = readPackage(buf, { publicKeyPem: opts.publicKeyPem ?? UPDATE_PUBLIC_KEY, app, currentVersion: version });
  if (!r.ok) {
    audit({ type: "human", id: by.id }, "update.refused", `Update package refused: ${r.reason}`);
    return r;
  }
  // New libraries can't be installed without internet, so an update must keep the same package-lock.json.
  const lock = r.files.find((f) => f.path === "package-lock.json");
  const currentLock = readFileSync(path.join(process.cwd(), "package-lock.json"));
  if (lock && !lock.data.equals(currentLock)) {
    const reason = "This update changes the app's libraries, which needs internet to install. Ask the developer for an offline package or install it with an internet connection.";
    audit({ type: "human", id: by.id }, "update.refused", `Update ${r.manifest.version} refused: ${reason}`);
    return { ok: false, reason };
  }
  const staged: Staged = { version: r.manifest.version, notes: r.manifest.notes, created: r.manifest.created, files: r.files.length, stagedAt: new Date().toISOString(), stagedBy: by.id };
  writeFileSync(file("staged.mlup"), buf);
  writeFileSync(file("staged.json"), JSON.stringify(staged));
  audit({ type: "human", id: by.id }, "update.staged", `Update package ${r.manifest.version} verified (signature, app, version, ${r.files.length} files) and ready to install`);
  return { ok: true, ...staged };
}

/** The supervisor writes a heartbeat every few seconds while it's running. */
export function supervisorAlive(): boolean {
  const s = readJson<{ beat: string }>("supervisor.json");
  return !!s && Date.now() - Date.parse(s.beat) < 20_000;
}

export function requestInstall(by: Actor): { ok: true } | Fail {
  if (!isAdmin(by)) return { ok: false, reason: ADMIN_ONLY };
  const s = stagedUpdate();
  if (!s) return { ok: false, reason: "There's no verified update waiting. Upload the package first." };
  if (!supervisorAlive()) return { ok: false, reason: "Updates can only be installed when the app was started with START-HERE (the updater isn't running)." };
  writeFileSync(file("request.json"), JSON.stringify({ version: s.version, by: by.id, at: new Date().toISOString() }));
  audit({ type: "human", id: by.id }, "update.requested", `Installation of version ${s.version} requested; the app will restart`);
  return { ok: true };
}

export function discardStaged(by: Actor): { ok: true } | Fail {
  if (!isAdmin(by)) return { ok: false, reason: ADMIN_ONLY };
  const s = stagedUpdate();
  for (const f of ["staged.mlup", "staged.json"]) rmSync(file(f), { force: true });
  if (s) audit({ type: "human", id: by.id }, "update.discarded", `Waiting update ${s.version} discarded`);
  return { ok: true };
}

export type Status = { state: "idle" | "installing" | "done" | "rolled_back" | "failed"; version?: string; message: string; at: string };
export const updateStatus = (): Status | null => readJson<Status>("status.json");
export const updateHistory = () =>
  db().prepare("SELECT at, actor_id, action, detail FROM audit_log WHERE action LIKE 'update.%' ORDER BY id DESC LIMIT 20").all() as { at: string; actor_id: string | null; action: string; detail: string }[];
