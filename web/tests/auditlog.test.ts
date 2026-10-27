import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditCsv, csvCell, queryAudit, toCsv } from "@/lib/auditlog";
import { audit, db } from "@/lib/db";

const CHIEF = { id: "STF-001", role: "chief_scientist" }, SCI = { id: "STF-002", role: "scientist" }, ADMIN = { id: "STF-900", role: "admin" };

test("spreadsheet formulas are neutralised (OWASP CSV injection)", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell('=HYPERLINK("http://evil.example","click")'), `"'=HYPERLINK(""http://evil.example"",""click"")"`);
  for (const lead of ["+", "-", "@", "\t", "\r"]) assert.ok(csvCell(`${lead}cmd`).startsWith(lead === "\t" || lead === "\r" ? `"'` : "'"), `leading ${JSON.stringify(lead)}`);
  assert.equal(csvCell("plain text"), "plain text");
  assert.equal(csvCell('say "hi", then go'), '"say ""hi"", then go"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(toCsv([["a", "b"], ["=x", "y,z"]]), "a,b\r\n'=x,\"y,z\"\r\n");
});

test("filters combine: action, person, dates and text", () => {
  audit({ type: "human", id: "STF-001" }, "price.changed", "Full blood count: ₦7,500 → ₦8,000", "price", "FBC");
  audit({ type: "human", id: "STF-900" }, "price.changed", "Widal test: ₦3,000 → ₦3,500", "price", "WIDAL");
  audit({ type: "human", id: "STF-002" }, "sample.rejected", "MCA-2026-0001: sample rejected (Haemolysed sample)", "order", "ORD-001");
  assert.equal(queryAudit({ action: "price.changed" }).length, 2);
  assert.equal(queryAudit({ action: "price.changed", actor: "STF-900" }).length, 1);
  assert.equal(queryAudit({ q: "haemolysed" }).length, 1, "text search is case-insensitive");
  assert.equal(queryAudit({ q: "%" }).length, 0, "% is searched literally, not as a wildcard");
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(queryAudit({ from: today, to: today }).length >= 3);
  assert.equal(queryAudit({ from: "2000-01-01", to: "2000-01-02" }).length, 0);
  assert.equal(queryAudit({ from: "not-a-date" }).length >= 3, true, "bad dates are ignored, not an error");
});

test("only a chief scientist or administrator can export, and each export is itself audited", () => {
  assert.equal(auditCsv(SCI, {}).ok, false);
  const before = (db().prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'audit.exported'").get() as { n: number }).n;
  const r = auditCsv(CHIEF, { action: "price.changed" });
  assert.ok(r.ok);
  assert.match(r.csv, /^Time \(Lagos\),Who,Action,Entity,Detail\r\n/);
  assert.ok(r.csv.includes("Widal test"));
  assert.equal((db().prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'audit.exported'").get() as { n: number }).n, before + 1);
  assert.ok(auditCsv(ADMIN, {}).ok);
});

test("the scientist-safe filter hides price, stock, staff and sign-in entries", async () => {
  const { MANAGER_ONLY_ACTIONS, scientistSafeSql } = await import("@/lib/auditlog");
  audit({ type: "human", id: "STF-001" }, "stock.received", "HCV rapid test: 3 kit(s) of lot X received (₦18,000 per kit)", "reagent", "RG-HCV");
  audit({ type: "human", id: "STF-002" }, "results.entered", "MCA-2026-0001: 4 result(s) entered", "order", "ORD-001");
  const seen = (db().prepare(`SELECT action, detail FROM audit_log WHERE ${scientistSafeSql}`).all(...MANAGER_ONLY_ACTIONS) as { action: string; detail: string }[]);
  assert.ok(seen.some((r) => r.action === "results.entered"));
  assert.ok(!seen.some((r) => /₦/.test(r.detail)), "no naira amount reaches a scientist");
  assert.ok(!seen.some((r) => /^(price|prices|stock|staff|audit|auth)\./.test(r.action)));
});
