// Small server-rendered SVG charts. Colours come from the theme tokens, so they work in light and dark.

export function Bars({ data, label, unit = "" }: { data: { k: string; v: number }[]; label: string; unit?: string }) {
  const W = 560, H = 220, L = 36, B = 28, T = 18, max = Math.max(1, ...data.map((d) => d.v));
  const step = Math.max(1, Math.ceil(max / 4)), top = step * Math.ceil(max / step);
  const y = (v: number) => T + (1 - v / top) * (H - T - B), bw = (W - L - 8) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.k} ${d.v}${unit}`).join(", ")}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((t) => (
        <g key={t}><line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" /><text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--font-data)">{t}</text></g>
      ))}
      {data.map((d, i) => {
        const x = L + i * bw + bw * 0.2, w = bw * 0.6;
        return (
          <g key={d.k}>
            <rect x={x} y={y(d.v)} width={w} height={H - B - y(d.v)} rx="3" fill="var(--brand)" />
            <text x={x + w / 2} y={y(d.v) - 6} textAnchor="middle" fontSize="11.5" fill="var(--fg)" fontFamily="var(--font-data)">{d.v}</text>
            <text x={x + w / 2} y={H - 9} textAnchor="middle" fontSize="11" fill="var(--muted)">{d.k}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function HBars({ data, label, warnAbove }: { data: { k: string; v: number }[]; label: string; warnAbove?: number }) {
  const W = 560, row = 26, L = 70, H = data.length * row + 28, max = Math.max(60, ...data.map((d) => d.v));
  const ticks = [0, 60, 120, 180, 240, 300].filter((t) => t <= max + 30);
  const x = (v: number) => L + (v / (ticks.at(-1) ?? max)) * (W - L - 50);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.k} ${Math.round(d.v)} minutes`).join(", ")}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1="4" y2={H - 22} stroke="var(--line-soft)" /><text x={x(t)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-data)">{t}</text></g>)}
      {data.map((d, i) => (
        <g key={d.k}>
          <text x={L - 8} y={10 + i * row + 12} textAnchor="end" fontSize="11.5" fill="var(--fg-2)" fontFamily="var(--font-data)">{d.k}</text>
          <rect x={L} y={10 + i * row} width={Math.max(2, x(d.v) - L)} height="15" rx="3" fill={warnAbove && d.v > warnAbove ? "var(--warn)" : "var(--brand)"} />
          <text x={x(d.v) + 6} y={10 + i * row + 12} fontSize="11.5" fill="var(--fg)" fontFamily="var(--font-data)">{Math.round(d.v)} min</text>
        </g>
      ))}
    </svg>
  );
}

export function LeveyJennings({ runs, label }: { runs: { id: string; run_at: string; value: number; target_mean: number; target_sd: number }[]; label: string }) {
  if (!runs.length) return <p className="sub">No runs recorded yet.</p>;
  const W = 640, H = 250, L = 46, R = 16, T = 14, B = 34, m = runs[0].target_mean, sd = runs[0].target_sd;
  const y = (v: number) => T + (1 - (v - (m - 3.5 * sd)) / (7 * sd)) * (H - T - B);
  const yc = (v: number) => Math.min(H - B, Math.max(T, y(v)));
  const x = (i: number) => (runs.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (runs.length - 1));
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Lagos" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
        <g key={k}>
          <line x1={L} x2={W - R} y1={y(m + k * sd)} y2={y(m + k * sd)} stroke={k === 0 ? "var(--muted)" : Math.abs(k) === 3 ? "var(--crit)" : Math.abs(k) === 2 ? "var(--warn)" : "var(--line)"} strokeDasharray={k === 0 ? undefined : "4 4"} />
          <text x={L - 8} y={y(m + k * sd) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--font-data)">{k === 0 ? "mean" : `${k > 0 ? "+" : ""}${k}s`}</text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--brand)" strokeWidth="1.6" points={runs.map((r, i) => `${x(i)},${yc(r.value)}`).join(" ")} />
      {runs.map((r, i) => {
        const zz = Math.abs((r.value - m) / sd), c = zz > 3 ? "var(--crit)" : zz > 2 ? "var(--warn)" : "var(--brand)";
        return (
          <g key={r.id}>
            <circle cx={x(i)} cy={yc(r.value)} r={zz > 2 ? 6 : 4.5} fill={c} stroke="var(--surface)" strokeWidth="2"><title>{`${day(r.run_at)}: ${r.value} (${((r.value - m) / sd).toFixed(1)} SD)`}</title></circle>
            {(runs.length <= 14 || i % Math.ceil(runs.length / 14) === 0) && <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{day(r.run_at)}</text>}
          </g>
        );
      })}
    </svg>
  );
}
