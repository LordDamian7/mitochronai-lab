import { criticalCheck } from "./critical";
import { audit, db, nowIso } from "./db";

// ── Row types ───────────────────────────────────────────────────────────────
export type Lab = { id: string; name: string; address: string; phone: string; working_days: string; opening_time: string; closing_time: string; assistant_name: string; comments_enabled: number; model_source: "local" | "byo" | "connect" };
export type Patient = { id: string; lab_patient_id: string; full_name: string; sex: "F" | "M"; date_of_birth: string; email: string; phone: string; risk_factors: string };
export type Order = { id: string; patient_id: string; requested_by: string; received_at: string; fasting_hours: number | null; status: string; reject_reason: string | null };
export type Result = { id: string; order_id: string; test_code: string; collected_at: string; tested_at: string | null; read_at: string | null; performed_by: string | null; value_numeric: number | null; value_text: string | null; unit: string | null; value_source: string | null; flag: string | null; status: string; approved_by: string | null; approved_at: string | null; released_at: string | null };
export type Catalog = { code: string; name: string; department: string; specimen: string; result_type: string; unit: string | null; ref_low: number | null; ref_high: number | null; ref_sex: string; ref_text: string; ref_source: string | null; calc_formula: string | null; options: string | null; plaus_low: number | null; plaus_high: number | null; optional: number };
export type Report = { id: number; order_id: string; version: number; status: "draft" | "final" | "superseded"; drafted_by: string; drafted_at: string; approved_by: string | null; approved_at: string | null; email_status: "drafted" | "sent"; email_sent_at: string | null };
export type Staff = { id: string; display_name: string; role: string };

export const lab = () => db().prepare("SELECT * FROM labs LIMIT 1").get() as Lab;
export const staffMap = () => Object.fromEntries((db().prepare("SELECT id, display_name, role FROM staff").all() as Staff[]).map((s) => [s.id, s]));
export const patient = (id: string) => db().prepare("SELECT * FROM patients WHERE id = ?").get(id) as Patient;
export const order = (id: string) => db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as Order | undefined;
export const resultsFor = (orderId: string) => db().prepare("SELECT * FROM results WHERE order_id = ? ORDER BY rowid").all(orderId) as Result[];
export const currentReport = (orderId: string) =>
  db().prepare("SELECT * FROM reports WHERE order_id = ? AND status != 'superseded' ORDER BY version DESC LIMIT 1").get(orderId) as Report | undefined;
export function catalogFor(code: string, sex: string): Catalog {
  const rows = db().prepare("SELECT * FROM test_catalog WHERE code = ?").all(code) as Catalog[];
  return rows.find((r) => r.ref_sex === sex) ?? rows[0];
}
export const hasPreviewed = (reportId: number, staffId: string) =>
  !!db().prepare("SELECT 1 FROM report_previews WHERE report_id = ? AND staff_id = ?").get(reportId, staffId);

// ── Gaya's deterministic checks (same rules as scripts/validate_data.py) ────
export type Check = { ok: boolean; text: string };
const isoDay = (iso: string) => { const d = new Date(iso); return ((d.getUTCDay() + 6) % 7) + 1; };

