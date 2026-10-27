#!/usr/bin/env python3
"""Build demo/index.html: the web app with the synthetic dataset embedded.

    python scripts/build_demo.py
"""
import base64
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "synthetic")
TABLES = ["labs", "staff", "duty_roster", "patients", "test_catalog", "orders", "results", "qc_runs"]

data = {}
for name in TABLES:
    with open(os.path.join(DATA, f"{name}.csv"), encoding="utf-8") as fh:
        data[name] = list(csv.DictReader(fh))
with open(os.path.join(ROOT, "demo", "app.template.html"), encoding="utf-8") as fh:
    page = fh.read()
assert "/*DATA*/null" in page and "/*IMG*/null" in page
ASSETS = {"logo": "logo.png", "top": "band-top.png", "bottom": "band-bottom.png",
          "sigGram": "sig-chief-gram-stain.png", "sigTaenia": "sig-taenia-solium.png"}
img = {}
for key, name in ASSETS.items():
    with open(os.path.join(ROOT, "demo", "assets", name), "rb") as fh:
        img[key] = "data:image/png;base64," + base64.b64encode(fh.read()).decode()
page = page.replace("/*IMG*/null", json.dumps(img))
page = page.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", r"<\/"))
with open(os.path.join(ROOT, "demo", "index.html"), "w", encoding="utf-8") as fh:
    fh.write(page)
print(f"demo/index.html written ({len(page) // 1024} KB)")
