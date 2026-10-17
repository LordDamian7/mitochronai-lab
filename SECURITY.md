# Security

MitochronAi Lab handles laboratory workflows. Its safety rules matter as much as its code.

## Data
- **This repository contains synthetic data only.** Every patient, scientist, result and address is fictional. Patient e-mails use `example.com`, which is reserved for documentation, so nothing can reach a real person.
- **Never commit real patient data.** `.gitignore` allows only `data/synthetic/`, and a pre-commit check blocks e-mail addresses outside `example.com` and common secret formats.
- **Isolation between labs** is enforced by the database (row-level security in `db/schema.sql`), not by application code.

## The agent (Gaya)
- Gaya automates paperwork and recommends procedures cited from the lab's own SOPs. Gaya does **not** interpret results. Optional comments are off by default and always edited and approved by a scientist.
- Nothing is released without a named chief scientist's approval. The database rejects a release with no approver.
- The audit log is append-only. The database rejects edits and deletions.
- Uploaded documents are **data, not instructions**. Text in an SOP, email or issue that tries to direct Gaya is flagged, never obeyed.

## Reporting a vulnerability
Use GitHub's private vulnerability reporting (**Security** tab → "Report a vulnerability"), not a public issue.
