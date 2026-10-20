import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import StatePill from "@/components/StatePill";
import { rejectSample } from "@/lib/entry";
import { publish } from "@/lib/events";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { catalogFor, checksFor, currentReport, hasPreviewed, lab, order, orderState, patient, resultsFor, staffMap } from "@/lib/lab";
import { approveAction } from "./actions";
import { CALL_ROLES, callsFor, criticalsNeedingCall, recordCall, type CallRole } from "@/lib/critical";
import { refText, shortDateTime, unit } from "@/lib/format";
import { resultText } from "@/lib/rules";

const tz = { timeZone: "Africa/Lagos" } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", ...tz }) : "—");
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...tz });

const FileIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
const MailIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;

async function reject(formData: FormData) {
  "use server";
  const me = await requireUser();
  const id = String(formData.get("orderId"));
  const res = rejectSample(id, String(formData.get("reason") ?? ""), me.id);
  if (!res.ok) redirect(`/orders/${id}?error=${encodeURIComponent(res.reason)}`);
  publish("sample.rejected", id, me.display_name);
  redirect(`/orders/${id}`);
}

async function phoned(formData: FormData) {
  "use server";
  const me = await requireUser();
  const id = String(formData.get("orderId"));
  const r = recordCall(id, { called_name: String(formData.get("called_name") ?? ""), called_role: String(formData.get("called_role")) as CallRole, read_back: formData.get("read_back") === "on" }, me);
  if (!r.ok) redirect(`/orders/${id}?error=${encodeURIComponent(r.reason)}`);
  publish("critical.called", id, me.display_name);
  redirect(`/orders/${id}?called=1`);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = order((await params).id);
  return { title: o ? patient(o.patient_id).lab_patient_id : "Not found" };
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; approved?: string; saved?: string; held?: string; called?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const { error, approved, saved, held, called } = await searchParams;
  const o = order(id);
  if (!o) notFound();
  const p = patient(o.patient_id), rs = resultsFor(id), staff = staffMap(), L = lab();
  const state = orderState(o);
  const pending = rs.some((r) => r.status === "pending");
  const checks = o.status === "rejected" || pending ? [] : checksFor(o);
  const allOk = checks.every((c) => c.ok);
  const rep = o.status === "rejected" ? undefined : currentReport(id);
  const previewed = rep ? hasPreviewed(rep.id, me.id) : false;
  const isChief = me.role === "chief_scientist";
  const canApprove = isChief && o.status === "awaiting_approval" && rep?.status === "draft" && previewed && allOk;
  const toCall = o.status === "rejected" ? [] : criticalsNeedingCall(id), calls = callsFor(id);
  const history = db().prepare("SELECT * FROM audit_log WHERE entity = 'order' AND entity_id = ? ORDER BY id DESC LIMIT 12").all(id) as { id: number; at: string; actor_type: string; actor_id: string | null; action: string; detail: string }[];
  const fileName = `${p.lab_patient_id}_${p.full_name.replace(/\s+/g, "_")}_Result.pdf`;
  const gate = !rep ? "Gaya drafts the report once every check passes."
    : !isChief ? `Only a chief scientist can approve and send. You're signed in as ${me.display_name}.`
    : !previewed ? "Open the report preview first. Approve and send unlocks once you've seen the generated result."
    : `You've previewed draft v${rep.version}. Approving signs it with your name and sends it to ${p.email} with the PDF attached.`;

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow"><Link href="/worklist">Worklist</Link> / <span className="mono">{p.lab_patient_id}</span></div>
          <h1>{p.full_name}</h1>
          <div className="sub">{p.sex === "F" ? "Female" : "Male"} · born {p.date_of_birth} · {p.phone} · received {fmt(o.received_at)}{o.fasting_hours ? ` · fasting ${o.fasting_hours} h` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StatePill state={state} />
          {(state === "awaiting_results" || state === "held" || state === "awaiting_approval") &&
            <Link className={`btn${state === "awaiting_results" ? " btn-primary" : ""}`} href={`/orders/${id}/enter`}>{state === "awaiting_results" ? "Enter results" : "Correct results"}</Link>}
        </div>
      </div>
      {error && <div className="notice err" role="alert">{error}</div>}
      {approved && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Approved and sent to {p.email}.</div>}
      {saved && state === "awaiting_approval" && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Results saved. Every check passed, and Gaya drafted the report for the chief scientist&apos;s approval.</div>}
      {called && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Call recorded with read-back. It&apos;s in the audit log.</div>}
      {held && state === "held" && <div className="notice err" role="status">Results saved, but Gaya is holding this request. See the failed checks below, then correct the results or the record.</div>}

      {o.status === "rejected" ? (
        <section className="panel"><div className="panel-head"><h2>Sample rejected</h2></div><div className="panel-body"><p style={{ margin: 0 }}>{o.reject_reason}</p></div></section>
      ) : (
        <div className="grid2">
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            <section className="panel" aria-labelledby="h-res">
              <div className="panel-head"><div><h2 id="h-res">Results</h2><p>{pending ? "Not entered yet" : `Performed by ${[...new Set(rs.map((r) => staff[r.performed_by ?? ""]?.display_name))].join(", ")}`}</p></div></div>
              <div className="tablewrap"><table className="grid cards" style={{ minWidth: 560 }}>
                <thead><tr><th>Test</th><th>Result</th><th>Reference</th><th>Flag</th><th>Tested</th></tr></thead>
                <tbody>{rs.map((r) => { const c = catalogFor(r.test_code, p.sex); return (
                  <tr key={r.id}><td data-label="Test" className="primary">{c.name}{r.value_source === "calculated" && <span className="sub"> · calc.</span>}</td>
                    <td data-label="Result" className="num" style={{ fontWeight: 600 }}>{r.status === "pending" ? <span className="sub" style={{ fontWeight: 400 }}>Awaiting entry</span> : <span className={c.result_type === "text" ? "result-prose" : undefined}>{resultText(r, c)}</span>} <span className="sub" style={{ fontWeight: 400 }}>{unit(r.unit)}</span></td>
                    <td data-label="Reference" className="sub">{refText(c.ref_text)}</td><td data-label="Flag">{r.flag ? <span className={`flag ${r.flag}`}>{r.flag}</span> : "—"}</td>
                    <td data-label="Tested" className="mono sub">{r.status === "pending" ? "—" : r.test_code === "MANTOUX" ? `read ${fmt(r.read_at)}` : time(r.tested_at!)}</td></tr>); })}</tbody>
              </table></div>
            </section>
            {(toCall.length > 0 || calls.length > 0) && (
              <section className={`panel critical-panel${toCall.length ? " due" : ""}`} aria-labelledby="h-crit">
                <div className="panel-head"><div><h2 id="h-crit">Critical result call</h2><p>ISO 15189 §7.4.1.3: phone the clinician now; they read the result back to you</p></div>
                  {toCall.length ? <span className="pill crit">Call needed</span> : <span className="pill ok">Phoned</span>}</div>
                <div className="panel-body">
                  {toCall.length > 0 && <form action={phoned} className="formgrid">
                    <input type="hidden" name="orderId" value={id} />
                    <p className="span2" style={{ margin: 0 }}><b>To phone:</b> {toCall.map((c) => `${c.name} ${c.value}${c.unit ? ` ${unit(c.unit)}` : ""}`).join(", ")} · requested by {o.requested_by}</p>
                    <label className="field" htmlFor="called_name">Name of the person you spoke to<input id="called_name" name="called_name" required maxLength={80} defaultValue={o.requested_by.startsWith("[") ? "" : o.requested_by} autoComplete="off" /></label>
                    <label className="field" htmlFor="called_role">They are the<select id="called_role" name="called_role" defaultValue="requesting_clinician">{Object.entries(CALL_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label className="span2 checkline" htmlFor="read_back"><input type="checkbox" id="read_back" name="read_back" required /> They read the result back to me correctly</label>
                    <div className="span2"><button className="btn btn-primary" type="submit">Record the call</button></div>
                  </form>}
                  {calls.length > 0 && <ol className="timeline">{calls.map((c, i) => <li key={i}><time>{shortDateTime(c.at)}</time><span>{c.test_code} {c.value} phoned by <b>{staff[c.called_by]?.display_name}</b> to {c.called_name} ({CALL_ROLES[c.called_role as CallRole]}), read back</span></li>)}</ol>}
                </div>
              </section>
            )}
            <section className="panel" aria-labelledby="h-chk">
              <div className="panel-head"><div><h2 id="h-chk">Gaya&apos;s checks</h2><p>Deterministic rules: duty roster, units, read windows, cut-offs, formulas</p></div>
                {pending ? <span className="pill mute">Waiting for results</span> : allOk ? <span className="pill ok">All passed</span> : <span className="pill crit">Holding</span>}</div>
              <div className="panel-body">{pending ? <p className="sub" style={{ margin: 0 }}>Gaya checks the request as soon as the results are saved.</p>
                : <div className="checks">{checks.map((c, i) => <div className="check" key={i}><i className={c.ok ? "" : "bad"}>{c.ok ? "PASS" : "HOLD"}</i><span>{c.text}</span></div>)}</div>}</div>
            </section>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            <section className="panel" aria-labelledby="h-att">
              <div className="panel-head"><div><h2 id="h-att">Prepared by {L.assistant_name}</h2><p>Attached to this patient&apos;s record</p></div></div>
              <div className="panel-body">
                {!rep ? <p className="sub" style={{ margin: 0 }}>No report yet. Gaya drafts it when every check passes.</p> : <>
                  <div className="attach"><FileIcon />
                    <div className="meta"><b>{fileName}</b><span className="sub">{rep.status === "final" ? `Final · signed by ${staff[rep.approved_by!].display_name}` : `Draft v${rep.version} · ${fmt(rep.drafted_at)}`}</span></div>
                    {rep.status === "draft" && <span className={`pill ${previewed ? "info" : "warn"}`}>{previewed ? "Previewed" : "Not previewed"}</span>}
                    <Link className="btn btn-sm" href={`/orders/${id}/report`} prefetch={false}>{rep.status === "final" ? "View" : "Preview"}</Link>
                  </div>
                  <div className="attach"><MailIcon />
                    <div className="meta"><b>{p.email}</b><span className="sub">Result e-mail with the PDF · {rep.email_status === "sent" ? `sent ${fmt(rep.email_sent_at)}` : "drafted, not sent"}</span></div>
                  </div>
                </>}
              </div>
            </section>
            <section className="panel" aria-labelledby="h-app">
              <div className="panel-head"><h2 id="h-app">Approval</h2></div>
              <div className="panel-body">
                {o.status === "released" && rep?.approved_by ? <p style={{ margin: 0 }}>Approved by <b>{staff[rep.approved_by].display_name}</b> on {fmt(rep.approved_at)}. The signed report was e-mailed to the patient.</p> : <>
                  <div className={`gate${canApprove ? " ready" : ""}`}>{pending ? "Enter the results first. Gaya then checks them and drafts the report." : allOk ? gate : "Gaya is holding this record because a check failed. Correct the results (or the record) and save again."}</div>
                  <form action={approveAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="orderId" value={id} />
                    <button className="btn btn-primary" type="submit" disabled={!canApprove}>Approve and send</button>
                    {rep && <Link className="btn" href={`/orders/${id}/report`} prefetch={false}>Preview report</Link>}
                  </form>
                  <details className="reject">
                    <summary>Reject the sample</summary>
                    <form action={reject} className="formgrid" style={{ marginTop: 10 }}>
                      <input type="hidden" name="orderId" value={id} />
                      <label className="field span2" htmlFor="reason">Reason (recorded in the audit log)
                        <select id="reason" name="reason" required defaultValue=""><option value="" disabled>Choose a reason…</option>
                          {["Haemolysed sample", "Clotted sample", "Insufficient volume", "Wrong container", "Unlabelled or mislabelled sample", "Sample too old"].map((x) => <option key={x}>{x}</option>)}
                        </select></label>
                      <div className="span2"><button className="btn" type="submit" style={{ color: "var(--crit)" }}>Reject sample</button></div>
                    </form>
                  </details>
                </>}
              </div>
            </section>
            <section className="panel" aria-labelledby="h-hist">
              <div className="panel-head"><h2 id="h-hist">History</h2></div>
              <div className="panel-body" style={{ paddingTop: 4 }}>
                {history.length ? <ol className="timeline">{history.map((h) => (
                  <li key={h.id}><time dateTime={h.at}>{shortDateTime(h.at)}</time><span>{h.actor_type === "gaya" ? <span className="who-gaya">Gaya</span> : <b>{staff[h.actor_id ?? ""]?.display_name ?? "System"}</b>} · {h.detail}</span></li>))}</ol>
                  : <p className="sub" style={{ margin: 0 }}>No actions recorded on this request yet.</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
