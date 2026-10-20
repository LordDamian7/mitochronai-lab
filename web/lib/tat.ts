import { PANELS } from "./catalogue";
import { db } from "./db";

/** Turnaround: each request is due when its slowest test should be done, counted from when the lab received it. */
export type TatState = "on_time" | "due_soon" | "overdue" | "done";
const TAT = Object.fromEntries(PANELS.map((p) => [p.code, p.tat_hours]));

export function expectedTatHours(orderId: string): number | null {
  const codes = (db().prepare("SELECT panel_code FROM order_panels WHERE order_id = ?").all(orderId) as { panel_code: string }[]).map((r) => TAT[r.panel_code]).filter((h) => h !== undefined);
  return codes.length ? Math.max(...codes) : null;
}

/** `minutes` is time left (on time / due soon) or time late (overdue). "Due soon" is the last 20 % of the turnaround. */
export function tatStatus(orderId: string, now = Date.now()): { state: TatState; minutes: number; dueAt: string | null } {
  const o = db().prepare("SELECT status, received_at FROM orders WHERE id = ?").get(orderId) as { status: string; received_at: string } | undefined;
  const hours = expectedTatHours(orderId);
  if (!o || hours === null) return { state: "done", minutes: 0, dueAt: null };
  const due = Date.parse(o.received_at) + hours * 3600_000, dueAt = new Date(due).toISOString();
  if (o.status === "released" || o.status === "rejected") return { state: "done", minutes: 0, dueAt };
  const left = (due - now) / 60_000;
  if (left < 0) return { state: "overdue", minutes: Math.round(-left), dueAt };
  return { state: left <= hours * 60 * 0.2 ? "due_soon" : "on_time", minutes: Math.round(left), dueAt };
}

export function overdueCount(now = Date.now()): number {
  const open = db().prepare("SELECT id FROM orders WHERE status NOT IN ('released','rejected')").all() as { id: string }[];
  return open.filter((o) => tatStatus(o.id, now).state === "overdue").length;
}

/** "45 min", "3 h 05 min", "2 d 4 h" */
export function duration(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(min / 1440)} d ${Math.floor((min % 1440) / 60)} h`;
}
