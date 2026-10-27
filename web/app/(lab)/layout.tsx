import Link from "next/link";
import { redirect } from "next/navigation";
import LiveUpdates from "@/components/LiveUpdates";
import NavLink from "@/components/NavLink";
import { activeUsers, requireUser, signOut } from "@/lib/auth";
import { canSeeBusiness } from "@/lib/business";
import { db } from "@/lib/db";
import { ensureDrafts, heldOrders, lab } from "@/lib/lab";
import { appInfo } from "@/lib/updater";

export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { chief_scientist: "Chief scientist", scientist: "Medical lab scientist", admin: "Administrator" };
const initials = (n: string) => n.replace(/^(Chief\s+)?Sct\.\s*/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const MODEL: Record<string, string> = { local: "Local model · offline", byo: "Own API key", connect: "MitochronAi Connect" };

async function logout() {
  "use server";
  await signOut();
  redirect("/login");
}

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  if (me.must_change_password) redirect("/account");
  ensureDrafts();
  const L = lab();
  const pending = (db().prepare("SELECT COUNT(*) n FROM orders WHERE status = 'awaiting_approval'").get() as { n: number }).n;
  const held = heldOrders().length;
  const online = activeUsers();
  return (
    <div className="shell">
      <aside className="rail" aria-label="Main">
        <Link href="/dashboard" className="rail-brand" aria-label="MitochronAi Lab: go to the dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.png" alt="" />
          <div><b>MitochronAi Lab</b><small>{L.name}</small></div>
        </Link>
        <nav aria-label="Sections">
          <div className="rail-label">Laboratory</div>
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/worklist" badge={pending} attn={me.role === "chief_scientist" && pending > 0}>Worklist</NavLink>
          <NavLink href="/requests/new">New request</NavLink>
          <NavLink href="/gaya" badge={held} attn={held > 0}>Held by Gaya</NavLink>
          <NavLink href="/qc">Quality control</NavLink>
          <NavLink href="/inventory">Reagents and kits</NavLink>
          <div className="rail-label">Records</div>
          {canSeeBusiness(me) && <NavLink href="/audit">Audit log</NavLink>}
          {canSeeBusiness(me) && <NavLink href="/pricing">Prices</NavLink>}
          {canSeeBusiness(me) && <NavLink href="/staff">Staff and roster</NavLink>}
          {me.role !== "scientist" && <NavLink href="/settings">Settings</NavLink>}
          {me.role === "admin" && <NavLink href="/update">Software update</NavLink>}
        </nav>
        <div className="rail-foot">
          <span><strong>{L.assistant_name}</strong> · {MODEL[L.model_source]}</span>
          <span>Sandboxed to this lab&apos;s workspace</span>
          <span>Version {appInfo().version}</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumbs"><b>{L.name}</b><span aria-hidden="true">/</span><span>{L.working_days}, {L.opening_time}–{L.closing_time}</span></div>
          <div className="topbar-right">
            <LiveUpdates me={me.display_name} />
            <div className="online" aria-label={`Signed in now: ${online.map((u) => u.display_name).join(", ")}`} title={online.map((u) => u.display_name).join(", ")}>
              {online.slice(0, 5).map((u) => <span key={u.id} className={`avatar${u.role === "chief_scientist" ? " chief" : ""}`} aria-hidden="true">{initials(u.display_name)}</span>)}
            </div>
            <div className="userbox">
              <Link href="/account" className="userlink" title="Change your password"><b>{me.display_name}</b><small>{ROLE[me.role]}</small></Link>
              <form action={logout}><button className="btn btn-sm" type="submit">Sign out</button></form>
            </div>
          </div>
        </header>
        <main className="content" id="content">{children}</main>
      </div>
    </div>
  );
}
