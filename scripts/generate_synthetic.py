#!/usr/bin/env python3
"""Generate the MitochronAi Lab synthetic dataset (v0.1).

Everything here is fictional: the lab, the staff, the patients and the results.
E-mail addresses use example.com (reserved for documentation), so no message can
ever reach a real person. Output is deterministic (fixed seed), so anyone
can rebuild exactly the same files:

    python scripts/generate_synthetic.py
"""
import csv
import datetime as dt
import os
import random

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "synthetic")
rng = random.Random(2026)
WEEK_START = dt.date(2026, 10, 5)  # Monday; the dataset covers Mon 5 to Sat 10 Oct 2026
TZ = dt.timezone(dt.timedelta(hours=1))  # West Africa Time

LAB = {
    "id": "LAB-001", "name": "MITOCHRONAI LAB",
    "address": "Floor 5, Wing B, Destiny Tower, Sesame Street",
    "phone": "0800 000 0000", "working_days": "Mon-Sat",
    "opening_time": "08:00", "closing_time": "18:00",
    "assistant_name": "Gaya", "comments_enabled": "false",
}

STAFF = [  # id, display name, role, ISO weekdays on duty
    ("STF-001", "Chief Sct. Gram Stain", "chief_scientist", [1, 2, 3, 4, 5]),
    ("STF-002", "Sct. Taenia solium", "scientist", [1, 2, 3]),
    ("STF-003", "Sct. Creatinin Jaffe", "scientist", [4, 5, 6]),
]

PATIENTS = [  # name, sex, risk factors
    ("John Doe", "M", []), ("Filip Joshua", "M", []), ("Jon Snow", "M", []),
    ("Primus Baker", "M", []), ("Jane Doe", "F", []), ("Amara Sample", "F", []),
    ("Tunde Placebo", "M", []), ("Kemi Control", "F", ["recent_TB_contact"]),
    ("Bayo Reagent", "M", []), ("Ifeoma Pipette", "F", []),
    ("Chidi Centrifuge", "M", []), ("Zainab Cuvette", "F", []),
]

# code, name, department, specimen, type, unit, low, high, sex, ref_text, source, formula
CATALOG = [
    ("FBG", "Fasting Blood Glucose", "Clinical Chemistry", "Fluoride plasma", "numeric", "mmol/L", 3.9, 6.0, "", "3.9-6.0 mmol/L", "WHO", ""),
    ("TC", "Total Cholesterol", "Clinical Chemistry", "Serum", "numeric", "mmol/L", "", 5.2, "", "< 5.2 mmol/L desirable", "NCEP ATP III", ""),
    ("HDL", "HDL Cholesterol", "Clinical Chemistry", "Serum", "numeric", "mmol/L", 1.0, "", "", ">= 1.0 mmol/L (>= 1.55 protective)", "NCEP ATP III", ""),
    ("TG", "Triglycerides", "Clinical Chemistry", "Serum", "numeric", "mmol/L", "", 1.7, "", "< 1.7 mmol/L", "NCEP ATP III", ""),
    ("LDL", "LDL Cholesterol", "Clinical Chemistry", "Serum", "numeric", "mmol/L", "", 2.6, "", "< 2.6 mmol/L optimal", "NCEP ATP III", "friedewald_mmol"),
    ("TCHDL", "TC / HDL ratio", "Clinical Chemistry", "Serum", "numeric", "ratio", "", 5.0, "", "< 5.0", "Lab-validated", "tc_over_hdl"),
    ("HB", "Haemoglobin", "Haematology", "EDTA whole blood", "numeric", "g/dL", 12.0, 15.5, "F", "12.0-15.5 g/dL", "Lab-validated", ""),
    ("HB", "Haemoglobin", "Haematology", "EDTA whole blood", "numeric", "g/dL", 13.0, 17.0, "M", "13.0-17.0 g/dL", "Lab-validated", ""),
    ("PCV", "Packed Cell Volume", "Haematology", "EDTA whole blood", "numeric", "%", 36, 46, "F", "36-46 %", "Lab-validated", ""),
    ("PCV", "Packed Cell Volume", "Haematology", "EDTA whole blood", "numeric", "%", 40, 50, "M", "40-50 %", "Lab-validated", ""),
    ("WBC", "White Cell Count", "Haematology", "EDTA whole blood", "numeric", "x10^9/L", 4.0, 10.0, "", "4.0-10.0 x10^9/L", "Lab-validated", ""),
    ("PLT", "Platelets", "Haematology", "EDTA whole blood", "numeric", "x10^9/L", 150, 410, "", "150-410 x10^9/L", "Lab-validated", ""),
    ("MAL", "Malaria RDT", "Parasitology", "EDTA whole blood", "qualitative", "", "", "", "", "Negative", "WHO", ""),
    ("BG", "Blood Group (ABO/RhD)", "Blood Bank", "EDTA whole blood", "text", "", "", "", "", "Report ABO group and RhD type", "", ""),
    ("HPSA", "H. pylori Stool Antigen", "Microbiology", "Stool", "qualitative", "", "", "", "", "Negative", "", ""),
    ("HPIGG", "H. pylori Antibody (IgG)", "Serology", "Serum", "qualitative", "", "", "", "", "Negative", "", ""),
    ("FIT", "Faecal Immunochemical Test", "Clinical Chemistry", "Stool", "qualitative", "", "", "", "", "Negative", "", ""),
    ("MANTOUX", "Tuberculin Skin Test (Mantoux)", "Immunology", "Intradermal", "numeric", "mm", "", "", "", "< 10 mm negative (>= 5 mm if high-risk)", "CDC/WHO", ""),
]

