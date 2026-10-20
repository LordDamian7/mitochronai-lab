import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { auditActions, queryAudit, type AuditFilter } from "@/lib/auditlog";
import { db } from "@/lib/db";
import { staffMap } from "@/lib/lab";
import { isManager } from "@/lib/staff";

export const metadata = { title: "Audit log" };
const MODEL: Record<string, string> = { local: "local model", byo: "own API key", connect: "MitochronAi Connect" };
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Chief scientist and administrators only: the log records prices, costs and staff changes. Request pages keep their own history. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if (!isManager(me)) redirect("/dashboard?denied=audit");
  const sp = await searchParams;
  const f: AuditFilter = { from: pick(sp.from), to: pick(sp.to), actor: pick(sp.actor), action: pick(sp.action), q: pick(sp.q) };
  const rows = queryAudit({ ...f, limit: 300 }), staff = staffMap(), actions = auditActions();
  const people = db().prepare("SELECT id, display_name FROM staff ORDER BY display_name").all() as { id: string; display_name: string }[];
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow">Append-only · the database refuses edits and deletions</div><h1>Audit log</h1>
        <div className="sub">Every sign-in, result, approval, price and stock change. Visible to the chief scientist and administrators.</div></div>
        <a className="btn" href={`/api/audit.csv${qs ? `?${qs}` : ""}`} download>Export CSV</a></div>
      <form className="panel filters" method="get" aria-label="Filter the audit log">
        <label className="field" htmlFor="f-from">From<input id="f-from" name="from" type="date" defaultValue={f.from} /></label>
        <label className="field" htmlFor="f-to">To<input id="f-to" name="to" type="date" defaultValue={f.to} /></label>
        <label className="field" htmlFor="f-actor">Who<select id="f-actor" name="actor" defaultValue={f.actor}><option value="">Anyone</option><option value="gaya">Gaya</option><option value="system">System</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
        <label className="field" htmlFor="f-action">Action<select id="f-action" name="action" defaultValue={f.action}><option value="">Any action</option>{actions.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field grow" htmlFor="f-q">Contains<input id="f-q" name="q" type="search" defaultValue={f.q} placeholder="Lab ID, request, name, lot…" maxLength={100} /></label>
        <div className="filter-actions"><button className="btn btn-primary" type="submit">Filter</button><Link className="btn" href="/audit">Clear</Link></div>
      </form>
      <section className="panel" aria-label="Audit entries">
        <div className="panel-head"><div><h2>{rows.length === 300 ? "Latest 300 matching entries" : `${rows.length} matching entr${rows.length === 1 ? "y" : "ies"}`}</h2><p>Newest first. Export includes up to 5,000.</p></div></div>
        <div className="tablewrap"><table className="grid">
          <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="mono sub" style={{ whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Lagos" })}</td>
              <td>{r.actor_type === "gaya" ? <><span className="who-gaya">Gaya</span> <span className="sub">{MODEL[r.model ?? ""] ?? ""}</span></> : r.actor_type === "system" ? <span className="sub">System</span> : staff[r.actor_id ?? ""]?.display_name}</td>
              <td className="mono" style={{ fontSize: 12.5 }}>{r.action}</td>
              <td>{r.detail}</td>
            </tr>))}</tbody>
        </table></div>
      </section>
    </>
  );
}
