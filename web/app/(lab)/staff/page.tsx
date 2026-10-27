import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";
import { lab } from "@/lib/lab";
import { lockedUntil } from "@/lib/security";
import { addStaff, isManager, resetPassword, ROLE_LABEL, ROLES, setActive, setRole, setRoster, stashOnce, takeOnce, unlock, type Role } from "@/lib/staff";

export const metadata = { title: "Staff and roster" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every action re-checks the signed-in person on the server; the lib functions check the role again. */
async function act(formData: FormData) {
  "use server";
  const me = await requireUser();
  if (!isManager(me)) redirect("/dashboard?denied=staff");
  const what = String(formData.get("act")), id = String(formData.get("id") ?? "");
  let r: { ok: true; tempPassword?: string } | { ok: false; reason: string };
  if (what === "add") r = addStaff({ display_name: String(formData.get("display_name") ?? ""), username: String(formData.get("username") ?? ""), role: String(formData.get("role")) as Role }, me);
  else if (what === "role") r = setRole(id, String(formData.get("role")) as Role, me);
  else if (what === "roster") r = setRoster(id, formData.getAll("day").map(Number), me);
  else if (what === "deactivate" || what === "activate") r = setActive(id, what === "activate", me);
  else if (what === "reset") r = resetPassword(id, me);
  else if (what === "unlock") r = unlock(id, me);
  else r = { ok: false, reason: "Unknown action." };
  if (!r.ok) redirect(`/staff?error=${encodeURIComponent(r.reason)}`);
  publish("staff.changed", undefined, me.display_name);
  if (r.tempPassword) redirect(`/staff?note=${stashOnce(me.id, r.tempPassword)}`);
  redirect("/staff?saved=1");
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; note?: string }> }) {
  const me = await requireUser();
  if (!isManager(me)) redirect("/dashboard?denied=staff");
  const { saved, error, note } = await searchParams;
  const secret = takeOnce(note, me.id), L = lab();
  const staff = db().prepare("SELECT id, display_name, role, username, active, must_change_password FROM staff ORDER BY active DESC, role DESC, display_name").all() as { id: string; display_name: string; role: Role; username: string | null; active: number; must_change_password: number }[];
  const roster = db().prepare("SELECT staff_id, weekday FROM duty_roster").all() as { staff_id: string; weekday: number }[];
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow">{L.name}</div><h1>Staff and duty roster</h1>
        <div className="sub">Who can sign in, what they may do, and when they're on duty. Gaya holds results entered by anyone not on the roster that day. Every change is in the audit log.</div></div></div>
      {secret && <div className="notice secret" role="status"><b>Temporary password (shown once):</b> <span className="mono">{secret}</span><br />Read it to the person in private. They must choose their own password when they first sign in. It disappears from this page after 2 minutes.</div>}
      {note && !secret && <div className="notice err" role="alert">That temporary password is no longer shown (it&apos;s only visible for 2 minutes). Reset the password again if needed.</div>}
      {saved && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Saved and recorded in the audit log.</div>}
      {error && <div className="notice err" role="alert">{error}</div>}

      <section className="panel" aria-labelledby="h-staff">
        <div className="panel-head"><div><h2 id="h-staff">Staff</h2><p>{staff.filter((s) => s.active).length} active · deactivated people can&apos;t sign in and are signed out at once</p></div></div>
        <div className="tablewrap"><table className="grid cards staff">
          <thead><tr><th>Person</th><th>Role</th><th>On duty</th><th>Account</th></tr></thead>
          <tbody>{staff.map((s) => {
            const mine = s.id === me.id, locked = s.username ? lockedUntil(s.username) : null;
            const days = new Set(roster.filter((r) => r.staff_id === s.id).map((r) => r.weekday));
            return (
              <tr key={s.id} className={s.active ? "" : "inactive"}>
                <td data-label="Person" className="primary">{s.display_name}{mine && <span className="sub"> (you)</span>}<br /><span className="sub mono">{s.username ?? "no sign-in"}</span>
                  {!s.active && <> <span className="pill mute">Deactivated</span></>}{locked && <> <span className="pill crit">Locked</span></>}{s.must_change_password ? <> <span className="pill warn">Temporary password</span></> : null}</td>
                <td data-label="Role">
                  <form action={act} className="inline-form">
                    <input type="hidden" name="act" value="role" /><input type="hidden" name="id" value={s.id} />
                    <label className="sr-only" htmlFor={`role-${s.id}`}>Role for {s.display_name}</label>
                    <select id={`role-${s.id}`} name="role" defaultValue={s.role} disabled={mine}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    {!mine && <button className="btn btn-sm" type="submit">Save</button>}
                  </form></td>
                <td data-label="On duty">
                  <form action={act} className="inline-form">
                    <input type="hidden" name="act" value="roster" /><input type="hidden" name="id" value={s.id} />
                    <fieldset className="days"><legend className="sr-only">Days {s.display_name} is on duty</legend>
                      {DAYS.map((d, i) => <label key={d} htmlFor={`d-${s.id}-${i + 1}`}><input type="checkbox" id={`d-${s.id}-${i + 1}`} name="day" value={i + 1} defaultChecked={days.has(i + 1)} />{d}</label>)}
                    </fieldset>
                    <button className="btn btn-sm" type="submit">Save</button>
                  </form></td>
                <td data-label="Account"><div className="acct-actions">
                  {s.username && !mine && <form action={act}><input type="hidden" name="act" value="reset" /><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm" type="submit">Reset password</button></form>}
                  {locked && <form action={act}><input type="hidden" name="act" value="unlock" /><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm" type="submit">Unlock</button></form>}
                  {!mine && <form action={act}><input type="hidden" name="act" value={s.active ? "deactivate" : "activate"} /><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm" type="submit" style={s.active ? { color: "var(--crit)" } : undefined}>{s.active ? "Deactivate" : "Reactivate"}</button></form>}
                </div></td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="h-add">
        <div className="panel-head"><div><h2 id="h-add">Add a person</h2><p>They get a temporary password and must choose their own at first sign-in</p></div></div>
        <form action={act} className="panel-body formgrid">
          <input type="hidden" name="act" value="add" />
          <label className="field" htmlFor="display_name">Name as printed on reports<input id="display_name" name="display_name" required maxLength={80} placeholder="e.g. Sct. Ada Obi" autoComplete="off" /></label>
          <label className="field" htmlFor="username">Username<input id="username" name="username" required maxLength={32} pattern="[A-Za-z][A-Za-z0-9._\-]{2,31}" placeholder="e.g. ada.obi" autoComplete="off" /></label>
          <label className="field" htmlFor="new-role">Role<select id="new-role" name="role" defaultValue="scientist">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <div className="span2"><button className="btn btn-primary" type="submit">Add person</button></div>
        </form>
      </section>
    </>
  );
}
