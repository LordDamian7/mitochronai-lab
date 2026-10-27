import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { lockedUntil, recordFailure } from "@/lib/security";
import { addStaff, changeOwnPassword, resetPassword, setActive, setRole, setRoster } from "@/lib/staff";

const CHIEF = { id: "STF-001", role: "chief_scientist" as const };
const SCI = { id: "STF-002", role: "scientist" as const };
const ADMIN = { id: "STF-900", role: "admin" as const };
const row = (id: string) => db().prepare("SELECT * FROM staff WHERE id = ?").get(id) as { username: string; role: string; active: number; must_change_password: number; password_hash: string };
const audits = (action: string) => (db().prepare("SELECT COUNT(*) n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
const addSession = (staffId: string, tag: string) => db().prepare("INSERT INTO sessions VALUES (?,?,?,?,?)").run(`hash-${tag}`, staffId, new Date().toISOString(), new Date(Date.now() + 3.6e6).toISOString(), new Date().toISOString());
const sessions = (staffId: string) => (db().prepare("SELECT COUNT(*) n FROM sessions WHERE staff_id = ?").get(staffId) as { n: number }).n;

test("only a chief scientist or administrator can manage staff", () => {
  const r = addStaff({ display_name: "Sct. New Person", username: "new.person", role: "scientist" }, SCI);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /chief scientist or an administrator/);
});

test("adding a person gives a one-time temporary password they must change", () => {
  const r = addStaff({ display_name: "  Sct.  Ada  Obi ", username: " Ada.Obi ", role: "scientist" }, ADMIN);
  assert.ok(r.ok);
  const s = row(r.id);
  assert.equal(s.username, "ada.obi");
  assert.equal(s.must_change_password, 1);
  assert.ok(verifyPassword(r.tempPassword, s.password_hash));
  assert.equal(audits("staff.added"), 1);
  assert.equal(addStaff({ display_name: "Someone Else", username: "ada.obi", role: "scientist" }, ADMIN).ok, false, "usernames are unique");
  assert.equal(addStaff({ display_name: "Bad Name", username: "x; DROP TABLE staff", role: "scientist" }, ADMIN).ok, false, "usernames are letters, digits, dots");
  assert.equal(addStaff({ display_name: "Bad Role", username: "bad.role", role: "superuser" as never }, ADMIN).ok, false);
});

test("nobody can lock the lab out: not yourself, not the last chief or administrator", () => {
  assert.equal(setActive("STF-900", false, ADMIN).ok, false, "can't deactivate yourself");
  assert.equal(setRole("STF-001", "scientist", CHIEF).ok, false, "can't demote yourself");
  assert.match((setActive("STF-001", false, ADMIN) as { reason: string }).reason, /last active chief scientist/);
  assert.match((setRole("STF-001", "scientist", ADMIN) as { reason: string }).reason, /last active chief scientist/);
  assert.match((setRole("STF-900", "scientist", CHIEF) as { reason: string }).reason, /last active administrator/);
  assert.equal(row("STF-001").active, 1);
  assert.equal(row("STF-001").role, "chief_scientist");
});

test("deactivating someone ends their sessions at once; reactivating works", () => {
  addSession("STF-003", "a"); addSession("STF-003", "b");
  assert.ok(setActive("STF-003", false, ADMIN).ok);
  assert.equal(row("STF-003").active, 0);
  assert.equal(sessions("STF-003"), 0);
  assert.ok(setActive("STF-003", true, ADMIN).ok);
  assert.equal(row("STF-003").active, 1);
});

test("a second chief makes demoting the first one possible", () => {
  const r = addStaff({ display_name: "Chief Sct. Two", username: "chief.two", role: "chief_scientist" }, ADMIN);
  assert.ok(r.ok);
  assert.ok(setRole("STF-001", "scientist", ADMIN).ok);
  assert.ok(setRole("STF-001", "chief_scientist", ADMIN).ok);
});

test("resetting a password forces a change, ends sessions and clears a lock-out", () => {
  addSession("STF-002", "c");
  for (let i = 0; i < 5; i++) recordFailure("taenia.solium");
  assert.ok(lockedUntil("taenia.solium"));
  const r = resetPassword("STF-002", ADMIN);
  assert.ok(r.ok);
  assert.ok(verifyPassword(r.tempPassword, row("STF-002").password_hash));
  assert.equal(row("STF-002").must_change_password, 1);
  assert.equal(sessions("STF-002"), 0);
  assert.equal(lockedUntil("taenia.solium"), null);
});

test("changing your own password needs the current one and follows the policy", () => {
  const r = addStaff({ display_name: "Sct. Bola Ade", username: "bola.ade", role: "scientist" }, ADMIN);
  assert.ok(r.ok);
  assert.match((changeOwnPassword(r.id, "wrong current password", "tea at noon in yaba") as { reason: string }).reason, /current password/);
  assert.match((changeOwnPassword(r.id, r.tempPassword, "too short") as { reason: string }).reason, /at least 15/);
  assert.match((changeOwnPassword(r.id, r.tempPassword, r.tempPassword) as { reason: string }).reason, /different/);
  assert.ok(changeOwnPassword(r.id, r.tempPassword, "tea at noon in yaba").ok);
  assert.equal(row(r.id).must_change_password, 0);
  assert.ok(verifyPassword("tea at noon in yaba", row(r.id).password_hash));
});

test("the duty roster takes weekdays 1-7 only and every change is audited", () => {
  assert.equal(setRoster("STF-002", [1, 3, 9], ADMIN).ok, false);
  assert.equal(setRoster("STF-002", [1, 3, 5], SCI).ok, false, "scientists can't edit the roster");
  assert.ok(setRoster("STF-002", [5, 1, 3, 3], ADMIN).ok);
  const days = (db().prepare("SELECT weekday FROM duty_roster WHERE staff_id = 'STF-002' ORDER BY weekday").all() as { weekday: number }[]).map((r) => r.weekday);
  assert.deepEqual(days, [1, 3, 5]);
  assert.ok(audits("staff.roster") >= 1);
});

test("a temporary-password note is shown only to the admin who created it, and only for 2 minutes", async () => {
  // Not "deleted on first read": Next.js renders the page twice after a server action (action response + follow-up fetch).
  const { stashOnce, takeOnce } = await import("@/lib/staff");
  const id = stashOnce("STF-900", "kq7m-2xvp-9hdt-c4wa");
  assert.equal(takeOnce(id, "STF-002"), null, "another person never sees it");
  assert.equal(takeOnce(id, "STF-900"), "kq7m-2xvp-9hdt-c4wa");
  assert.equal(takeOnce(id, "STF-900"), "kq7m-2xvp-9hdt-c4wa", "still there for the second render of the same page");
  assert.equal(takeOnce(id, "STF-900", Date.now() + 121_000), null, "gone after 2 minutes");
  assert.equal(takeOnce(undefined, "STF-900"), null);
});

test("REVIEW #2: guessing the current password on the account page counts towards the lock-out", () => {
  const r = addStaff({ display_name: "Sct. Guess Target", username: "guess.target", role: "scientist" }, ADMIN);
  assert.ok(r.ok);
  for (let i = 0; i < 5; i++) assert.equal(changeOwnPassword(r.id, `wrong guess ${i}`, "tea at noon in yaba").ok, false);
  assert.ok(lockedUntil("guess.target"), "five wrong guesses lock the account");
  assert.match((changeOwnPassword(r.id, r.tempPassword, "tea at noon in yaba") as { reason: string }).reason, /Too many attempts/, "even the right password is refused while locked");
});
