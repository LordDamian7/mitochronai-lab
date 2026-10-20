import { createHash } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { lab } from "@/lib/lab";
import { PASSWORD_MIN } from "@/lib/security";
import { changeOwnPassword } from "@/lib/staff";

export const metadata = { title: "My account" };

async function change(formData: FormData) {
  "use server";
  const me = await requireUser({ allowTemporaryPassword: true });
  const next = String(formData.get("next") ?? ""), confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) redirect(`/account?error=${encodeURIComponent("The two new passwords don't match.")}`);
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const r = changeOwnPassword(me.id, String(formData.get("current") ?? ""), next, createHash("sha256").update(token).digest("hex"));
  if (!r.ok) redirect(`/account?error=${encodeURIComponent(r.reason)}`);
  redirect("/dashboard?password=changed");
}

/** Outside the (lab) layout on purpose: someone with a temporary password can reach only this page. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireUser({ allowTemporaryPassword: true });
  const { error } = await searchParams;
  const L = lab(), forced = !!me.must_change_password;
  return (
    <div className="login">
      <section className="login-brand" aria-label="Password guidance">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="MitoChron AI: Intelligence. Health. Impact." />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1>Choose a password you can remember</h1>
          <p>At least {PASSWORD_MIN} characters. No symbols needed: a short sentence or a few unrelated words is strongest, such as &ldquo;tea at noon in yaba&rdquo;. Don&apos;t use your username, the lab&apos;s name or a common password.</p>
        </div>
        <p style={{ fontSize: 12.5 }}>{L.name}</p>
      </section>
      <main className="login-form">
        <form action={change}>
          <div><div className="eyebrow">{me.display_name}</div><h2 style={{ margin: 0, fontSize: 22 }}>{forced ? "Set your own password" : "Change your password"}</h2></div>
          {forced && <div className="notice" role="status" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>You signed in with a temporary password. Choose your own to continue.</div>}
          {error && <div className="notice err" role="alert">{error}</div>}
          <label className="field" htmlFor="current">{forced ? "Temporary password" : "Current password"}<input id="current" name="current" type="password" autoComplete="current-password" required /></label>
          <label className="field" htmlFor="next">New password<input id="next" name="next" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={128} /></label>
          <label className="field" htmlFor="confirm">New password again<input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={128} /></label>
          <button className="btn btn-primary" type="submit" style={{ minHeight: 42 }}>Save password</button>
          {!forced && <Link className="btn" href="/dashboard">Cancel</Link>}
          <p className="sub" style={{ margin: 0 }}>Saving signs you out on other devices.</p>
        </form>
      </main>
    </div>
  );
}
