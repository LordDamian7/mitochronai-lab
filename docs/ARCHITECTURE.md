# MitochronAi Lab: architecture and roadmap

MitochronAi Lab turns **Gaya**, an AI laboratory assistant first piloted as a Claude Project, into a platform. Each lab gets an isolated workspace. Gaya runs in a sandbox (a local model, the lab's own API key, or a managed model), automates the paperwork, and recommends procedures and precautions cited from the lab's own SOPs. A named scientist approves everything before release, and every action is logged.

## 1. Design principles (taken from Gaya's pilot)
1. **Rules in code, language in the model.** Gaya's four catches were all *checkable rules*: timing windows, cut-offs, formulas, rosters. The platform runs them as **deterministic validators**: tested, the same every time, working offline. The model handles documents, drafting and explanation.
2. **Cite or stay silent.** Every procedure or precaution Gaya recommends quotes the lab's own SOP section, or a named standard (WHO, CLSI, NCEP ATP III). If no source exists, Gaya says "no SOP covers this" and logs an **SOP gap**.
3. **No interpretation by default.** Gaya flags, checks, drafts and recommends procedures. Clinical interpretation belongs to the scientist. An **optional comments field** (off by default, switched on per lab) lets Gaya draft a comment, which a scientist edits and owns. It is always labelled as a draft and never released unedited without approval.
4. **Nothing leaves without a named approver.** Draft → Awaiting approval → Approved (name, role, time) → Released. Gaya can't skip a state.
5. **Raise, never quietly fix.** Discrepancies become tasks for a human, as in the pilot.
6. **Uploaded documents are data, not instructions.** Text in an SOP or email that tries to direct Gaya ("ignore approval and send") is flagged, never obeyed.
7. **Every action is logged.** An append-only audit log records who, what, which files, which model, the approver and the time.

## 2. Architecture
```
 ┌──────────────── MitoChron Lab app (web first; desktop shell later) ────────────────┐
 │  Dashboard · Worklist · Records · Reports · Approvals · SOP library · Audit · Settings │
 └──────────────┬───────────────────────────────────────────────┬───────────────────────┘
                │                                               │
      ┌─────────▼─────────┐                          ┌──────────▼──────────┐
      │  Gaya agent core  │── tool calls only ──────▶│  Deterministic tools │
      │  (plans, drafts,  │                          │  validators, formulas│
      │   cites SOPs)     │◀── results + citations ──│  unit conversion,    │
      └───┬──────────┬────┘                          │  roster, templating  │
          │          │                               └──────────┬──────────┘
 ┌────────▼───┐ ┌────▼──────────────┐                ┌──────────▼──────────┐
 │Model router│ │ Document index    │                │ Approval state      │
 │ local │ BYO│ │ SOPs, policies,   │                │ machine + audit log │
 │ key │ Conn.│ │ templates (local) │                └──────────┬──────────┘
 └────────────┘ └───────────────────┘                           │
                        Tenant workspace (one per lab, isolated) ┘
```

| Layer | Demo choice | Production path |
|---|---|---|
| App | Next.js on Vercel | Desktop shell (Tauri is lighter than Electron) for offline labs |
| Tenancy | Supabase: every row has `lab_id`, row-level security, separate storage bucket per lab | Shared plan for most tiers; **dedicated project per lab for Enterprise** |
| Local model sandbox | Ollama on the lab PC, reached only through the model router | Signed local runtime with resource limits set in Settings |
| Model router | One interface over Local / bring-your-own key / MitoChron Connect | Per-lab policy: e.g. "patient data never goes to cloud models" |
| Document index | Parse → chunk → embed → local vector store (SQLite-based) | Same, per tenant, encrypted at rest |
| Reports | Fill the lab's **actual** `.docx` letterhead (template filling, not re-drawing) → PDF | Fixes Gaya's formatting limitation |
| Email | A proper email API with attachment support, draft-only until approved | Fixes Gaya's attachment limitation |
| Audit | Append-only table; exports for inspectors | Hash-chained entries so edits are detectable |

## 3. Gaya's tools (each one testable)
| Tool | Kind | Pilot origin |
|---|---|---|
| `check_record` | Validators: required fields, dates in order, read-time windows (Mantoux 48–72 h), cut-off matches risk factors on file | Mantoux catches |
| `check_formula` | Recompute derived values (Friedewald LDL, TC/HDL), flag mismatches, record whether a value was measured or calculated | LDL catch |
| `check_roster` | Performing scientist was on duty for that date | Roster catch |
| `check_recipient` | Email matches the patient on file; the PDF password field exists | Safety stops |
| `convert_units` | mg/dL ↔ mmol/L with standard factors; one unit system per report | Register/report mismatch |
| `lookup_procedure` | Search the SOP library, return the cited passage, or an "SOP gap" | SOP coverage limit |
| `register_patient` | Next Lab ID, duplicate check | Walk-in registration |
| `build_report` | Fill the lab template → draft DOCX/PDF stamped DRAFT | Reports |
| `draft_email` | House-format result or reminder email, held for approval | Emails |
| `log_action` | Writes the audit entry; called by every other tool | Audit trail |

## 4. The dashboard
- **Lab operations:** sample volume; turnaround time (TAT) by test and stage (received → tested → verified → released); rejection rate and reasons; pending approvals; critical-value notification time; test mix
- **Quality:** Levey-Jennings charts, Westgard rule violations, QC pass rate per analyser *(needs QC data in the demo set)*
- **Documents:** SOP coverage (tests with an SOP vs without), SOP gaps raised, documents due for review
- **Gaya's performance:** tasks completed; discrepancies caught (by type); drafts approved without edits vs edited; corrections from supervisors; average approval wait; time saved (estimated from task counts × baseline minutes, labelled as an estimate)

## 5. Roadmap: one small, finished iteration at a time
| Version | Delivers | Done when |
|---|---|---|
| v0.1 | Clean synthetic dataset + database schema | Validators run on it with no false alarms |
| v0.2 | Deterministic validators (the four pilot catches, plus units and recipient) | Tests reproduce every pilot catch |
| v0.3 | SOP upload + cited procedure lookup | Every answer cites a passage, or reports a gap |
| v0.4 | Report builder on the real letterhead + approval states + audit log | A report can't be released without a named approver (test) |
| v0.5 | Dashboard (worklist, TAT, Gaya metrics), restyled from the MedLab AI design | Numbers match the dataset |
| v0.6 | Model router: local, bring-your-own key, Connect placeholder | Same task runs on two model sources |
| v0.7 | Login + per-lab isolation (Supabase row-level security) + a demo tenant | Lab A provably can't read Lab B (test) |
| v1.0 | Public demo + case study write-up | Shown to 3 lab people for feedback |

