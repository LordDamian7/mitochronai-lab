import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createRequest, registerPatient } from "@/lib/entry";
import { publish } from "@/lib/events";
import TestPicker from "@/components/TestPicker";
import { canSeeBusiness, prices } from "@/lib/business";
import { PANELS } from "@/lib/rules";

export const metadata = { title: "New request" };

const toIso = (local: string) => (local ? new Date(`${local}:00+01:00`).toISOString() : new Date().toISOString());
const nowLocal = () => new Date(Date.now() + 3600000).toISOString().slice(0, 16); // WAT (UTC+1) for the datetime-local default

async function submit(formData: FormData) {
  "use server";
  const me = await requireUser();
  const mode = String(formData.get("mode"));
  const err = (m: string) => redirect(`/requests/new?mode=${mode}&error=${encodeURIComponent(m)}`);
  let patientId = String(formData.get("patient_id") ?? "");
  if (mode === "new") {
    const r = registerPatient({
      full_name: String(formData.get("full_name") ?? ""), sex: String(formData.get("sex") ?? ""),
      date_of_birth: String(formData.get("date_of_birth") ?? ""), phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""), risk_factors: formData.getAll("risk").map(String),
    }, me.id);
    if (!r.ok) return err(r.reason);
    patientId = r.id;
  }
  const fasting = String(formData.get("fasting_hours") ?? "").trim();
  const r = createRequest({
    patient_id: patientId, panels: formData.getAll("panel").map(String), requested_by: String(formData.get("requested_by") ?? ""),
    fasting_hours: fasting ? Number(fasting) : null, collected_at: toIso(String(formData.get("collected_at") ?? "")),
  }, me.id);
  if (!r.ok) return err(r.reason);
  publish("request.created", r.id, me.display_name);
  redirect(`/orders/${r.id}/enter`);
}

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ mode?: string; error?: string; patient?: string }> }) {
  const me = await requireUser();
  const { mode = "existing", error, patient } = await searchParams;
  const priceList = canSeeBusiness(me) ? Object.fromEntries(Object.values(prices()).map((x) => [x.panel_code, x.price_ngn])) : undefined;
  const patients = db().prepare("SELECT id, lab_patient_id, full_name, sex, date_of_birth FROM patients ORDER BY full_name").all() as { id: string; lab_patient_id: string; full_name: string; sex: string; date_of_birth: string }[];
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow"><Link href="/worklist">Worklist</Link> / New request</div><h1>New request</h1></div></div>
      {error && <div className="notice err" role="alert">{error}</div>}
      <form action={submit} className="grid2">
        <input type="hidden" name="mode" value={mode} />
        <section className="panel" aria-labelledby="h-pt">
          <div className="panel-head"><div><h2 id="h-pt">Patient</h2><p>Choose a registered patient or register a new one</p></div></div>
          <nav className="tabs" aria-label="Patient">
            <Link className="tab" href="/requests/new?mode=existing" aria-current={mode !== "new" ? "page" : undefined}>Registered patient</Link>
            <Link className="tab" href="/requests/new?mode=new" aria-current={mode === "new" ? "page" : undefined}>New patient</Link>
          </nav>
          <div className="panel-body">
            {mode !== "new" ? (
              <label className="field" htmlFor="patient_id">Patient
                <select id="patient_id" name="patient_id" required defaultValue={patient ?? ""}>
                  <option value="" disabled>Choose a patient…</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.lab_patient_id} · {p.sex} · born {p.date_of_birth}</option>)}
                </select>
              </label>
            ) : (
              <div className="formgrid">
                <label className="field span2" htmlFor="full_name">Full name<input id="full_name" name="full_name" required autoComplete="off" /></label>
                <label className="field" htmlFor="sex">Sex<select id="sex" name="sex" required defaultValue=""><option value="" disabled>Choose…</option><option value="F">Female</option><option value="M">Male</option></select></label>
                <label className="field" htmlFor="date_of_birth">Date of birth<input id="date_of_birth" name="date_of_birth" type="date" required /></label>
                <label className="field" htmlFor="phone">Phone<input id="phone" name="phone" inputMode="tel" autoComplete="off" /></label>
                <label className="field" htmlFor="email">E-mail<input id="email" name="email" type="email" autoComplete="off" placeholder="name@example.com" /></label>
                <fieldset className="field span2 checks-inline"><legend>Risk factors (change the Mantoux cut-off to ≥ 5 mm)</legend>
                  {[["HIV", "HIV"], ["immunosuppression", "Immunosuppression"], ["recent_TB_contact", "Recent TB contact"]].map(([v, l]) =>
                    <label key={v} htmlFor={`risk-${v}`}><input type="checkbox" id={`risk-${v}`} name="risk" value={v} /> {l}</label>)}
                </fieldset>
                <p className="sub span2" style={{ margin: 0 }}>Gaya assigns the next Lab ID and checks for duplicates (same name and date of birth).</p>
              </div>
            )}
          </div>
        </section>
        <section className="panel" aria-labelledby="h-tests">
          <div className="panel-head"><div><h2 id="h-tests">Tests and sample</h2><p>Calculated values (LDL, MCV, eGFR…) are worked out by the server, not typed</p></div></div>
          <div className="panel-body">
            <TestPicker panels={PANELS.map(({ code, name, department, fasting, tat_hours }) => ({ code, name, department, fasting, tat_hours }))} prices={priceList} />
            <div className="formgrid">
              <label className="field span2" htmlFor="requested_by">Requesting clinician<input id="requested_by" name="requested_by" placeholder="e.g. Dr A. Example" autoComplete="off" /></label>
              <label className="field" htmlFor="collected_at">Collected / placed at<input id="collected_at" name="collected_at" type="datetime-local" defaultValue={nowLocal()} required /></label>
              <label className="field" htmlFor="fasting_hours">Fasting (hours)<input id="fasting_hours" name="fasting_hours" type="number" min="0" max="24" step="0.5" /></label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit">Create request and enter results</button>
              <Link className="btn" href="/worklist">Cancel</Link>
            </div>
          </div>
        </section>
      </form>
    </>
  );
}
