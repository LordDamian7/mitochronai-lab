import { redirect } from "next/navigation";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import UploadUpdate from "@/components/UploadUpdate";
import { requireUser } from "@/lib/auth";
import { staffMap } from "@/lib/lab";
import { appInfo, discardStaged, requestInstall, stagedUpdate, supervisorAlive, updateHistory, updateStatus } from "@/lib/updater";

export const metadata = { title: "Software update" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** Administrator only: the page and every action check the role on the server (uploads go to /api/update/upload). */
async function installNow() {
  "use server";
  const me = await requireUser();
  if (me.role !== "admin") redirect("/dashboard?denied=update");
  const r = requestInstall(me);
  if (!r.ok) redirect(`/update?error=${encodeURIComponent(r.reason)}`);
  redirect("/update?installing=1");
}
async function discard() {
  "use server";
  const me = await requireUser();
  if (me.role !== "admin") redirect("/dashboard?denied=update");
  discardStaged(me);
  redirect("/update");
}

export default async function UpdatePage({ searchParams }: { searchParams: Promise<{ staged?: string; installing?: string; error?: string }> }) {
  const me = await requireUser();
  if (me.role !== "admin") redirect("/dashboard?denied=update");
  const { staged: justStaged, installing, error } = await searchParams;
  const app = appInfo(), staged = stagedUpdate(), alive = supervisorAlive(), status = updateStatus(), staff = staffMap(), history = updateHistory();
  return (
    <>
      <div className="pagehead"><div><div className="eyebrow">Settings · administrator only</div><h1>Software update</h1>
        <div className="sub">Install a new version from a USB stick. Only packages signed by the app&apos;s developer, for this lab&apos;s app and newer than the current version, are accepted. Patient data is never part of an update.</div></div></div>
      {installing && <div className="notice" role="status" style={{ background: "var(--info-bg)", color: "var(--info)" }}>Installing. The app restarts and will be unavailable for a few minutes; reload this page afterwards. If anything goes wrong, the current version is put back automatically.</div>}
      {justStaged && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>The package is genuine and ready. Check the notes below, then install it outside opening hours.</div>}
      {error && <div className="notice err" role="alert">{error}</div>}
      {status && status.state !== "idle" && !installing && <div className={`notice${status.state === "done" ? "" : status.state === "installing" ? "" : " err"}`} role="status"
        style={status.state === "done" ? { background: "var(--ok-bg)", color: "var(--ok)" } : status.state === "installing" ? { background: "var(--info-bg)", color: "var(--info)" } : undefined}>
        <b>Last update ({when(status.at)}):</b> {status.message}</div>}

      <div className="kpis">
        <div className="panel kpi"><span>Installed version</span><b>{app.version}</b><small>{app.app}</small></div>
        <div className="panel kpi"><span>Updater</span><b style={{ color: alive ? "var(--ok)" : "var(--warn)" }}>{alive ? "Running" : "Not running"}</b><small>{alive ? "Installing is possible" : "Start the app with START-HERE to install"}</small></div>
      </div>

      <div className="grid2">
        <section className="panel" aria-labelledby="h-up">
          <div className="panel-head"><div><h2 id="h-up">1 · Load the update</h2><p>From the USB stick. Nothing is installed at this step.</p></div></div>
          <UploadUpdate />
        </section>
        <section className="panel" aria-labelledby="h-inst">
          <div className="panel-head"><div><h2 id="h-inst">2 · Install</h2><p>Backs up the app and the database first; rolls back by itself on any problem</p></div></div>
          <div className="panel-body">
            {staged ? <>
              <p style={{ margin: 0 }}><b>Version {staged.version}</b> · {staged.files} files · built {when(staged.created)} · checked by {staff[staged.stagedBy]?.display_name}</p>
              {staged.notes && <p className="result-prose" style={{ margin: 0 }}>{staged.notes}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <form action={installNow}><ConfirmSubmit disabled={!alive} message={`Install version ${staged.version} now? The app will be unavailable for a few minutes. Everyone signed in should save their work first.`}>Install version {staged.version} now</ConfirmSubmit></form>
                <form action={discard}><button className="btn" type="submit">Discard</button></form>
              </div>
              {!alive && <p className="sub" style={{ margin: 0 }}>The updater isn&apos;t running. Close the app and start it with START-HERE, then come back.</p>}
            </> : <p className="sub" style={{ margin: 0 }}>No update is waiting. Load one first.</p>}
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="h-hist">
        <div className="panel-head"><div><h2 id="h-hist">Update history</h2><p>Every check, install and rollback, from the audit log</p></div></div>
        <div className="panel-body" style={{ paddingTop: 4 }}>{history.length ? <ol className="timeline">{history.map((h, i) => (
          <li key={i}><time>{when(h.at)}</time><span><b>{h.actor_id ? staff[h.actor_id]?.display_name : "Updater"}</b> · {h.detail}</span></li>))}</ol>
          : <p className="sub" style={{ margin: 0 }}>No updates yet.</p>}</div>
      </section>
    </>
  );
}
