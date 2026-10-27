import Link from "next/link";
import { redirect } from "next/navigation";
import { LeveyJennings } from "@/components/Charts";
import { requireUser } from "@/lib/auth";
import { publish } from "@/lib/events";
import { dateTime } from "@/lib/format";
import { staffMap } from "@/lib/lab";
import { CONTROLS, qcStatus, recordQcRun, runsFor, westgard } from "@/lib/qc";

export const metadata = { title: "Quality control" };

async function addRun(formData: FormData) {
  "use server";
  const me = await requireUser();
  const [test, level] = String(formData.get("control") ?? "").split("|");
  const r = recordQcRun(test, level, Number(String(formData.get("value") ?? "").replace(",", ".")), me.id);
  if (!r.ok) redirect(`/qc?c=${test}|${level}&error=${encodeURIComponent(r.reason)}`);
  publish("qc.recorded", undefined, me.display_name);
  redirect(`/qc?c=${test}|${level}&recorded=${r.violations.some((v) => v.severity === "reject") ? "reject" : r.violations.length ? "warning" : "ok"}`);
}

const STATE: Record<string, [string, string]> = { ok: ["In control", "ok"], warning: ["1-2s warning", "warn"], reject: ["Rejected run", "crit"] };

export default async function QcPage({ searchParams }: { searchParams: Promise<{ c?: string; error?: string; recorded?: string }> }) {
  await requireUser();
  const { c = "FBG|L2", error, recorded } = await searchParams;
  const [test, level] = c.split("|");
  const control = CONTROLS.find((x) => x.test === test && x.level === level) ?? CONTROLS[1];
  const runs = runsFor(control.test, control.level), status = qcStatus(), staff = staffMap();
  const violations = [...westgard("FBG"), ...westgard("TC")].reverse();
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow">Analyser Chem-1 · Westgard multirule</div><h1>Quality control</h1></div></div>
      {error && <div className="notice err" role="alert">{error}</div>}
      {recorded && <div className={`notice${recorded === "reject" ? " err" : ""}`} role="status" style={recorded === "ok" ? { background: "var(--ok-bg)", color: "var(--ok)" } : recorded === "warning" ? { background: "var(--warn-bg)", color: "var(--warn)" } : undefined}>
        {recorded === "ok" ? "Run recorded: in control." : recorded === "warning" ? "Run recorded with a 1-2s warning. Check the other level and recent runs before releasing patient results." : "Run rejected by a Westgard rule. Don't release patient results for this test until the cause is fixed and a new run passes."}</div>}
      <div className="kpis">
        {status.map((s) => (
          <Link key={`${s.test}${s.level}`} href={`/qc?c=${s.test}|${s.level}`} className="panel kpi" style={{ textDecoration: "none", color: "inherit", outline: s.test === control.test && s.level === control.level ? "2px solid var(--brand)" : undefined }}>
            <span>{s.test} control {s.level}</span>
            <b>{s.last?.value ?? "—"}</b>
            <small><span className={`pill ${STATE[s.state][1]}`}>{STATE[s.state][0]}</span> · target {s.mean} ± {s.sd}</small>
          </Link>
        ))}
      </div>
      <div className="grid2">
        <section className="panel" aria-labelledby="h-lj">
          <div className="panel-head"><div><h2 id="h-lj">Levey-Jennings · {control.test} {control.level}</h2><p>Target {control.mean} ± {control.sd} {control.unit} · {runs.length} runs</p></div></div>
          <div className="panel-body"><LeveyJennings runs={runs} label={`Levey-Jennings chart for ${control.test} ${control.level}`} /></div>
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <section className="panel" aria-labelledby="h-add">
            <div className="panel-head"><div><h2 id="h-add">Record a control run</h2><p>Gaya applies the Westgard rules immediately</p></div></div>
            <form action={addRun} className="panel-body">
              <div className="formgrid">
                <label className="field" htmlFor="control">Control<select id="control" name="control" defaultValue={`${control.test}|${control.level}`}>
                  {CONTROLS.map((x) => <option key={`${x.test}|${x.level}`} value={`${x.test}|${x.level}`}>{x.test} {x.level} (target {x.mean})</option>)}</select></label>
                <label className="field" htmlFor="value">Value ({control.unit})<input id="value" name="value" inputMode="decimal" required autoComplete="off" className="result-input" style={{ width: "100%" }} /></label>
              </div>
              <div><button className="btn btn-primary" type="submit">Record run</button></div>
            </form>
          </section>
          <section className="panel" aria-labelledby="h-v">
            <div className="panel-head"><div><h2 id="h-v">Rule violations</h2><p>1-2s is a warning; 1-3s, 2-2s, R-4s, 4-1s and 10x reject the run</p></div></div>
            <div className="panel-body">{violations.length ? <ol className="timeline">{violations.slice(0, 8).map((v, i) => (
              <li key={i}><span><span className={`pill ${v.severity === "reject" ? "crit" : "warn"}`}>{v.rule}</span></span><span>{v.text}</span></li>))}</ol>
              : <p className="sub" style={{ margin: 0 }}>No violations.</p>}</div>
          </section>
        </div>
      </div>
      <section className="panel" aria-labelledby="h-runs">
        <div className="panel-head"><h2 id="h-runs">Recent runs · {control.test} {control.level}</h2></div>
        <div className="tablewrap"><table className="grid cards">
          <thead><tr><th>Run</th><th>Value</th><th>SD from target</th><th>Run by</th></tr></thead>
          <tbody>{[...runs].reverse().slice(0, 10).map((r) => { const zz = (r.value - r.target_mean) / r.target_sd; return (
            <tr key={r.id}><td data-label="Run" className="mono primary">{dateTime(r.run_at)}</td><td data-label="Value" className="num">{r.value}</td>
              <td data-label="SD" className="num" style={{ color: Math.abs(zz) > 3 ? "var(--crit)" : Math.abs(zz) > 2 ? "var(--warn)" : undefined }}>{zz > 0 ? "+" : ""}{zz.toFixed(2)}</td>
              <td data-label="Run by">{staff[r.run_by ?? ""]?.display_name ?? "—"}</td></tr>); })}</tbody>
        </table></div>
      </section>
    </>
  );
}
