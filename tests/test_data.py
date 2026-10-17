"""Tests for the v0.1 dataset: the clean data passes, and each kind of fault is caught.

    python -m unittest discover tests
"""
import csv
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from validate_data import DEFAULT_DIR, validate  # noqa: E402


def corrupt(table, row_id, field, value):
    """Copy the dataset, change one cell, return the folder."""
    tmp = tempfile.mkdtemp()
    for f in os.listdir(DEFAULT_DIR):
        shutil.copy(os.path.join(DEFAULT_DIR, f), tmp)
    path = os.path.join(tmp, f"{table}.csv")
    with open(path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        if r["id"] == row_id:
            r[field] = value
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return tmp


def first(table, **match):
    with open(os.path.join(DEFAULT_DIR, f"{table}.csv"), encoding="utf-8") as fh:
        return next(r for r in csv.DictReader(fh) if all(r[k] == v for k, v in match.items()))


class CleanData(unittest.TestCase):
    def test_dataset_has_no_issues(self):
        self.assertEqual(validate(), [])


class CatchesFaults(unittest.TestCase):
    def assertCaught(self, folder, phrase):
        issues = validate(folder)
        self.assertTrue(any(phrase in i for i in issues), f"expected '{phrase}' in {issues}")

    def test_real_looking_email(self):
        self.assertCaught(corrupt("patients", "PAT-001", "email", "someone@mail.invalid"), "@example.com")

    def test_mantoux_read_too_early(self):
        r = first("results", test_code="MANTOUX")
        self.assertCaught(corrupt("results", r["id"], "read_at", r["collected_at"]), "48-72 h")

    def test_wrong_mantoux_cutoff(self):
        r = first("results", test_code="MANTOUX")
        wrong = "POS" if r["flag"] == "NEG" else "NEG"
        self.assertCaught(corrupt("results", r["id"], "flag", wrong), "cut-off")

    def test_friedewald_mismatch(self):
        r = first("results", test_code="LDL")
        self.assertCaught(corrupt("results", r["id"], "value_numeric", "9.9"), "Friedewald")

    def test_scientist_not_on_duty(self):
        r = first("results", performed_by="STF-002", test_code="FBG")  # Mon-Wed only
        self.assertCaught(corrupt("results", r["id"], "performed_by", "STF-003"), "not on duty")

    def test_release_without_chief(self):
        r = first("results", status="released")
        self.assertCaught(corrupt("results", r["id"], "approved_by", "STF-002"), "not a chief scientist")

    def test_unit_mismatch(self):
        r = first("results", test_code="FBG")
        self.assertCaught(corrupt("results", r["id"], "unit", "mg/dL"), "differs from catalog")


if __name__ == "__main__":
    unittest.main()
