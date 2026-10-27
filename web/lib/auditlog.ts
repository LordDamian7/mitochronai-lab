import { audit, db } from "./db";
import { staffMap } from "./lab";

/**
 * Searching and exporting the append-only audit log (ISO 15189 traceability). Export is for the chief scientist and
 * administrators, and every export is itself audited. CSV cells are neutralised against spreadsheet formula
 * injection (OWASP): a cell starting with = + - @ tab or CR is prefixed with an apostrophe.
 */
export type AuditFilter = { from?: string; to?: string; actor?: string; action?: string; q?: string; limit?: number };
export type AuditRow = { id: number; at: string; actor_type: string; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; model: string | null; detail: string };

const isDay = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function queryAudit(f: AuditFilter): AuditRow[] {
  const where: string[] = [], args: (string | number)[] = [];
  // Days are Lagos calendar days (WAT, UTC+1).
  if (isDay(f.from)) { where.push("at >= ?"); args.push(new Date(`${f.from}T00:00:00+01:00`).toISOString()); }
  if (isDay(f.to)) { where.push("at < ?"); args.push(new Date(Date.parse(`${f.to}T00:00:00+01:00`) + 864e5).toISOString()); }
  if (f.actor === "gaya" || f.actor === "system") { where.push("actor_type = ?"); args.push(f.actor); }
  else if (f.actor) { where.push("actor_id = ?"); args.push(f.actor); }
  if (f.action) { where.push("action = ?"); args.push(f.action); }
  if (f.q?.trim()) { where.push("(lower(detail) LIKE ? ESCAPE '\\' OR lower(COALESCE(entity_id, '')) LIKE ? ESCAPE '\\')"); const p = `%${likeEscape(f.q.trim().toLowerCase().slice(0, 100))}%`; args.push(p, p); }
  const limit = Math.min(Math.max(1, Math.floor(f.limit ?? 300)), 5000);
  return db().prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${limit}`).all(...args) as AuditRow[];
}

/** Entries only a chief scientist or administrator may see: they carry prices, costs or staff details. */
export const MANAGER_ONLY_ACTIONS = ["price.%", "prices.%", "stock.%", "staff.%", "audit.%", "auth.%"];
export const scientistSafeSql = MANAGER_ONLY_ACTIONS.map(() => "action NOT LIKE ?").join(" AND ");

export const auditActions = () => (db().prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]).map((r) => r.action);

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const lagos = (iso: string) => new Date(iso).toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Lagos" });

export function auditCsv(by: { id: string; role: string }, f: AuditFilter): { ok: true; csv: string; count: number } | { ok: false; reason: string } {
  if (by.role !== "chief_scientist" && by.role !== "admin") return { ok: false, reason: "Only a chief scientist or an administrator can export the audit log." };
  const rows = queryAudit({ ...f, limit: 5000 }), staff = staffMap();
  const who = (r: AuditRow) => (r.actor_type === "gaya" ? "Gaya" : r.actor_type === "system" ? "System" : staff[r.actor_id ?? ""]?.display_name ?? r.actor_id ?? "");
  const csv = toCsv([["Time (Lagos)", "Who", "Action", "Entity", "Detail"], ...rows.map((r) => [lagos(r.at), who(r), r.action, [r.entity, r.entity_id].filter(Boolean).join(" "), r.detail])]);
  const described = Object.entries(f).filter(([k, v]) => v && k !== "limit").map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(", ") || "no filter";
  audit({ type: "human", id: by.id }, "audit.exported", `Audit log exported as CSV (${rows.length} entries; ${described})`);
  return { ok: true, csv, count: rows.length };
}
