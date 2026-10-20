import { redirect } from "next/navigation";
import { currentUser, signIn } from "@/lib/auth";
import { lab } from "@/lib/lab";

export const metadata = { title: "Sign in" };

async function login(formData: FormData) {
  "use server";
  const r = await signIn(String(formData.get("username") ?? ""), String(formData.get("password") ?? ""));
  redirect(r.ok ? (r.user.must_change_password ? "/account" : "/dashboard") : `/login?error=${r.reason === "locked" ? "locked" : "1"}`);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/dashboard");
  const { error } = await searchParams;
  const L = lab();
  return (
    <div className="login">
      <section className="login-brand" aria-label="About this laboratory system">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="MitoChron AI: Intelligence. Health. Impact." />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1>Laboratory workflow with Gaya</h1>
          <p>Scientists enter and check results. Gaya drafts each report on the lab's template. The chief scientist previews and approves before anything reaches a patient.</p>
        </div>
        <p style={{ fontSize: 12.5 }}>{L.name} · {L.address}</p>
      </section>
      <main className="login-form">
        <form action={login}>
          <div>
            <div className="eyebrow">{L.name}</div>
            <h2 style={{ margin: 0, fontSize: 22 }}>Sign in</h2>
          </div>
          {error === "locked" ? <div className="notice err" role="alert">Too many attempts. Wait 15 minutes and try again, or ask the lab administrator to unlock the account.</div>
            : error && <div className="notice err" role="alert">That username and password didn&apos;t match. Check them and try again.</div>}
          <label className="field" htmlFor="username">Username
            <input id="username" name="username" autoComplete="username" required autoFocus />
          </label>
          <label className="field" htmlFor="password">Password
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="btn btn-primary" type="submit" style={{ minHeight: 42 }}>Sign in</button>
          <p className="sub" style={{ margin: 0 }}>Demo laboratory with synthetic data. Test logins are in <span className="mono">web/seed/demo-users.json</span>.</p>
        </form>
      </main>
    </div>
  );
}
