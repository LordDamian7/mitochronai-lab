// The lab's launcher (START-HERE.bat runs this). It runs the app, restarts it if it crashes, and installs a verified
// update when the administrator asks for one: verify again, back up, install, rebuild, self-test, roll back on failure.
//   node scripts/run.mjs        (MCL_HOST / MCL_PORT override 127.0.0.1:3000)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { UPDATE_PUBLIC_KEY } from "../lib/update-key.ts";
import { install, recoverInterrupted } from "./supervisor-core.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.MCL_HOST ?? "127.0.0.1", PORT = process.env.MCL_PORT ?? "3000";
const NEXT = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
const ENV = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
const UPDATE = path.join(WEB, "var", "update");
const log = (m) => console.log(`[updater ${new Date().toLocaleTimeString("en-GB")}] ${m}`);
let child = null, expectedExit = false, busy = false, crashes = [];

function audit(action, detail) {
  try {
    const db = new DatabaseSync(path.join(WEB, "var", "mitochronai.db"));
    db.prepare("INSERT INTO audit_log (at, actor_type, actor_id, action, entity, entity_id, model, detail) VALUES (?,?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), "system", null, action, null, null, null, detail);
    db.close();
  } catch (e) { log(`couldn't write to the audit log: ${e.message}`); }
  log(`${action}: ${detail}`);
}

function start() {
  return new Promise((resolve) => {
    expectedExit = false;
    const c = spawn(process.execPath, [NEXT, "start", "-H", HOST, "-p", PORT], { cwd: WEB, env: ENV, stdio: "inherit" });
    child = c;
    c.on("exit", (code) => {
      if (child === c) child = null;
      if (expectedExit || busy) return;
      crashes = [...crashes.filter((t) => Date.now() - t < 60_000), Date.now()];
      if (crashes.length > 5) { log("The app keeps stopping; not restarting it again. Check the messages above."); return; }
      log(`The app stopped (code ${code}); restarting in 3 seconds.`);
      setTimeout(() => start(), 3000);
    });
    setTimeout(resolve, 500);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    expectedExit = true;
    const c = child;
    const done = () => { clearTimeout(t); child = null; resolve(); };
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* already gone */ } done(); }, 10_000);
    c.once("exit", done);
    c.kill();
  });
}

function build(web) {
  return new Promise((resolve) => {
    log("Building the app (2-5 minutes)...");
    const b = spawn(process.execPath, [NEXT, "build"], { cwd: web, env: ENV, stdio: "inherit" });
    const t = setTimeout(() => { b.kill(); resolve(false); }, 20 * 60_000);
    b.on("exit", (code) => { clearTimeout(t); resolve(code === 0); });
  });
}

async function selfTest() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://${HOST}:${PORT}/login`); if (r.status === 200) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const hooks = { publicKeyPem: UPDATE_PUBLIC_KEY, start, stop, build, selfTest, audit };

mkdirSync(UPDATE, { recursive: true });
const recovered = await recoverInterrupted(WEB, hooks);
if (recovered) log(recovered.message);
if (!existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
  log("First start: preparing the app.");
  if (!(await build(WEB))) { log("Preparing the app failed. See the messages above."); process.exit(1); }
}
await start();
log(`MitochronAi Lab running at http://${HOST}:${PORT} (updates enabled; keep this window open).`);

const beat = () => { try { writeFileSync(path.join(UPDATE, "supervisor.json"), JSON.stringify({ pid: process.pid, beat: new Date().toISOString() })); } catch { /* next beat */ } };
beat();
setInterval(beat, 5000);
setInterval(async () => {
  if (busy || !existsSync(path.join(UPDATE, "request.json"))) return;
  busy = true;
  try { const r = await install(WEB, hooks); log(r.message); } catch (e) { log(`Update error: ${e.message}`); }
  finally { busy = false; }
}, 3000);

const quit = async () => { rmSync(path.join(UPDATE, "supervisor.json"), { force: true }); await stop(); process.exit(0); };
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
