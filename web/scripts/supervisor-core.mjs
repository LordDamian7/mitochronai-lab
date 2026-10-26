// The install logic behind scripts/run.mjs, kept separate so every failure path can be tested with fake builds.
// install(): verify again → back up (code, build, database copy) → install → build → start → self-test; any failure rolls back.
// recoverInterrupted(): after a power cut mid-install, put the previous version back before the app starts.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyFiles, readPackage, restoreBackup } from "../lib/update.ts";

const J = (p) => JSON.parse(readFileSync(p, "utf8"));
// Backup + rebuild need room: a disk that fills mid-install can also stop the rollback half-way (seen on the dev PC).
export const MIN_FREE_BYTES = 1024 ** 3;
const diskFree = (web) => { const s = statfsSync(web); return Number(s.bavail) * Number(s.bsize); };
const paths = (web) => { const U = path.join(web, "var", "update"); mkdirSync(U, { recursive: true }); return { U, request: path.join(U, "request.json"), staged: path.join(U, "staged.mlup"), stagedInfo: path.join(U, "staged.json"), installing: path.join(U, "installing.json"), status: path.join(U, "status.json"), last: path.join(U, "last-backup.txt") }; };
function setStatus(web, state, message, version) {
  const s = { state, message, version, at: new Date().toISOString() };
  writeFileSync(paths(web).status, JSON.stringify(s));
  return s;
}

/** Restore code and the previous build from a backup. The database is never overwritten automatically (its copy stays in the backup). */
function rollback(web, backup) {
  if (existsSync(path.join(backup, "code", "files.json"))) restoreBackup(web, path.join(backup, "code"));
  if (existsSync(path.join(backup, ".next"))) { rmSync(path.join(web, ".next"), { recursive: true, force: true }); renameSync(path.join(backup, ".next"), path.join(web, ".next")); }
}

function pruneBackups(web, keep = 3) {
  const dir = path.join(web, "var", "backups");
  if (!existsSync(dir)) return;
  for (const old of readdirSync(dir).sort().reverse().slice(keep)) rmSync(path.join(dir, old), { recursive: true, force: true });
}

export async function install(web, h) {
  const P = paths(web);
  if (!existsSync(P.request)) return setStatus(web, "idle", "No update requested.");
  rmSync(P.request, { force: true }); // consumed once, so a failure can't loop
  const current = J(path.join(web, "package.json"));
  if (!existsSync(P.staged)) return setStatus(web, "failed", "The update package is missing. Upload it again.");
  // Verify again: the file on disk is not trusted just because the web page accepted it earlier.
  const r = readPackage(readFileSync(P.staged), { publicKeyPem: h.publicKeyPem, app: current.name, currentVersion: current.version });
  if (!r.ok) { h.audit("update.failed", `Install refused: ${r.reason}`); return setStatus(web, "failed", r.reason); }
  const lock = r.files.find((f) => f.path === "package-lock.json");
  if (lock && existsSync(path.join(web, "package-lock.json")) && !lock.data.equals(readFileSync(path.join(web, "package-lock.json")))) {
    const reason = "This update changes the app's libraries, which needs internet to install.";
    h.audit("update.failed", `Install refused: ${reason}`); return setStatus(web, "failed", reason);
  }
  const version = r.manifest.version;
  const free = (h.freeBytes ?? diskFree)(web);
  if (free < MIN_FREE_BYTES) {
    const reason = `Not enough free disk space to install safely (${(free / 1024 ** 3).toFixed(1)} GB free, at least 1 GB needed). Free some space, then press Install again; the package stays ready.`;
    h.audit("update.failed", `Install of ${version} not started: ${reason}`); return setStatus(web, "failed", reason, version);
  }
  const backup = path.join(web, "var", "backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-v${current.version}`);
  mkdirSync(backup, { recursive: true });
  writeFileSync(P.last, backup);
  writeFileSync(P.installing, JSON.stringify({ backup, version, from: current.version, at: new Date().toISOString() }));
  setStatus(web, "installing", `Installing version ${version}. The app will be back in a few minutes.`, version);
  h.audit("update.started", `Installing version ${version} (was ${current.version}); backup at ${path.relative(web, backup)}`);
  await h.stop();
  try {
    // A copy of the database, for manual recovery only (the app is stopped, so the files are consistent).
    const varDir = path.join(web, "var");
    mkdirSync(path.join(backup, "db"), { recursive: true });
    for (const f of readdirSync(varDir)) if (/\.db(-wal|-shm)?$/.test(f)) copyFileSync(path.join(varDir, f), path.join(backup, "db", f));
    if (existsSync(path.join(web, ".next"))) renameSync(path.join(web, ".next"), path.join(backup, ".next"));
    mkdirSync(path.join(web, ".next"), { recursive: true });
    applyFiles(web, r.files, path.join(backup, "code"));
    if (!(await h.build(web))) throw new Error("The new version didn't build");
    await h.start();
    if (!(await h.selfTest())) { await h.stop(); throw new Error("The new version didn't start correctly"); }
    for (const f of [P.installing, P.staged, P.stagedInfo]) rmSync(f, { force: true });
    pruneBackups(web);
    h.audit("update.installed", `Version ${version} installed and running (was ${current.version})`);
    return setStatus(web, "done", `Version ${version} is installed and running.`, version);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    rollback(web, backup);
    rmSync(P.installing, { force: true });
    h.audit("update.rolled_back", `${why}; version ${current.version} restored automatically`);
    await h.start();
    return setStatus(web, "rolled_back", `${why}. Version ${current.version} was put back automatically; nothing was lost.`, version);
  }
}

export async function recoverInterrupted(web, h) {
  const P = paths(web);
  if (!existsSync(P.installing)) return null;
  const { backup, version, from } = J(P.installing);
  rollback(web, backup);
  rmSync(P.installing, { force: true });
  h.audit("update.recovered", `An interrupted installation of ${version} was undone at start-up${from ? `; version ${from} restored` : ""}`);
  return setStatus(web, "rolled_back", `The installation of ${version} was interrupted (for example by a power cut) and has been undone.`, version);
}
