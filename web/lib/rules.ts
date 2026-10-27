import { ANALYTES, PANELS } from "./catalogue";
import type { Catalog, Patient } from "./lab";

export { PANELS };
/** Calculated analytes are filled in by the server, never typed. */
export const CALCULATED = new Set(ANALYTES.filter((a) => a.calc_formula).map((a) => a.code));

/**
 * Critical (panic) values: flagged "C" so they stand out for an immediate phone call.
 * Commonly used adult limits; the lab director confirms them before go-live.
 */
const CRITICAL: Record<string, [number | null, number | null]> = {
  HB: [7.0, null], PLT: [20, null], WBC: [1.0, 50], K: [2.8, 6.2], NA: [120, 160],
  FBG: [2.2, 25], RBG: [2.2, 25], INR: [null, 5], CA: [1.6, 3.5],
};

/** "< X" limits flag at X and above; "≤ X" and closed ranges flag only beyond the bound. */
export function numericFlag(code: string, value: number, c: Catalog): "N" | "L" | "H" | "C" {
  const crit = CRITICAL[code];
  if (crit && ((crit[0] !== null && value < crit[0]) || (crit[1] !== null && value > crit[1]))) return "C";
  if (c.ref_low !== null && value < c.ref_low) return "L";
  const exclusiveUpper = c.ref_low === null && /^<(?!=)/.test(c.ref_text.trim());
  if (c.ref_high !== null && (exclusiveUpper ? value >= c.ref_high : value > c.ref_high)) return "H";
  return "N";
}

export const mantouxFlag = (mm: number, p: Pick<Patient, "risk_factors">) => (mm >= (p.risk_factors ? 5 : 10) ? "POS" : "NEG");

/** Options of a choice / qualitative analyte. A trailing * marks an abnormal option. */
export const optionsOf = (c: Pick<Catalog, "options">) => (c.options ?? "").split("|").filter(Boolean).map((o) => ({ label: o.replace(/\*$/, ""), abnormal: o.endsWith("*") }));
/** Labels for a qualitative analyte: [negative, positive]. */
export const qualLabels = (c: Pick<Catalog, "options">): [string, string] => { const o = optionsOf(c); return [o[0]?.label ?? "Negative", o[1]?.label ?? "Positive"]; };

/** Friedewald (mmol/L). Returns null when TG ≥ 4.5 mmol/L, where the formula is not valid. */
export function friedewald(tc: number, hdl: number, tg: number): number | null {
  if (tg >= 4.5) return null;
  return Math.round((tc - hdl - tg / 2.2) * 10) / 10;
}

/** CKD-EPI 2021 (race-free). Creatinine in µmol/L. */
export function ckdEpi2021(creaUmol: number, ageYears: number, sex: string): number {
  const scr = creaUmol / 88.4, f = sex === "F", k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
  return Math.round(142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** ageYears * (f ? 1.012 : 1));
}

export const ageAt = (dob: string, at: string) => {
  const b = new Date(dob), a = new Date(at);
  let y = a.getFullYear() - b.getFullYear();
  if (a < new Date(a.getFullYear(), b.getMonth(), b.getDate())) y--;
  return y;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
/**
 * Fill in every calculated analyte present on the request from the measured values.
 * Returns the values, or the reason a calculation can't be done.
 */
export function calculate(codes: string[], v: Record<string, number | string>, p: Pick<Patient, "sex" | "date_of_birth">, at: string): { ok: true; values: Record<string, number> } | { ok: false; reason: string } {
  const out: Record<string, number> = {}, n = (k: string) => v[k] as number;
  for (const code of codes) {
    const f = ANALYTES.find((a) => a.code === code)?.calc_formula;
    if (!f) continue;
    if (f === "friedewald_mmol") {
      const ldl = friedewald(n("TC"), n("HDL"), n("TG"));
      if (ldl === null) return { ok: false, reason: "TG is 4.5 mmol/L or more, so LDL can't be calculated by Friedewald. Measure LDL directly (direct LDL entry arrives in a later version)." };
      out[code] = ldl;
    } else if (f === "tc_over_hdl") out[code] = r1(n("TC") / n("HDL"));
    else if (f === "mcv") out[code] = r1((n("PCV") / n("RBC")) * 10);
    else if (f === "mch") out[code] = r1((n("HB") / n("RBC")) * 10);
    else if (f === "mchc") out[code] = r1((n("HB") / n("PCV")) * 100);
    else if (f === "globulin") out[code] = Math.round(n("TP") - n("ALB"));
    else if (f === "ckd_epi_2021") {
      if (!p.date_of_birth) return { ok: false, reason: "eGFR needs the patient's date of birth." };
      out[code] = ckdEpi2021(n("CREA"), ageAt(p.date_of_birth, at), p.sex);
    } else if (f === "sperm_total") out[code] = r1(n("SF_VOL") * n("SF_CONC"));
    if (out[code] !== undefined && !Number.isFinite(out[code])) return { ok: false, reason: `${code} can't be calculated from the values entered.` };
  }
  return { ok: true, values: out };
}

/** What a result says, for screens and the report. Older qualitative rows have only a flag, so fall back to the label. */
export function resultText(r: { value_numeric: number | null; value_text: string | null; flag: string | null }, c: Pick<Catalog, "result_type" | "options">): string {
  if (r.value_numeric !== null) return String(r.value_numeric);
  if (r.value_text) return r.value_text;
  if (c.result_type === "qualitative" && (r.flag === "POS" || r.flag === "NEG")) return qualLabels(c)[r.flag === "POS" ? 1 : 0];
  return "—";
}
