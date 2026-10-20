# UI/UX recommendations for MitochronAi Lab

*2026-10-19. Ordered by impact for a busy Nigerian lab, with rough effort. Nothing here is built yet.*

## 1. Speed at the bench (highest impact)
| # | Recommendation | Why | Effort |
|---|---|---|---|
| 1 | **Barcode labels and scanning.** Print a sample label (Lab ID + request + tube type) at registration; a USB scanner finds the request in one scan. | Removes the main source of mix-ups and the slowest step. Also the foundation for analyser integration. | Medium |
| 2 | **Keyboard-first result entry.** Enter moves to the next result, the decimal point works on numeric keypads, and Ctrl+S saves. Common choices take one keystroke (N for Negative, P for Positive). | A full blood count has 13 values; today every one needs the mouse. | Small |
| 3 | **Test profiles / favourites.** One click for "Antenatal booking" (FBC, genotype, blood group, HBsAg, HIV, VDRL, urinalysis) or "Medical fitness". Each lab defines its own. | Most requests are the same few bundles. | Small |
| 4 | **"Normal" defaults for text results**, such as "No ova, cysts or parasites seen", pre-filled and editable. | Saves typing on the commonest outcome. | Small |
| 5 | **Patient search with phone number and partial name** instead of one long dropdown. | The patient list will grow into thousands. | Small |

## 2. Front desk and money
| # | Recommendation | Why | Effort |
|---|---|---|---|
| 6 | **Receptionist / cashier role**: registers patients, takes payment, prints receipts and invoices; sees prices but not revenue or results. | Prices are hidden from scientists today, so someone must quote them. | Medium |
| 7 | **Payment status on every request** (paid / part-paid / HMO / waived), with receipts and a daily cash-up report. Results release only when paid, unless the chief overrides. | Revenue today counts approved work, not money received. | Medium |
| 8 | **HMO and corporate price lists** (per-client prices and discounts), with monthly invoices. | A large share of Nigerian lab income is HMO-billed. | Medium |
| 9 | **Reorder list from stock**: one click turns "low" and "expiring" reagents into a purchase order for the supplier. | Kit counts are already tracked. | Small |

## 3. Results that reach people
| # | Recommendation | Why | Effort |
|---|---|---|---|
| 10 | **WhatsApp and SMS delivery** of the password-protected PDF (Bird is already connected), with delivery receipts. | Most patients and clinicians in Nigeria live on WhatsApp, not e-mail. | Medium |
| 11 | **Critical-value call log**: a critical result (C flag) asks who was phoned, when, and their read-back, before release. | ISO 15189 requirement, and safer. | Small |
| 12 | **Cumulative report**: previous results beside the new ones (delta check), with a trend chart for HbA1c, creatinine and viral load. | Clinicians judge change, not single values. Gaya can flag implausible jumps. | Medium |
| 13 | **Clinician portal** (read-only, per referring doctor) | Fewer phone calls asking "is it ready?". | Large |

## 4. Clarity and safety
| # | Recommendation | Why | Effort |
|---|---|---|---|
| 14 | **Turnaround clock on every request** (green / amber / red against the test's turnaround) on the worklist. | The worklist shows status, not lateness. | Small |
| 15 | **Disable "Save" until the page is ready, and warn about unsaved entries** when leaving a page. | On a slow connection, a click before the page is ready does nothing, and leaving loses typing. | Small |
| 16 | **Bench views**: the worklist filtered by section (haematology, chemistry, microbiology), so each scientist sees their own queue. | 108 tests across 13 sections. | Small |
| 17 | **Roster and staff editing in Settings** (it's view-only today), with signature upload. | Gaya's roster check depends on it. | Small |
| 18 | **Higher-contrast status colours and larger touch targets** for tablets at the bench; check every screen at 375 px. | Gloves, glare and shared tablets. | Small |

## 5. Resilience in Nigerian conditions
| # | Recommendation | Why | Effort |
|---|---|---|---|
| 19 | **Works through power and internet cuts**: the lab server on a UPS, and the app usable on the lab network with no internet; queued e-mails and WhatsApp messages send when the connection returns. | NEPA cuts and network drops are routine. | Medium |
| 20 | **Automatic encrypted backups** (nightly, kept off-site), with a tested restore. | One SQLite file holds the lab's whole history. | Small |
| 21 | **Lighter pages for low-power PCs**: paginate the worklist and audit log, and keep the price list collapsed by section. | Tested on a 2-core PC: page loads suffer when the CPU is busy. | Small |
