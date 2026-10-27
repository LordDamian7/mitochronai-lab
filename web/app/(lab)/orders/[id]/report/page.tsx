import Link from "next/link";
import { notFound } from "next/navigation";
import ResultReport from "@/components/ResultReport";
import { requireUser } from "@/lib/auth";
import { publish } from "@/lib/events";
import { currentReport, order, patient, recordPreview } from "@/lib/lab";
import { approveAction } from "../actions";

export const metadata = { title: "Report preview" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; approved?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const { error, approved } = await searchParams;
  const o = order(id), rep = o && currentReport(id);
  if (!o || !rep) notFound();
  const p = patient(o.patient_id);
  // Opening this page is the preview. It's recorded per user, and it is what unlocks "Approve and send" for the chief.
  if (recordPreview(rep.id, me.id)) publish("report.previewed", id, me.display_name);
  const canApprove = me.role === "chief_scientist" && rep.status === "draft" && o.status === "awaiting_approval";
  return (
    <>
      <div className="pagehead noprint">
        <div>
          <div className="eyebrow"><Link href="/worklist">Worklist</Link> / <Link href={`/orders/${id}`}>{p.lab_patient_id}</Link> / Report</div>
          <h1>{rep.status === "final" ? "Result report" : `Report preview · draft v${rep.version} by Gaya`}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href={`/orders/${id}`}>Back to record</Link>
          {canApprove && (
            <form action={approveAction}>
              <input type="hidden" name="orderId" value={id} />
              <input type="hidden" name="back" value={`/orders/${id}/report`} />
              <button className="btn btn-primary" type="submit">Approve and send</button>
            </form>
          )}
        </div>
      </div>
      {error && <div className="notice err noprint" role="alert">{error}</div>}
      {approved && <div className="notice noprint" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Approved. The signed report was sent to {p.email}. (Delivery isn&apos;t connected yet, so nothing actually left the server.)</div>}
      <ResultReport order={o} report={rep} />
    </>
  );
}
