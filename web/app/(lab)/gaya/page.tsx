import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime, shortDateTime } from "@/lib/format";
import { checksFor, heldOrders, lab, patient, type Order } from "@/lib/lab";

export const metadata = { title: "Held by Gaya" };

export default async function GayaPage() {
  await requireUser();
  const L = lab(), held = heldOrders();
  const waiting = db().prepare(`SELECT * FROM orders WHERE status = 'in_progress' AND id IN (SELECT order_id FROM results WHERE status = 'pending') ORDER BY received_at`).all() as Order[];
  const recent = db().prepare(`SELECT * FROM audit_log WHERE actor_type = 'gaya' ORDER BY id DESC LIMIT 10`).all() as { id: number; at: string; action: string; detail: string }[];
  return (
    <>
      <div className="pagehead">
        <div><div className="eyebrow">{L.assistant_name} checks every saved result against the roster, catalogue, read windows, cut-offs and formulas</div><h1>Held by Gaya</h1></div>
      </div>
      <p className="sub" style={{ margin: 0, maxWidth: "75ch" }}>Gaya never quietly fixes a problem. It holds the request, says exactly what failed, and waits for a scientist to correct the results or the record. Nothing held can be approved or sent.</p>
      {held.length === 0 ? (
        <section className="panel"><div className="panel-body"><b>Nothing is held.</b><span className="sub">Every saved request passed Gaya&apos;s checks.</span></div></section>
      ) : held.map((o) => {
        const p = patient(o.patient_id), failed = checksFor(o).filter((c) => !c.ok);
        return (
          <section key={o.id} className="panel" aria-labelledby={`h-${o.id}`} style={{ borderLeft: "3px solid var(--crit-solid)" }}>
            <div className="panel-head">
              <div><h2 id={`h-${o.id}`}><span className="mono">{p.lab_patient_id}</span> · {p.full_name}</h2><p>Received {dateTime(o.received_at)}</p></div>
              <span className="pill crit">Held</span>
            </div>
            <div className="panel-body">
              <div className="checks">{failed.map((c, i) => <div className="check" key={i}><i className="bad">HOLD</i><span>{c.text}</span></div>)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="btn btn-primary" href={`/orders/${o.id}/enter`}>Correct results</Link>
                <Link className="btn" href={`/orders/${o.id}`}>Open record</Link>
              </div>
            </div>
          </section>
        );
      })}
      <div className="grid2">
        <section className="panel" aria-labelledby="h-wait">
          <div className="panel-head"><div><h2 id="h-wait">Waiting for results</h2><p>Requests created but not yet entered</p></div></div>
          <div className="panel-body" style={{ paddingTop: 4 }}>{waiting.length ? <ol className="timeline">{waiting.map((o) => { const p = patient(o.patient_id); return (
            <li key={o.id}><time>{shortDateTime(o.received_at)}</time><span><Link href={`/orders/${o.id}/enter`}>{p.lab_patient_id} · {p.full_name}</Link></span></li>); })}</ol>
            : <p className="sub" style={{ margin: 0 }}>None.</p>}</div>
        </section>
        <section className="panel" aria-labelledby="h-act">
          <div className="panel-head"><div><h2 id="h-act">Gaya&apos;s recent work</h2><p>From the audit log</p></div></div>
          <div className="panel-body" style={{ paddingTop: 4 }}><ol className="timeline">{recent.map((a) => <li key={a.id}><time>{shortDateTime(a.at)}</time><span><span className="mono sub">{a.action}</span> · {a.detail}</span></li>)}</ol></div>
        </section>
      </div>
    </>
  );
}
