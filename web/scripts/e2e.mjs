// End-to-end workflow through the real UI in Chrome, with several staff signed in at once.
//   node scripts/e2e.mjs        (server must be running on :3000)
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const users = JSON.parse(fs.readFileSync("seed/demo-users.json", "utf8")).users;
const pw = (u) => users.find((x) => x.username === u).password;
const results = [];
const check = (label, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  · " + extra : ""}`); };
const isoDay = ((new Date().getUTCDay() + 6) % 7) + 1; // the lab runs on WAT; close enough for the roster day except near midnight
const ON_DUTY_TODAY = { 1: "taenia.solium", 2: "taenia.solium", 3: "taenia.solium", 4: "creatinin.jaffe", 5: "creatinin.jaffe", 6: "creatinin.jaffe", 7: null }[isoDay];
const OFF_DUTY_TODAY = isoDay <= 3 ? "creatinin.jaffe" : "taenia.solium";

const browser = await chromium.launch({ channel: "chrome", headless: true });
async function session(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000); // this PC has 2 cores; the server answers in < 0.5 s but the test browser can be starved of CPU
  const goto = page.goto.bind(page);
  // Lab pages are interactive only once React has hydrated; the live indicator connecting is the signal.
  page.goto = async (url, opts) => { const r = await goto(url, { waitUntil: "domcontentloaded", timeout: 180000, ...opts }); if (!url.endsWith("/login")) await ready(page); return r; };
  page.on("pageerror", (e) => check(`no page errors (${user})`, false, e.message));
  await page.goto(`${BASE}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pw(user));
  await Promise.all([page.waitForURL("**/dashboard", { waitUntil: "commit", timeout: 180000 }), page.click("button[type=submit]")]);
  return page;
}
// Read-only look at the lab database, to confirm what the screens claim (stock, prices).
const sql = (q, ...a) => { const d = new DatabaseSync("var/mitochronai.db", { readOnly: true }); try { return d.prepare(q).all(...a); } finally { d.close(); } };
const testsLeft = (reagent) => { const r = sql("SELECT SUM(kits_in_stock) k, SUM(open_tests_left) o, MAX(g.tests_per_kit) n FROM reagent_lots JOIN reagents g ON g.id = reagent_id WHERE reagent_id = ? AND qa_status = 'accepted'", reagent)[0]; return r.k * r.n + r.o; };
const naira = (t, label) => Number((t.match(new RegExp(`${label}\\s*₦([\\d,]+)`)) ?? [, "NaN"])[1].replace(/,/g, ""));
async function fillFbc(page, hb) {
  for (const [k, v] of Object.entries({ HB: hb, PCV: "40", RBC: "4.5", WBC: "6.1", NEUT: "60", LYMPH: "30", MONO: "6", EOS: "3", BASO: "1", PLT: "250" })) await page.fill(`#r_${k}`, v);
}
async function ready(page) { await page.waitForSelector(".live[data-state=open]", { timeout: 90000 }).catch(() => {}); }
const local = (d) => new Date(d.getTime() + 3600000).toISOString().slice(0, 16);
const text = async (page) => { await page.waitForSelector("main h1", { timeout: 180000 }); await page.waitForTimeout(300); return page.locator("main").innerText(); };

if (!ON_DUTY_TODAY) { console.log("Sunday: the lab is closed, so the roster scenarios can't run today."); process.exit(0); }
const onDuty = await session(ON_DUTY_TODAY);
const offDuty = await session(OFF_DUTY_TODAY);
const chief = await session("gram.stain");
check("three staff signed in at once", true, `${ON_DUTY_TODAY}, ${OFF_DUTY_TODAY}, gram.stain`);

// 1. New patient + lipid profile + FBG, entered by the scientist on duty → Gaya drafts a report.
const stamp = Date.now().toString().slice(-5);
await onDuty.goto(`${BASE}/requests/new?mode=new`);
await onDuty.fill("#full_name", `Test Ward ${stamp}`);
await onDuty.selectOption("#sex", "F");
await onDuty.fill("#date_of_birth", "1990-05-14");
await onDuty.fill("#phone", "0800 000 9999");
await onDuty.fill("#email", `ward${stamp}@example.com`);
await onDuty.check("#panel-LIPID"); await onDuty.check("#panel-FBG");
await onDuty.fill("#requested_by", "Dr A. Example");
await onDuty.fill("#fasting_hours", "12");
await onDuty.fill("#collected_at", local(new Date(Date.now() - 90 * 60000)));
await Promise.all([onDuty.waitForURL(/\/enter$/, { timeout: 180000 , waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
await ready(onDuty);
const orderId = onDuty.url().split("/orders/")[1].split("/")[0];
check("new patient registered and request created", /ORD-\d+/.test(orderId), orderId);
check("LDL and TC/HDL are not typed (calculated)", (await onDuty.locator("#r_LDL").count()) === 0 && (await onDuty.locator("#r_TCHDL").count()) === 0);
const lipidStockBefore = ["RG-GLU", "RG-CHOL", "RG-HDL", "RG-TG"].map(testsLeft);
await onDuty.fill("#r_TC", "6.2"); await onDuty.fill("#r_HDL", "1.1"); await onDuty.fill("#r_TG", "1.8"); await onDuty.fill("#r_FBG", "5.4");
await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${orderId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
let t = await text(onDuty);
check("all checks pass → awaiting approval", t.includes("Every check passed") && t.includes("Awaiting approval"));
check("server calculated LDL by Friedewald (6.2 − 1.1 − 1.8/2.2 = 4.3)", /LDL Cholesterol[\s\S]{0,40}4\.3/.test(t));
check("TC 6.2 flagged high", /Total Cholesterol[\s\S]{0,80}\bH\b/.test(t));
check("Gaya drafted report v1 and attached it", t.includes("Draft v1") && t.includes("_Result.pdf"));
const lipidStockAfter = ["RG-GLU", "RG-CHOL", "RG-HDL", "RG-TG"].map(testsLeft);
check("one test each of glucose, cholesterol, HDL and TG reagent used", lipidStockAfter.every((v, i) => v === lipidStockBefore[i] - 1), lipidStockAfter.map((v, i) => lipidStockBefore[i] - v).join(","));
check("Gaya checked the reagent lots used", t.includes("accepted by QA and in date"));

// 2. The same scientist mistypes a value → plausibility guard.
const r2 = await onDuty.goto(`${BASE}/requests/new?mode=existing`);
await onDuty.selectOption("#patient_id", await onDuty.locator("#patient_id option", { hasText: `Test Ward ${stamp}` }).getAttribute("value"));
await onDuty.check("#panel-FBC");
await Promise.all([onDuty.waitForURL(/\/enter$/, { timeout: 180000 , waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
await ready(onDuty);
const fbcId = onDuty.url().split("/orders/")[1].split("/")[0];
await fillFbc(onDuty, "132");
await Promise.all([onDuty.waitForURL(/error=/, { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
check("Hb of 132 g/dL refused as a likely typing error", (await text(onDuty)).includes("outside the plausible range"));

// 3. Scientist who is NOT on today's roster enters it → Gaya holds it.
await offDuty.goto(`${BASE}/orders/${fbcId}/enter`);
await fillFbc(offDuty, "13.2");
await Promise.all([offDuty.waitForURL(new RegExp(`/orders/${fbcId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), offDuty.click("text=Save and send to Gaya")]);
t = await text(offDuty);
check("off-roster entry is held by Gaya", t.includes("Gaya is holding this request") && t.includes("was NOT on duty"));
await chief.goto(`${BASE}/gaya`);
check("held request appears on the chief's 'Held by Gaya' page", (await text(chief)).includes(`Test Ward ${stamp}`));
check("held request can't be approved", await chief.goto(`${BASE}/orders/${fbcId}`).then(() => chief.locator("button:has-text('Approve and send')").isDisabled()));
// The scientist on duty re-enters it → passes.
await onDuty.goto(`${BASE}/orders/${fbcId}/enter`);
await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${fbcId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
t = await text(onDuty);
check("corrected by the scientist on duty → released from hold", t.includes("Every check passed"));
check("MCV, MCH and MCHC calculated from Hb, PCV and RBC (88.9 / 29.3 / 33)", /Mean Cell Volume[\s\S]{0,30}88\.9/.test(t) && /Mean Cell Haemoglobin\s[\s\S]{0,30}29\.3/.test(t) && /Concentration[\s\S]{0,30}33/.test(t));
check("white-cell differential adds up to 100 %", t.includes("adds up to 100 %"));

// 4. Mantoux read too early → held.
await onDuty.goto(`${BASE}/requests/new?mode=existing`);
await onDuty.selectOption("#patient_id", await onDuty.locator("#patient_id option", { hasText: `Test Ward ${stamp}` }).getAttribute("value"));
await onDuty.check("#panel-MANTOUX");
await onDuty.fill("#collected_at", local(new Date(Date.now() - 30 * 3600000)));
await Promise.all([onDuty.waitForURL(/\/enter$/, { timeout: 180000 , waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
await ready(onDuty);
const mxId = onDuty.url().split("/orders/")[1].split("/")[0];
await onDuty.fill("#r_MANTOUX", "7");
await onDuty.fill("#read_at", local(new Date()));
await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${mxId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
check("Mantoux read at 30 h is held (window 48–72 h)", /Mantoux read at 30\.\d h/.test(await text(onDuty)) && (await text(onDuty)).includes("Held by Gaya"));

// 5. Chief: preview → approve the lipid report. Live update reaches the scientist.
await chief.goto(`${BASE}/orders/${orderId}`);
check("chief: approve locked before preview", await chief.locator("button:has-text('Approve and send')").isDisabled());
await chief.goto(`${BASE}/orders/${orderId}/report`);
check("report preview shows DRAFT and the patient's name", (await chief.content()).includes("DRAFT") && (await text(chief)).includes(`Test Ward ${stamp}`));
await onDuty.goto(`${BASE}/orders/${orderId}`);
// The scientist already has the record open and connected, as in real use. (If a change lands while the feed is still
// connecting, the page catches up on connect; that path is covered by a separate timing diagnostic.)
await onDuty.waitForSelector(".live[data-state=open]", { timeout: 180000 });
const revenueBefore = await (async () => { const p = await chief.context().newPage(); await p.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 180000 }); await p.waitForSelector("main h1"); const v = naira(await p.locator("main").innerText(), "Revenue this month"); await p.close(); return v; })();
await Promise.all([chief.waitForURL(/approved=1/, { waitUntil: "commit", timeout: 180000 }), chief.click("button:has-text('Approve and send')")]);
check("chief approved and sent from the preview", (await text(chief)).includes("Approved"));
const liveAt = Date.now();
const live = await onDuty.waitForFunction(() => document.querySelector("main")?.innerText.includes("Approved by"), null, { timeout: 10000 }).then(() => true, () => false);
check("scientist's open record updated live to Released", live, live ? `${Date.now() - liveAt} ms` : "not within 10 s");

// 6. Reject a sample.
await onDuty.goto(`${BASE}/orders/${mxId}`);
await onDuty.click("summary:has-text('Reject the sample')");
await onDuty.selectOption("#reason", "Sample too old");
// Not "networkidle": the live feed keeps a connection open on purpose, so the network never goes quiet.
await onDuty.click("button:has-text('Reject sample')");
await onDuty.waitForFunction(() => document.querySelector("main")?.innerText.includes("Sample rejected"), null, { timeout: 180000 }).catch(() => {});
check("sample rejected with a reason", (await text(onDuty)).includes("Sample rejected") && (await text(onDuty)).includes("Sample too old"));

// 7. QC: a value 3.5 SD high → Westgard 1-3s rejection.
await onDuty.goto(`${BASE}/qc?c=TC|L1`);
await onDuty.selectOption("#control", "TC|L1");
await onDuty.fill("#value", "4.42");
await Promise.all([onDuty.waitForURL(/recorded=/, { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Record run")]);
t = await text(onDuty);
check("QC 4.42 on TC L1 (target 4.0 ± 0.12) rejected by 1-3s", t.includes("Run rejected") && t.includes("1-3s"));

// 8. Settings: scientists can't change; chief can, and it's audited.
await onDuty.goto(`${BASE}/settings`);
check("scientist has no Settings link and can't save", (await onDuty.locator("nav >> text=Settings").count()) === 0 && (await onDuty.locator("button:has-text('Save settings')").count()) === 0);
await chief.goto(`${BASE}/settings`);
await chief.check("#m-byo");
await Promise.all([chief.waitForURL(/saved=1/, { waitUntil: "commit", timeout: 180000 }), chief.click("button:has-text('Save settings')")]);
await chief.goto(`${BASE}/audit`);
t = await text(chief);
check("audit log records the model change, approvals, holds, QC and rejection",
  ["settings.model", "report.approved", "discrepancy.raised", "qc.rejected", "sample.rejected", "patient.registered"].every((a) => t.includes(a)));
await chief.goto(`${BASE}/settings`); await chief.check("#m-local");
await Promise.all([chief.waitForURL(/saved=1/, { waitUntil: "commit", timeout: 180000 }), chief.click("button:has-text('Save settings')")]);

// 9. Dashboard renders with live numbers.
await chief.goto(`${BASE}/dashboard`);
t = await text(chief);
check("dashboard shows KPIs, charts, QC and activity", ["Requests", "Median turnaround", "Requests per day", "Quality control", "Recent activity"].every((s) => t.includes(s)));

// 10. The logo takes everyone back to the dashboard.
await onDuty.goto(`${BASE}/qc`);
await Promise.all([onDuty.waitForURL("**/dashboard", { waitUntil: "commit", timeout: 180000 }), onDuty.click("a.rail-brand")]);
check("clicking the logo opens the dashboard", onDuty.url().endsWith("/dashboard"));

// 11. Revenue counts the approved request at the price it was made at.
await chief.goto(`${BASE}/dashboard`);
t = await text(chief);
const lipidValue = sql("SELECT SUM(price_ngn) v FROM order_panels WHERE order_id = ?", orderId)[0].v;
const revenueAfter = naira(t, "Revenue this month");
check("chief sees revenue, tests done and kits available", ["Revenue this month", "Tests done this month", "Kits available"].every((x) => t.includes(x)));
check("approving the lipid + FBG request added its price to this month's revenue", revenueAfter - revenueBefore === lipidValue, `+₦${revenueAfter - revenueBefore} (request worth ₦${lipidValue})`);

// 12. Scientists can't see the money or the stock counts, even by typing the address.
await onDuty.goto(`${BASE}/dashboard`);
t = await text(onDuty);
check("scientist's dashboard has no revenue, tests-done or kit figures", !t.includes("Revenue this month") && !t.includes("Kits available") && !t.includes("₦"));
check("scientist has no Prices link", (await onDuty.locator("nav >> text=Prices").count()) === 0);
await onDuty.goto(`${BASE}/pricing`);
check("scientist typing /pricing is sent back to the dashboard", onDuty.url().includes("/dashboard?denied=prices") && (await text(onDuty)).includes("chief scientist and administrators only"));
await onDuty.goto(`${BASE}/inventory`);
t = await text(onDuty);
check("scientist sees lots, expiry and QA status but no quantities or costs", t.includes("Reagents and kits") && t.includes("Accepted") && !t.includes("Usable tests") && !t.includes("Cost / test") && !t.includes("₦") && (await onDuty.locator("#lot_no").count()) === 0);
await onDuty.goto(`${BASE}/requests/new?mode=existing`);
check("scientist's test picker shows no prices", !(await text(onDuty)).includes("₦"));

// 13. Chief edits a price: saved, audited, and only new requests use it.
await chief.goto(`${BASE}/pricing`);
const mpOld = Number(await chief.inputValue("#price_MP"));
await chief.fill("#price_MP", String(mpOld + 500));
await Promise.all([chief.waitForURL(/saved=/, { waitUntil: "commit", timeout: 180000 }), chief.click("button:has-text('Save and confirm all prices')")]);
t = await text(chief);
check("chief saved a new malaria-film price and every price is now confirmed", t.includes("Price list saved") && !t.includes("starter prices that nobody has confirmed") && Number(await chief.inputValue("#price_MP")) === mpOld + 500);
await chief.goto(`${BASE}/audit`);
check("price change is in the audit log with old and new value", (await text(chief)).includes(`₦${mpOld.toLocaleString("en-NG")} → ₦${(mpOld + 500).toLocaleString("en-NG")}`));
check("existing requests keep their original price", sql("SELECT SUM(price_ngn) v FROM order_panels WHERE order_id = ?", orderId)[0].v === lipidValue);

// 14. The administrator has the same business view, but still can't approve results.
const admin = await session("lab.admin");
await admin.goto(`${BASE}/dashboard`);
check("administrator sees the business figures", (await text(admin)).includes("Revenue this month"));
await admin.goto(`${BASE}/pricing`);
check("administrator can open and edit prices", (await admin.locator("#price_FBC").count()) === 1 && (await admin.locator("button:has-text('Save and confirm all prices')").count()) === 1);
const pendingId = sql("SELECT id FROM orders WHERE status = 'awaiting_approval' ORDER BY id DESC LIMIT 1")[0]?.id;
if (pendingId) { await admin.goto(`${BASE}/orders/${pendingId}`); check("administrator can't approve results", await admin.locator("button:has-text('Approve and send')").isDisabled()); }

// 15. Many tests in one request: dipstick + culture + Widal + HBsAg + E/U/Cr, with the new result types.
await onDuty.goto(`${BASE}/requests/new?mode=existing`);
await onDuty.selectOption("#patient_id", await onDuty.locator("#patient_id option", { hasText: `Test Ward ${stamp}` }).getAttribute("value"));
await onDuty.fill("input[type=search]", "widal");
check("test search narrows the list", await onDuty.locator("#panel-WIDAL").isVisible() && !(await onDuty.locator("#panel-FBC").isVisible()));
await onDuty.fill("input[type=search]", "");
for (const c of ["URINE", "URINEMCS", "WIDAL", "HBSAG", "EUCR"]) await onDuty.check(`#panel-${c}`);
await Promise.all([onDuty.waitForURL(/\/enter$/, { timeout: 180000, waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
await ready(onDuty);
const multiId = onDuty.url().split("/orders/")[1].split("/")[0];
const fillMulti = async (org) => {
  for (const [k, v] of Object.entries({ U_APP: "Slightly turbid", U_PRO: "Trace", U_GLU: "Negative", U_KET: "Negative", U_BLD: "Negative", U_BIL: "Negative", U_URO: "Normal", U_NIT: "Positive", U_LEU: "2+",
    URINE_CUL: "Significant growth", WID_TO: "1/160", WID_TH: "1/80", WID_AO: "< 1/20", WID_AH: "1/20", WID_BO: "1/40", WID_BH: "< 1/20", WID_CO: "< 1/20", WID_CH: "< 1/20" })) await onDuty.selectOption(`#r_${k}`, v);
  await onDuty.selectOption("#r_HBSAG", "NEG");
  for (const [k, v] of Object.entries({ U_PH: "6.0", U_SG: "1.020", NA: "139", K: "4.1", CL: "101", HCO3: "25", UREA: "4.2", CREA: "70" })) await onDuty.fill(`#r_${k}`, v);
  await onDuty.fill("#r_URINE_MIC", "Pus cells 20-25/hpf, red cells 2-4/hpf, bacteria seen");
  await onDuty.fill("#r_URINE_ORG", org);
  await onDuty.fill("#r_URINE_AST", org ? "Nitrofurantoin S; Ciprofloxacin R; Ceftriaxone S" : "");
};
await fillMulti("");
await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${multiId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
t = await text(onDuty);
check("culture with growth but no organism or sensitivity is held", t.includes("Held by Gaya") && t.includes("culture shows growth but the organism and sensitivity are missing"));
await onDuty.goto(`${BASE}/orders/${multiId}/enter`);
await fillMulti("Escherichia coli > 10^5 CFU/mL");
await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${multiId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
t = await text(onDuty);
const age = (() => { const b = new Date("1990-05-14"), a = new Date(); let y = a.getFullYear() - b.getFullYear(); if (a < new Date(a.getFullYear(), b.getMonth(), b.getDate())) y--; return y; })();
const scr = 70 / 88.4 / 0.7, egfr = Math.round(142 * Math.min(scr, 1) ** -0.241 * Math.max(scr, 1) ** -1.2 * 0.9938 ** age * 1.012);
check("organism and sensitivity added → every check passes", t.includes("Every check passed"));
check(`eGFR calculated by CKD-EPI 2021 (${egfr} for a ${age}-year-old woman, creatinine 70)`, new RegExp(`eGFR[\\s\\S]{0,40}${egfr}`).test(t));
check("Widal 1/160 and nitrite positive flagged abnormal; HBsAg shows its label", /S\. Typhi O[\s\S]{0,30}1\/160[\s\S]{0,40}\bA\b/.test(t) && /Nitrite[\s\S]{0,30}Positive[\s\S]{0,40}\bA\b/.test(t) && /surface antigen[\s\S]{0,60}Non-reactive/.test(t));
check("culture report text kept as written", t.includes("Escherichia coli > 10^5 CFU/mL") && t.includes("Ciprofloxacin R"));

// 16. A result made with an expired lot is held. (Arrange: the in-date Widal lot runs out, leaving only the expired one.)
const widalGood = sql("SELECT id, kits_in_stock, open_tests_left FROM reagent_lots WHERE reagent_id = 'RG-WIDAL' AND lot_no = 'WD2608'")[0];
const rw = new DatabaseSync("var/mitochronai.db"); rw.prepare("UPDATE reagent_lots SET kits_in_stock = 0, open_tests_left = 0 WHERE id = ?").run(widalGood.id); rw.close();
try {
  await onDuty.goto(`${BASE}/requests/new?mode=existing`);
  await onDuty.selectOption("#patient_id", await onDuty.locator("#patient_id option", { hasText: `Test Ward ${stamp}` }).getAttribute("value"));
  await onDuty.check("#panel-WIDAL");
  await Promise.all([onDuty.waitForURL(/\/enter$/, { timeout: 180000, waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
  await ready(onDuty);
  const wId = onDuty.url().split("/orders/")[1].split("/")[0];
  for (const k of ["WID_TO", "WID_TH", "WID_AO", "WID_AH", "WID_BO", "WID_BH", "WID_CO", "WID_CH"]) await onDuty.selectOption(`#r_${k}`, "< 1/20");
  await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${wId}[?](saved|held)=1`), { waitUntil: "commit", timeout: 180000 }), onDuty.click("text=Save and send to Gaya")]);
  t = await text(onDuty);
  check("Widal run on an expired lot is held by Gaya", t.includes("Held by Gaya") && t.includes("lot WD2602: expired on 2026-09-30"));
} finally {
  const rw2 = new DatabaseSync("var/mitochronai.db"); rw2.prepare("UPDATE reagent_lots SET kits_in_stock = ?, open_tests_left = ? WHERE id = ?").run(widalGood.kits_in_stock, widalGood.open_tests_left, widalGood.id); rw2.close();
}

// 17. A delivery goes into quarantine; the chief accepts it after verification.
const lotNo = `HC${stamp}`;
await chief.goto(`${BASE}/inventory`);
await chief.selectOption("#reagent_id", "RG-HCV");
await chief.fill("#lot_no", lotNo); await chief.fill("#expiry", "2028-06-30"); await chief.fill("#kits", "3"); await chief.fill("#cost", "18,000");
await Promise.all([chief.waitForURL(/received=1/, { waitUntil: "commit", timeout: 180000 }), chief.click("button:has-text('Record delivery')")]);
t = await text(chief);
check("delivery recorded and the new lot is in quarantine", t.includes("Delivery recorded") && sql("SELECT qa_status FROM reagent_lots WHERE lot_no = ?", lotNo)[0]?.qa_status === "quarantine");
const qaForm = chief.locator("form.qa-form", { hasText: lotNo });
await qaForm.locator("input[name=note]").fill("QC L1 and L2 within limits; 5 patient samples agree with the previous lot");
await Promise.all([chief.waitForURL(/qa=accepted/, { waitUntil: "commit", timeout: 180000 }), qaForm.locator("button:has-text('Accept lot')").click()]);
check("chief accepted the lot after new-lot verification", sql("SELECT qa_status FROM reagent_lots WHERE lot_no = ?", lotNo)[0]?.qa_status === "accepted");

// ── Lab-admin iteration 1 ─────────────────────────────────────────────────
const fresh = async () => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(180000); return p; };
const signInAs = async (p, user, password) => {
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.fill("#username", user); await p.fill("#password", password);
  // Wait for the sign-in request itself: the page is already on /login, so waiting for a URL would return at once.
  const [resp] = await Promise.all([p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"), p.click("button[type=submit]")]);
  // The server says where it's sending the browser ("/account;push"); wait until we're exactly there.
  const target = (resp.headers()["x-action-redirect"] ?? "").split(";")[0];
  if (target) await p.waitForURL((u) => u.pathname + u.search === target, { waitUntil: "commit" });
  await p.waitForLoadState("domcontentloaded");
  await p.waitForTimeout(300);
};

// 18. Staff management: the administrator adds a scientist, who must replace the temporary password.
// The passphrase shares nothing with the username (the policy rightly refuses passwords containing it).
const newUser = `e2e.${stamp}`, newPass = "green mango by the window";
await admin.goto(`${BASE}/staff`);
await admin.fill("#display_name", `Sct. E2E ${stamp}`); await admin.fill("#username", newUser);
await Promise.all([admin.waitForURL(/note=/, { waitUntil: "commit" }), admin.click("button:has-text('Add person')")]);
const temp = (await admin.locator(".notice.secret .mono").innerText()).trim();
check("administrator adds a person and sees a one-time temporary password", /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(temp) && !admin.url().includes(temp));
const noteUrl = admin.url();
await chief.goto(noteUrl.replace(/^.*\/staff/, `${BASE}/staff`), { waitUntil: "domcontentloaded" });
check("another manager opening the same link doesn't see the temporary password", !(await chief.locator("main").innerText()).includes(temp));
const newId = sql("SELECT id FROM staff WHERE username = ?", newUser)[0].id;
await admin.goto(`${BASE}/staff`);
const dayBox = admin.locator(`#d-${newId}-${isoDay}`);
await dayBox.check();
await Promise.all([admin.waitForURL(/saved=1/, { waitUntil: "commit" }), dayBox.locator("xpath=ancestor::form").locator("button:has-text('Save')").click()]);
check("roster saved for the new person (today)", sql("SELECT weekday FROM duty_roster WHERE staff_id = ?", newId).map((r) => r.weekday).join() === String(isoDay));

const nu = await fresh();
await signInAs(nu, newUser, temp);
check("signing in with a temporary password goes straight to 'set your own password'", nu.url().endsWith("/account") && (await nu.locator("main").innerText()).includes("temporary password"));
await nu.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
check("every other page sends them back to the account page", nu.url().endsWith("/account"));
const evStatus = await nu.evaluate(async (b) => (await fetch(`${b}/api/events`)).status, BASE);
check("the live feed refuses them too (403) until they choose a password", evStatus === 403, String(evStatus));
check("the browser itself won't submit a new password under 15 characters", (await nu.getAttribute("#next", "minlength")) === "15");
await nu.fill("#current", temp); await nu.fill("#next", "aaaaaaaaaaaaaaaaaaaa"); await nu.fill("#confirm", "aaaaaaaaaaaaaaaaaaaa");
await Promise.all([nu.waitForURL(/error=/, { waitUntil: "commit" }), nu.click("button:has-text('Save password')")]);
check("the server refuses a long but predictable password, with guidance", (await nu.locator("main").innerText()).includes("too common or too predictable"));
await nu.fill("#current", temp); await nu.fill("#next", newPass); await nu.fill("#confirm", newPass);
await Promise.all([nu.waitForURL(/dashboard/, { waitUntil: "commit" }), nu.click("button:has-text('Save password')")]);
check("after choosing a passphrase they reach the dashboard", nu.url().includes("/dashboard?password=changed"));
await nu.context().close();

// 19. Lock-out: five wrong passwords lock the account, even against the right one; the administrator unlocks it.
const lk = await fresh();
for (let i = 0; i < 5; i++) await signInAs(lk, newUser, `wrong password number ${i}`);
await signInAs(lk, newUser, newPass);
t = await lk.locator("main").innerText();
check("after 5 failures even the right password is refused for now", lk.url().includes("error=locked") && t.includes("Too many attempts"));
await signInAs(lk, `nobody.${stamp}`, "x");
const unknownMsg = await lk.locator(".notice[role=alert]").innerText();
check("an unknown username gets the same wording as a wrong password (no account discovery)", unknownMsg.includes("didn't match") || unknownMsg.includes("didn’t match"));
await admin.goto(`${BASE}/staff`);
const row = admin.locator("tr", { hasText: `Sct. E2E ${stamp}` });
check("the administrator sees the account as locked", (await row.innerText()).includes("Locked"));
await Promise.all([admin.waitForURL(/saved=1/, { waitUntil: "commit" }), row.locator("button:has-text('Unlock')").click()]);
await signInAs(lk, newUser, newPass);
check("after unlocking, the right password works", lk.url().includes("/dashboard"));
await lk.context().close();

// 20. Least privilege: a scientist can't reach staff, the audit log or its export, even by typing the address.
for (const path of ["/staff", "/audit"]) {
  await onDuty.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  check(`scientist typing ${path} is sent back to the dashboard`, onDuty.url().includes("/dashboard?denied="));
}
const sciCsv = await onDuty.evaluate(async (b) => (await fetch(`${b}/api/audit.csv`)).status, BASE);
check("scientist gets 403 from the audit export", sciCsv === 403, String(sciCsv));
await onDuty.goto(`${BASE}/dashboard`);
check("scientist's activity feed shows no prices", !(await onDuty.locator("main").innerText()).includes("₦"));

// 21. Audit search and export for the chief.
await chief.goto(`${BASE}/audit?action=price.changed`);
t = await chief.locator("section[aria-label='Audit entries'] tbody").innerText(); // the table only: the filter dropdown lists every action
check("chief filters the audit log to price changes", t.includes("price.changed") && !t.includes("results.entered"));
const csv = await chief.evaluate(async (b) => { const r = await fetch(`${b}/api/audit.csv?action=price.changed`); return { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), cache: r.headers.get("cache-control"), body: await r.text() }; }, BASE);
check("CSV export downloads with safe headers", csv.status === 200 && csv.type.startsWith("text/csv") && /attachment; filename="mitochronai-audit-/.test(csv.disp) && csv.cache.includes("no-store") && csv.body.replace(/^﻿/, "").startsWith("Time (Lagos),Who,Action,Entity,Detail"), `${csv.status} ${csv.type}`);
check("the export itself is in the audit log", sql("SELECT COUNT(*) n FROM audit_log WHERE action = 'audit.exported' AND actor_id = 'STF-001'")[0].n >= 1);

// 22. Critical result: held until phoned with read-back, then released for approval.
await onDuty.goto(`${BASE}/requests/new?mode=existing`);
await onDuty.selectOption("#patient_id", await onDuty.locator("#patient_id option", { hasText: `Test Ward ${stamp}` }).getAttribute("value"));
await onDuty.check("#panel-FBC");
await Promise.all([onDuty.waitForURL(/\/enter$/, { waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
await ready(onDuty);
const critId = onDuty.url().split("/orders/")[1].split("/")[0];
await fillFbc(onDuty, "6.5");
await Promise.all([onDuty.waitForURL(new RegExp(`/orders/${critId}[?](saved|held)=1`), { waitUntil: "commit" }), onDuty.click("text=Save and send to Gaya")]);
t = await text(onDuty);
check("critical Hb 6.5 is held until it's phoned", t.includes("Critical result call") && t.includes("Call needed") && t.includes("not yet phoned"));
await onDuty.fill("#called_name", "Dr A. Example");
await onDuty.check("#read_back");
await Promise.all([onDuty.waitForURL(/called=1/, { waitUntil: "commit" }), onDuty.click("button:has-text('Record the call')")]);
t = await text(onDuty);
const checksNow = await onDuty.locator("section[aria-labelledby=h-chk]").innerText(); // current checks, not the history (which keeps the old hold)
check("after the call (read back) the request is released for approval", t.includes("Phoned") && t.includes("Awaiting approval") && !checksNow.includes("HOLD") && checksNow.includes("phoned to Dr A. Example"));
check("the call is in the request's history and the audit log", t.includes("read back") && sql("SELECT COUNT(*) n FROM audit_log WHERE action = 'critical.called' AND entity_id = ?", critId)[0].n === 1);

// 23. Turnaround: overdue requests are visible and filterable.
await chief.goto(`${BASE}/worklist?status=overdue`);
t = await chief.locator("main").innerText();
const overdueN = Number((t.match(/Overdue\s*(\d+)/) ?? [])[1]);
check("worklist 'Overdue' filter lists late requests with how late they are", Number.isInteger(overdueN) && (overdueN === 0 || / late/.test(t)), `${overdueN} overdue`);
await chief.goto(`${BASE}/dashboard`);
check("dashboard shows the overdue count", (await chief.locator("main").innerText()).includes("Overdue now"));

// 24. Unsaved work: leaving the entry form with typed results asks first.
await onDuty.goto(`${BASE}/requests/new?mode=existing`);
await onDuty.selectOption("#patient_id", await onDuty.locator("#patient_id option", { hasText: `Test Ward ${stamp}` }).getAttribute("value"));
await onDuty.check("#panel-FBG");
await Promise.all([onDuty.waitForURL(/\/enter$/, { waitUntil: "commit" }), onDuty.click("text=Create request and enter results")]);
await ready(onDuty);
await onDuty.fill("#r_FBG", "5.2");
let asked = "";
onDuty.once("dialog", async (d) => { asked = d.message(); await d.dismiss(); });
await onDuty.click("nav >> text=Dashboard");
await onDuty.waitForTimeout(1500);
check("leaving with unsaved results asks first, and staying keeps the page", asked.includes("aren't saved") && onDuty.url().endsWith("/enter"), asked.slice(0, 60));

// 25. Browser security headers: the app can't be framed by another site (clickjacking) and leaks no referrer.
const hdr = await chief.evaluate(async (b) => { const r = await fetch(`${b}/dashboard`); return Object.fromEntries(["x-frame-options", "content-security-policy", "referrer-policy", "x-content-type-options"].map((k) => [k, r.headers.get(k)])); }, BASE);
check("security headers present (no framing, no sniffing, no referrer)", hdr["x-frame-options"] === "DENY" && /frame-ancestors 'none'/.test(hdr["content-security-policy"] ?? "") && hdr["referrer-policy"] === "same-origin" && hdr["x-content-type-options"] === "nosniff", JSON.stringify(hdr).slice(0, 120));

// 26. Sign-in works before the page's scripts run (slow connections): a plain form post with JavaScript off.
const nojs = await (await browser.newContext({ javaScriptEnabled: false })).newPage(); nojs.setDefaultTimeout(180000);
await nojs.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await nojs.fill("#username", "gram.stain"); await nojs.fill("#password", pw("gram.stain"));
await Promise.all([nojs.waitForNavigation({ waitUntil: "domcontentloaded" }), nojs.click("button[type=submit]")]);
check("sign-in works as a plain form post, before any script has loaded", nojs.url().includes("/dashboard"), nojs.url().replace(BASE, ""));
await nojs.context().close();

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
