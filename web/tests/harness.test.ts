import "./helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "@/lib/db";

test("a fresh test database is seeded and isolated from the lab's real one", () => {
  assert.match(process.env.MCL_DB_PATH ?? "", /mcl-test-/);
  assert.equal((db().prepare("SELECT COUNT(*) n FROM test_prices").get() as { n: number }).n, 108);
  assert.ok(db().prepare("SELECT 1 FROM staff WHERE role = 'chief_scientist' AND active = 1").get());
});
