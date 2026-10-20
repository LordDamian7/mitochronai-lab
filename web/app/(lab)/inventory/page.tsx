import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canSeeBusiness, naira } from "@/lib/business";
import { PANELS } from "@/lib/catalogue";
import { publish } from "@/lib/events";
import { decideLot, receiveLot, reagents, stock } from "@/lib/inventory";
import { lab, staffMap } from "@/lib/lab";

export const metadata = { title: "Reagents and kits" };
const dmy = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const panelNames = (codes: string) => { const c = codes.split(","); return c.length > 4 ? `${c.length} culture tests` : c.map((x) => PANELS.find((p) => p.code === x)?.name ?? x).join(", "); };

async function receive(formData: FormData) {
  "use server";
  const me = await requireUser();
  if (!canSeeBusiness(me)) redirect("/inventory?error=" + encodeURIComponent("Only the chief scientist or an administrator can receive stock."));
  const r = receiveLot({ reagent_id: String(formData.get("reagent_id") ?? ""), lot_no: String(formData.get("lot_no") ?? ""), expiry: String(formData.get("expiry") ?? ""),
    kits: Number(formData.get("kits")), cost: Number(String(formData.get("cost") ?? "").replace(/[₦,\s]/g, "")) }, me.id);
  if (!r.ok) redirect(`/inventory?error=${encodeURIComponent(r.reason)}`);
  publish("stock.received", undefined, me.display_name);
  redirect("/inventory?received=1");
}

