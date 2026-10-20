import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ANALYTES, PANELS, REAGENTS } from "./catalogue";
import { hashPassword } from "./password";

/**
 * One SQLite file on the lab server. Safety rules live in the database itself:
 * the audit log is append-only, and a result can only be released with an
 * active chief scientist named as approver.
 */
const ROOT = process.cwd();
// MCL_DB_PATH is for the test suite (a throwaway database per test file); the lab always uses var/mitochronai.db.
const DB_PATH = process.env.MCL_DB_PATH ?? path.join(ROOT, "var", "mitochronai.db");
const VAR_DIR = path.dirname(DB_PATH);
const SEED_DIR = path.join(ROOT, "..", "data", "synthetic");
const USERS_SEED = path.join(ROOT, "seed", "demo-users.json");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS labs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, phone TEXT,
  working_days TEXT, opening_time TEXT, closing_time TEXT,
  assistant_name TEXT NOT NULL DEFAULT 'Gaya',
  comments_enabled INTEGER NOT NULL DEFAULT 0,
  model_source TEXT NOT NULL DEFAULT 'local' CHECK (model_source IN ('local','byo','connect'))
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('scientist','chief_scientist','admin')),
  username TEXT UNIQUE, password_hash TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS duty_roster (staff_id TEXT NOT NULL REFERENCES staff(id), weekday INTEGER NOT NULL, PRIMARY KEY (staff_id, weekday));
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id), lab_patient_id TEXT NOT NULL,
  full_name TEXT NOT NULL, sex TEXT NOT NULL, date_of_birth TEXT, email TEXT, phone TEXT,
  risk_factors TEXT NOT NULL DEFAULT '', UNIQUE (lab_id, lab_patient_id)
);
CREATE TABLE IF NOT EXISTS test_catalog (
  code TEXT NOT NULL, name TEXT NOT NULL, department TEXT NOT NULL, specimen TEXT,
  result_type TEXT NOT NULL, unit TEXT, ref_low REAL, ref_high REAL, ref_sex TEXT NOT NULL DEFAULT '',
  ref_text TEXT, ref_source TEXT, calc_formula TEXT, PRIMARY KEY (code, ref_sex)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id), patient_id TEXT NOT NULL REFERENCES patients(id),
  requested_by TEXT, received_at TEXT NOT NULL, fasting_hours REAL,
  status TEXT NOT NULL CHECK (status IN ('received','in_progress','awaiting_approval','released','rejected')),
  reject_reason TEXT
);
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY, lab_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id),
  test_code TEXT NOT NULL, collected_at TEXT NOT NULL, tested_at TEXT, read_at TEXT,
  performed_by TEXT REFERENCES staff(id), value_numeric REAL, value_text TEXT, unit TEXT,
  value_source TEXT, flag TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','entered','awaiting_approval','approved','released')),
  approved_by TEXT REFERENCES staff(id), approved_at TEXT, released_at TEXT
);
CREATE TABLE IF NOT EXISTS qc_runs (
  id TEXT PRIMARY KEY, lab_id TEXT NOT NULL, analyser TEXT NOT NULL, test_code TEXT NOT NULL, level TEXT NOT NULL,
  run_at TEXT NOT NULL, value REAL NOT NULL, target_mean REAL NOT NULL, target_sd REAL NOT NULL, run_by TEXT
);
-- Gaya's drafts. A new version is a new row; an approved report is never edited.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','final','superseded')),
  drafted_by TEXT NOT NULL, drafted_at TEXT NOT NULL, approved_by TEXT REFERENCES staff(id), approved_at TEXT,
  email_status TEXT NOT NULL DEFAULT 'drafted' CHECK (email_status IN ('drafted','sent')), email_sent_at TEXT,
  UNIQUE (order_id, version)
);
CREATE TABLE IF NOT EXISTS report_previews (report_id INTEGER NOT NULL REFERENCES reports(id), staff_id TEXT NOT NULL REFERENCES staff(id), at TEXT NOT NULL, PRIMARY KEY (report_id, staff_id));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_type TEXT NOT NULL CHECK (actor_type IN ('human','gaya','system')),
  actor_id TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, model TEXT, detail TEXT NOT NULL
);

