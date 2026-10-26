# Security review · USB / offline updates (2026-10-22)

Method: `differential-review` with the `sharp-edges` checklist, over every file added or changed for v0.5. Reviewer: Ambrose. **Confidence: medium-high.** The verifier, the staging and the supervisor are covered by unit tests. The full upload → install → rollback path is covered by `scripts/update-e2e.mjs` against a real supervisor.

## Scope
`lib/update.ts` (format, signature, path rules, limits, apply/restore), `lib/update-key.ts`, `lib/updater.ts` (staging, request, status), `scripts/make-update.mjs` (signing), `scripts/supervisor-core.mjs` and `scripts/run.mjs` (install, rollback, power-cut recovery), `app/api/update/upload/route.ts`, `app/(lab)/update/page.tsx`, `components/UploadUpdate.tsx`, `components/ConfirmSubmit.tsx`, `app/(lab)/layout.tsx`, `next.config.ts`, `START-HERE.bat`, bundled fonts.

## Threat model
| Threat | Defence | Evidence |
|---|---|---|
| A forged or altered package (USB virus, a stranger's laptop) | Ed25519 signature over format, app, version and the SHA-256 of the payload. The public key is pinned in the code, and the private key never leaves John's PC (`~/.mitochronai/update-signing`). Each file is also checked against its SHA-256 in the signed manifest. | Unit: one changed byte, a different signer, a wrong fingerprint. e2e: a TAMPERED package is refused with a clear reason. |
| Another lab edition's package installed on MitochronAi, or the other way round | The app name is inside the signature and must equal `package.json` `name`. | Unit: "for app-b" refused. **Every lab edition must have its own package name (see O1).** |
| Rolling back to an older version that has known bugs | The version must be strictly newer, checked on upload and again at install. | Unit and e2e: the same version is refused. |
| Path traversal / overwriting patient data | Allowlist: `app/ components/ lib/ public/ scripts/ tests/` plus five root files. Refused: `..`, `.`, absolute paths, backslashes, drive letters, `var/`, `seed/`, `node_modules/`, `.next/`. Checked by the signer **and** the reader, so a compromised build machine still can't reach `var/`. | Unit: 12 bad paths; a signed package naming `../var/…` is refused. |
| Decompression bomb, or a huge upload filling the disk or RAM | 25 MB packed (Content-Length checked, then the stream is cut at 25 MB), 60 MB unpacked (`maxOutputLength`), 2,000 files. | Unit: a bomb that's small on USB is stopped. Route returns 413. |
| Anyone other than the lab admin uploading or installing | The route checks the session and `role === "admin"` **before reading the body** (401/403). The page and both server actions re-check; `stageUpdate`, `requestInstall` and `discardStaged` re-check in `lib/`. | e2e: chief can't open the page and has no menu item; scientist 403; anonymous 401. Unit: non-admin refused in lib. |
| CSRF on the upload route (it is a route handler, so Next's server-action origin check doesn't apply) | Origin header required; its host must equal Host. SameSite=Lax cookies. | e2e: the admin's cookie with `Origin: evil.example` → 403. |
| Large bodies accepted everywhere | The first draft raised `serverActions.bodySizeLimit` to 26 MB for **every** action, so any signed-in user could send 26 MB bodies to any form. Removed; only the dedicated upload route accepts large bodies, and only after the admin check. | `next.config.ts` diff. |
| A new library smuggled in (supply chain) | `package-lock.json` must be byte-identical to the installed one. Packages can't add or change dependencies, and the install never touches the internet. | Unit (updater) refused, with a clear message. |
| Power cut or crash during install | `installing.json` marks an install in progress. On the next start, `recoverInterrupted` restores the code and `.next` from the backup and records it. | Unit: supervisor recovery test. |
| A broken update leaves the lab without its app | Backup (code, `.next`, a DB copy), then build, start and self-test. Any failure restores the old code and build and restarts it. | Unit: build failure and self-test failure both roll back. e2e: broken 0.5.2 rolled back; app answers on 0.5.1; the broken file is gone; data counts are unchanged. |
| Data loss | Packages can't name `var/`. The DB is copied before install, and **never restored automatically** (results entered after an update must not be silently lost). | Unit: patient file untouched by apply/restore. e2e: counts equal before and after. |
| No record of who changed the software | Audit rows for staged, refused, requested, discarded, installed, rolled_back and recovered (actor = admin, or "system" for the supervisor). Shown as Update history on the page. | e2e: history shows the checks, the install and the rollback. |
| The update page reachable over the network | The server binds to 127.0.0.1 by default, and the supervisor files sit beside the DB in `var/update`, which isn't web-served. | `run.mjs` defaults. |
| Builds failing offline (a lab without internet can't install) | `next/font/google` downloads at build time. Fonts are now bundled (IBM Plex, OFL licence included). | Found by the first real install (rolled back correctly). `tests/offline.test.ts` keeps it fixed. |

## Findings fixed during this iteration
| # | Severity | Finding | Fix |
|---|---|---|---|
| U1 | Medium | `bodySizeLimit: "26mb"` applied to all server actions (DoS by any signed-in user). | Dedicated upload route; limit removed. |
| U2 | High (availability) | The build fetched fonts from Google, so every offline install would fail and roll back. | Fonts bundled; regression test. |
| U3 | Low (test reliability) | The e2e could accept a `status.json` left by an earlier run. | Only a status written after the Install click counts. |
| U4 | Low (test reliability) | The e2e waited for the URL change before the upload had finished on a slow PC. | Wait for the upload response, then for the result notice. |
| U5 | High (availability) | **Found by the real e2e run.** Windows grew its page file to 10.9 GB during the 0.5.2 build and the disk reached 0 bytes free. The build failed and the automatic rollback then also failed half-way (ENOSPC while copying files back), leaving mixed code. The power-cut safeguard worked as designed: `installing.json` was still there, and the start-up recovery restored 0.5.1 exactly (every file checked against the backup). Patient data was never touched. | The supervisor now refuses to **start** an install with less than 1 GB free. It changes nothing, doesn't stop the app, keeps the package ready and tells the admin why. Unit test `REVIEW U5` (red, then green). |

## Open items
| # | Severity | Item | Recommendation |
|---|---|---|---|
| O1 | High (resolved) | A second lab edition built from this code kept `"name": "mitochronai-lab-web"`. With the same signing key, a MitochronAi package would have been accepted there. | Resolved: the edition now has its own package name, and its tests check it. |
| O2 | Medium | The private signing key is a plain PEM file. On Windows, `mode 0o600` has no effect, so anyone with access to John's account can sign updates for both labs. | Keep it off cloud-synced folders. Consider a passphrase-encrypted key (`--init-key` with a passphrase) or a hardware key, and keep an offline backup. A new key needs a one-time manual install of the new public key. |
| O3 | Low | There's no key-rotation or revocation mechanism. | Document the manual procedure: ship a package that changes `lib/update-key.ts`, signed with the old key, before retiring it. |
| O4 | Low | The admin can install during opening hours. The confirmation dialog warns, but nothing prevents it. | Optional: block installs while requests are in progress, or outside a set window. |
| O6 | Medium | Rollback copies files back; on a completely full disk it can still fail. The start-up recovery is the backstop. | Optional: rename instead of copy during rollback, so it needs no free space. |
| O5 | Info | Anyone with write access to the PC's disk can bypass all of this. | Out of scope. Windows accounts, BitLocker and physical security are the control. |

## Checklist coverage
Authorisation: pass. CSRF: pass. Path traversal: pass. Resource limits: pass. Cryptography: pass (Ed25519 from Node's crypto, no home-made primitives, constant format string). Secrets in the repo: pass (private key outside the repo; `*.mlup` and `dist-updates/` git-ignored). Error messages: pass (plain-English reasons, no stack traces). Audit: pass. Supply chain: pass (lockfile pinned).
