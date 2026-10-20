/* eslint-disable @next/next/no-img-element */
import { refText, unit } from "@/lib/format";
import { catalogFor, lab, patient, resultsFor, staffMap, type Order, type Report } from "@/lib/lab";
import { ageAt, resultText } from "@/lib/rules";

// Signature images on file. A scientist without one gets "[signature on file]".
const SIG: Record<string, string> = { "STF-001": "/brand/sig-chief-gram-stain.png", "STF-002": "/brand/sig-taenia-solium.png" };
const tz = { timeZone: "Africa/Lagos" } as const;
const dt = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", ...tz })}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...tz })}` : "—");
const FLAG: Record<string, string> = { N: "Normal", H: "H", L: "L", C: "CRITICAL", POS: "POSITIVE", NEG: "NEGATIVE", A: "ABNORMAL" };

/** The patient's result, laid out like the lab's sample report on the MitoChron letterhead. */
export default function ResultReport({ order: o, report }: { order: Order; report: Report }) {
  const L = lab(), p = patient(o.patient_id), rs = resultsFor(o.id), staff = staffMap();
  const final = report.status === "final";
  const groups = new Map<string, { r: (typeof rs)[number]; c: ReturnType<typeof catalogFor> }[]>();
  for (const r of rs) { const c = catalogFor(r.test_code, p.sex); groups.set(c.department, [...(groups.get(c.department) ?? []), { r, c }]); }
  const performers = [...new Set(rs.map((r) => r.performed_by).filter(Boolean))] as string[];
  return (
    <article className="paper" aria-label={`Result report for ${p.full_name}`}>
      {!final && <div className="watermark" aria-hidden="true">DRAFT</div>}
      <img className="band" src="/brand/band-top.png" alt="" />
      <div className="lh-top">
        <img src="/brand/logo.png" alt="MitoChron AI: Intelligence. Health. Impact." />
        <div className="lh-contact"><b>{L.name}</b><span>{L.address}</span><span>Tel {L.phone} · mitochron-ai.tech</span></div>
      </div>
      <div className="doc">
        <h2>LABORATORY RESULT REPORT</h2>
        <div className="pblock">
          <div><span>PATIENT NAME</span><b>{p.full_name}</b></div>
          <div><span>AGE / SEX</span><b>{ageAt(p.date_of_birth, rs[0].collected_at)} years / {p.sex === "F" ? "Female" : "Male"}</b></div>
          <div><span>LAB ID</span><b>{p.lab_patient_id}</b></div>
          <div><span>PHONE</span><b>{p.phone}</b></div>
          <div><span>REFERRED BY</span><b>{o.requested_by}</b></div>
          <div><span>SAMPLE COLLECTED</span><b>{dt(rs[0].collected_at)}</b></div>
          <div><span>FASTING STATUS</span><b>{o.fasting_hours ? `${o.fasting_hours} h (confirmed)` : "Not required"}</b></div>
          <div><span>REPORT DATE</span><b>{final ? dt(report.approved_at) : `Draft v${report.version}, not released`}</b></div>
        </div>
        {[...groups].map(([dept, rows]) => {
          const num = rows.filter(({ r, c }) => c.result_type === "numeric" && r.test_code !== "MANTOUX");
          const qual = rows.filter(({ c }) => c.result_type !== "numeric");
          const tst = rows.filter(({ r }) => r.test_code === "MANTOUX");
          return (
            <div className="sect" key={dept}>
              <h3>{dept.toUpperCase()}</h3>
              {num.length > 0 && <div className="tablewrap"><table className="rtab"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead><tbody>
                {num.map(({ r, c }) => <tr key={r.id}><td>{c.name}{r.value_source === "calculated" && <span style={{ color: "var(--ink-2)" }}> (calc.)</span>}</td><td className="res">{r.value_numeric}</td><td>{unit(r.unit)}</td><td>{refText(c.ref_text)}</td><td className={`f${r.flag}`}>{FLAG[r.flag ?? ""] ?? ""}</td></tr>)}
              </tbody></table></div>}
              {qual.length > 0 && <div className="tablewrap"><table className="rtab"><thead><tr><th>Specimen</th><th>Test</th><th>Result</th><th>Expected</th></tr></thead><tbody>
                {qual.map(({ r, c }) => <tr key={r.id}><td>{c.specimen}</td><td>{c.name}</td><td className={`res f${r.flag}${c.result_type === "text" ? " prose" : ""}`}>{c.result_type === "qualitative" ? resultText(r, c).toUpperCase() : resultText(r, c)}{r.flag === "A" ? " *" : ""}</td><td>{refText(c.ref_text)}</td></tr>)}
              </tbody></table></div>}
              {tst.map(({ r }) => {
                const hrs = (Date.parse(r.read_at!) - Date.parse(r.collected_at)) / 3.6e6, cut = p.risk_factors ? 5 : 10;
                return <div className="tablewrap" key={r.id}><table className="rtab"><tbody>
                  <tr><td style={{ width: "34%" }}><b>Tuberculin used</b></td><td>PPD 0.1 mL intradermal · Lot [No.]</td></tr>
                  <tr><td><b>Site</b></td><td>Left volar forearm</td></tr>
                  <tr><td><b>Administered</b></td><td>{dt(r.collected_at)}</td></tr>
                  <tr><td><b>Read</b></td><td>{dt(r.read_at)} ({hrs.toFixed(1)} hours)</td></tr>
                  <tr><td><b>Induration</b></td><td className="res">{r.value_numeric} mm (transverse diameter)</td></tr>
                  <tr><td><b>Interpretation</b></td><td className={`f${r.flag}`}><b>{r.flag === "POS" ? "POSITIVE" : "NEGATIVE"}</b> at the ≥ {cut} mm cut-off{p.risk_factors ? " (risk factor on file)" : " (no risk factor reported)"}</td></tr>
                </tbody></table></div>;
              })}
            </div>
          );
        })}
        <div className="sigs">
          <div className="sig"><span className="k">PERFORMED BY</span>
            {performers.map((id) => SIG[id] ? <img key={id} src={SIG[id]} alt={`Signature of ${staff[id].display_name}`} /> : <div key={id} className="pending" style={{ color: "var(--ink-2)", fontWeight: 400 }}>[signature on file]</div>)}
            <b>{performers.map((id) => staff[id].display_name).join(", ")}</b><span>Medical Laboratory Scientist</span></div>
          <div className="sig"><span className="k">VERIFIED &amp; AUTHORISED BY</span>
            {final && report.approved_by && SIG[report.approved_by] ? <img src={SIG[report.approved_by]} alt={`Signature of ${staff[report.approved_by].display_name}`} /> : <div className="pending">Pending verification</div>}
            <b>{final && report.approved_by ? staff[report.approved_by].display_name : "Chief Scientist"}</b><span>Laboratory Director{final ? ` · ${dt(report.approved_at)}` : ""}</span></div>
        </div>
        <div className="endrep">— END OF REPORT —</div>
      </div>
      <div className="lh-foot"><img src="/brand/band-bottom.png" alt="" /><div><b>SMARTER INTELLIGENCE · BETTER HEALTH · LASTING IMPACT</b><span>mitochron-ai.tech</span></div></div>
    </article>
  );
}
