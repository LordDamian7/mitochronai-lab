import { audit, db, nowIso } from "./db";
import { lab } from "./lab";

export type QcRun = { id: string; analyser: string; test_code: string; level: string; run_at: string; value: number; target_mean: number; target_sd: number; run_by: string | null };
export type Violation = { rule: string; severity: "warning" | "reject"; runId: string; text: string };

export const CONTROLS: { test: string; level: string; mean: number; sd: number; unit: string }[] = [
  { test: "FBG", level: "L1", mean: 5.0, sd: 0.15, unit: "mmol/L" }, { test: "FBG", level: "L2", mean: 15.0, sd: 0.4, unit: "mmol/L" },
  { test: "TC", level: "L1", mean: 4.0, sd: 0.12, unit: "mmol/L" }, { test: "TC", level: "L2", mean: 7.5, sd: 0.2, unit: "mmol/L" },
];
export const runsFor = (test: string, level?: string) =>
  db().prepare(`SELECT * FROM qc_runs WHERE test_code = ? ${level ? "AND level = ?" : ""} ORDER BY run_at`).all(...(level ? [test, level] : [test])) as QcRun[];
const z = (r: QcRun) => (r.value - r.target_mean) / r.target_sd;

/**
 * Westgard multirule over one test's runs (both control levels).
 * 1-2s warning · 1-3s, 2-2s, R-4s, 4-1s, 10x reject.
 */
export function westgard(test: string): Violation[] {
  const runs = runsFor(test), out: Violation[] = [];
  const byLevel = new Map<string, QcRun[]>();
  for (const r of runs) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
  for (const [level, rs] of byLevel) {
    rs.forEach((r, i) => {
      const zi = z(r);
      if (Math.abs(zi) > 3) out.push({ rule: "1-3s", severity: "reject", runId: r.id, text: `${test} ${level}: ${r.value} is ${zi.toFixed(1)} SD from target` });
      else if (Math.abs(zi) > 2) out.push({ rule: "1-2s", severity: "warning", runId: r.id, text: `${test} ${level}: ${r.value} is ${zi.toFixed(1)} SD from target` });
      const prev = rs[i - 1];
      if (prev && Math.abs(zi) > 2 && Math.abs(z(prev)) > 2 && Math.sign(zi) === Math.sign(z(prev)))
        out.push({ rule: "2-2s", severity: "reject", runId: r.id, text: `${test} ${level}: two consecutive runs beyond 2 SD on the same side` });
      const last4 = rs.slice(Math.max(0, i - 3), i + 1);
      if (last4.length === 4 && last4.every((x) => z(x) > 1) || last4.length === 4 && last4.every((x) => z(x) < -1))
        out.push({ rule: "4-1s", severity: "reject", runId: r.id, text: `${test} ${level}: four consecutive runs beyond 1 SD on the same side` });
      const last10 = rs.slice(Math.max(0, i - 9), i + 1);
      if (last10.length === 10 && (last10.every((x) => z(x) > 0) || last10.every((x) => z(x) < 0)))
        out.push({ rule: "10x", severity: "reject", runId: r.id, text: `${test} ${level}: ten consecutive runs on the same side of the mean` });
    });
  }
  // R-4s: the two levels in the same day's run are more than 4 SD apart in opposite directions.
  const days = new Map<string, QcRun[]>();
  for (const r of runs) days.set(r.run_at.slice(0, 10), [...(days.get(r.run_at.slice(0, 10)) ?? []), r]);
  for (const [day, rs] of days) {
    const zs = rs.map(z);
    if (rs.length > 1 && Math.max(...zs) > 2 && Math.min(...zs) < -2 && Math.max(...zs) - Math.min(...zs) > 4)
      out.push({ rule: "R-4s", severity: "reject", runId: rs[0].id, text: `${test} on ${day}: levels differ by more than 4 SD in opposite directions` });
  }
  return out;
}

/** Status of the latest run for each control: in control, warning, or reject (patient results for that test should not be released). */
export function qcStatus() {
  return CONTROLS.map((c) => {
    const runs = runsFor(c.test, c.level), last = runs.at(-1);
    const v = last ? westgard(c.test).filter((x) => x.runId === last.id) : [];
    const state = v.some((x) => x.severity === "reject") ? "reject" : v.length ? "warning" : "ok";
    return { ...c, last, state: state as "ok" | "warning" | "reject", violations: v };
  });
}

export function recordQcRun(test: string, level: string, value: number, by: string) {
  const c = CONTROLS.find((x) => x.test === test && x.level === level);
  if (!c) return { ok: false as const, reason: "Choose a control." };
  if (!Number.isFinite(value) || value <= 0) return { ok: false as const, reason: "Enter the control value." };
  const d = db(), L = lab();
  const last = d.prepare("SELECT id FROM qc_runs ORDER BY id DESC LIMIT 1").get() as { id: string } | undefined;
  const id = `QC-${String((last ? Number(last.id.slice(3)) : 0) + 1).padStart(3, "0")}`;
  d.prepare("INSERT INTO qc_runs VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, L.id, "Chem-1", test, level, nowIso(), value, c.mean, c.sd, by);
  audit({ type: "human", id: by }, "qc.recorded", `${test} ${level}: ${value} ${c.unit} on Chem-1`, "qc", id);
  const v = westgard(test).filter((x) => x.runId === id);
  if (v.length) audit({ type: "gaya", model: L.model_source }, v.some((x) => x.severity === "reject") ? "qc.rejected" : "qc.warning",
    v.map((x) => `${x.rule}: ${x.text}`).join(" · "), "qc", id);
  return { ok: true as const, violations: v };
}
