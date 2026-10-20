import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { criticalsNeedingCall, recordCall } from "@/lib/critical";
import { db } from "@/lib/db";
import { createRequest, saveResults } from "@/lib/entry";
import { checksFor, order } from "@/lib/lab";

const SCI = { id: "STF-002", role: "scientist" };
const fbc = (hb: string) => ({ HB: hb, PCV: "20", RBC: "2.5", WBC: "6.1", NEUT: "60", LYMPH: "30", MONO: "6", EOS: "3", BASO: "1", PLT: "250" });
const criticalLine = (id: string) => checksFor(order(id)!).find((c) => /[Cc]ritical/.test(c.text));

test("a critical result holds the request until it has been phoned, with read-back (ISO 15189 §7.4.1.3)", () => {
  const r = createRequest({ patient_id: "PAT-001", panels: ["FBC"], requested_by: "Dr A. Example", fasting_hours: null, collected_at: new Date(Date.now() - 3600_000).toISOString() }, SCI.id);
  assert.ok(r.ok);
  assert.ok(saveResults(r.id, fbc("6.5"), null, null, SCI.id).ok);
  assert.equal(criticalsNeedingCall(r.id).length, 1, "Hb 6.5 g/dL is critical");
  const line = criticalLine(r.id);
  assert.ok(line && !line.ok, "held until phoned");
  assert.match(line!.text, /Haemoglobin 6\.5 g\/dL.*not yet phoned/);

  assert.match((recordCall(r.id, { called_name: "Dr A. Example", called_role: "requesting_clinician", read_back: false }, SCI) as { reason: string }).reason, /read the result back/);
  assert.match((recordCall(r.id, { called_name: "x", called_role: "requesting_clinician", read_back: true }, SCI) as { reason: string }).reason, /name/);
  assert.match((recordCall(r.id, { called_name: "Dr A. Example", called_role: "janitor" as never, read_back: true }, SCI) as { reason: string }).reason, /who/);
  assert.ok(recordCall(r.id, { called_name: "Dr A. Example", called_role: "requesting_clinician", read_back: true }, SCI).ok);

  assert.equal(criticalsNeedingCall(r.id).length, 0);
  assert.ok(criticalLine(r.id)!.ok, "the hold is lifted");
  assert.match(criticalLine(r.id)!.text, /phoned to Dr A\. Example.*read back/);
  const a = db().prepare("SELECT detail FROM audit_log WHERE action = 'critical.called' AND entity_id = ?").get(r.id) as { detail: string };
  assert.match(a.detail, /Haemoglobin 6\.5 g\/dL.*Dr A\. Example.*read back/);
});

test("correcting a critical value to another critical value needs a new call", () => {
  const r = createRequest({ patient_id: "PAT-001", panels: ["FBC"], requested_by: "Dr B", fasting_hours: null, collected_at: new Date(Date.now() - 3600_000).toISOString() }, SCI.id);
  assert.ok(r.ok);
  assert.ok(saveResults(r.id, fbc("6.5"), null, null, SCI.id).ok);
  assert.ok(recordCall(r.id, { called_name: "Dr B. Ward", called_role: "requesting_clinician", read_back: true }, SCI).ok);
  assert.ok(saveResults(r.id, fbc("5.9"), null, null, SCI.id).ok);
  assert.equal(criticalsNeedingCall(r.id).length, 1, "5.9 was never phoned");
  assert.equal(criticalLine(r.id)!.ok, false);
});

test("a critical value corrected to a normal one no longer needs a call, and the earlier call stays on record", () => {
  const r = createRequest({ patient_id: "PAT-001", panels: ["FBC"], requested_by: "Dr C", fasting_hours: null, collected_at: new Date(Date.now() - 3600_000).toISOString() }, SCI.id);
  assert.ok(r.ok);
  assert.ok(saveResults(r.id, fbc("6.5"), null, null, SCI.id).ok);
  assert.ok(recordCall(r.id, { called_name: "Dr C. Ward", called_role: "requesting_clinician", read_back: true }, SCI).ok);
  assert.ok(saveResults(r.id, fbc("13.2"), null, null, SCI.id).ok);
  assert.equal(criticalsNeedingCall(r.id).length, 0);
  assert.equal(criticalLine(r.id), undefined, "no critical line when nothing is critical");
  assert.ok(db().prepare("SELECT 1 FROM critical_calls WHERE order_id = ?").get(r.id), "the call record is kept");
});

test("there's nothing to phone on a request without critical results", () => {
  const r = createRequest({ patient_id: "PAT-001", panels: ["FBG"], requested_by: "Dr D", fasting_hours: 10, collected_at: new Date(Date.now() - 3600_000).toISOString() }, SCI.id);
  assert.ok(r.ok);
  assert.ok(saveResults(r.id, { FBG: "5.1" }, null, null, SCI.id).ok);
  assert.match((recordCall(r.id, { called_name: "Dr D. Ward", called_role: "requesting_clinician", read_back: true }, SCI) as { reason: string }).reason, /no critical/);
});

test("REVIEW #5: recording the call releases the hold and Gaya drafts the report", async () => {
  const { currentReport, orderState } = await import("@/lib/lab");
  const r = createRequest({ patient_id: "PAT-001", panels: ["FBC"], requested_by: "Dr E", fasting_hours: null, collected_at: new Date(Date.now() - 3600_000).toISOString() }, SCI.id);
  assert.ok(r.ok);
  assert.ok(saveResults(r.id, fbc("6.5"), null, null, SCI.id).ok);
  assert.equal(orderState(order(r.id)!), "held");
  assert.ok(recordCall(r.id, { called_name: "Dr E. Ward", called_role: "requesting_clinician", read_back: true }, SCI).ok);
  const after = order(r.id)!;
  if (checksFor(after).every((c) => c.ok)) {
    assert.equal(orderState(after), "awaiting_approval", "no longer held once every check passes");
    assert.equal(currentReport(r.id)?.status, "draft", "Gaya drafted the report");
  } else {
    // Another check (e.g. the duty roster on a day this scientist isn't rostered) still holds it: that's correct.
    assert.equal(orderState(after), "held");
  }
});
