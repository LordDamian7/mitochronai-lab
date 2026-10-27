import Link from "next/link";
import UnsavedGuard from "@/components/UnsavedGuard";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canSeeBusiness, naira, prices, savePrices } from "@/lib/business";
import { DEPARTMENTS, PANELS } from "@/lib/catalogue";
import { publish } from "@/lib/events";
import { reagentCostPerTest, stock } from "@/lib/inventory";
import { lab, staffMap } from "@/lib/lab";

export const metadata = { title: "Prices" };
const tat = (h: number) => (h < 24 ? `${h} h` : `${Math.round(h / 24)} d`);

async function save(formData: FormData) {
  "use server";
  const me = await requireUser();
  const input: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("price_")) input[k.slice(6)] = String(v);
  const r = savePrices(input, me);
  if (!r.ok) redirect(`/pricing?error=${encodeURIComponent(r.reason)}`);
  publish("prices.changed", undefined, me.display_name);
  redirect(`/pricing?saved=${r.changed}`);
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const me = await requireUser();
  if (!canSeeBusiness(me)) redirect("/dashboard?denied=prices");
  const { saved, error } = await searchParams;
  const P = prices(), rows = stock(), staff = staffMap(), L = lab();
  const unconfirmed = Object.values(P).filter((p) => !p.confirmed).length;
  const lastSaved = Object.values(P).filter((p) => p.updated_at).sort((a, b) => b.updated_at!.localeCompare(a.updated_at!))[0];
  return (
    <>
      <div className="pagehead">
        <div><div className="eyebrow">{L.name}</div><h1>Test prices</h1>
          <div className="sub">Only the chief scientist and administrators can see or change this page. New prices apply to new requests; existing requests keep the price they were made at.</div></div>
        {lastSaved && <p className="sub" style={{ margin: 0 }}>Last saved by {staff[lastSaved.updated_by ?? ""]?.display_name ?? "—"}</p>}
      </div>
      {saved !== undefined && <div className="notice" role="status" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>Price list saved: {saved} price{saved === "1" ? "" : "s"} changed. Every change is in the audit log.</div>}
      {error && <div className="notice err" role="alert">{error}</div>}
      {unconfirmed > 0 && <div className="notice" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>{unconfirmed} of {PANELS.length} prices are starter prices that nobody has confirmed yet. Review them and save: saving confirms every price on this page.</div>}
      <UnsavedGuard formId="price-form" message="Your price changes aren't saved yet. Leave this page and lose them?" />
      <form action={save} id="price-form" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {DEPARTMENTS.map((dept) => (
          <section className="panel" key={dept} aria-labelledby={`h-${dept}`}>
            <div className="panel-head"><div><h2 id={`h-${dept}`}>{dept}</h2></div></div>
            <div className="tablewrap"><table className="grid cards prices">
              <thead><tr><th>Test</th><th>Turnaround</th><th>Reagent cost</th><th>Price (₦)</th><th>Margin</th></tr></thead>
              <tbody>{PANELS.filter((p) => p.department === dept).map((p) => {
                const cur = P[p.code], cost = reagentCostPerTest(p.code, rows);
                const margin = cost !== null && cur ? cur.price_ngn - cost : null;
                return (
                  <tr key={p.code}>
                    <td data-label="Test" className="primary"><label htmlFor={`price_${p.code}`}>{p.name}</label> {!cur?.confirmed && <span className="pill warn">starter</span>}</td>
                    <td data-label="Turnaround" className="sub">{tat(p.tat_hours)}</td>
                    <td data-label="Reagent cost" className="sub num">{cost === null ? "not linked" : naira(cost)}</td>
                    <td data-label="Price (₦)"><input id={`price_${p.code}`} name={`price_${p.code}`} inputMode="numeric" defaultValue={cur?.price_ngn ?? p.price} required className="result-input price-input" autoComplete="off" /></td>
                    <td data-label="Margin" className={`num${margin !== null && margin < 0 ? " neg" : ""}`}>{margin === null ? "—" : naira(margin)}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
        ))}
        <div className="savebar"><button className="btn btn-primary" type="submit">Save and confirm all prices</button><Link className="btn" href="/dashboard">Cancel</Link>
          <span className="sub">Reagent cost is per request, from the lot in use; it excludes labour, controls and consumables.</span></div>
      </form>
    </>
  );
}
