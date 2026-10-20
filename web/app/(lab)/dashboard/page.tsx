import Link from "next/link";
import { Bars, HBars } from "@/components/Charts";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { shortDateTime } from "@/lib/format";
import { heldOrders, lab, staffMap } from "@/lib/lab";
import { qcStatus } from "@/lib/qc";
import { overdueCount } from "@/lib/tat";
import { businessSnapshot, canSeeBusiness, naira } from "@/lib/business";
import { MANAGER_ONLY_ACTIONS, scientistSafeSql } from "@/lib/auditlog";

export const metadata = { title: "Dashboard" };
const one = <T,>(sql: string, ...a: (string | number)[]) => db().prepare(sql).get(...a) as T;
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hm = (m: number | null) => (m === null ? "—" : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} m` : `${Math.round(m)} m`);
const SOPS: [string, string, boolean][] = [["Mantoux", "SOP-MAN-01", true], ["Lipid profile", "SOP-LIP-01", true], ["Fasting glucose", "SOP-GLU-01", true], ["H. pylori", "SOP-HPY-01", true], ["Full blood count", "", false], ["Malaria RDT", "", false], ["Blood group", "", false], ["FIT", "", false]];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string; password?: string }> }) {
  const me = await requireUser();
  const { denied, password } = await searchParams;
  const biz = canSeeBusiness(me) ? businessSnapshot() : null;
  const L = lab(), staff = staffMap();
  const counts = Object.fromEntries((db().prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0), held = heldOrders().length;
  const awaitingResults = one<{ n: number }>("SELECT COUNT(DISTINCT order_id) n FROM results WHERE status = 'pending'").n;
  const released = db().prepare(`SELECT o.received_at, MAX(r.released_at) rel FROM orders o JOIN results r ON r.order_id = o.id WHERE o.status = 'released' AND r.test_code != 'MANTOUX' GROUP BY o.id`).all() as { received_at: string; rel: string }[];
  const tat = median(released.map((x) => (Date.parse(x.rel) - Date.parse(x.received_at)) / 60000));
  const byTest = db().prepare(`SELECT op.panel_code k, o.received_at, MAX(r.released_at) released_at FROM order_panels op JOIN orders o ON o.id = op.order_id
    JOIN results r ON r.order_id = o.id WHERE o.status = 'released' AND op.panel_code != 'MANTOUX' GROUP BY op.order_id, op.panel_code`).all() as { k: string; received_at: string; released_at: string }[];
  const tatByTest = Object.entries(byTest.reduce<Record<string, number[]>>((acc, r) => ((acc[r.k] ??= []).push((Date.parse(r.released_at) - Date.parse(r.received_at)) / 60000), acc), {}))
    .map(([k, v]) => ({ k, v: median(v)! })).sort((a, b) => b.v - a.v).slice(0, 10);
  const days = db().prepare(`SELECT substr(datetime(received_at, '+1 hour'), 1, 10) d, COUNT(*) n FROM orders GROUP BY d ORDER BY d DESC LIMIT 7`).all() as { d: string; n: number }[];
  const vol = days.reverse().map((x) => ({ k: new Date(`${x.d}T12:00:00+01:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", timeZone: "Africa/Lagos" }), v: x.n }));
  const gaya = { drafted: one<{ n: number }>("SELECT COUNT(*) n FROM reports").n, held: one<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'discrepancy.raised'").n, approved: one<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'report.approved'").n };
  const qc = qcStatus();
  const overdue = overdueCount();
  // Scientists see lab activity only: price, stock, staff and export entries are for the chief and administrators.
  const activity = (biz ? db().prepare("SELECT * FROM audit_log WHERE action NOT LIKE 'auth.%' ORDER BY id DESC LIMIT 8").all()
    : db().prepare(`SELECT * FROM audit_log WHERE ${scientistSafeSql} ORDER BY id DESC LIMIT 8`).all(...MANAGER_ONLY_ACTIONS)) as { id: number; at: string; actor_type: string; actor_id: string | null; detail: string }[];
  const greeting = me.role === "chief_scientist" && (counts.awaiting_approval ?? 0) > 0 ? `${counts.awaiting_approval} report${counts.awaiting_approval > 1 ? "s" : ""} waiting for your approval.` : held ? `${held} request${held > 1 ? "s" : ""} held by Gaya.` : "Nothing is waiting on you.";
  return (
    <>
      <div className="pagehead">
        <div><div className="eyebrow">{L.name}</div><h1>Laboratory overview</h1></div>
        <p className="sub" style={{ margin: 0 }}>{greeting}</p>
      </div>
      {denied && <div className="notice err" role="alert">That page is for the chief scientist and administrators only.</div>}
      {password && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Password changed. Other devices signed in as you have been signed out.</div>}
      <div className="kpis">
        <Link href="/worklist" className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}><span>Requests</span><b>{total}</b><small>{counts.rejected ?? 0} rejected ({total ? (((counts.rejected ?? 0) / total) * 100).toFixed(1) : 0} %)</small></Link>
        <Link href="/gaya" className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}><span>Awaiting results</span><b>{awaitingResults}</b><small>created, not entered</small></Link>
        <Link href="/gaya" className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}><span>Held by Gaya</span><b style={{ color: held ? "var(--crit)" : undefined }}>{held}</b><small>failed a check</small></Link>
        <Link href="/worklist?status=awaiting_approval" className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}><span>Awaiting approval</span><b style={{ color: counts.awaiting_approval ? "var(--warn)" : undefined }}>{counts.awaiting_approval ?? 0}</b><small>chief scientist sign-off</small></Link>
        <Link href="/worklist?status=overdue" className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}><span>Overdue now</span><b style={{ color: overdue ? "var(--crit)" : undefined }}>{overdue}</b><small>past their turnaround time</small></Link>
        <div className="panel kpi"><span>Median turnaround</span><b>{hm(tat)}</b><small>received → released</small></div>
      </div>
      {biz && (
        <section className="panel business" aria-labelledby="h-biz">
          <div className="panel-head"><div><h2 id="h-biz">Business · {biz.month.label}</h2><p>Visible to the chief scientist and administrators only. Revenue counts requests approved this month, at the price on each request.</p></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn btn-sm" href="/pricing">Prices</Link><Link className="btn btn-sm" href="/inventory">Inventory</Link></div></div>
          <div className="panel-body">
            <div className="kpis">
              <div className="kpi"><span>Revenue this month</span><b>{naira(biz.month.revenue)}</b><small>{biz.lastMonth.label}: {naira(biz.lastMonth.revenue)}</small></div>
              <div className="kpi"><span>Tests done this month</span><b>{biz.month.tests}</b><small>on {biz.month.requests} released request{biz.month.requests === 1 ? "" : "s"}</small></div>
              <div className="kpi"><span>Kits available</span><b>{biz.kits}</b><small>unopened · {biz.openedKits} reagent{biz.openedKits === 1 ? "" : "s"} with an opened kit</small></div>
              <div className="kpi"><span>Stock value</span><b>{naira(biz.stockValue)}</b><small>usable lots at cost</small></div>
            </div>
            {(biz.low.length > 0 || biz.expiring.length > 0 || biz.unconfirmed > 0) && <div className="checks" style={{ marginTop: 12 }}>
              {biz.unconfirmed > 0 && <div className="check"><i className="bad">PRICE</i><span>{biz.unconfirmed} starter prices not confirmed yet. <Link href="/pricing">Review prices</Link></span></div>}
              {biz.low.map((r) => <div className="check" key={`l${r.id}`}><i className="bad">LOW</i><span>{r.name}: {r.usable_kits} kit{r.usable_kits === 1 ? "" : "s"} left (reorder at {r.reorder_level_kits})</span></div>)}
              {biz.expiring.map((r) => <div className="check" key={`e${r.id}`}><i className="bad">EXP</i><span>{r.name}: a lot expires within 30 days</span></div>)}
            </div>}
          </div>
        </section>
      )}
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <section className="panel" aria-labelledby="h-vol"><div className="panel-head"><div><h2 id="h-vol">Requests per day</h2><p>Last {vol.length} working days with activity</p></div></div><div className="panel-body"><Bars data={vol} label="Requests per day" /></div></section>
        <section className="panel" aria-labelledby="h-tat"><div className="panel-head"><div><h2 id="h-tat">Median turnaround by test</h2><p>Received → released. Amber: over 2.5 hours</p></div></div><div className="panel-body"><HBars data={tatByTest} label="Median turnaround by test" warnAbove={150} /></div></section>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)" }}>
        <section className="panel" aria-labelledby="h-gaya"><div className="panel-head"><div><h2 id="h-gaya">Gaya</h2><p>{L.model_source === "local" ? "Local model · offline" : L.model_source === "byo" ? "Lab's own API key" : "MitochronAi Connect"}</p></div></div>
          <div className="panel-body"><div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
            <div className="kpi" style={{ padding: 0 }}><span>Reports drafted</span><b>{gaya.drafted}</b></div>
            <div className="kpi" style={{ padding: 0 }}><span>Holds raised</span><b>{gaya.held}</b></div>
            <div className="kpi" style={{ padding: 0 }}><span>Approved</span><b>{gaya.approved}</b></div>
          </div></div></section>
        <section className="panel" aria-labelledby="h-qc"><div className="panel-head"><div><h2 id="h-qc">Quality control</h2><p>Latest run per control</p></div><Link className="btn btn-sm" href="/qc">Open QC</Link></div>
          <div className="panel-body"><div className="checks">{qc.map((q) => <div className="check" key={q.test + q.level}><i className={q.state === "ok" ? "" : "bad"}>{q.state === "ok" ? "OK" : q.state === "warning" ? "1-2s" : "REJ"}</i><span>{q.test} {q.level}: {q.last?.value ?? "—"} (target {q.mean})</span></div>)}</div></div></section>
        <section className="panel" aria-labelledby="h-sop"><div className="panel-head"><div><h2 id="h-sop">SOP coverage</h2><p>{SOPS.filter((s) => s[2]).length} of {SOPS.length} tests have an SOP Gaya can cite</p></div></div>
          <div className="panel-body"><div className="checks">{SOPS.map(([n, code, ok]) => <div className="check" key={n}><i className={ok ? "" : "bad"}>{ok ? "SOP" : "GAP"}</i><span>{n}{code && <span className="sub mono"> · {code}</span>}</span></div>)}</div></div></section>
      </div>
      <section className="panel" aria-labelledby="h-act">
        <div className="panel-head"><div><h2 id="h-act">Recent activity</h2><p>Everyone in the lab, newest first</p></div>{biz && <Link className="btn btn-sm" href="/audit">Full audit log</Link>}</div>
        <div className="panel-body" style={{ paddingTop: 4 }}><ol className="timeline">{activity.map((a) => (
          <li key={a.id}><time>{shortDateTime(a.at)}</time><span>{a.actor_type === "gaya" ? <span className="who-gaya">Gaya</span> : <b>{staff[a.actor_id ?? ""]?.display_name ?? "System"}</b>} · {a.detail}</span></li>))}</ol></div>
      </section>
    </>
  );
}