PANELS = {
    "LIPID": ["TC", "HDL", "TG", "LDL", "TCHDL"],
    "FBC": ["HB", "PCV", "WBC", "PLT"],
    "HPYLORI": ["HPSA", "HPIGG"],
    "FBG": ["FBG"], "MAL": ["MAL"], "BG": ["BG"], "FIT": ["FIT"], "MANTOUX": ["MANTOUX"],
}

# (patient index, weekday 1-6, requested panels, fasting hours or None, rejected reason or None)
ORDERS = [
    (0, 1, ["MANTOUX"], None, None),
    (1, 1, ["FBG", "LIPID"], 12, None),
    (2, 2, ["HPYLORI", "FIT", "FBG"], 10, None),
    (3, 2, ["FBC", "BG", "MAL"], None, None),
    (4, 2, ["FBC", "MAL"], None, None),
    (5, 3, ["FBG", "LIPID"], 12, None),
    (6, 3, ["FBC"], None, "Haemolysed sample - recollection requested"),
    (7, 3, ["MANTOUX"], None, None),
    (8, 4, ["FBG"], 9, None),
    (9, 4, ["FBC", "MAL"], None, None),
    (10, 4, ["LIPID"], 14, None),
    (11, 5, ["HPYLORI", "FBC"], None, None),
    (6, 5, ["FBC"], None, None),
    (1, 5, ["FBG"], 10, None),
    (4, 6, ["FBG", "LIPID"], 12, None),
    (2, 6, ["FBC"], None, None),
    (8, 6, ["MAL"], None, None),
    (5, 6, ["BG"], None, None),
]


def on_duty(weekday: int, chief_ok: bool = False):
    staff = [s for s in STAFF if weekday in s[3] and (chief_ok or s[2] != "chief_scientist")]
    return staff[0][0] if staff else None


def chief_on(weekday: int):
    return next((s[0] for s in STAFF if s[2] == "chief_scientist" and weekday in s[3]), None)


def ts(d: dt.datetime) -> str:
    return d.isoformat(timespec="minutes")


def ref_for(code: str, sex: str):
    rows = [c for c in CATALOG if c[0] == code]
    return next((c for c in rows if c[8] == sex), rows[0])


