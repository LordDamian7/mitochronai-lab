import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import StatePill from "@/components/StatePill";
import { currentReport, orderState, type Order, type Patient } from "@/lib/lab";
import { duration, overdueCount, tatStatus } from "@/lib/tat";

export const metadata = { title: "Worklist" };

const FILTERS = [["all", "All"], ["overdue", "Overdue"], ["in_progress", "In progress"], ["awaiting_approval", "Awaiting approval"], ["released", "Released"], ["rejected", "Rejected"]] as const;
const DUE: Record<string, string> = { overdue: "crit", due_soon: "warn", on_time: "mute" };
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

export default async function Worklist({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await requireUser();
  const { status = "all" } = await searchParams;
  const rows = db().prepare(`SELECT o.*, p.lab_patient_id, p.full_name, p.sex,
      COALESCE((SELECT GROUP_CONCAT(panel_code) FROM order_panels op WHERE op.order_id = o.id), (SELECT GROUP_CONCAT(DISTINCT test_code) FROM results r WHERE r.order_id = o.id)) tests,
      (SELECT GROUP_CONCAT(test_code || ':' || flag) FROM results r WHERE r.order_id = o.id AND flag IN ('H','L','C','POS','A')) flags
    FROM orders o JOIN patients p ON p.id = o.patient_id ${status === "all" || status === "overdue" ? "" : "WHERE o.status = ?"} ORDER BY o.received_at DESC`)
    .all(...(status === "all" || status === "overdue" ? [] : [status])) as (Order & Pick<Patient, "lab_patient_id" | "full_name" | "sex"> & { tests: string | null; flags: string | null })[];
  const tat = Object.fromEntries(rows.map((o) => [o.id, tatStatus(o.id)]));
  const shown = status === "overdue" ? rows.filter((o) => tat[o.id].state === "overdue") : rows;
  const counts: Record<string, number> = Object.fromEntries((db().prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.overdue = overdueCount();
  const awaiting = counts.awaiting_approval ?? 0;

  return (
    <>
      <div className="pagehead">
        <div><div className="eyebrow">All benches</div><h1>Worklist</h1></div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {me.role === "chief_scientist" && awaiting > 0 && <p className="sub" style={{ margin: 0 }}>{awaiting} report{awaiting > 1 ? "s" : ""} drafted by Gaya waiting for your preview and approval.</p>}
          <Link className="btn btn-primary" href="/requests/new">New request</Link>
        </div>
      </div>
      <section className="panel" aria-label="Requests">
        <nav className="tabs" aria-label="Filter by status">
          {FILTERS.map(([k, l]) => (
            <Link key={k} href={k === "all" ? "/worklist" : `/worklist?status=${k}`} className="tab" aria-current={status === k ? "page" : undefined}>
              {l}<span className="count">{k === "all" ? total : counts[k] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <div className="tablewrap">
          <table className="grid cards">
            <thead><tr><th>Lab ID</th><th>Patient</th><th>Tests</th><th>Flags</th><th>Received</th><th>Due</th><th>Status</th><th>Report</th></tr></thead>
            <tbody>
              {shown.map((o) => {
                const rep = o.status === "rejected" ? undefined : currentReport(o.id);
                const state = orderState(o);
                return (
                  <tr key={o.id}>
                    <td data-label="Lab ID" className="nowrap primary"><Link className="rowlink mono" href={`/orders/${o.id}`}>{o.lab_patient_id}</Link></td>
                    <td data-label="Patient">{o.full_name} <span className="sub">{o.sex}</span></td>
                    <td data-label="Tests" className="mono" style={{ fontSize: 12.5 }}>{o.tests?.split(",").slice(0, 5).join(", ") ?? "—"}</td>
                    <td data-label="Flags">{o.status === "rejected" ? <span className="sub">{o.reject_reason}</span>
                      : o.flags ? o.flags.split(",").slice(0, 3).map((f) => { const [t, fl] = f.split(":"); return <span key={f} className={`flag ${fl}`} style={{ marginRight: 6 }}>{t} {fl}</span>; })
                      : <span className="sub">Within range</span>}</td>
                    <td data-label="Received" className="mono nowrap" style={{ fontSize: 12.5 }}>{fmt(o.received_at)}</td>
                    <td data-label="Due" className="nowrap">{tat[o.id].state === "done" ? <span className="sub">—</span>
                      : <span className={`pill ${DUE[tat[o.id].state]}`} title={`Due ${fmt(tat[o.id].dueAt!)}`}>{tat[o.id].state === "overdue" ? `${duration(tat[o.id].minutes)} late` : `${duration(tat[o.id].minutes)} left`}</span>}</td>
                    <td data-label="Status"><StatePill state={state} /></td>
                    <td data-label="Report" className="nowrap">{rep ? <Link className="btn btn-sm" href={`/orders/${o.id}/report`} prefetch={false}>{rep.status === "final" ? "View" : "Preview"}</Link> : <span className="sub">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
