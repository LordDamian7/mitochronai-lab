// End-to-end test of USB updates through the real UI, against an app started with `node scripts/run.mjs`.
//   node scripts/update-e2e.mjs <folder with the .mlup packages> <good version> <broken version>
// Installs <good>, proves a broken <broken> rolls back, and checks roles, forgery, downgrade and data safety.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const [DIR, GOOD, BROKEN] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const app = JSON.parse(fs.readFileSync("package.json", "utf8")).name;
const users = JSON.parse(fs.readFileSync("seed/demo-users.json", "utf8")).users;
const results = [];
const check = (label, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  · " + extra : ""}`); };
const counts = () => { const d = new DatabaseSync("var/mitochronai.db", { readOnly: true }); try { return ["patients", "orders", "results"].map((t) => d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n).join("/"); } finally { d.close(); } };
const status = () => { try { return JSON.parse(fs.readFileSync("var/update/status.json", "utf8")); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pkg = (v) => path.join(DIR, `${app}-${v}.mlup`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
async function session(user) {
  const ctx = await browser.newContext(); const p = await ctx.newPage(); p.setDefaultTimeout(180000);
  await p.goto(`${BASE}/login`); await p.fill("#username", user); await p.fill("#password", users.find((u) => u.username === user).password);
  await Promise.all([p.waitForURL("**/dashboard", { waitUntil: "commit" }), p.click("button[type=submit]")]);
  return p;
}
async function upload(p, file) {
  await p.goto(`${BASE}/update`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".live[data-state=open]").catch(() => {});
  await p.setInputFiles("#package", file);
  // The page sends the file with fetch, then moves to ?staged=1 / ?error=… on the client; wait for the answer first, then the page.
  await Promise.all([p.waitForResponse((r) => r.url().includes("/api/update/upload")), p.click("button:has-text('Check the package')")]);
  await p.waitForURL(/update\?(staged|error)=/);
  // Wait for this upload's own notice (an older "Last update" notice may already be on the page).
  await p.locator(p.url().includes("error=") ? ".notice[role=alert]" : "text=genuine and ready").first().waitFor(); await sleep(500);
  return p.locator("main").innerText();
}
async function installAndWait(p, version) {
  const clicked = new Date().toISOString(); // only a status written after this click counts (an older run may have left one)
  p.once("dialog", (d) => d.accept());
  await Promise.all([p.waitForURL(/installing=1/, { waitUntil: "commit" }), p.click(`button:has-text('Install version ${version} now')`)]);
  for (let i = 0; i < 900; i++) { // up to 30 min: a rebuild on a slow lab PC can take 10+
    const s = status(); if (s && s.version === version && s.at > clicked && ["done", "rolled_back", "failed"].includes(s.state)) return s; await sleep(2000); }
  return status();
}

const before = counts();
const admin = await session("lab.admin"), chief = await session("gram.stain"), sci = await session("taenia.solium");

// Roles and request origin
await chief.goto(`${BASE}/update`, { waitUntil: "domcontentloaded" });
check("the chief scientist can't open Software update (admin only)", chief.url().includes("denied=update"));
check("no 'Software update' menu item for the chief", (await chief.locator("nav >> text=Software update").count()) === 0);
const sciUp = await sci.evaluate(async (b) => (await fetch(`${b}/api/update/upload`, { method: "POST", body: "x" })).status, BASE);
check("a scientist's upload is refused before it's read (403)", sciUp === 403, String(sciUp));
const anon = await fetch(`${BASE}/api/update/upload`, { method: "POST", body: "x" });
check("an upload without signing in is refused (401)", anon.status === 401, String(anon.status));
const cookie = (await admin.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const csrf = await fetch(`${BASE}/api/update/upload`, { method: "POST", body: "x", headers: { cookie, origin: "http://evil.example" } });
check("an upload sent from another website is refused, even with the admin's session (CSRF)", csrf.status === 403, String(csrf.status));

// Admin view, forged package
await admin.goto(`${BASE}/update`, { waitUntil: "domcontentloaded" });
let t = await admin.locator("main").innerText();
const installed = (t.match(/Installed version\s*([\d.]+)/) ?? [])[1];
check("admin sees the installed version and that the updater is running", !!installed && t.includes("Running"), installed);
t = await upload(admin, path.join(DIR, `TAMPERED-${app}-${GOOD}.mlup`));
check("a tampered package is refused with a clear reason", /signature|damaged|altered/i.test(t) && !t.includes(`Install version ${GOOD} now`));

// Good update
t = await upload(admin, pkg(GOOD));
check(`the genuine ${GOOD} package is verified and waits for install`, t.includes("genuine and ready") && t.includes(`Version ${GOOD}`));
let s = await installAndWait(admin, GOOD);
check(`version ${GOOD} installed: the app came back by itself`, s?.state === "done", s?.message);
await admin.goto(`${BASE}/update`, { waitUntil: "domcontentloaded" });
t = await admin.locator("main").innerText();
check(`the app now reports version ${GOOD}`, new RegExp(`Installed version\\s*${GOOD.replace(/\./g, "\\.")}`).test(t));
check("patients, requests and results are all still there", counts() === before, `${before} → ${counts()}`);
check("existing sessions survive the update (still signed in)", !admin.url().includes("/login"));

// Downgrade
t = await upload(admin, pkg(GOOD));
check("installing the same version again is refused (no downgrades)", /isn't newer/.test(t));

// Broken update rolls back
if (BROKEN) {
  t = await upload(admin, pkg(BROKEN));
  check(`the broken ${BROKEN} package is genuine, so it's accepted for install`, t.includes(`Version ${BROKEN}`));
  s = await installAndWait(admin, BROKEN);
  check(`${BROKEN} failed to build and was rolled back automatically`, s?.state === "rolled_back", s?.message);
  const r = await fetch(`${BASE}/login`);
  check(`the lab is running again on ${GOOD}`, r.status === 200 && JSON.parse(fs.readFileSync("package.json", "utf8")).version === GOOD);
  check("the broken file isn't left behind", !fs.existsSync("lib/zz-broken.ts"));
  check("data still intact after the rollback", counts() === before);
}
await admin.goto(`${BASE}/update`, { waitUntil: "domcontentloaded" });
t = await admin.locator("main").innerText();
check("the update history shows the checks, the install and the rollback", /verified/.test(t) && /installed and running/.test(t) && (!BROKEN || /restored automatically/.test(t)));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} update checks passed`);
process.exit(passed === results.length ? 0 : 1);
