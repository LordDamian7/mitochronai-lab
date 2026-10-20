import { audit, db, nowIso } from "./db";

export type Reagent = { id: string; name: string; method: string | null; panels: string; tests_per_kit: number; storage: string | null; open_stability_days: number | null; reorder_level_kits: number };
export type Lot = { id: number; reagent_id: string; lot_no: string; expiry: string; received_on: string; kits_in_stock: number; open_tests_left: number; opened_on: string | null; cost_per_kit_ngn: number; qa_status: "accepted" | "quarantine" | "rejected"; qa_by: string | null; qa_on: string | null; qa_note: string | null };

const day = (iso: string) => iso.slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const openExpiry = (r: Reagent, l: Lot) => (r.open_stability_days && l.opened_on ? addDays(l.opened_on, r.open_stability_days) : null);

/** Why a lot can't be used on a given day, or null if it can. */
export function lotProblem(r: Reagent, l: Lot, on: string): string | null {
  if (l.qa_status === "rejected") return "rejected by QA";
  if (l.qa_status === "quarantine") return "not yet accepted by QA (quarantine)";
  if (l.expiry < on) return `expired on ${l.expiry}`;
  return null;
}

export const reagents = () => db().prepare("SELECT * FROM reagents ORDER BY name").all() as Reagent[];
export const lotsOf = (reagentId: string) => db().prepare("SELECT * FROM reagent_lots WHERE reagent_id = ? ORDER BY expiry, id").all(reagentId) as Lot[];
export const reagentsFor = (panelCode: string) => reagents().filter((r) => r.panels.split(",").includes(panelCode));

/**
 * Take one test's worth of each reagent a request needs (first-expiring, accepted lot first) and remember which lot was used.
 * Idempotent per request: correcting results never consumes again. Must run inside the caller's transaction.
 */
export function consumeFor(orderId: string, panelCodes: string[], testedAt: string) {
  const d = db(), on = day(testedAt);
  const needed = new Map<string, Reagent>();
  for (const p of panelCodes) for (const r of reagentsFor(p)) needed.set(r.id, r);
  for (const r of needed.values()) {
    if (d.prepare("SELECT 1 FROM reagent_consumption WHERE order_id = ? AND reagent_id = ?").get(orderId, r.id)) continue;
    const lots = lotsOf(r.id);
    // An opened kit past its stability is discarded before anything is taken from that lot.
    for (const l of lots) {
      const oe = openExpiry(r, l);
      if (l.open_tests_left > 0 && oe && oe < on) {
        d.prepare("UPDATE reagent_lots SET open_tests_left = 0 WHERE id = ?").run(l.id);
        audit({ type: "system" }, "stock.discarded", `${r.name} lot ${l.lot_no}: opened kit discarded (${l.open_tests_left} tests) after ${r.open_stability_days}-day open stability`, "reagent", r.id);
        l.open_tests_left = 0;
      }
    }
    const hasStock = (l: Lot) => l.open_tests_left > 0 || l.kits_in_stock > 0;
    // Usable lots: an opened kit first (finish it), then the earliest expiry.
    const good = lots.filter((l) => hasStock(l) && !lotProblem(r, l, on)).sort((a, b) => Number(b.open_tests_left > 0) - Number(a.open_tests_left > 0) || a.expiry.localeCompare(b.expiry));
    // Nothing usable: if stock exists it must have come from a bad lot, so record that lot and let Gaya hold the result.
    const lot = good[0] ?? lots.find(hasStock);
    const problem = !lot ? "out of stock: no kit was available when this was tested" : lotProblem(r, lot, on);
    if (lot) {
      if (lot.open_tests_left > 0) d.prepare("UPDATE reagent_lots SET open_tests_left = open_tests_left - 1 WHERE id = ?").run(lot.id);
      else {
        d.prepare("UPDATE reagent_lots SET kits_in_stock = kits_in_stock - 1, open_tests_left = ?, opened_on = ? WHERE id = ?").run(r.tests_per_kit - 1, on, lot.id);
        audit({ type: "system" }, "stock.kit_opened", `${r.name} lot ${lot.lot_no}: new kit opened (${lot.kits_in_stock - 1} unopened left)`, "reagent", r.id);
      }
    }
    d.prepare("INSERT INTO reagent_consumption VALUES (?,?,?,?,?,?,?,?)").run(orderId, r.id, lot?.id ?? null, lot?.lot_no ?? null, lot?.expiry ?? null, lot?.qa_status ?? null, problem, nowIso());
    if (problem) audit({ type: "gaya" }, "stock.problem", `${r.name}${lot ? ` lot ${lot.lot_no}` : ""}: ${problem}`, "order", orderId);
  }
}

export type StockRow = Reagent & { lots: (Lot & { problem: string | null; open_expiry: string | null })[]; usable_kits: number; opened_tests: number; usable_tests: number; cost_per_test: number | null; value_ngn: number; low: boolean; expiring: boolean };

