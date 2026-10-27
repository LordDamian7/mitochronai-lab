import { randomInt } from "node:crypto";
import { db } from "./db";

/**
 * Sign-in security, following NIST SP 800-63B rev 4: long passwords, no composition rules, screening against
 * common passwords, no forced periodic changes; plus account lock-out after repeated failures (OWASP ASVS V2).
 */
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const LOCK_AFTER = 5;
export const LOCK_WINDOW_MIN = 15;
export const LOCK_MINUTES = 15;
export const IDLE_MINUTES = 30;

// The letters of passwords people pick most, worldwide and in Nigeria. A password whose letters are only one of
// these (with digits or symbols around them) is refused.
const COMMON = new Set(("password passw passwd pass qwerty qwertyuiop asdfgh asdfghjkl zxcvbn abc abcdef letmein welcome admin administrator " +
  "iloveyou love monkey dragon football baseball soccer sunshine princess master shadow superman batman trustno login root user guest test " +
  "secret changeme default nigeria naija lagos abuja jesus jesuschrist god godisgood blessing blessed favour favor grace mercy praise amen " +
  "chelsea arsenal manutd barcelona madrid liverpool hello hellohello lab laboratory doctor nurse hospital").split(" "));

export const normaliseUsername = (u: string) => u.trim().toLowerCase();

/** Why a new password is refused, or null if it's acceptable. */
export function checkPassword(pw: string, username: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters. A short sentence you'll remember works well, such as "tea at noon in yaba".`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = pw.toLowerCase(), letters = lower.replace(/[^a-z]/g, "");
  if (new Set(lower).size <= 3 || /^[\d\s\W]*$/.test(lower) || COMMON.has(letters) || /0123456789|1234567890|9876543210|abcdefghij|qwertyuiop/.test(lower.replace(/\s/g, "")))
    return "That password is too common or too predictable. Choose a sentence or several unrelated words.";
  const user = normaliseUsername(username);
  if (user.length >= 3 && (lower.includes(user) || user.split(/[._-]/).some((part) => part.length >= 4 && lower.includes(part))))
    return "Don't include your username in your password.";
  if (/mitochron/.test(letters)) return "Don't include the lab's name in your password.";
  return null;
}

/** A random temporary password an administrator reads out once; the person must replace it at first sign-in. */
export function tempPassword(): string {
  const A = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i: easy to read aloud and type
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join("")).join("-");
}

export function recordFailure(username: string, now = Date.now()) {
  // Rows older than anything a lock can depend on are removed, so typing random usernames can't fill the disk.
  db().prepare("DELETE FROM login_failures WHERE at < ?").run(new Date(now - (LOCK_WINDOW_MIN + LOCK_MINUTES) * 60_000).toISOString());
  db().prepare("INSERT INTO login_failures (username, at) VALUES (?, ?)").run(normaliseUsername(username).slice(0, 64), new Date(now).toISOString());
}

/** When the lock on this username ends, or null if it isn't locked. */
export function lockedUntil(username: string, now = Date.now()): Date | null {
  const rows = db().prepare("SELECT at FROM login_failures WHERE username = ? AND at > ? ORDER BY at DESC")
    .all(normaliseUsername(username), new Date(now - (LOCK_WINDOW_MIN + LOCK_MINUTES) * 60_000).toISOString()) as { at: string }[];
  // Look for LOCK_AFTER failures inside any LOCK_WINDOW_MIN window ending at the most recent failure.
  const times = rows.map((r) => Date.parse(r.at)).filter((t) => t <= now);
  if (times.length < LOCK_AFTER) return null;
  const last = times[0], windowStart = last - LOCK_WINDOW_MIN * 60_000;
  if (times.filter((t) => t >= windowStart).length < LOCK_AFTER) return null;
  const until = last + LOCK_MINUTES * 60_000;
  return until > now ? new Date(until) : null;
}

export function clearFailures(username: string) {
  db().prepare("DELETE FROM login_failures WHERE username = ?").run(normaliseUsername(username));
}

export const isSessionIdle = (lastSeenIso: string, now = Date.now()) => now - Date.parse(lastSeenIso) > IDLE_MINUTES * 60_000;
