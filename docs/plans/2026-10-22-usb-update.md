# Signed USB updates · Implementation Plan

**Goal:** the lab's administrator installs a new version of the app from a USB stick, safely, with backup and automatic rollback.

**Architecture:** John builds a signed package on his PC (`scripts/make-update.mjs`, Ed25519 key kept in his user profile, never in a repo). In the lab, the admin uploads it on **Settings → Software update**; the app verifies and stages it. A small supervisor (`scripts/run.mjs`, started by `START-HERE.bat`) re-verifies it, backs up the app and the database, installs, rebuilds, self-tests, and rolls back on any failure. One verification module (`lib/update.ts`, Node built-ins only) is shared by the tool, the app and the supervisor.

## Global constraints
- Only the **admin** role may stage or install; checked on the server.
- A package must be: signed by the pinned key; for **this** app (package name); **newer** than the installed version (no downgrades); at most 25 MB packed and 60 MB unpacked; and only touch the app's code (`app/ components/ lib/ public/ scripts/ tests/` and the four config files). Never `var/` (patient data), `node_modules/`, `.next/` or `seed/`.
- Dependency changes (a different `package-lock.json`) are refused: they need internet; the lab installs offline.
- Nothing runs from the USB by itself; the admin starts it. Every step is in the audit log.

## Review focus
1. A tampered or forged package; 2. a package for the other lab's app; 3. a path like `../var/mitochronai.db`; 4. a decompression bomb; 5. a power cut or failed build mid-update (rollback must leave the old version running with its data).

## Tasks
0. `lib/update.ts` tests first (sign/verify, tamper, wrong app, downgrade, unsafe paths, bomb, hashes), then the module.
1. `scripts/make-update.mjs` (key init; package build).
2. Staging in the app (`lib/updater.ts`, `/update` page, body-size limit), tests for roles and checks.
3. Supervisor (`scripts/run.mjs`): apply, rebuild, self-test, rollback; apply logic unit-tested in a temp folder.
4. `START-HERE.bat` runs the supervisor; version shown in the side menu.
5. Security review; real end-to-end update on the production build; port to the second lab edition.
