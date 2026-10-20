import Link from "next/link";
import UnsavedGuard from "@/components/UnsavedGuard";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { saveResults } from "@/lib/entry";
import { publish } from "@/lib/events";
import { refText, unit } from "@/lib/format";
import { catalogFor, order, patient, resultsFor } from "@/lib/lab";
import { CALCULATED, optionsOf, qualLabels } from "@/lib/rules";

export const metadata = { title: "Enter results" };
const toLocal = (iso: string) => new Date(Date.parse(iso) + 3600000).toISOString().slice(0, 16); // shown in WAT
const toIso = (local: string) => new Date(`${local}:00+01:00`).toISOString();

async function save(formData: FormData) {
  "use server";
  const me = await requireUser();
  const id = String(formData.get("orderId"));
  const entries: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("r_")) entries[k.slice(2)] = String(v);
  const collected = String(formData.get("collected_at") ?? ""), read = String(formData.get("read_at") ?? "");
  const r = saveResults(id, entries, collected ? toIso(collected) : null, read ? toIso(read) : null, me.id);
  if (!r.ok) redirect(`/orders/${id}/enter?error=${encodeURIComponent(r.reason)}`);
  publish(r.held ? "discrepancy.raised" : "results.entered", id, me.display_name);
  redirect(`/orders/${id}?${r.held ? "held" : "saved"}=1`);
}

export default async function EnterResults({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  const o = order(id);
  if (!o) notFound();
  if (o.status === "released" || o.status === "rejected") redirect(`/orders/${id}`);
  const p = patient(o.patient_id), rs = resultsFor(id);
  const entered = rs.some((r) => r.status !== "pending");
  const mantoux = rs.find((r) => r.test_code === "MANTOUX");
  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow"><Link href="/worklist">Worklist</Link> / <Link href={`/orders/${id}`}>{p.lab_patient_id}</Link> / {entered ? "Correct results" : "Enter results"}</div>
          <h1>{p.full_name}</h1>
          <div className="sub">{p.sex === "F" ? "Female" : "Male"} · born {p.date_of_birth}{p.risk_factors ? ` · risk factors: ${p.risk_factors.replace(/;/g, ", ").replace(/_/g, " ")}` : ""}</div>
        </div>
      </div>
      {error && <div className="notice err" role="alert">{error}</div>}
      {entered && <div className="notice" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>Correcting results withdraws any draft report. Gaya re-checks and drafts a new version.</div>}
      <UnsavedGuard formId="entry-form" message="Your results aren't saved yet. Leave this page and lose them?" />
      <form action={save} className="panel" id="entry-form">
        <input type="hidden" name="orderId" value={id} />
        <div className="panel-head"><div><h2>Results</h2><p>Flags and calculated values (LDL, MCV, eGFR and others) are worked out by the server when you save</p></div></div>
        <div className="panel-body">
          <div className="formgrid">
            <label className="field" htmlFor="collected_at">{mantoux ? "Placed / collected at" : "Collected at"}
              <input id="collected_at" name="collected_at" type="datetime-local" defaultValue={toLocal(rs[0].collected_at)} required /></label>
            {mantoux && <label className="field" htmlFor="read_at">Mantoux read at (48–72 h after placement)
              <input id="read_at" name="read_at" type="datetime-local" defaultValue={mantoux.read_at ? toLocal(mantoux.read_at) : toLocal(new Date().toISOString())} required /></label>}
          </div>
          <div className="tablewrap">
            <table className="grid cards entry">
              <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th></tr></thead>
              <tbody>{rs.map((r) => {
                const c = catalogFor(r.test_code, p.sex), name = `r_${r.test_code}`;
                const current = c.result_type === "qualitative" ? (r.flag === "POS" || r.flag === "NEG" ? r.flag : "") : r.value_numeric ?? r.value_text ?? "";
                const req = !c.optional;
                return (
                  <tr key={r.id}>
                    <td data-label="Test" className="primary"><label htmlFor={name}>{c.name}</label>{!req && <span className="sub"> · optional</span>}</td>
                    <td data-label="Result">
                      {CALCULATED.has(r.test_code) ? <span className="sub">Calculated on save{r.value_numeric !== null ? ` (now ${r.value_numeric})` : ""}</span>
                        : c.result_type === "numeric" ? <input id={name} name={name} inputMode="decimal" defaultValue={String(current)} required={req} autoComplete="off" className="result-input" />
                        : c.result_type === "qualitative" ? <select id={name} name={name} defaultValue={String(current)} required={req} className="result-input"><option value="" disabled>Choose…</option><option value="NEG">{qualLabels(c)[0]}</option><option value="POS">{qualLabels(c)[1]}</option></select>
                        : c.result_type === "choice" ? <select id={name} name={name} defaultValue={String(current)} required={req} className="result-input"><option value="" disabled>Choose…</option>{optionsOf(c).map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}</select>
                        : <textarea id={name} name={name} defaultValue={String(current)} required={req} rows={3} className="result-input result-text" placeholder={c.ref_text} />}
                    </td>
                    <td data-label="Unit" className="sub">{unit(c.unit)}</td>
                    <td data-label="Reference" className="sub">{refText(c.ref_text)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit">Save and send to Gaya</button>
            <Link className="btn" href={`/orders/${id}`}>Cancel</Link>
          </div>
        </div>
      </form>
    </>
  );
}
