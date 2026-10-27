# Security review · lab-admin iteration 1 (2026-10-20)

Method: `differential-review` (risk-first, evidence-based) with the `sharp-edges` checklist, over every file changed in this iteration. Codebase size: MEDIUM (about 60 source files), so the review was focused: each changed file plus one hop of callers. Reviewer: Ambrose. **Confidence: medium-high for the changed code; the pre-existing code was only reviewed where the new features touch it.**

## Scope
`lib/security.ts`, `lib/auth.ts`, `lib/staff.ts`, `lib/critical.ts`, `lib/auditlog.ts`, `lib/tat.ts`, `lib/lab.ts` (checks, re-evaluation), `lib/db.ts` (schema, migration, test path), `app/(lab)/staff`, `app/account`, `app/login`, `app/(lab)/audit`, `app/api/audit.csv`, `app/api/events`, `app/(lab)/orders/[id]`, worklist, dashboard, layout, `components/UnsavedGuard.tsx`, `next.config.ts`.

## Findings fixed in this iteration
| # | Severity | Finding | Fix | Regression evidence |
|---|---|---|---|---|
| 1 | High | The forced password change was enforced only by the page layout. Server actions and direct POSTs bypass layouts, so a person still on a temporary password could call, for example, the price-save action. | `requireUser()` now redirects anyone with `must_change_password` to `/account` unless the caller opts in (only the account page does). | e2e §18: every page returns to `/account`; code path shared by all actions. |
| 2 | Medium | `/account` allowed unlimited guessing of the current password from a stolen session. | Wrong current passwords count towards the same lock-out; a locked account can't change its password. | Unit test `REVIEW #2` (red, then green). |
| 3 | Medium | `login_failures` grew without limit: typing random usernames could fill the disk. | Rows older than the lock window are pruned on every failure; usernames capped at 64 characters. | Unit test `REVIEW #3` (red, then green). |
| 4 | High | The audit CSV export and the live feed ignored the temporary-password state. | Both return 403 until the person chooses a password. | e2e §18 (live feed 403). |
| 5 | Medium (integrity) | After a critical call was recorded, a held request stayed held forever, even with every check passing. | `reevaluate()` re-runs Gaya's checks after a call; releases the hold and drafts the report. | Unit test `REVIEW #5` (red, then green); e2e §22. |
| 6 | Medium | No browser security headers: the app could be framed by another site (clickjacking on "Approve and send"). | CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, Permissions-Policy, COOP. | e2e §25; `curl -D -` shows the headers. |
| 7 | Medium (pre-existing) | The full audit log and the dashboard activity feed showed prices and reagent costs to scientists. | Audit log is manager-only; the dashboard feed hides `price.*`, `stock.*`, `staff.*`, `audit.*`, `auth.*` for scientists. | Unit test (scientist-safe filter); e2e §20. |
| 8 | Low (design) | Sign-in leaked which usernames exist: failures for unknown names weren't counted, and unknown names returned faster (no hash computed). | Failures recorded for any name; a dummy scrypt hash is checked for unknown names; one message for both. | e2e §19 (same wording for an unknown user). |
| 9 | Medium (design) | A temporary password in a redirect URL would be stored in browser history and server logs. | Note with a random 144-bit id, readable only by the admin who created it, for 2 minutes. Only the id is in the URL. (First design deleted it on first read; the e2e run showed Next.js renders the page twice after a server action, so the admin never saw it. Changed to time-bound.) | Unit test (viewer-bound, expires); e2e §18 (URL doesn't contain it; another manager opening the link doesn't see it). |
| 11 | High (introduced here, caught by e2e) | The first version of finding 6 set `Referrer-Policy: no-referrer`. Chrome then sends `Origin: null` on plain form posts (a click before scripts load), and Next.js's server-action CSRF check rejected the sign-in (`TypeError: Invalid URL 'null'`). | `Referrer-Policy: same-origin`: full referrer within the app, nothing to other sites. | e2e §26: sign-in with JavaScript switched off. |
| 10 | Medium (design) | A Secure-cookie setting tied to "production" would break sign-in on plain-HTTP lab networks, and its opt-out switch would be a footgun. | The cookie is marked Secure exactly when the request arrived over HTTPS; there is no setting. | Code review. |

## Checklist coverage
| Area | Result |
|---|---|
| Authorisation on every server action and route | Pass. Each action calls `requireUser()`; staff, price, stock, audit and export functions re-check the role inside `lib/`. |
| CSRF | Pass for state changes (Next.js server actions verify that Origin matches Host). The CSV export is a GET that only writes an audit line; SameSite=Lax cookies; impact limited to a download on the chief's own device. |
| Injection: SQL | Pass. Parameterised throughout; the only dynamic SQL is fixed clause strings and an integer `LIMIT` clamped to 1-5000. LIKE wildcards escaped. |
| Injection: HTML / XSS | Pass. React escapes all output; no `dangerouslySetInnerHTML`. |
| Injection: CSV formulas | Pass. `= + - @ tab CR` neutralised (OWASP); unit-tested. |
| Passwords | Pass (NIST 800-63B rev 4 shape): 15-128 characters, no composition rules, common and predictable passwords and the username refused, no forced rotation. |
| Lock-out | Pass: 5 failures in 15 minutes → 15-minute lock, never permanent, admin unlock, same message for real and unknown users. |
| Sessions | Pass: random 256-bit token, only its SHA-256 stored, HttpOnly, SameSite=Lax, Secure on HTTPS, 12-hour cap, 30-minute idle end, all sessions ended on deactivation or password reset, other devices on password change. |
| Least privilege | Pass: prices, revenue, stock counts and costs, the audit log, staff and export are manager-only on the server; tested by typing addresses directly. |
| Audit coverage | Pass: staff add/role/activation/reset/unlock/roster, password change, lock-outs, critical calls, exports, price and stock changes. Temporary passwords are never written to the log. |
| Secrets | Pass: no secrets in code, URLs or logs; demo passwords only in the seed file. |
| Error messages | Pass with a note (see L3). |
| Denial of service | Pass with notes: lock-out bounded at 15 minutes; failure table pruned; export capped at 5,000 rows. |

## Open items (not fixed in this iteration)
| # | Severity | Item | Proposed next step |
|---|---|---|---|
| M1 | Medium | Password hashing uses Node's scrypt defaults (N=16384, r=8, p=1). OWASP's current guidance is stronger (for example N=2^17). The lab PC has 6 GB of RAM, so the memory cost per sign-in matters. | Store the parameters in the hash, raise them, and re-hash on each successful sign-in. Needs the lab server's specification (question for John). |
| L1 | Low | The idle timeout counts background refreshes from the live feed as activity, so a screen left open in a busy lab may stay signed in. | Count only user navigation as activity, or add a client-side idle lock screen. |
| L2 | Low | The live feed tells every signed-in person *that* prices or staff changed (not the values). | Send manager-only event kinds only to managers. |
| L3 | Low | Error messages are passed in the URL and shown on the page, so a crafted link can display misleading text in the app's error style (content spoofing, no script execution). | Pass error codes and map them to fixed messages. |
| L4 | Low | No HTTPS yet on the lab network (only a deployment question): passwords cross the LAN in clear text. | Serve over HTTPS on the LAN (local certificate) or over Tailscale. |
| I1 | Info | No multi-factor authentication. NIST allows 8-character passwords only with MFA; this design uses 15 without MFA. | TOTP for chief and admin accounts in a later iteration. |
