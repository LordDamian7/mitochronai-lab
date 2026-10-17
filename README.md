# MitochronAi Lab

**An AI laboratory assistant platform for diagnostic labs, built by a medical laboratory scientist.**

MitochronAi Lab gives each laboratory its own isolated workspace and an AI assistant, **Gaya**, that takes the administrative load off scientists: checking records, building reports on the lab's own letterhead, drafting patient e-mails, and recommending procedures and precautions **cited from the lab's own SOPs**. Gaya does not interpret results. A named chief scientist approves everything before release, and every action is logged.

> **Status: v0.1, data foundation.** This release contains the database schema, a synthetic dataset and its integrity checks. The app, agent and dashboard come in later iterations (see the roadmap).

## Where it comes from
Gaya was first piloted as a Claude Project running a simulated laboratory. In that pilot it caught four errors before they reached a report: a Mantoux reading recorded before its read window, the wrong tuberculin cut-off, an LDL value that didn't match the Friedewald formula, and a test attributed to a scientist who wasn't on duty. It also stopped itself before sending a result to the wrong recipient. This repository rebuilds that work as software, so those checks become **deterministic, tested code** rather than something a model has to remember.

## What's in v0.1
| Path | What it is |
|---|---|
| `db/schema.sql` | PostgreSQL/Supabase schema: labs, staff, duty roster, patients, test catalogue, orders, results, QC runs, documents, audit log. **Per-lab isolation through row-level security**, an **append-only audit log**, and a rule that **only an active chief scientist can approve or release a result**. |
| `scripts/generate_synthetic.py` | Rebuilds the synthetic dataset deterministically (fixed seed) |
| `data/synthetic/` | One fictional lab, 3 scientists, 12 patients, 18 orders (one rejected), 63 results, 24 QC runs over one working week |
| `scripts/validate_data.py` | Integrity checks a lab scientist would apply (see below) |
| `tests/` | Proves the clean data passes and that each kind of fault is caught |
| `docs/ARCHITECTURE.md` | Design principles, architecture, Gaya's tools, the dashboard and the roadmap |

### The integrity checks
- Synthetic patient e-mails must use `example.com`, so nothing can reach a real person
- Timestamps follow the chain *received → collected → tested → approved → released*, inside opening hours
- The performing scientist was on the duty roster that day
- Released results have a named chief-scientist approver
- Mantoux readings fall 48–72 h after placement, and the flag matches the **≥ 10 mm** cut-off (**≥ 5 mm** when a risk factor is on file)
- Calculated LDL matches Friedewald (mmol/L), and Friedewald isn't used when TG ≥ 4.5 mmol/L
- Every result uses its test's single canonical unit, and its flag agrees with the reference range
- Order status agrees with its results; rejected orders carry a reason

## Run it
Needs only Python 3.10+, with no dependencies.
```bash
python scripts/generate_synthetic.py      # rebuild data/synthetic/
python scripts/validate_data.py           # expect: 0 issue(s)
python -m unittest discover -s tests -v   # expect: 8 tests OK
```
Contributors: install the pre-commit guard with `python scripts/precommit_check.py --install`.

## About the data
**Everything here is fictional.** The lab (MITOCHRONAI LAB, Destiny Tower, Sesame Street), its scientists (named after organisms and assays) and its patients are invented. Reference ranges follow recognised sources (WHO, NCEP ATP III) or are marked lab-validated. They are for demonstration only and are **not clinical guidance**. The QC data includes one deliberate 1-2s Westgard warning for the dashboard demo.

## Roadmap
v0.1 data foundation ✅ → v0.2 deterministic validators → v0.3 SOP upload and cited procedure lookup → v0.4 reports on the lab's letterhead, approval states and audit log → v0.5 dashboard → v0.6 model router (local / bring-your-own key / managed) → v0.7 login and per-lab isolation → v1.0 public demo. Details are in `docs/ARCHITECTURE.md`.

## Security
See [SECURITY.md](SECURITY.md).
