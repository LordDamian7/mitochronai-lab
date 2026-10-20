// Import first in every test file: points the app at a throwaway database so tests never touch the lab's real one.
// node --test runs each file in its own process, so each file gets its own fresh, seeded database.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "mcl-test-"));
process.env.MCL_DB_PATH = path.join(dir, "lab.db");
// Remove the throwaway database when this test file's process ends.
// (Windows can't delete an open file, so the database is closed first.)
process.on("exit", () => {
  try { (globalThis as { __mitochronaiDb?: { close(): void } }).__mitochronaiDb?.close(); } catch { /* already closed */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* the OS cleans temp eventually */ }
});
