# Lab-admin iteration 1 · Implementation Plan

> Written with the `writing-plans` skill; executed with `test-driven-development`, reviewed with `sharp-edges` and `differential-review`, closed with `verification-before-completion`.

**Goal:** Give the lab administrator and chief scientist the controls a real lab needs (staff, roster, sign-in security, critical-result calls, audit search and export, turnaround monitoring), each secure by default.

**Architecture:** Each feature is one focused module in `web/lib/` (pure database logic, no Next.js imports, so it can be unit-tested in seconds), a server-rendered page or panel in `web/app/(lab)/`, and server actions that re-check the role on every call. Every state change writes an audit entry.

**Tech stack:** Next.js 15 (server components and server actions), Node 25 `node:sqlite`, `node:test` with Node's built-in TypeScript type stripping, Playwright (`playwright-core`) against installed Chrome.

**Spec:** John's brief of 2026-10-20 (industry-standard UI/UX from a lab-admin perspective, security-checked) and `docs/ux-recommendations.md` items 11, 14, 15, 17.

## Global constraints
- Roles: `scientist`, `chief_scientist`, `admin`. "Manager" = chief or admin. Approval stays chief-only.
- Passwords (NIST SP 800-63B rev 4): minimum **15** characters (one setting, `PASSWORD_MIN`), maximum 128, no composition rules, rejected if on the common-password list or containing the username; never force periodic changes. Temporary passwords set by an admin must be changed at next sign-in.
- Sign-in lockout: **5** failed attempts within **15** minutes locks the account for **15** minutes; the error message never says which of username or password was wrong.
- Idle sessions end after **30** minutes without activity; absolute limit stays 12 hours (one shift).
- Critical results (ISO 15189:2022 §7.4.1.3): approval is blocked until every critical (`C`) result has a call record: who called, who was told, their role, time, and read-back confirmed.
- CSV export is manager-only, audited, and neutralises spreadsheet formulas (cells starting `= + - @`, tab or CR get a leading `'`).
- No new npm dependencies. Synthetic data only.

## Review focus
1. **Last chief or admin locks everyone out:** deactivating or demoting the only active chief / admin, or yourself, must be refused.
2. **Deactivated staff keep a live session:** deactivation must end their sessions immediately.
3. **Lockout as a denial-of-service:** an attacker can lock a real user out for 15 minutes, but never permanently, and an admin can unlock them.
4. **Spreadsheet formula injection:** a patient name like `=HYPERLINK(...)` in the audit log must export as text.
5. **A critical value corrected away:** if a critical result is corrected to a normal value, its earlier call record must not block or be lost (it stays in the audit log).

## File map
| File | Responsibility |
|---|---|
| `web/lib/db.ts` | + `MCL_DB_PATH` override (tests only), new tables, `staff.must_change_password` |
| `web/lib/security.ts` | password policy, lockout counters, idle timeout constants |
| `web/lib/auth.ts` | uses `security.ts`: lockout on sign-in, idle expiry, forced change flag |
| `web/lib/staff.ts` | add / update / deactivate staff, reset password, roster edits, guard rails |
| `web/lib/critical.ts` | critical results needing a call, record a call, Gaya check line |
| `web/lib/auditlog.ts` | filtered audit query, CSV with formula neutralisation |
| `web/lib/tat.ts` | expected turnaround per request, overdue status |
| `web/app/(lab)/staff/page.tsx` | staff and roster management (manager only) |
| `web/app/(lab)/account/page.tsx` | change own password (everyone) |
| `web/app/(lab)/audit/page.tsx`, `web/app/api/audit.csv/route.ts` | filters + export |
| `web/app/(lab)/orders/[id]/page.tsx` | critical call form on the order |
| `web/app/(lab)/worklist/page.tsx`, dashboard | turnaround clock, overdue count |
| `web/components/UnsavedGuard.tsx` | warn before leaving a form with typed changes |
| `web/tests/*.test.ts`, `web/tests/setup.mjs` | unit tests (`node --test`) |
| `web/scripts/e2e.mjs` | end-to-end checks for the UI and role boundaries |

