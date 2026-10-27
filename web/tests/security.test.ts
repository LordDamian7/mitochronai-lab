import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword, clearFailures, isSessionIdle, lockedUntil, PASSWORD_MIN, recordFailure, tempPassword } from "@/lib/security";

const MIN = 60_000;

test("passwords follow NIST SP 800-63B rev 4: length, not composition", () => {
  assert.equal(PASSWORD_MIN, 15);
  assert.match(checkPassword("Sh0rt!pass", "ada") ?? "", /at least 15/);
  assert.equal(checkPassword("tea at noon in yaba", "ada"), null, "a plain 15+ character passphrase is fine; no symbols required");
  assert.match(checkPassword("x".repeat(129), "ada") ?? "", /128/);
  assert.match(checkPassword("password12345678", "ada") ?? "", /common/);
  assert.match(checkPassword("123456789012345678", "ada") ?? "", /common/);
  assert.match(checkPassword("aaaaaaaaaaaaaaaaaa", "ada") ?? "", /common/);
  assert.match(checkPassword("my name is taenia.solium ok", "taenia.solium") ?? "", /username/);
  assert.match(checkPassword("mitochronai lab 2026", "ada") ?? "", /lab's name/);
});

test("five failures in 15 minutes lock the account for 15 minutes, then it opens again", () => {
  const t0 = Date.parse("2026-10-20T09:00:00Z");
  for (let i = 0; i < 4; i++) recordFailure("Gram.Stain ", t0 + i * MIN);
  assert.equal(lockedUntil("gram.stain", t0 + 4 * MIN), null, "four failures are not enough");
  recordFailure("gram.stain", t0 + 5 * MIN);
  const until = lockedUntil("gram.stain", t0 + 6 * MIN);
  assert.ok(until, "fifth failure locks");
  assert.equal(until!.getTime(), t0 + 20 * MIN, "locked for 15 minutes from the last failure");
  assert.ok(lockedUntil("gram.stain", t0 + 19 * MIN), "still locked just before it expires");
  assert.equal(lockedUntil("gram.stain", t0 + 21 * MIN), null, "never a permanent lock-out");
});

test("failures spread over more than 15 minutes don't lock", () => {
  const t0 = Date.parse("2026-10-20T10:00:00Z");
  for (let i = 0; i < 5; i++) recordFailure("lab.admin", t0 + i * 5 * MIN);
  assert.equal(lockedUntil("lab.admin", t0 + 20 * MIN + 1), null);
});

test("an administrator can clear a lock (or a successful sign-in does)", () => {
  const t0 = Date.parse("2026-10-20T11:00:00Z");
  for (let i = 0; i < 5; i++) recordFailure("creatinin.jaffe", t0 + i * MIN);
  assert.ok(lockedUntil("creatinin.jaffe", t0 + 5 * MIN));
  clearFailures("creatinin.jaffe");
  assert.equal(lockedUntil("creatinin.jaffe", t0 + 5 * MIN), null);
});

test("sessions end after 30 idle minutes", () => {
  const seen = "2026-10-20T09:00:00.000Z";
  assert.equal(isSessionIdle(seen, Date.parse(seen) + 29 * MIN), false);
  assert.equal(isSessionIdle(seen, Date.parse(seen) + 31 * MIN), true);
});

test("temporary passwords are random, long enough and pass the policy", () => {
  const a = tempPassword(), b = tempPassword();
  assert.notEqual(a, b);
  assert.ok(a.length >= PASSWORD_MIN);
  assert.equal(checkPassword(a, "someone"), null);
});

test("REVIEW #3: old failure rows are pruned, so random usernames can't fill the disk", async () => {
  const { db } = await import("@/lib/db");
  const old = Date.now() - 2 * 3600_000;
  for (let i = 0; i < 50; i++) recordFailure(`spam-${i}`, old);
  recordFailure("someone.new");
  const left = (db().prepare("SELECT COUNT(*) n FROM login_failures WHERE username LIKE 'spam-%'").get() as { n: number }).n;
  assert.equal(left, 0, "rows older than the lock window are removed on the next failure");
});
