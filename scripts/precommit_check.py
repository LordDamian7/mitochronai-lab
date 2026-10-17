#!/usr/bin/env python3
"""Pre-commit guard: block non-synthetic e-mail addresses and secrets.

Install once per clone:  python scripts/precommit_check.py --install
"""
import os
import re
import subprocess
import sys

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
ALLOWED_DOMAINS = {"example.com", "example.org", "example.net", "users.noreply.github.com"}
SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
                    r"|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")


def install():
    root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
    hook = os.path.join(root, ".git", "hooks", "pre-commit")
    with open(hook, "w", newline="\n") as fh:
        fh.write('#!/bin/sh\nexec python "$(git rev-parse --show-toplevel)/scripts/precommit_check.py"\n')
    os.chmod(hook, 0o755)
    print("Installed", hook)


def main():
    staged = subprocess.check_output(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"], text=True).splitlines()
    problems = []
    for path in staged:
        if path == "scripts/precommit_check.py":
            continue
        try:
            text = subprocess.check_output(["git", "show", f":{path}"], stderr=subprocess.DEVNULL).decode("utf-8", "ignore")
        except subprocess.CalledProcessError:
            continue
        for m in EMAIL.finditer(text):
            domain = m.group(1).lower()
            # Reserved domains (RFC 2606) can never deliver mail to anyone.
            if domain not in ALLOWED_DOMAINS and not domain.endswith((".test", ".invalid", ".example")):
                problems.append(f"{path}: e-mail outside example.com ({m.group(0)})")
        if SECRET.search(text):
            problems.append(f"{path}: possible secret")
    if problems:
        print("Commit blocked:", *sorted(set(problems)), sep="\n  ", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(install() if "--install" in sys.argv else main())