### Task 0: Fast test harness
**Files:** create `web/tests/setup.mjs` (resolve hook: extensionless and `@/` imports to `.ts`), `web/tests/helpers.ts` (fresh temporary database per test file); modify `web/lib/db.ts` (`MCL_DB_PATH`); add `"test": "node --import ./tests/setup.mjs --test tests/"` to `package.json`.
- [ ] Write `tests/harness.test.ts`: a fresh database has 108 prices and an active chief. Run: `npm test`. Expect: FAIL (no harness).
- [ ] Implement; run; expect PASS.

### Task 1: Sign-in protection and passwords
**Interfaces:** `checkPassword(pw, username): string | null` (reason or null) · `recordFailure(username)`, `isLocked(username): Date | null`, `clearFailures(username)` · `IDLE_MINUTES = 30`, `PASSWORD_MIN = 15`.
- [ ] Failing tests: short, common and username-containing passwords rejected, a 15-character passphrase accepted; 5 failures lock, a 6th attempt with the right password is still refused while locked, the lock expires after 15 minutes; unlock by admin clears it.
- [ ] Implement `security.ts`; wire into `signIn` (`auth.ts`) and `currentUser` (idle expiry); `/account` page to change one's own password (current password required); forced change redirect for `must_change_password`.
- [ ] e2e: wrong password ×5 then right password → still refused with the generic message; change own password works and the old one stops working.

### Task 2: Staff and duty roster
**Interfaces:** `addStaff({display_name, username, role}, by)` → `{ok, tempPassword}` · `setRole`, `setActive(id, active, by)`, `resetPassword(id, by)` → temp password shown once · `setRoster(id, weekdays[], by)`.
- [ ] Failing tests: manager-only; can't deactivate or demote yourself; can't remove the last active chief or admin; deactivation deletes the person's sessions; usernames unique and lower-case; roster saves weekdays 1–7 only; every change audited.
- [ ] Implement `staff.ts` and `/staff` page; Settings links to it.
- [ ] e2e: admin adds a scientist and sets their roster; the new scientist signs in with the temp password, is forced to change it, and can then enter results only on rostered days; scientist typing `/staff` is refused.

### Task 3: Critical-result call log
**Interfaces:** `criticalsNeedingCall(orderId)` · `recordCall(orderId, {result_ids, called_name, called_role, read_back}, by)` · a line in `checksFor()`.
- [ ] Failing tests: an order with Hb 6.5 (critical) is held "critical result not yet phoned"; recording a call with read-back releases the hold; a call without read-back is refused; the call is audited with time, caller and recipient.
- [ ] Implement table `critical_calls`, `critical.ts`, the call form on the order page.
- [ ] e2e: critical Hb → order held → scientist records the call → chief can approve.

### Task 4: Audit search and safe export
**Interfaces:** `queryAudit({from, to, actor, action, q, limit})` · `toCsv(rows)`.
- [ ] Failing tests: filters combine; `=1+1` exports as `'=1+1`; quotes and commas escaped; export is refused for scientists and itself audited.
- [ ] Implement `auditlog.ts`, filter form on `/audit`, `GET /api/audit.csv` (manager only, `Content-Disposition: attachment`, `Cache-Control: no-store`).
- [ ] e2e: chief filters to `price.changed`, downloads the CSV, file starts with the header row; scientist gets 403.

### Task 5: Turnaround monitor
**Interfaces:** `expectedTat(orderId)` (hours, from the slowest test) · `tatStatus(order) → "on_time" | "due_soon" | "overdue"` with minutes left.
- [ ] Failing tests: FBC received 3 h ago is overdue (2 h target); a 72 h culture received yesterday is on time; released orders are never overdue.
- [ ] Implement; worklist clock column and filter "Overdue"; dashboard KPI.

### Task 6: Form safety
- [ ] `UnsavedGuard` warns on leaving the result-entry and price pages with typed changes; submit buttons stay disabled until the page is interactive.
- [ ] e2e: typing then navigating away triggers the browser's leave-page dialog.

### Task 7: Security review and verification
- [ ] `differential-review` report over every changed file (saved as `docs/security/2026-10-20-iteration-1-review.md`) with the sharp-edges checklist: authorisation on every action, input validation, injection (SQL, CSV, HTML), session handling, secrets, error messages, audit coverage, denial of service.
- [ ] Fix every high and medium finding with a regression test.
- [ ] Fresh runs: `npm test`, `npx tsc --noEmit`, `npm run build`, full e2e. Report the counts.
- [ ] Commits wait for John's approval (none made without it).
