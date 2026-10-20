import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { audit, db, nowIso } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { clearFailures, isSessionIdle, lockedUntil, normaliseUsername, recordFailure } from "./security";

export const SESSION_COOKIE = "mcl_session";
const SESSION_HOURS = 12; // one shift

export type Role = "scientist" | "chief_scientist" | "admin";
export type User = { id: string; display_name: string; role: Role; username: string; must_change_password: number };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** True when the browser reached us over HTTPS (directly or through a proxy): the session cookie is then marked Secure. */
async function overHttps() {
  const h = await headers();
  return h.get("x-forwarded-proto") === "https" || (h.get("origin") ?? "").startsWith("https://");
}

// Compared against when the username doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = hashPassword("not-a-real-password-used-only-for-timing");

export type SignIn = { ok: true; user: User } | { ok: false; reason: "invalid" | "locked" };
/**
 * Each login gets its own session, so several people can work at once. Only a hash of the token is stored.
 * Failures are counted for any username typed (real or not), and every failure looks the same to the person
 * signing in, so the page can't be used to discover who works at the lab.
 */
export async function signIn(username: string, password: string): Promise<SignIn> {
  const name = normaliseUsername(username).slice(0, 64);
  if (lockedUntil(name)) {
    audit({ type: "system" }, "auth.locked", `Sign-in refused for "${name}": too many failed attempts`);
    return { ok: false, reason: "locked" };
  }
  const row = db().prepare("SELECT id, display_name, role, username, must_change_password, password_hash FROM staff WHERE username = ? AND active = 1")
    .get(name) as (User & { password_hash: string }) | undefined;
  const good = verifyPassword(password, row?.password_hash ?? DUMMY_HASH) && !!row;
  if (!good || !row) {
    recordFailure(name);
    audit({ type: "system" }, "auth.failed", `Failed sign-in for "${name}"${lockedUntil(name) ? "; account locked for 15 minutes" : ""}`);
    return { ok: false, reason: lockedUntil(name) ? "locked" : "invalid" };
  }
  clearFailures(name);
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  db().prepare("INSERT INTO sessions VALUES (?,?,?,?,?)")
    .run(sha(token), row.id, now.toISOString(), new Date(now.getTime() + SESSION_HOURS * 3.6e6).toISOString(), now.toISOString());
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600, secure: await overHttps() });
  audit({ type: "human", id: row.id }, "auth.signed_in", `${row.display_name} signed in`);
  return { ok: true, user: { id: row.id, display_name: row.display_name, role: row.role, username: row.username, must_change_password: row.must_change_password } };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const user = await currentUser();
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
    if (user) audit({ type: "human", id: user.id }, "auth.signed_out", `${user.display_name} signed out`);
  }
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db().prepare(`SELECT s.id, s.display_name, s.role, s.username, s.must_change_password, x.expires_at, x.last_seen_at FROM sessions x JOIN staff s ON s.id = x.staff_id
    WHERE x.token_hash = ? AND s.active = 1`).get(sha(token)) as (User & { expires_at: string; last_seen_at: string }) | undefined;
  if (!row || row.expires_at < nowIso()) return null;
  // An idle session (no request for 30 minutes) is ended on the server, not just forgotten by the browser.
  if (isSessionIdle(row.last_seen_at)) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
    audit({ type: "system" }, "auth.idle_timeout", `${row.display_name} signed out after 30 minutes without activity`);
    return null;
  }
  db().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(nowIso(), sha(token));
  return { id: row.id, display_name: row.display_name, role: row.role, username: row.username, must_change_password: row.must_change_password };
}

/**
 * Every page and server action starts here. Someone still on a temporary password is sent to /account, whatever
 * they call: the layout's redirect alone would not cover server actions or direct POSTs.
 */
export async function requireUser(opts: { allowTemporaryPassword?: boolean } = {}): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.must_change_password && !opts.allowTemporaryPassword) redirect("/account");
  return u;
}

/** Who else is signed in right now (seen in the last 15 minutes). */
export function activeUsers(): { id: string; display_name: string; role: Role }[] {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  return db().prepare(`SELECT DISTINCT s.id, s.display_name, s.role FROM sessions x JOIN staff s ON s.id = x.staff_id
    WHERE x.last_seen_at > ? AND x.expires_at > ? ORDER BY s.display_name`).all(since, nowIso()) as never;
}
