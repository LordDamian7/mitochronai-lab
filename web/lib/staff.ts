import { randomBytes } from "node:crypto";
import { audit, db, nowIso } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { checkPassword, clearFailures, lockedUntil, normaliseUsername, recordFailure, tempPassword } from "./security";

/**
 * Staff accounts and the duty roster (ISO 15189 §6.2: authorised personnel). Managed by the chief scientist or an
 * administrator. Guard rails are checked against the database at the moment of the change, so the lab can never
 * lose its last chief scientist or administrator, and nobody can disable or demote themselves.
 */
export type Role = "scientist" | "chief_scientist" | "admin";
export const ROLES: Role[] = ["scientist", "chief_scientist", "admin"];
export const ROLE_LABEL: Record<Role, string> = { scientist: "Medical lab scientist", chief_scientist: "Chief scientist", admin: "Administrator" };
type Actor = { id: string; role: string };
type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const isManager = (a: Pick<Actor, "role">) => a.role === "chief_scientist" || a.role === "admin";
const NOT_MANAGER = "Only a chief scientist or an administrator can manage staff.";
type StaffRow = { id: string; lab_id: string; display_name: string; role: Role; username: string | null; active: number };
const get = (id: string) => db().prepare("SELECT id, lab_id, display_name, role, username, active FROM staff WHERE id = ?").get(id) as StaffRow | undefined;
const othersActive = (role: Role, notId: string) => (db().prepare("SELECT COUNT(*) n FROM staff WHERE role = ? AND active = 1 AND id != ?").get(role, notId) as { n: number }).n;
const endSessions = (staffId: string) => db().prepare("DELETE FROM sessions WHERE staff_id = ?").run(staffId);

/** Refuses a change that would leave no active chief scientist or administrator. */
function keepsLeaders(s: StaffRow, nextRole: Role, nextActive: boolean): string | null {
  for (const [role, name] of [["chief_scientist", "chief scientist"], ["admin", "administrator"]] as const)
    if (s.role === role && s.active && (!nextActive || nextRole !== role) && othersActive(role, s.id) === 0)
      return `${s.display_name} is the last active ${name}. Add or activate another ${name} first.`;
  return null;
}

export function addStaff(input: { display_name: string; username: string; role: Role }, by: Actor): ({ ok: true; id: string; tempPassword: string }) | Fail {
  if (!isManager(by)) return fail(NOT_MANAGER);
  const name = input.display_name.trim().replace(/\s+/g, " ");
  const username = normaliseUsername(input.username);
  if (name.length < 3 || name.length > 80) return fail("Enter the person's name as it should appear on reports (3-80 characters).");
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) return fail("Usernames are 3-32 letters, digits, dots, dashes or underscores, starting with a letter.");
  if (!ROLES.includes(input.role)) return fail("Choose a role.");
  if (db().prepare("SELECT 1 FROM staff WHERE username = ?").get(username)) return fail(`The username "${username}" is already taken.`);
  const last = db().prepare("SELECT id FROM staff WHERE id LIKE 'STF-%' ORDER BY CAST(substr(id, 5) AS INTEGER) DESC LIMIT 1").get() as { id: string } | undefined;
  const id = `STF-${String((last ? Number(last.id.slice(4)) : 0) + 1).padStart(3, "0")}`;
  const lab = (db().prepare("SELECT id FROM labs LIMIT 1").get() as { id: string }).id;
  const temp = tempPassword();
  db().prepare("INSERT INTO staff (id, lab_id, display_name, role, username, password_hash, active, must_change_password) VALUES (?,?,?,?,?,?,1,1)")
    .run(id, lab, name, input.role, username, hashPassword(temp));
  audit({ type: "human", id: by.id }, "staff.added", `${name} (${username}) added as ${ROLE_LABEL[input.role]}; temporary password issued`, "staff", id);
  return { ok: true, id, tempPassword: temp };
}