async function decide(formData: FormData) {
  "use server";
  const me = await requireUser();
  if (!canSeeBusiness(me)) redirect("/inventory?error=" + encodeURIComponent("Only the chief scientist or an administrator can accept or reject a lot."));
  const decision = String(formData.get("decision")) === "rejected" ? "rejected" : "accepted";
  const r = decideLot(Number(formData.get("lot_id")), decision, String(formData.get("note") ?? ""), me.id);
  if (!r.ok) redirect(`/inventory?error=${encodeURIComponent(r.reason)}`);
  publish("stock.qa", undefined, me.display_name);
  redirect(`/inventory?qa=${decision}`);
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ received?: string; qa?: string; error?: string }> }) {
  const me = await requireUser();
  const { received, qa, error } = await searchParams;
  const manager = canSeeBusiness(me), rows = stock(), staff = staffMap(), L = lab();
  const quarantined = rows.flatMap((r) => r.lots.filter((l) => l.qa_status === "quarantine" && l.kits_in_stock > 0).map((l) => ({ r, l })));
  return (
    <>
      <div className="pagehead">
        <div><div className="eyebrow">{L.name}</div><h1>Reagents and kits</h1>
          <div className="sub">Gaya holds any result made with a lot that is expired, past its opened-kit stability, or not yet accepted by QA.{manager ? "" : " Stock levels and costs are visible to the chief scientist and administrators."}</div></div>
      </div>
      {received && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Delivery recorded. A new lot stays in quarantine until it passes new-lot verification.</div>}
      {qa && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Lot {qa}. The decision is in the audit log.</div>}
      {error && <div className="notice err" role="alert">{error}</div>}

      {manager && (
        <div className="kpis">
          <div className="panel kpi"><span>Kits in stock</span><b>{rows.reduce((s, r) => s + r.usable_kits, 0)}</b><small>unopened, accepted and in date</small></div>
          <div className="panel kpi"><span>Stock value</span><b>{naira(rows.reduce((s, r) => s + r.value_ngn, 0))}</b><small>usable lots at purchase cost</small></div>
          <div className="panel kpi"><span>Low stock</span><b style={{ color: rows.some((r) => r.low) ? "var(--warn)" : undefined }}>{rows.filter((r) => r.low).length}</b><small>at or below the reorder level</small></div>
          <div className="panel kpi"><span>Expiring in 30 days</span><b style={{ color: rows.some((r) => r.expiring) ? "var(--warn)" : undefined }}>{rows.filter((r) => r.expiring).length}</b><small>use these lots first</small></div>
          <div className="panel kpi"><span>Awaiting QA</span><b style={{ color: quarantined.length ? "var(--warn)" : undefined }}>{quarantined.length}</b><small>new lots in quarantine</small></div>
        </div>
      )}

      <section className="panel" aria-labelledby="h-stock">
        <div className="panel-head"><div><h2 id="h-stock">Stock by reagent</h2><p>Lots are used first-expiring-first; an opened kit is finished before a new one is opened</p></div></div>
        <div className="tablewrap"><table className="grid cards stock">
          <thead><tr><th>Reagent</th><th>Used for</th><th>Lots</th><th>Storage</th>{manager && <><th>Usable tests</th><th>Kits</th><th>Cost / test</th></>}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Reagent" className="primary">{r.name}<br /><span className="sub">{r.method} · {r.tests_per_kit} tests per kit</span></td>
              <td data-label="Used for" className="sub">{panelNames(r.panels)}</td>
              <td data-label="Lots"><div className="lots">{r.lots.filter((l) => l.kits_in_stock > 0 || l.open_tests_left > 0 || l.qa_status === "quarantine").map((l) => (
                <div key={l.id} className="lot">
                  <span className="mono">{l.lot_no}</span>
                  <span className={`pill ${l.problem ? (l.qa_status === "quarantine" ? "warn" : "crit") : "ok"}`}>{l.problem ? (l.qa_status === "quarantine" ? "Quarantine" : l.qa_status === "rejected" ? "Rejected" : "Expired") : "Accepted"}</span>
                  <span className="sub">exp {dmy(l.expiry)}{l.open_tests_left > 0 && l.open_expiry ? ` · opened ${dmy(l.opened_on)}, use by ${dmy(l.open_expiry)}` : ""}{manager ? ` · ${l.kits_in_stock} kit${l.kits_in_stock === 1 ? "" : "s"}${l.open_tests_left ? ` + ${l.open_tests_left} tests open` : ""}` : ""}</span>
                  {l.qa_on && <span className="sub">QA: {l.qa_note} ({staff[l.qa_by ?? ""]?.display_name ?? "—"}, {dmy(l.qa_on)})</span>}
                </div>))}</div></td>
              <td data-label="Storage" className="sub">{r.storage}{r.open_stability_days ? ` · ${r.open_stability_days} days once opened` : ""}</td>
              {manager && <>
                <td data-label="Usable tests" className="num">{r.usable_tests.toLocaleString("en-NG")}</td>
                <td data-label="Kits" className="num">{r.usable_kits}{r.low && <> <span className="pill warn">reorder</span></>}</td>
                <td data-label="Cost / test" className="num sub">{r.cost_per_test === null ? "—" : naira(r.cost_per_test)}</td>
              </>}
            </tr>))}</tbody>
        </table></div>
      </section>

      {manager && (
        <div className="grid2">
          <section className="panel" aria-labelledby="h-recv">
            <div className="panel-head"><div><h2 id="h-recv">Receive a delivery</h2><p>The lot goes into quarantine until it passes new-lot verification</p></div></div>
            <form action={receive} className="panel-body formgrid">
              <label className="field span2" htmlFor="reagent_id">Reagent
                <select id="reagent_id" name="reagent_id" required defaultValue=""><option value="" disabled>Choose…</option>{reagents().map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label className="field" htmlFor="lot_no">Lot number<input id="lot_no" name="lot_no" required autoComplete="off" /></label>
              <label className="field" htmlFor="expiry">Expiry date<input id="expiry" name="expiry" type="date" required /></label>
              <label className="field" htmlFor="kits">Kits received<input id="kits" name="kits" type="number" min="1" max="1000" required /></label>
              <label className="field" htmlFor="cost">Cost per kit (₦)<input id="cost" name="cost" inputMode="numeric" required autoComplete="off" /></label>
              <div className="span2"><button className="btn btn-primary" type="submit">Record delivery</button></div>
            </form>
          </section>
          <section className="panel" aria-labelledby="h-qa">
            <div className="panel-head"><div><h2 id="h-qa">New-lot verification</h2><p>Run QC on the new lot, then accept or reject it</p></div></div>
            <div className="panel-body">{quarantined.length ? quarantined.map(({ r, l }) => (
              <form key={l.id} action={decide} className="formgrid qa-form">
                <input type="hidden" name="lot_id" value={l.id} />
                <div className="span2"><b>{r.name}</b> · lot <span className="mono">{l.lot_no}</span> · exp {dmy(l.expiry)} · {l.kits_in_stock} kit(s)</div>
                <label className="field span2" htmlFor={`note-${l.id}`}>Verification result<input id={`note-${l.id}`} name="note" required placeholder="e.g. QC L1 and L2 within limits; 5 patient samples agree with the old lot" autoComplete="off" /></label>
                <div className="span2" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" type="submit" name="decision" value="accepted">Accept lot</button>
                  <button className="btn" type="submit" name="decision" value="rejected" style={{ color: "var(--crit)" }}>Reject lot</button>
                </div>
              </form>)) : <p className="sub" style={{ margin: 0 }}>No lots waiting for verification.</p>}</div>
          </section>
        </div>
      )}
    </>
  );
}
