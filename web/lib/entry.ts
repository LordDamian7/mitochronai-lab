import { audit, db, nowIso } from "./db";
import { catalogFor, checksFor, currentReport, lab, order, patient, resultsFor, type Patient } from "./lab";
import { consumeFor } from "./inventory";
import { calculate, CALCULATED, mantouxFlag, numericFlag, optionsOf, PANELS, qualLabels } from "./rules";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });
const nextId = (table: string, prefix: string, width = 3) => {
  const row = db().prepare(`SELECT id FROM ${table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1`).get(`${prefix}%`) as { id: string } | undefined;
  return `${prefix}${String((row ? Number(row.id.slice(prefix.length)) : 0) + 1).padStart(width, "0")}`;
};

export function registerPatient(input: { full_name: string; sex: string; date_of_birth: string; phone: string; email: string; risk_factors: string[] }, by: string) {
  const name = input.full_name.trim().replace(/\s+/g, " ");
  if (name.length < 3) return fail("Enter the patient's full name.");
  if (!["F", "M"].includes(input.sex)) return fail("Choose the patient's sex.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date_of_birth) || Date.parse(input.date_of_birth) > Date.now()) return fail("Enter a valid date of birth (it's also the PDF password).");
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) return fail("That e-mail address doesn't look right.");
  const d = db(), L = lab(), year = new Date().getFullYear();
  const dup = d.prepare("SELECT lab_patient_id FROM patients WHERE lower(full_name) = lower(?) AND date_of_birth = ?").get(name, input.date_of_birth) as { lab_patient_id: string } | undefined;
  if (dup) return fail(`This patient is already registered as ${dup.lab_patient_id}. Choose them from the list instead.`);
  const last = d.prepare("SELECT lab_patient_id FROM patients WHERE lab_patient_id LIKE ? ORDER BY lab_patient_id DESC LIMIT 1").get(`MCA-${year}-%`) as { lab_patient_id: string } | undefined;
  const labPatientId = `MCA-${year}-${String((last ? Number(last.lab_patient_id.slice(-4)) : 0) + 1).padStart(4, "0")}`;
  const id = nextId("patients", "PAT-");
  d.prepare("INSERT INTO patients VALUES (?,?,?,?,?,?,?,?,?)").run(id, L.id, labPatientId, name, input.sex, input.date_of_birth, input.email.trim(), input.phone.trim(), input.risk_factors.join(";"));
  audit({ type: "human", id: by }, "patient.registered", `${labPatientId} ${name} registered`, "patient", id);
  return { ok: true as const, id };
}

/** A request: one patient, one or more panels. Each test gets a pending result row. */
export function createRequest(input: { patient_id: string; panels: string[]; requested_by: string; fasting_hours: number | null; collected_at: string }, by: string) {
  const p = patient(input.patient_id);
  if (!p) return fail("Choose a patient.");
  const panels = PANELS.filter((x) => input.panels.includes(x.code));
  if (!panels.length) return fail("Choose at least one test.");
  const collected = Date.parse(input.collected_at);
  if (Number.isNaN(collected) || collected > Date.now() + 5 * 60000) return fail("The collection time can't be in the future.");
  const d = db(), L = lab(), id = nextId("orders", "ORD-");
  d.exec("BEGIN");
  try {
    d.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)").run(id, L.id, p.id, input.requested_by.trim() || "[Referring clinician]", nowIso(), input.fasting_hours, "in_progress", null);
    const price = d.prepare("SELECT price_ngn FROM test_prices WHERE panel_code = ?");
    for (const x of panels) d.prepare("INSERT INTO order_panels VALUES (?,?,?)").run(id, x.code, (price.get(x.code) as { price_ngn: number } | undefined)?.price_ngn ?? x.price);
    for (const code of [...new Set(panels.flatMap((x) => x.tests))]) {
      const c = catalogFor(code, p.sex);
      d.prepare("INSERT INTO results (id,lab_id,order_id,test_code,collected_at,unit,value_source,status) VALUES (?,?,?,?,?,?,?,?)")
        .run(nextId("results", "RES-"), L.id, id, code, new Date(collected).toISOString(), c.unit, CALCULATED.has(code) ? "calculated" : "measured", "pending");
    }
    audit({ type: "human", id: by }, "request.created", `${p.lab_patient_id}: ${panels.map((x) => x.name).join(", ")} requested`, "order", id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { ok: true as const, id };
}

/**
 * Save the scientist's entries. Flags and calculated values come from the server, never from the browser.
 * Then Gaya runs its checks: pass → a report is drafted for approval; fail → the request is held with reasons.
 */
export function saveResults(orderId: string, entries: Record<string, string>, collectedAt: string | null, readAt: string | null, by: string) {
  const d = db(), o = order(orderId);
  if (!o) return fail("Request not found.");
  if (o.status === "released" || o.status === "rejected") return fail("This request is closed. Released results can't be changed.");
  const p = patient(o.patient_id) as Patient, rs = resultsFor(orderId), now = nowIso();
  const vals: Record<string, number | string> = {};
  for (const r of rs) {
    if (CALCULATED.has(r.test_code)) continue;
    const c = catalogFor(r.test_code, p.sex), raw = (entries[r.test_code] ?? "").trim();
    if (!raw) {
      if (c.optional) { vals[r.test_code] = ""; continue; }
      return fail(`Enter a result for ${c.name}.`);
    }
    if (c.result_type === "numeric") {
      const v = Number(raw.replace(",", "."));
      if (!Number.isFinite(v)) return fail(`${c.name}: "${raw}" isn't a number.`);
      if ((c.plaus_low !== null && v < c.plaus_low) || (c.plaus_high !== null && v > c.plaus_high))
        return fail(`${c.name}: ${v} ${c.unit ?? ""} is outside the plausible range (${c.plaus_low}–${c.plaus_high}). Check for a typing error.`);
      vals[r.test_code] = v;
    } else if (c.result_type === "qualitative") {
      if (raw !== "POS" && raw !== "NEG") return fail(`${c.name}: choose ${qualLabels(c).join(" or ")}.`);
      vals[r.test_code] = raw;
    } else if (c.result_type === "choice") {
      if (!optionsOf(c).some((o) => o.label === raw)) return fail(`${c.name}: choose one of the listed options.`);
      vals[r.test_code] = raw;
    } else {
      if (raw.length > 4000) return fail(`${c.name}: keep the report under 4,000 characters.`);
      vals[r.test_code] = raw;
    }
  }
  const calc = calculate(rs.map((r) => r.test_code), vals, p, collectedAt ?? rs[0].collected_at);
  if (!calc.ok) return fail(calc.reason);
  Object.assign(vals, calc.values);
  const L = lab();
  d.exec("BEGIN");
  try {
    if (collectedAt) d.prepare("UPDATE results SET collected_at = ? WHERE order_id = ?").run(new Date(collectedAt).toISOString(), orderId);
    for (const r of rs) {
      const c = catalogFor(r.test_code, p.sex), v = vals[r.test_code];
      let flag: string | null = null, num: number | null = null, text: string | null = null, tested = now, read: string | null = null;
      if (r.test_code === "MANTOUX") { num = v as number; flag = mantouxFlag(num, p); read = readAt ? new Date(readAt).toISOString() : now; tested = read; }
      else if (c.result_type === "numeric") { num = v as number; flag = numericFlag(r.test_code, num, c); }
      else if (c.result_type === "qualitative") { flag = v === "POS" ? "POS" : "NEG"; text = qualLabels(c)[v === "POS" ? 1 : 0]; }
      else if (c.result_type === "choice") { text = String(v); flag = optionsOf(c).find((o) => o.label === v)?.abnormal ? "A" : null; }
      else text = String(v) || null;
      d.prepare("UPDATE results SET value_numeric = ?, value_text = ?, flag = ?, tested_at = ?, read_at = ?, performed_by = ?, status = 'entered' WHERE id = ?")
        .run(num, text, flag, tested, read, by, r.id);
    }
    // Any earlier draft no longer matches these results.
    const old = currentReport(orderId);
    if (old?.status === "draft") {
      d.prepare("UPDATE reports SET status = 'superseded' WHERE id = ?").run(old.id);
      audit({ type: "gaya", model: L.model_source }, "report.superseded", `Draft v${old.version} withdrawn because results changed`, "order", orderId);
    }
    audit({ type: "human", id: by }, old ? "results.corrected" : "results.entered", `${p.lab_patient_id}: ${rs.length} result(s) ${old ? "corrected" : "entered"}`, "order", orderId);
    // Reagents are taken once per request, from the lot in use; Gaya checks that lot below.
    const panelCodes = (d.prepare("SELECT panel_code FROM order_panels WHERE order_id = ?").all(orderId) as { panel_code: string }[]).map((x) => x.panel_code);
    consumeFor(orderId, panelCodes, now);
    const fresh = order(orderId)!;
    const failed = checksFor(fresh).filter((c) => !c.ok);
    if (failed.length) {
      d.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(orderId);
      d.prepare("UPDATE results SET status = 'entered' WHERE order_id = ?").run(orderId);
      audit({ type: "gaya", model: L.model_source }, "discrepancy.raised", `${p.lab_patient_id} held: ${failed.map((f) => f.text).join(" · ")}`, "order", orderId);
    } else {
      d.prepare("UPDATE orders SET status = 'awaiting_approval' WHERE id = ?").run(orderId);
      d.prepare("UPDATE results SET status = 'awaiting_approval' WHERE order_id = ?").run(orderId);
    }
    d.exec("COMMIT");
    return { ok: true as const, held: failed.length > 0 };
  } catch (e) {
    d.exec("ROLLBACK");
    return fail(e instanceof Error ? e.message : "Saving failed.");
  }
}

export function rejectSample(orderId: string, reason: string, by: string) {
  const o = order(orderId);
  if (!o) return fail("Request not found.");
  if (o.status === "released" || o.status === "rejected") return fail("This request is already closed.");
  if (reason.trim().length < 4) return fail("Give the reason for rejecting the sample.");
  const d = db(), p = patient(o.patient_id);
  d.exec("BEGIN");
  d.prepare("UPDATE orders SET status = 'rejected', reject_reason = ? WHERE id = ?").run(reason.trim(), orderId);
  d.prepare("DELETE FROM results WHERE order_id = ? AND status IN ('pending','entered','awaiting_approval')").run(orderId);
  const old = currentReport(orderId);
  if (old?.status === "draft") d.prepare("UPDATE reports SET status = 'superseded' WHERE id = ?").run(old.id);
  audit({ type: "human", id: by }, "sample.rejected", `${p.lab_patient_id}: sample rejected (${reason.trim()})`, "order", orderId);
  d.exec("COMMIT");
  return { ok: true as const };
}
