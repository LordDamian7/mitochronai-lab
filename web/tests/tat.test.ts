import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "@/lib/db";
import { createRequest } from "@/lib/entry";
import { expectedTatHours, overdueCount, tatStatus } from "@/lib/tat";

const H = 3600_000;
const make = (panels: string[], hoursAgo: number) => {
  const r = createRequest({ patient_id: "PAT-001", panels, requested_by: "Dr T", fasting_hours: null, collected_at: new Date(Date.now() - hoursAgo * H).toISOString() }, "STF-002");
  assert.ok(r.ok);
  db().prepare("UPDATE orders SET received_at = ? WHERE id = ?").run(new Date(Date.now() - hoursAgo * H).toISOString(), r.id);
  return r.id;
};

test("the expected turnaround is the slowest test on the request", () => {
  assert.equal(expectedTatHours(make(["FBC"], 0)), 2);
  assert.equal(expectedTatHours(make(["FBC", "URINEMCS"], 0)), 72);
});

test("on time, due soon, overdue", () => {
  const now = Date.now();
  const late = make(["FBC"], 3), soon = make(["FBC"], 1.7), fine = make(["URINEMCS"], 24);
  assert.equal(tatStatus(late, now).state, "overdue");
  assert.ok(tatStatus(late, now).minutes >= 59, "about an hour late");
  assert.equal(tatStatus(soon, now).state, "due_soon");
  assert.equal(tatStatus(fine, now).state, "on_time");
});

test("released and rejected requests are never overdue", () => {
  const id = make(["FBC"], 10);
  db().prepare("UPDATE orders SET status = 'released' WHERE id = ?").run(id);
  assert.equal(tatStatus(id).state, "done");
  const id2 = make(["FBC"], 10);
  db().prepare("UPDATE orders SET status = 'rejected' WHERE id = ?").run(id2);
  assert.equal(tatStatus(id2).state, "done");
});

test("the dashboard count includes only open, late requests", () => {
  const before = overdueCount();
  make(["FBC"], 5);
  make(["URINEMCS"], 1);
  assert.equal(overdueCount(), before + 1);
});
