import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { audit, db } from "@/lib/db";
import { publish } from "@/lib/events";
import { lab } from "@/lib/lab";

export const metadata = { title: "Settings" };
const MODELS = [
  ["local", "Local model on the lab server", "Patient data never leaves the building. Gaya's runtime is blocked from the internet."],
  ["byo", "The lab's own API key", "The lab pays its model provider directly. Only that provider's address is allowed out."],
  ["connect", "MitochronAi Connect", "Managed model, billed per task. Only the MitochronAi endpoint is allowed out."],
] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function save(formData: FormData) {
  "use server";
  const me = await requireUser();
  if (me.role === "scientist") redirect("/settings?error=1");
  const L = lab();
  const model = String(formData.get("model"));
  const comments = formData.get("comments") === "on" ? 1 : 0;
  if (!["local", "byo", "connect"].includes(model)) redirect("/settings?error=1");
  db().prepare("UPDATE labs SET model_source = ?, comments_enabled = ? WHERE id = ?").run(model, comments, L.id);
  if (model !== L.model_source) audit({ type: "human", id: me.id }, "settings.model", `Gaya's model source changed from ${L.model_source} to ${model}`);
  if (comments !== L.comments_enabled) audit({ type: "human", id: me.id }, "settings.comments", `Optional AI-drafted comments turned ${comments ? "on" : "off"}`);
  publish("settings.changed", undefined, me.display_name);
  redirect("/settings?saved=1");
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const me = await requireUser();
  const { saved, error } = await searchParams;
  const L = lab(), canEdit = me.role !== "scientist";
  const staff = db().prepare("SELECT id, display_name, role, username, active FROM staff ORDER BY role DESC, display_name").all() as { id: string; display_name: string; role: string; username: string | null; active: number }[];
  const roster = db().prepare("SELECT staff_id, weekday FROM duty_roster").all() as { staff_id: string; weekday: number }[];
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow">{L.name}</div><h1>Settings</h1></div></div>
      {saved && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Settings saved and recorded in the audit log.</div>}
      {error && <div className="notice err" role="alert">Only a chief scientist or administrator can change settings.</div>}
      <form action={save} className="grid2">
        <section className="panel" aria-labelledby="h-model">
          <div className="panel-head"><div><h2 id="h-model">Where Gaya&apos;s model runs</h2><p>Patient records stay in this lab&apos;s workspace whichever you choose</p></div></div>
          <div className="panel-body">
            <fieldset className="field checks-list" style={{ gridTemplateColumns: "minmax(0,1fr)" }} disabled={!canEdit}><legend className="sr-only">Model source</legend>
              {MODELS.map(([v, l, d]) => (
                <label key={v} htmlFor={`m-${v}`} style={{ alignItems: "flex-start", padding: "10px 12px" }}>
                  <input type="radio" id={`m-${v}`} name="model" value={v} defaultChecked={L.model_source === v} style={{ marginTop: 2 }} />
                  <span><b>{l}</b><br /><span className="sub">{d}</span></span>
                </label>
              ))}
            </fieldset>
            <p className="sub" style={{ margin: 0 }}>Connecting a real model (and enforcing the network block) arrives in step 4. This setting is already recorded and audited.</p>
          </div>
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <section className="panel" aria-labelledby="h-com">
            <div className="panel-head"><div><h2 id="h-com">Optional comments</h2><p>Off by default. Gaya never interprets results on its own.</p></div></div>
            <div className="panel-body">
              <fieldset className="checks-inline" disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}><legend className="sr-only">Comments</legend>
                <label htmlFor="comments"><input type="checkbox" id="comments" name="comments" defaultChecked={!!L.comments_enabled} /> Let Gaya draft a comment on each report for a scientist to edit</label>
              </fieldset>
              {canEdit && <div><button className="btn btn-primary" type="submit">Save settings</button></div>}
            </div>
          </section>
          <section className="panel" aria-labelledby="h-staff">
            <div className="panel-head"><div><h2 id="h-staff">Staff and duty roster</h2><p>Gaya checks every result against this roster</p></div>{canEdit && <a className="btn btn-sm" href="/staff">Manage staff</a>}</div>
            <div className="tablewrap"><table className="grid cards" style={{ minWidth: 0 }}>
              <thead><tr><th>Name</th><th>Role</th><th>On duty</th></tr></thead>
              <tbody>{staff.map((s) => (
                <tr key={s.id}><td data-label="Name" className="primary">{s.display_name}<br /><span className="sub mono">{s.username ?? "no login"}</span></td>
                  <td data-label="Role">{s.role === "chief_scientist" ? <span className="pill info">Chief scientist</span> : s.role === "admin" ? <span className="pill mute">Administrator</span> : <span className="pill mute">Scientist</span>}</td>
                  <td data-label="On duty" className="sub">{roster.filter((r) => r.staff_id === s.id).map((r) => DAYS[r.weekday - 1]).join(" · ") || "—"}</td></tr>))}</tbody>
            </table></div>
          </section>
        </div>
      </form>
    </>
  );
}