/** Everything the inventory page and the dashboard need, computed for today. */
export function stock(): StockRow[] {
  const today = day(nowIso()), soon = addDays(today, 30);
  return reagents().map((r) => {
    const lots = lotsOf(r.id).map((l) => ({ ...l, problem: lotProblem(r, l, today), open_expiry: openExpiry(r, l) }));
    const usable = lots.filter((l) => !l.problem);
    const usable_kits = usable.reduce((s, l) => s + l.kits_in_stock, 0);
    const opened_tests = usable.reduce((s, l) => s + l.open_tests_left, 0);
    const current = usable.find((l) => l.open_tests_left > 0) ?? usable[0];
    return {
      ...r, lots, usable_kits, opened_tests, usable_tests: usable_kits * r.tests_per_kit + opened_tests,
      cost_per_test: current ? current.cost_per_kit_ngn / r.tests_per_kit : null,
      value_ngn: Math.round(usable.reduce((s, l) => s + l.kits_in_stock * l.cost_per_kit_ngn + (l.open_tests_left / r.tests_per_kit) * l.cost_per_kit_ngn, 0)),
      low: usable_kits <= r.reorder_level_kits, expiring: usable.some((l) => l.expiry <= soon && (l.kits_in_stock > 0 || l.open_tests_left > 0)),
    };
  });
}

/** Reagent cost of one request of a panel, from the lot currently in use. */
export function reagentCostPerTest(panelCode: string, rows = stock()): number | null {
  const rs = rows.filter((r) => r.panels.split(",").includes(panelCode));
  if (!rs.length || rs.some((r) => r.cost_per_test === null)) return null;
  return rs.reduce((s, r) => s + r.cost_per_test!, 0);
}

type Fail = { ok: false; reason: string };
/** A delivery always starts in quarantine: QA must verify the new lot before it's used on patients. */
export function receiveLot(input: { reagent_id: string; lot_no: string; expiry: string; kits: number; cost: number }, by: string): { ok: true } | Fail {
  const r = reagents().find((x) => x.id === input.reagent_id);
  const lot = input.lot_no.trim().toUpperCase();
  if (!r) return { ok: false, reason: "Choose a reagent." };
  if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(lot)) return { ok: false, reason: "Enter the lot number printed on the kit (letters, digits and dashes)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiry) || input.expiry <= day(nowIso())) return { ok: false, reason: "The expiry date must be in the future." };
  if (!Number.isInteger(input.kits) || input.kits < 1 || input.kits > 1000) return { ok: false, reason: "Enter the number of kits received (1-1000)." };
  if (!Number.isInteger(input.cost) || input.cost < 0 || input.cost > 100_000_000) return { ok: false, reason: "Enter the cost per kit in naira." };
  const d = db();
  const existing = d.prepare("SELECT * FROM reagent_lots WHERE reagent_id = ? AND lot_no = ?").get(r.id, lot) as Lot | undefined;
  if (existing) {
    if (existing.expiry !== input.expiry) return { ok: false, reason: `Lot ${lot} is already on file with expiry ${existing.expiry}. Check the kit label.` };
    d.prepare("UPDATE reagent_lots SET kits_in_stock = kits_in_stock + ? WHERE id = ?").run(input.kits, existing.id);
  } else d.prepare("INSERT INTO reagent_lots (reagent_id,lot_no,expiry,received_on,kits_in_stock,open_tests_left,cost_per_kit_ngn,qa_status,qa_note) VALUES (?,?,?,?,?,0,?,'quarantine','Awaiting new-lot verification')")
    .run(r.id, lot, input.expiry, day(nowIso()), input.kits, input.cost);
  audit({ type: "human", id: by }, "stock.received", `${r.name}: ${input.kits} kit(s) of lot ${lot} received (expiry ${input.expiry}, ₦${input.cost.toLocaleString("en-NG")} per kit)${existing ? "" : "; in quarantine until QA verifies it"}`, "reagent", r.id);
  return { ok: true };
}

export function decideLot(lotId: number, decision: "accepted" | "rejected", note: string, by: string): { ok: true } | Fail {
  const d = db(), l = d.prepare("SELECT * FROM reagent_lots WHERE id = ?").get(lotId) as Lot | undefined;
  if (!l) return { ok: false, reason: "Lot not found." };
  if (note.trim().length < 4) return { ok: false, reason: "Record the verification result (for example: new-lot QC L1 and L2 within limits)." };
  const r = reagents().find((x) => x.id === l.reagent_id)!;
  d.prepare("UPDATE reagent_lots SET qa_status = ?, qa_by = ?, qa_on = ?, qa_note = ? WHERE id = ?").run(decision, by, day(nowIso()), note.trim(), lotId);
  audit({ type: "human", id: by }, decision === "accepted" ? "stock.lot_accepted" : "stock.lot_rejected", `${r.name} lot ${l.lot_no} ${decision} by QA: ${note.trim()}`, "reagent", r.id);
  return { ok: true };
}