export function setActive(id: string, active: boolean, by: Actor): { ok: true } | Fail {
  if (!isManager(by)) return fail(NOT_MANAGER);
  const s = get(id);
  if (!s) return fail("Staff member not found.");
  if (id === by.id && !active) return fail("You can't deactivate your own account.");
  if (!active) { const why = keepsLeaders(s, s.role, false); if (why) return fail(why); }
  db().prepare("UPDATE staff SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (!active) endSessions(id);
  audit({ type: "human", id: by.id }, active ? "staff.activated" : "staff.deactivated", `${s.display_name} ${active ? "reactivated" : "deactivated; signed out everywhere"}`, "staff", id);
  return { ok: true };
}

export function setRole(id: string, role: Role, by: Actor): { ok: true } | Fail {
  if (!isManager(by)) return fail(NOT_MANAGER);
  if (!ROLES.includes(role)) return fail("Choose a role.");
  const s = get(id);
  if (!s) return fail("Staff member not found.");
  if (id === by.id) return fail("You can't change your own role. Ask another chief scientist or administrator.");
  if (s.role === role) return { ok: true };
  const why = keepsLeaders(s, role, true);
  if (why) return fail(why);
  db().prepare("UPDATE staff SET role = ? WHERE id = ?").run(role, id);
  audit({ type: "human", id: by.id }, "staff.role", `${s.display_name}: ${ROLE_LABEL[s.role]} → ${ROLE_LABEL[role]}`, "staff", id);
  return { ok: true };
}

/** A new temporary password, read out once; the person must replace it at their next sign-in. */
export function resetPassword(id: string, by: Actor): ({ ok: true; tempPassword: string }) | Fail {
  if (!isManager(by)) return fail(NOT_MANAGER);
  const s = get(id);
  if (!s || !s.username) return fail("Staff member not found.");
  if (id === by.id) return fail("Change your own password from your account page.");
  const temp = tempPassword();
  db().prepare("UPDATE staff SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hashPassword(temp), id);
  endSessions(id);
  clearFailures(s.username);
  audit({ type: "human", id: by.id }, "staff.password_reset", `${s.display_name}: password reset; signed out everywhere; must choose a new one at next sign-in`, "staff", id);
  return { ok: true, tempPassword: temp };
}

/** Unlock an account locked by failed sign-ins, without changing its password. */
export function unlock(id: string, by: Actor): { ok: true } | Fail {
  if (!isManager(by)) return fail(NOT_MANAGER);
  const s = get(id);
  if (!s?.username) return fail("Staff member not found.");
  clearFailures(s.username);
  audit({ type: "human", id: by.id }, "staff.unlocked", `${s.display_name}: sign-in lock cleared`, "staff", id);
  return { ok: true };
}

export function changeOwnPassword(id: string, current: string, next: string, keepTokenHash?: string): { ok: true } | Fail {
  const s = db().prepare("SELECT display_name, username, password_hash FROM staff WHERE id = ? AND active = 1").get(id) as { display_name: string; username: string; password_hash: string } | undefined;
  if (!s) return fail("Your current password isn't right.");
  // Guessing the current password here counts towards the same lock-out as the sign-in page.
  if (lockedUntil(s.username)) return fail("Too many attempts. Wait 15 minutes, or ask the lab administrator to unlock your account.");
  if (!verifyPassword(current, s.password_hash)) {
    recordFailure(s.username);
    audit({ type: "system" }, "auth.failed", `Wrong current password on the account page for "${s.username}"`, "staff", id);
    return fail("Your current password isn't right.");
  }
  if (next === current) return fail("Choose a password different from the current one.");
  const why = checkPassword(next, s.username);
  if (why) return fail(why);
  db().prepare("UPDATE staff SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hashPassword(next), id);
  // Other devices signed in as this person are signed out; this one stays signed in.
  db().prepare("DELETE FROM sessions WHERE staff_id = ? AND token_hash != ?").run(id, keepTokenHash ?? "");
  audit({ type: "human", id }, "auth.password_changed", `${s.display_name} changed their password`, "staff", id);
  return { ok: true };
}

export function setRoster(id: string, weekdays: number[], by: Actor): { ok: true } | Fail {
  if (!isManager(by)) return fail("Only a chief scientist or an administrator can change the duty roster.");
  const s = get(id);
  if (!s) return fail("Staff member not found.");
  if (!weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return fail("Days must be Monday to Sunday.");
  const days = [...new Set(weekdays)].sort();
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM duty_roster WHERE staff_id = ?").run(id);
    for (const w of days) d.prepare("INSERT INTO duty_roster VALUES (?, ?)").run(id, w);
    audit({ type: "human", id: by.id }, "staff.roster", `${s.display_name} on duty: ${days.map((w) => DAYS[w - 1]).join(", ") || "no days"}`, "staff", id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    return fail(e instanceof Error ? e.message : "Saving the roster failed.");
  }
  return { ok: true };
}

/**
 * Keep a secret (a temporary password) for one viewer for two minutes. It isn't deleted on first read because Next.js
 * renders the page twice after a server action; it's bound to the admin who created it and expires on its own.
 */
export function stashOnce(viewerId: string, text: string): string {
  const id = randomBytes(18).toString("base64url");
  db().prepare("DELETE FROM one_time_notes WHERE expires_at < ?").run(nowIso());
  db().prepare("INSERT INTO one_time_notes VALUES (?,?,?,?)").run(id, viewerId, text, new Date(Date.now() + 120_000).toISOString());
  return id;
}
export function takeOnce(id: string | undefined, viewerId: string, now = Date.now()): string | null {
  if (!id) return null;
  const row = db().prepare("SELECT text FROM one_time_notes WHERE id = ? AND viewer_id = ? AND expires_at > ?").get(id, viewerId, new Date(now).toISOString()) as { text: string } | undefined;
  return row?.text ?? null;
}