def flag_numeric(code, value, sex):
    c = ref_for(code, sex)
    low, high = c[6], c[7]
    if code == "HB" and value < 7.0:
        return "C"
    if low != "" and value < low:
        return "L"
    if high != "":
        # "< X" limits (lipids) flag at X and above; closed ranges flag only above the upper bound.
        upper_is_exclusive = code in ("TC", "TG", "LDL", "TCHDL")
        if value >= high if upper_is_exclusive else value > high:
            return "H"
    return "N"


def lipid_values():
    tc = round(rng.uniform(3.8, 6.4), 1)
    hdl = round(rng.uniform(0.9, 1.8), 1)
    tg = round(rng.uniform(0.7, 2.4), 1)
    ldl = round(tc - hdl - tg / 2.2, 1)  # Friedewald (mmol/L); valid because TG < 4.5
    return {"TC": tc, "HDL": hdl, "TG": tg, "LDL": ldl, "TCHDL": round(tc / hdl, 1)}


def fbc_values(sex):
    hb = round(rng.uniform(11.0, 15.0) if sex == "F" else rng.uniform(12.0, 16.5), 1)
    return {"HB": hb, "PCV": round(hb * 3, 0), "WBC": round(rng.uniform(3.6, 11.5), 1), "PLT": int(rng.uniform(140, 430))}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    patients, orders, results = [], [], []
    for i, (name, sex, risks) in enumerate(PATIENTS, start=1):
        dob = dt.date(rng.randint(1958, 2004), rng.randint(1, 12), rng.randint(1, 28))
        first, last = name.lower().split(" ", 1)
        patients.append({
            "id": f"PAT-{i:03d}", "lab_id": LAB["id"], "lab_patient_id": f"MCA-2026-{i:04d}",
            "full_name": name, "sex": sex, "date_of_birth": dob.isoformat(),
            "email": f"{first}.{last.replace(' ', '')}@example.com",
            "phone": f"0800 000 {i:04d}", "risk_factors": ";".join(risks),
        })

    rid = 0
    for n, (pi, wd, panels, fasting, reject) in enumerate(ORDERS, start=1):
        day = WEEK_START + dt.timedelta(days=wd - 1)
        received = dt.datetime.combine(day, dt.time(8, 0), TZ) + dt.timedelta(minutes=rng.randint(0, 7 * 60))
        p = patients[pi]
        order = {
            "id": f"ORD-{n:03d}", "lab_id": LAB["id"], "patient_id": p["id"],
            "requested_by": "[Referring clinician]", "received_at": ts(received),
            "fasting_hours": fasting if fasting is not None else "",
            "status": "rejected" if reject else "", "reject_reason": reject or "",
        }
        statuses = []
        if not reject:
            values = {}
            for panel in panels:
                if panel == "LIPID":
                    values.update(lipid_values())
                elif panel == "FBC":
                    values.update(fbc_values(p["sex"]))
                elif panel == "FBG":
                    values["FBG"] = round(rng.uniform(4.2, 7.4), 1)
                elif panel == "MAL":
                    values["MAL"] = "POS" if rng.random() < 0.2 else "NEG"
                elif panel == "BG":
                    values["BG"] = rng.choice(["O RhD positive", "A RhD positive", "B RhD positive", "AB RhD positive", "O RhD negative"])
                elif panel == "HPYLORI":
                    pos = rng.random() < 0.5
                    values["HPSA"], values["HPIGG"] = ("POS", "POS") if pos else ("NEG", "NEG")
                elif panel == "FIT":
                    values["FIT"] = "POS" if rng.random() < 0.3 else "NEG"
                elif panel == "MANTOUX":
                    values["MANTOUX"] = rng.choice([0, 3, 6, 8, 12])
            collected = received + dt.timedelta(minutes=rng.randint(0, 10))
            closing = dt.datetime.combine(collected.date(), dt.time(17, 45), TZ)
            # One bench time per order: a panel is run together, so derived values share it.
            bench = min(collected + dt.timedelta(minutes=rng.randint(30, 180)), closing)
            for code, value in values.items():
                rid += 1
                cat = ref_for(code, p["sex"])
                read_at = ""
                if code == "MANTOUX":
                    # Read 48-72 h after placement, inside opening hours on the read day.
                    earliest = collected + dt.timedelta(hours=48)
                    latest = min(collected + dt.timedelta(hours=72),
                                 dt.datetime.combine(earliest.date(), dt.time(17, 0), TZ))
                    tested = earliest + dt.timedelta(minutes=rng.randint(0, int((latest - earliest).total_seconds() // 60)))
                    read_at = ts(tested)
                    high_risk = bool(p["risk_factors"])
                    flag = "POS" if value >= (5 if high_risk else 10) else "NEG"
                else:
                    tested = bench
                    flag = value if cat[4] == "qualitative" else ("" if cat[4] == "text" else flag_numeric(code, value, p["sex"]))
                twd = tested.isoweekday()
                performer = on_duty(twd) or on_duty(twd, chief_ok=True)
                chief = chief_on(twd)
                approved = released = ""
                status = "awaiting_approval"
                # The chief verifies the same day if on duty and there is time before closing.
                if chief and tested.time() <= dt.time(16, 30):
                    a = tested + dt.timedelta(minutes=15 + (n * 7) % 60)
                    r = a + dt.timedelta(minutes=5 + (n * 3) % 20)
                    approved, released, status = ts(a), ts(r), "released"
                statuses.append(status)
                results.append({
                    "id": f"RES-{rid:03d}", "lab_id": LAB["id"], "order_id": order["id"], "test_code": code,
                    "collected_at": ts(collected), "tested_at": ts(tested), "read_at": read_at,
                    "performed_by": performer,
                    "value_numeric": value if cat[4] == "numeric" else "",
                    "value_text": value if cat[4] != "numeric" else "",
                    "unit": cat[5], "value_source": "calculated" if cat[11] else "measured",
                    "flag": flag, "status": status,
                    "approved_by": chief if approved else "", "approved_at": approved, "released_at": released,
                    "comment": "", "comment_author": "",
                })
            order["status"] = "released" if all(s == "released" for s in statuses) else "awaiting_approval"
        orders.append(order)

    qc = []
    for d in range(6):
        day = WEEK_START + dt.timedelta(days=d)
        run_at = dt.datetime.combine(day, dt.time(7, 45), TZ)
        for code, level, mean, sd in [("FBG", "L1", 5.0, 0.15), ("FBG", "L2", 15.0, 0.40), ("TC", "L1", 4.0, 0.12), ("TC", "L2", 7.5, 0.20)]:
            value = rng.gauss(mean, sd * 0.8)
            if (d, code, level) == (3, "FBG", "L2"):
                value = mean + 2.3 * sd  # deliberate 1-2s warning (Westgard) for the dashboard demo
            qc.append({
                "id": f"QC-{len(qc) + 1:03d}", "lab_id": LAB["id"], "analyser": "Chem-1", "test_code": code,
                "level": level, "run_at": ts(run_at), "value": round(value, 2),
                "target_mean": mean, "target_sd": sd, "run_by": on_duty(day.isoweekday()),
            })

    catalog = [dict(zip(["code", "name", "department", "specimen", "result_type", "unit", "ref_low", "ref_high", "ref_sex", "ref_text", "ref_source", "calc_formula"], c)) for c in CATALOG]
    roster = [{"staff_id": s[0], "weekday": w} for s in STAFF for w in s[3]]
    staff = [{"id": s[0], "lab_id": LAB["id"], "display_name": s[1], "role": s[2]} for s in STAFF]

    for name, rows in [("labs", [LAB]), ("staff", staff), ("duty_roster", roster), ("patients", patients),
                       ("test_catalog", catalog), ("orders", orders), ("results", results), ("qc_runs", qc)]:
        with open(os.path.join(OUT, f"{name}.csv"), "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"{name:13s} {len(rows):4d} rows")


if __name__ == "__main__":
    main()