-- What was requested on each order, and the price at the time (later price changes never rewrite history).
CREATE TABLE IF NOT EXISTS order_panels (order_id TEXT NOT NULL REFERENCES orders(id), panel_code TEXT NOT NULL, price_ngn INTEGER NOT NULL, PRIMARY KEY (order_id, panel_code));
CREATE TABLE IF NOT EXISTS test_prices (panel_code TEXT PRIMARY KEY, price_ngn INTEGER NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS reagents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, method TEXT, panels TEXT NOT NULL, tests_per_kit INTEGER NOT NULL CHECK (tests_per_kit > 0),
  storage TEXT, open_stability_days INTEGER, reorder_level_kits INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS reagent_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reagent_id TEXT NOT NULL REFERENCES reagents(id), lot_no TEXT NOT NULL, expiry TEXT NOT NULL,
  received_on TEXT NOT NULL, kits_in_stock INTEGER NOT NULL CHECK (kits_in_stock >= 0), open_tests_left INTEGER NOT NULL DEFAULT 0 CHECK (open_tests_left >= 0),
  opened_on TEXT, cost_per_kit_ngn INTEGER NOT NULL,
  qa_status TEXT NOT NULL CHECK (qa_status IN ('accepted','quarantine','rejected')), qa_by TEXT, qa_on TEXT, qa_note TEXT,
  UNIQUE (reagent_id, lot_no)
);
-- One row per request and reagent: which lot was used and its state at that moment (Gaya checks this snapshot).
CREATE TABLE IF NOT EXISTS reagent_consumption (
  order_id TEXT NOT NULL REFERENCES orders(id), reagent_id TEXT NOT NULL REFERENCES reagents(id), lot_id INTEGER, lot_no TEXT, expiry TEXT,
  qa_status TEXT, problem TEXT, at TEXT NOT NULL, PRIMARY KEY (order_id, reagent_id)
);

-- Failed sign-ins, for lock-out. Usernames are stored lower-case; rows are cleared on a successful sign-in or by an administrator.
CREATE TABLE IF NOT EXISTS login_failures (username TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS login_failures_user ON login_failures (username, at);

-- Critical results phoned to a clinician (ISO 15189 §7.4.1.3). One row per result and value phoned; never deleted.
CREATE TABLE IF NOT EXISTS critical_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), result_id TEXT NOT NULL, test_code TEXT NOT NULL, value TEXT NOT NULL,
  called_by TEXT NOT NULL REFERENCES staff(id), called_name TEXT NOT NULL, called_role TEXT NOT NULL, read_back INTEGER NOT NULL CHECK (read_back = 1), at TEXT NOT NULL
);

-- A secret shown once to one person (a temporary password), referenced by a random id so it never sits in a URL.
CREATE TABLE IF NOT EXISTS one_time_notes (id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL, text TEXT NOT NULL, expires_at TEXT NOT NULL);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS report_final_frozen BEFORE UPDATE ON reports WHEN OLD.status = 'final' AND NEW.status != 'superseded'
  BEGIN SELECT RAISE(ABORT, 'an approved report cannot be edited; issue a new version'); END;
CREATE TRIGGER IF NOT EXISTS results_need_chief BEFORE UPDATE OF status ON results WHEN NEW.status IN ('approved','released')
  AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = NEW.approved_by AND s.role = 'chief_scientist' AND s.active = 1)
  BEGIN SELECT RAISE(ABORT, 'approval needs an active chief scientist'); END;
