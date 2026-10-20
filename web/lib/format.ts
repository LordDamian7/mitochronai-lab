// Display helpers shared by screens and the printed report.
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

/** "x10^9/L" → "×10⁹/L", as units are printed on lab reports. */
export function unit(u: string | null | undefined): string {
  if (!u) return "";
  return u.replace(/x10\^(-?\d+)/g, (_, e: string) => "×10" + [...e].map((c) => SUP[c] ?? c).join(""));
}
/** Same treatment for reference-range text such as "4.0-10.0 x10^9/L". Also uses a proper en dash for ranges. */
export function refText(t: string | null | undefined): string {
  if (!t) return "";
  return unit(t).replace(/(\d)-(\d)/g, "$1–$2").replace(/>=/g, "≥").replace(/<=/g, "≤");
}

const tz = { timeZone: "Africa/Lagos" } as const;
export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", ...tz }) : "—";
export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", ...tz });