export function checksFor(o: Order): Check[] {
  const p = patient(o.patient_id), rs = resultsFor(o.id), staff = staffMap(), out: Check[] = [];
  const roster = new Set((db().prepare("SELECT staff_id, weekday FROM duty_roster").all() as { staff_id: string; weekday: number }[]).map((r) => `${r.staff_id}|${r.weekday}`));
  const by = Object.fromEntries(rs.map((r) => [r.test_code, r]));
  // Duty roster: one line per scientist and day, not one per test.
  const shifts = new Map<string, string[]>();
  for (const r of rs) if (r.performed_by && r.tested_at) {
    const k = `${r.performed_by}|${isoDay(r.tested_at)}|${r.tested_at.slice(0, 10)}`;
    shifts.set(k, [...(shifts.get(k) ?? []), r.test_code]);
  }
  for (const [k, tests] of shifts) {
    const [sid, wd, day] = k.split("|");
    const when = new Date(`${day}T12:00:00+01:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "Africa/Lagos" });
    const ok = roster.has(`${sid}|${wd}`);
    out.push({ ok, text: `Duty roster: ${staff[sid]?.display_name} ${ok ? "was on duty" : "was NOT on duty"} on ${when} (${tests.length === 1 ? tests[0] : `${tests.length} tests`})` });
  }
  // Units: a single line unless something disagrees with the catalogue.
  const withUnit = rs.filter((r) => r.unit);
  const wrongUnit = withUnit.filter((r) => r.unit !== catalogFor(r.test_code, p.sex).unit);
  if (withUnit.length) out.push(wrongUnit.length
    ? { ok: false, text: `Units: ${wrongUnit.map((r) => `${r.test_code} in ${r.unit}, catalogue says ${catalogFor(r.test_code, p.sex).unit}`).join("; ")}` }
    : { ok: true, text: `Units: all ${withUnit.length} match the test catalogue` });
  for (const r of rs) {
    if (r.test_code === "MANTOUX" && r.read_at) {
      const h = (Date.parse(r.read_at) - Date.parse(r.collected_at)) / 3.6e6, cut = p.risk_factors ? 5 : 10;
      out.push({ ok: h >= 48 && h <= 72, text: `Mantoux read at ${h.toFixed(1)} h (window 48–72 h)` });
      out.push({ ok: r.flag === ((r.value_numeric ?? 0) >= cut ? "POS" : "NEG"), text: `Mantoux ${r.value_numeric} mm judged at the ≥ ${cut} mm cut-off` });
    }
  }
  if (by.TC && by.HDL && by.TG && by.LDL) {
    const f = by.TC.value_numeric! - by.HDL.value_numeric! - by.TG.value_numeric! / 2.2;
    out.push({ ok: Math.abs(by.LDL.value_numeric! - f) <= 0.1, text: `LDL ${by.LDL.value_numeric} mmol/L agrees with Friedewald (${f.toFixed(1)})` });
  }
  // A white-cell differential has to account for every cell counted.
  const diff = ["NEUT", "LYMPH", "MONO", "EOS", "BASO"];
  if (diff.every((k) => by[k]?.value_numeric !== null && by[k]?.value_numeric !== undefined)) {
    const sum = diff.reduce((s, k) => s + by[k].value_numeric!, 0);
    out.push({ ok: Math.abs(sum - 100) <= 1, text: `White-cell differential adds up to ${Math.round(sum * 10) / 10} % (must be 100 % ± 1)` });
  }
  // A culture with significant growth needs the organism and its sensitivities before it can be reported.
  for (const r of rs) if (r.test_code.endsWith("_CUL") && r.value_text && /^(Significant growth|Growth)$/.test(r.value_text)) {
    const k = r.test_code.slice(0, -4), missing = [["_ORG", "organism"], ["_AST", "sensitivity"]].filter(([s]) => !by[k + s]?.value_text).map(([, n]) => n);
    out.push({ ok: !missing.length, text: missing.length ? `${catalogFor(r.test_code, p.sex).name.split(":")[0]} culture shows growth but the ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing` : `${catalogFor(r.test_code, p.sex).name.split(":")[0]} culture: organism and sensitivity recorded` });
  }
  // Critical values must be phoned (with read-back) before the report can be approved.
  const crit = criticalCheck(o.id);
  if (crit) out.push(crit);
  // Reagent lots used for this request: accepted by QA, in date, and inside the opened-kit stability.
  const used = db().prepare("SELECT c.*, g.name FROM reagent_consumption c JOIN reagents g ON g.id = c.reagent_id WHERE c.order_id = ? ORDER BY g.name").all(o.id) as { name: string; lot_no: string | null; problem: string | null }[];
  if (used.length) {
    const bad = used.filter((u) => u.problem);
    out.push(bad.length
      ? { ok: false, text: `Reagents: ${bad.map((u) => `${u.name}${u.lot_no ? ` lot ${u.lot_no}` : ""}: ${u.problem}`).join("; ")}` }
      : { ok: true, text: `Reagents: ${used.length === 1 ? `${used[0].name} lot ${used[0].lot_no}` : `${used.length} lots`} accepted by QA and in date` });
  }
  return out;
}

// ── Gaya drafts a report for every request whose checks pass ───────────────
export function ensureDrafts() {
  const d = db(), L = lab();
  const orders = d.prepare(`SELECT * FROM orders WHERE status IN ('awaiting_approval','released')
    AND id NOT IN (SELECT order_id FROM reports WHERE status != 'superseded')`).all() as Order[];
  for (const o of orders) {
    const rs = resultsFor(o.id);
    if (!rs.length || !checksFor(o).every((c) => c.ok)) continue;
    const prior = (d.prepare("SELECT MAX(version) v FROM reports WHERE order_id = ?").get(o.id) as { v: number | null }).v ?? 0;
    const benchDone = prior ? nowIso() : new Date(Math.max(...rs.map((r) => Date.parse(r.tested_at ?? r.collected_at))) + 3 * 60000).toISOString();
    if (o.status === "released") {
      const rel = Math.max(...rs.map((r) => Date.parse(r.released_at!)));
      d.prepare("INSERT INTO reports (order_id,version,status,drafted_by,drafted_at,approved_by,approved_at,email_status,email_sent_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(o.id, 1, "final", "gaya", benchDone, rs[0].approved_by, rs[0].approved_at, "sent", new Date(rel + 2 * 60000).toISOString());
    } else {
      d.prepare("INSERT INTO reports (order_id,version,status,drafted_by,drafted_at) VALUES (?,?,?,?,?)").run(o.id, prior + 1, "draft", "gaya", benchDone);
      audit({ type: "gaya", model: L.model_source }, "report.drafted",
        `${patient(o.patient_id).lab_patient_id}: checks passed; result report v${prior + 1} and e-mail drafted on the lab template and attached to the record`, "order", o.id);
    }
  }
}

/**
 * Re-run Gaya's checks after something other than result entry changed (for example a critical call was recorded):
 * a held request whose checks now all pass moves to awaiting approval, and Gaya drafts its report.
 */
export function reevaluate(orderId: string) {
  const o = order(orderId);
  if (!o || o.status !== "in_progress" || resultsFor(orderId).some((r) => r.status === "pending")) return;
  if (!checksFor(o).every((c) => c.ok)) return;
  const d = db();
  d.prepare("UPDATE orders SET status = 'awaiting_approval' WHERE id = ?").run(orderId);
  d.prepare("UPDATE results SET status = 'awaiting_approval' WHERE order_id = ?").run(orderId);
  audit({ type: "gaya", model: lab().model_source }, "discrepancy.resolved", `${patient(o.patient_id).lab_patient_id}: every check now passes; released from hold`, "order", orderId);
  ensureDrafts();
}

export function recordPreview(reportId: number, staffId: string) {
  const r = db().prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as Report | undefined;
  if (!r || r.status !== "draft" || hasPreviewed(reportId, staffId)) return false;
  db().prepare("INSERT INTO report_previews VALUES (?,?,?)").run(reportId, staffId, nowIso());
  audit({ type: "human", id: staffId }, "report.previewed", `Draft v${r.version} opened for review`, "order", r.order_id);
  return true;
}

/** The chief approves a previewed draft: results released, report final, e-mail sent. One transaction. */
export function approveAndSend(orderId: string, chiefId: string): { ok: true } | { ok: false; reason: string } {
  const d = db(), o = order(orderId), rep = currentReport(orderId);
  const chief = d.prepare("SELECT role, display_name FROM staff WHERE id = ? AND active = 1").get(chiefId) as { role: string; display_name: string } | undefined;
  if (!o || !rep) return { ok: false, reason: "No draft report for this request." };
  if (chief?.role !== "chief_scientist") return { ok: false, reason: "Only a chief scientist can approve and send." };
  if (o.status !== "awaiting_approval" || rep.status !== "draft") return { ok: false, reason: "This request is not waiting for approval." };
  if (!hasPreviewed(rep.id, chiefId)) return { ok: false, reason: "Open the report preview before approving." };
  if (!checksFor(o).every((c) => c.ok)) return { ok: false, reason: "Gaya is holding this record: a check failed." };
  const at = nowIso(), sent = new Date(Date.now() + 60000).toISOString(), p = patient(o.patient_id), L = lab();
  d.exec("BEGIN");
  try {
    d.prepare("UPDATE results SET status = 'released', approved_by = ?, approved_at = ?, released_at = ? WHERE order_id = ?").run(chiefId, at, at, orderId);
    d.prepare("UPDATE orders SET status = 'released' WHERE id = ?").run(orderId);
    d.prepare("UPDATE reports SET status = 'final', approved_by = ?, approved_at = ?, email_status = 'sent', email_sent_at = ? WHERE id = ?").run(chiefId, at, sent, rep.id);
    audit({ type: "human", id: chiefId }, "report.approved", `${p.lab_patient_id} ${p.full_name}: previewed report v${rep.version} approved`, "order", orderId);
    audit({ type: "gaya", model: L.model_source }, "report.finalised", `Signed report ${p.lab_patient_id} v${rep.version} issued (PDF)`, "order", orderId);
    audit({ type: "gaya", model: L.model_source }, "email.sent", `Result e-mail with the PDF sent to ${p.email} (demo: delivery not connected yet)`, "order", orderId);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    return { ok: false, reason: e instanceof Error ? e.message : "Approval failed." };
  }
  return { ok: true };
}

// ── One place that decides what state a request is in ──────────────────────
export type OrderState = "awaiting_results" | "held" | "awaiting_approval" | "released" | "rejected";
export function orderState(o: Order): OrderState {
  if (o.status === "rejected") return "rejected";
  if (o.status === "released") return "released";
  if (o.status === "awaiting_approval") return checksFor(o).every((c) => c.ok) ? "awaiting_approval" : "held";
  const rs = resultsFor(o.id);
  return rs.some((r) => r.status === "pending") ? "awaiting_results" : "held";
}
export const STATE_LABEL: Record<OrderState, [string, string]> = {
  awaiting_results: ["Awaiting results", "mute"],
  held: ["Held by Gaya", "crit"],
  awaiting_approval: ["Awaiting approval", "warn"],
  released: ["Released", "ok"],
  rejected: ["Rejected", "crit"],
};

/** Requests whose entered results failed one of Gaya's checks. */
export function heldOrders(): Order[] {
  const candidates = db().prepare(`SELECT * FROM orders WHERE status IN ('in_progress','awaiting_approval')
    AND id NOT IN (SELECT order_id FROM results WHERE status = 'pending') ORDER BY received_at DESC`).all() as Order[];
  return candidates.filter((o) => orderState(o) === "held");
}
