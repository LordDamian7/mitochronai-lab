import { audit, db, nowIso } from "./db";
import { catalogFor, patient, reevaluate, resultsFor, order, type Check } from "./lab";

/**
 * Critical results (ISO 15189:2022 §7.4.1.3): a critical value must be phoned to the clinician as soon as it's known,
 * and the call recorded: when, by whom, to whom, and that they read the result back. Each call is tied to the exact
 * value phoned, so a corrected critical value needs a new call; the old call record is kept.
 */
export const CALL_ROLES = { requesting_clinician: "requesting clinician", ward_nurse: "ward nurse", other_clinician: "other clinician", patient: "patient" } as const;
export type CallRole = keyof typeof CALL_ROLES;
type Pending = { result_id: string; test_code: string; name: string; value: string; unit: string };
type Call = { called_name: string; called_role: CallRole; called_by: string; at: string; read_back: number };

const describe = (p: Pending) => `${p.name} ${p.value}${p.unit ? ` ${p.unit}` : ""}`;

function criticals(orderId: string): Pending[] {
  const o = order(orderId);
  if (!o) return [];
  const sex = patient(o.patient_id).sex;
  return resultsFor(orderId).filter((r) => r.flag === "C" && r.status !== "pending").map((r) => {
    const c = catalogFor(r.test_code, sex);
    return { result_id: r.id, test_code: r.test_code, name: c.name, value: String(r.value_numeric ?? r.value_text ?? ""), unit: c.unit ?? "" };
  });
}

/** Critical results on this request that haven't been phoned at their current value. */
export function criticalsNeedingCall(orderId: string): Pending[] {
  const called = db().prepare("SELECT 1 FROM critical_calls WHERE result_id = ? AND value = ?");
  return criticals(orderId).filter((p) => !called.get(p.result_id, p.value));
}

export function callsFor(orderId: string): (Call & { test_code: string; value: string })[] {
  return db().prepare("SELECT * FROM critical_calls WHERE order_id = ? ORDER BY at DESC").all(orderId) as never;
}

export function recordCall(orderId: string, input: { called_name: string; called_role: CallRole; read_back: boolean }, by: { id: string }): { ok: true } | { ok: false; reason: string } {
  const pending = criticalsNeedingCall(orderId);
  if (!pending.length) return { ok: false, reason: "There's no critical result waiting for a call on this request." };
  const name = input.called_name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) return { ok: false, reason: "Enter the name of the person you spoke to." };
  if (!(input.called_role in CALL_ROLES)) return { ok: false, reason: "Choose who you spoke to." };
  if (!input.read_back) return { ok: false, reason: "Ask them to read the result back to you; only then is it recorded as communicated." };
  const d = db(), at = nowIso(), p = patient(order(orderId)!.patient_id);
  d.exec("BEGIN");
  try {
    for (const c of pending)
      d.prepare("INSERT INTO critical_calls (order_id, result_id, test_code, value, called_by, called_name, called_role, read_back, at) VALUES (?,?,?,?,?,?,?,1,?)")
        .run(orderId, c.result_id, c.test_code, c.value, by.id, name, input.called_role, at);
    audit({ type: "human", id: by.id }, "critical.called", `${p.lab_patient_id}: ${pending.map(describe).join(", ")} phoned to ${name} (${CALL_ROLES[input.called_role]}), read back`, "order", orderId);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    return { ok: false, reason: e instanceof Error ? e.message : "Saving the call failed." };
  }
  reevaluate(orderId);
  return { ok: true };
}

/** Gaya's line for the request: absent when nothing is critical. */
export function criticalCheck(orderId: string): Check | null {
  const all = criticals(orderId);
  if (!all.length) return null;
  const pending = criticalsNeedingCall(orderId);
  if (pending.length) return { ok: false, text: `Critical result: ${pending.map(describe).join(", ")} not yet phoned to the requesting clinician (record the call below)` };
  const last = callsFor(orderId)[0];
  const when = new Date(last.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
  return { ok: true, text: `Critical result phoned to ${last.called_name} (${CALL_ROLES[last.called_role as CallRole]}) at ${when}, read back` };
}