`;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const readSeed = (name: string) => parseCsv(fs.readFileSync(path.join(SEED_DIR, `${name}.csv`), "utf8"));
const nul = (v: string | undefined) => (v === undefined || v === "" ? null : v);
const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));

function seed(db: DatabaseSync) {
  const users: { staff_id: string; username: string; password: string; display_name?: string; role?: string }[] =
    JSON.parse(fs.readFileSync(USERS_SEED, "utf8")).users;
  db.exec("BEGIN");
  try {
    for (const l of readSeed("labs"))
      db.prepare("INSERT INTO labs (id,name,address,phone,working_days,opening_time,closing_time,assistant_name) VALUES (?,?,?,?,?,?,?,?)")
        .run(l.id, l.name, l.address, l.phone, l.working_days, l.opening_time, l.closing_time, l.assistant_name);
    const lab = readSeed("labs")[0].id;
    for (const s of readSeed("staff"))
      db.prepare("INSERT INTO staff (id,lab_id,display_name,role) VALUES (?,?,?,?)").run(s.id, s.lab_id, s.display_name, s.role);
    for (const u of users) {
      const exists = db.prepare("SELECT 1 FROM staff WHERE id = ?").get(u.staff_id);
      if (!exists) db.prepare("INSERT INTO staff (id,lab_id,display_name,role) VALUES (?,?,?,?)").run(u.staff_id, lab, u.display_name ?? u.username, u.role ?? "admin");
      db.prepare("UPDATE staff SET username = ?, password_hash = ? WHERE id = ?").run(u.username, hashPassword(u.password), u.staff_id);
    }
    for (const r of readSeed("duty_roster")) db.prepare("INSERT INTO duty_roster VALUES (?,?)").run(r.staff_id, Number(r.weekday));
    for (const p of readSeed("patients"))
      db.prepare("INSERT INTO patients VALUES (?,?,?,?,?,?,?,?,?)").run(p.id, p.lab_id, p.lab_patient_id, p.full_name, p.sex, p.date_of_birth, p.email, p.phone, p.risk_factors);
    for (const c of readSeed("test_catalog"))
      db.prepare("INSERT INTO test_catalog VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(c.code, c.name, c.department, c.specimen, c.result_type, nul(c.unit), num(c.ref_low), num(c.ref_high), c.ref_sex, c.ref_text, nul(c.ref_source), nul(c.calc_formula));
    for (const o of readSeed("orders"))
      db.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)").run(o.id, o.lab_id, o.patient_id, o.requested_by, o.received_at, num(o.fasting_hours), o.status, nul(o.reject_reason));
    for (const r of readSeed("results"))
      db.prepare("INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(r.id, r.lab_id, r.order_id, r.test_code, r.collected_at, nul(r.tested_at), nul(r.read_at), nul(r.performed_by), num(r.value_numeric), nul(r.value_text), nul(r.unit), nul(r.value_source), nul(r.flag), r.status, nul(r.approved_by), nul(r.approved_at), nul(r.released_at));
    for (const q of readSeed("qc_runs"))
      db.prepare("INSERT INTO qc_runs VALUES (?,?,?,?,?,?,?,?,?,?)").run(q.id, q.lab_id, q.analyser, q.test_code, q.level, q.run_at, Number(q.value), Number(q.target_mean), Number(q.target_sd), nul(q.run_by));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __mitochronaiDb: DatabaseSync | undefined;
}

export function db(): DatabaseSync {
  if (globalThis.__mitochronaiDb) return globalThis.__mitochronaiDb;
  fs.mkdirSync(VAR_DIR, { recursive: true });
  const fresh = !fs.existsSync(DB_PATH);
  const d = new DatabaseSync(DB_PATH);
  d.exec(SCHEMA);
  if (fresh) seed(d);
  migrate(d);
  globalThis.__mitochronaiDb = d;
  return d;
}

/**
 * Brings any database (new or from an earlier version) up to the current catalogue. Safe to run on every start:
 * the catalogue is reference data and is refreshed from lib/catalogue.ts; prices and stock are only ever added, never overwritten.
 */
function migrate(d: DatabaseSync) {
  const staffCols = new Set((d.prepare("PRAGMA table_info(staff)").all() as { name: string }[]).map((c) => c.name));
  if (!staffCols.has("must_change_password")) d.exec("ALTER TABLE staff ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  const cols = new Set((d.prepare("PRAGMA table_info(test_catalog)").all() as { name: string }[]).map((c) => c.name));
  for (const [c, type] of [["options", "TEXT"], ["plaus_low", "REAL"], ["plaus_high", "REAL"], ["optional", "INTEGER NOT NULL DEFAULT 0"]])
    if (!cols.has(c)) d.exec(`ALTER TABLE test_catalog ADD COLUMN ${c} ${type}`);
  d.exec("BEGIN");
  try {
    d.exec("DELETE FROM test_catalog");
    const ins = d.prepare("INSERT INTO test_catalog (code,name,department,specimen,result_type,unit,ref_low,ref_high,ref_sex,ref_text,ref_source,calc_formula,options,plaus_low,plaus_high,optional) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const a of ANALYTES) ins.run(a.code, a.name, a.department, a.specimen, a.result_type, a.unit, a.ref_low, a.ref_high, a.ref_sex, a.ref_text, a.ref_source, a.calc_formula, a.options, a.plaus_low, a.plaus_high, a.optional);
    const price = d.prepare("INSERT OR IGNORE INTO test_prices (panel_code, price_ngn) VALUES (?,?)");
    for (const p of PANELS) price.run(p.code, p.price);
    if (!(d.prepare("SELECT COUNT(*) n FROM reagents").get() as { n: number }).n) {
      const today = new Date().toISOString().slice(0, 10);
      for (const r of REAGENTS) {
        d.prepare("INSERT INTO reagents VALUES (?,?,?,?,?,?,?,?)").run(r.id, r.name, r.method, r.panels.join(","), r.tests_per_kit, r.storage, r.open_stability_days, r.reorder_level_kits);
        for (const l of r.lots)
          d.prepare("INSERT INTO reagent_lots (reagent_id,lot_no,expiry,received_on,kits_in_stock,open_tests_left,opened_on,cost_per_kit_ngn,qa_status,qa_by,qa_on,qa_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(r.id, l.lot, l.expiry, l.opened_on ?? today, l.kits, l.open_left, l.opened_on ?? null, l.cost, l.qa, l.qa === "accepted" ? "STF-001" : null, l.qa === "accepted" ? l.opened_on ?? today : null,
              l.qa === "accepted" ? "New-lot QC within limits" : "Awaiting new-lot verification");
      }
    }
    backfillOrderPanels(d);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/** Orders made before order_panels existed: work out what was requested from the result rows (largest matching panel first). */
function backfillOrderPanels(d: DatabaseSync) {
  const orders = d.prepare("SELECT id FROM orders WHERE id NOT IN (SELECT order_id FROM order_panels)").all() as { id: string }[];
  const prices = Object.fromEntries((d.prepare("SELECT panel_code, price_ngn FROM test_prices").all() as { panel_code: string; price_ngn: number }[]).map((r) => [r.panel_code, r.price_ngn]));
  for (const { id } of orders) {
    const left = new Set((d.prepare("SELECT test_code FROM results WHERE order_id = ?").all(id) as { test_code: string }[]).map((r) => r.test_code));
    while (left.size) {
      const best = PANELS.map((p) => ({ p, hit: p.tests.filter((t) => left.has(t)).length }))
        .filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit || a.p.tests.length - b.p.tests.length)[0];
      if (!best) break;
      d.prepare("INSERT OR IGNORE INTO order_panels VALUES (?,?,?)").run(id, best.p.code, prices[best.p.code] ?? best.p.price);
      for (const t of best.p.tests) left.delete(t);
    }
  }
}

export const nowIso = () => new Date().toISOString();

export type Actor = { type: "human" | "gaya" | "system"; id?: string | null; model?: string | null };
export function audit(actor: Actor, action: string, detail: string, entity?: string, entityId?: string) {
  db().prepare("INSERT INTO audit_log (at,actor_type,actor_id,action,entity,entity_id,model,detail) VALUES (?,?,?,?,?,?,?,?)")
    .run(nowIso(), actor.type, actor.id ?? null, action, entity ?? null, entityId ?? null, actor.model ?? null, detail);
}
