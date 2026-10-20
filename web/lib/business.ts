import type { User } from "./auth";
import { PANELS } from "./catalogue";
import { audit, db, nowIso } from "./db";
import { stock } from "./inventory";

/** Revenue, kit counts, tests done and price editing are for the chief scientist and the administrator only. */
export const canSeeBusiness = (u: Pick<User, "role">) => u.role === "chief_scientist" || u.role === "admin";

export type Price = { panel_code: string; price_ngn: number; confirmed: number; updated_by: string | null; updated_at: string | null };
export const prices = () => Object.fromEntries((db().prepare("SELECT * FROM test_prices").all() as Price[]).map((p) => [p.panel_code, p]));
export const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

/** Start of a calendar month in Lagos time (WAT, UTC+1), as an ISO instant. */
const monthStart = (year: number, month0: number) => new Date(Date.UTC(year, month0, 1) - 3600000).toISOString();
function monthWindow(offset = 0) {
  const lagos = new Date(Date.now() + 3600000);
  const y = lagos.getUTCFullYear(), m = lagos.getUTCMonth() + offset;
  return { from: monthStart(y, m), to: monthStart(y, m + 1), label: new Date(Date.UTC(y, m, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

/** Released work in a month: a request counts when the chief approves it (the report is final). */
export function monthFigures(offset = 0) {
  const w = monthWindow(offset);
  const row = db().prepare(`SELECT COUNT(*) tests, COALESCE(SUM(op.price_ngn), 0) revenue, COUNT(DISTINCT op.order_id) requests
    FROM order_panels op JOIN reports r ON r.order_id = op.order_id AND r.status = 'final'
    WHERE r.approved_at >= ? AND r.approved_at < ?`).get(w.from, w.to) as { tests: number; revenue: number; requests: number };
  return { ...w, ...row };
}

export function businessSnapshot() {
  const rows = stock();
  const unconfirmed = (db().prepare("SELECT COUNT(*) n FROM test_prices WHERE confirmed = 0").get() as { n: number }).n;
  return {
    month: monthFigures(0), lastMonth: monthFigures(-1),
    kits: rows.reduce((s, r) => s + r.usable_kits, 0), openedKits: rows.filter((r) => r.opened_tests > 0).length,
    stockValue: rows.reduce((s, r) => s + r.value_ngn, 0),
    low: rows.filter((r) => r.low), expiring: rows.filter((r) => r.expiring), unconfirmed,
  };
}

/** Save the price list. Saving confirms every price on the page; each change is audited with old and new value. */
export function savePrices(input: Record<string, string>, by: User): { ok: true; changed: number } | { ok: false; reason: string } {
  if (!canSeeBusiness(by)) return { ok: false, reason: "Only the chief scientist or an administrator can change prices." };
  const current = prices(), next: [string, number][] = [];
  for (const p of PANELS) {
    const raw = (input[p.code] ?? "").replace(/[₦,\s]/g, "");
    if (raw === "") return { ok: false, reason: `Enter a price for ${p.name}.` };
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > 10_000_000) return { ok: false, reason: `${p.name}: enter a whole number of naira between 0 and 10,000,000.` };
    next.push([p.code, v]);
  }
  const d = db(), at = nowIso();
  let changed = 0;
  d.exec("BEGIN");
  try {
    for (const [code, v] of next) {
      const old = current[code];
      if (old && old.price_ngn === v && old.confirmed) continue;
      d.prepare("INSERT INTO test_prices (panel_code, price_ngn, confirmed, updated_by, updated_at) VALUES (?,?,1,?,?) ON CONFLICT(panel_code) DO UPDATE SET price_ngn = excluded.price_ngn, confirmed = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
        .run(code, v, by.id, at);
      if (!old || old.price_ngn !== v) {
        changed++;
        audit({ type: "human", id: by.id }, "price.changed", `${PANELS.find((p) => p.code === code)!.name}: ${old ? naira(old.price_ngn) : "no price"} → ${naira(v)}`, "price", code);
      }
    }
    audit({ type: "human", id: by.id }, "prices.confirmed", `Price list reviewed and saved (${changed} price${changed === 1 ? "" : "s"} changed)`);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    return { ok: false, reason: e instanceof Error ? e.message : "Saving failed." };
  }
  return { ok: true, changed };
}
