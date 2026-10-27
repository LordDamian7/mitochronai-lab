"use client";
import { useMemo, useState } from "react";

type P = { code: string; name: string; department: string; fasting?: boolean; tat_hours: number };
const tat = (h: number) => (h < 24 ? `${h} h` : `${Math.round(h / 24)} d`);
const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/** Searchable, grouped test list. Filtering only hides rows, so ticked tests stay ticked and are always submitted. */
export default function TestPicker({ panels, prices }: { panels: P[]; prices?: Record<string, number> }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const groups = useMemo(() => [...new Set(panels.map((p) => p.department))].map((d) => [d, panels.filter((p) => p.department === d)] as const), [panels]);
  const match = (p: P) => !q.trim() || `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase());
  const toggle = (code: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(code); else n.delete(code); return n; });
  const total = prices ? [...picked].reduce((s, c) => s + (prices[c] ?? 0), 0) : null;
  return (
    <fieldset className="field picker"><legend>Tests requested</legend>
      <div className="picker-bar">
        <input type="search" aria-label="Search tests" placeholder="Search tests, e.g. widal, HbA1c, urine culture" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sub" aria-live="polite">{picked.size ? `${picked.size} selected${total !== null ? ` · ${naira(total)}` : ""}` : "None selected"}</span>
      </div>
      <div className="picker-groups">
        {groups.map(([dept, items]) => {
          const shown = items.filter(match);
          return (
            <details key={dept} open hidden={!shown.length}>
              <summary>{dept} <span className="sub">({items.length})</span></summary>
              <div className="checks-list">
                {items.map((p) => (
                  <label key={p.code} htmlFor={`panel-${p.code}`} hidden={!match(p)}>
                    <input type="checkbox" id={`panel-${p.code}`} name="panel" value={p.code} onChange={(e) => toggle(p.code, e.target.checked)} />
                    <span>{p.name}<span className="sub"> · {tat(p.tat_hours)}{p.fasting ? " · fasting" : ""}{prices ? ` · ${naira(prices[p.code] ?? 0)}` : ""}</span></span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </fieldset>
  );
}
