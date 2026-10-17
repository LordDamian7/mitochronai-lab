#!/usr/bin/env python3
"""Integrity checks for the MitochronAi Lab dataset (v0.1).

Each check encodes a rule a lab scientist would apply. Several come straight
from Gaya's pilot catches (read-time windows, formulas, the duty roster).

    python scripts/validate_data.py [data_dir]
Exit code 0 = clean; 1 = issues found (each one printed).
"""
import csv
import datetime as dt
import os
import re
import sys
from collections import defaultdict

DEFAULT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "synthetic")
OPEN, CLOSE = dt.time(8, 0), dt.time(18, 0)


def load(d, name):
    with open(os.path.join(d, f"{name}.csv"), encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def t(s):
    return dt.datetime.fromisoformat(s) if s else None


def num(s):
    return float(s) if s not in ("", None) else None


def validate(d=DEFAULT_DIR):
    issues = []
    add = issues.append
    staff = {s["id"]: s for s in load(d, "staff")}
    roster = {(r["staff_id"], int(r["weekday"])) for r in load(d, "duty_roster")}
    patients = {p["id"]: p for p in load(d, "patients")}
    orders = {o["id"]: o for o in load(d, "orders")}
    results = load(d, "results")
    catalog = defaultdict(list)
    for c in load(d, "test_catalog"):
        catalog[c["code"]].append(c)

    # Identity and contact safety
    for table, rows in [("patients", patients.values()), ("orders", orders.values()), ("results", results)]:
        ids = [r["id"] for r in rows]
        if len(ids) != len(set(ids)):
            add(f"{table}: duplicate ids")
    seen = set()
    for p in patients.values():
        if not re.fullmatch(r"MCA-\d{4}-\d{4}", p["lab_patient_id"]):
            add(f"{p['id']}: lab_patient_id '{p['lab_patient_id']}' is not MCA-YYYY-NNNN")
        if p["lab_patient_id"] in seen:
            add(f"{p['id']}: duplicate lab_patient_id {p['lab_patient_id']}")
        seen.add(p["lab_patient_id"])
        if p["email"] and not p["email"].lower().endswith("@example.com"):
            add(f"{p['id']}: synthetic patient email must use @example.com (got {p['email']})")
        if not p["date_of_birth"]:
            add(f"{p['id']}: missing date of birth (needed to password-protect result PDFs)")

    by_order = defaultdict(dict)
    for r in results:
        rid, o = r["id"], orders.get(r["order_id"])
        if not o:
            add(f"{rid}: unknown order {r['order_id']}")
            continue
        p = patients.get(o["patient_id"])
        if not p:
            add(f"{rid}: order {o['id']} has unknown patient")
            continue
        by_order[o["id"]][r["test_code"]] = r
        cats = catalog.get(r["test_code"])
        if not cats:
            add(f"{rid}: test {r['test_code']} not in catalog")
            continue
        cat = next((c for c in cats if c["ref_sex"] == p["sex"]), cats[0])

        # Units: one canonical unit per test
        if r["unit"] != cat["unit"]:
            add(f"{rid}: unit '{r['unit']}' differs from catalog '{cat['unit']}' for {r['test_code']}")

        # Time order and opening hours
        received, collected, tested = t(o["received_at"]), t(r["collected_at"]), t(r["tested_at"])
        approved, released = t(r["approved_at"]), t(r["released_at"])
        chain = [("received", received), ("collected", collected), ("tested", tested), ("approved", approved), ("released", released)]
        present = [(n, v) for n, v in chain if v]
        for (n1, v1), (n2, v2) in zip(present, present[1:]):
            if v2 < v1:
                add(f"{rid}: {n2} ({v2}) is before {n1} ({v1})")
        for n, v in present[1:]:
            if v.isoweekday() == 7 or not (OPEN <= v.time() <= CLOSE):
                add(f"{rid}: {n} at {v:%a %H:%M} is outside opening hours (Mon-Sat 08:00-18:00)")

        # Duty roster
        if r["performed_by"] and tested and (r["performed_by"], tested.isoweekday()) not in roster:
            add(f"{rid}: {staff.get(r['performed_by'], {}).get('display_name', r['performed_by'])} was not on duty on {tested:%a %d %b}")

        # Approval chain
        if r["status"] in ("approved", "released"):
            a = staff.get(r["approved_by"])
            if not a:
                add(f"{rid}: {r['status']} without a named approver")
            elif a["role"] != "chief_scientist":
                add(f"{rid}: approver {a['display_name']} is not a chief scientist")
        if r["status"] == "released" and not released:
            add(f"{rid}: status released but no released_at")

        # Mantoux read window and cut-off
        if r["test_code"] == "MANTOUX":
            read = t(r["read_at"])
            if not read:
                add(f"{rid}: Mantoux has no read time")
            else:
                hours = (read - collected).total_seconds() / 3600
                if not 48 <= hours <= 72:
                    add(f"{rid}: Mantoux read at {hours:.1f} h; must be 48-72 h after placement")
            mm = num(r["value_numeric"])
            cutoff = 5 if p["risk_factors"] else 10
            expected = "POS" if mm is not None and mm >= cutoff else "NEG"
            if r["flag"] != expected:
                add(f"{rid}: Mantoux {mm} mm flagged {r['flag']}, expected {expected} at the >= {cutoff} mm cut-off")

        # Numeric flags agree with the reference range
        elif cat["result_type"] == "numeric" and r["value_numeric"]:
            v, low, high = num(r["value_numeric"]), num(cat["ref_low"]), num(cat["ref_high"])
            exclusive = r["test_code"] in ("TC", "TG", "LDL", "TCHDL")
            if r["test_code"] == "HB" and v < 7.0:
                expected = "C"
            elif low is not None and v < low:
                expected = "L"
            elif high is not None and (v >= high if exclusive else v > high):
                expected = "H"
            else:
                expected = "N"
            if r["flag"] != expected:
                add(f"{rid}: {r['test_code']} {v} flagged {r['flag']}, expected {expected}")

    # Derived values (Friedewald LDL in mmol/L; TC/HDL ratio)
    for oid, tests in by_order.items():
        if {"TC", "HDL", "TG", "LDL"} <= tests.keys() and tests["LDL"]["value_source"] == "calculated":
            tc, hdl, tg, ldl = (num(tests[k]["value_numeric"]) for k in ("TC", "HDL", "TG", "LDL"))
            if tg >= 4.5:
                add(f"{oid}: TG {tg} mmol/L >= 4.5, so Friedewald LDL is invalid; measure LDL directly")
            elif abs(ldl - (tc - hdl - tg / 2.2)) > 0.1:
                add(f"{oid}: LDL {ldl} does not match Friedewald {tc - hdl - tg / 2.2:.1f} mmol/L")
        if {"TC", "HDL", "TCHDL"} <= tests.keys():
            tc, hdl, ratio = (num(tests[k]["value_numeric"]) for k in ("TC", "HDL", "TCHDL"))
            if abs(ratio - tc / hdl) > 0.1:
                add(f"{oid}: TC/HDL {ratio} does not match {tc / hdl:.1f}")

    # Order status follows its results
    for o in orders.values():
        statuses = [r["status"] for r in by_order.get(o["id"], {}).values()]
        if o["status"] == "rejected":
            if statuses:
                add(f"{o['id']}: rejected order has results")
            if not o["reject_reason"]:
                add(f"{o['id']}: rejected without a reason")
        elif statuses and o["status"] == "released" and any(s != "released" for s in statuses):
            add(f"{o['id']}: order released but some results are not")
    return issues


if __name__ == "__main__":
    found = validate(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DIR)
    for i in found:
        print("ISSUE", i)
    print(f"{len(found)} issue(s)")
    sys.exit(1 if found else 0)
