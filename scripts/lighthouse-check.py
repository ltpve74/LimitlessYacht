#!/usr/bin/env python3
"""
Lighthouse performance gate for the publish pipeline.

Serves the committed site locally, runs Lighthouse, and fails when scores or
core metrics regress beyond scripts/lighthouse-budgets.json.

Usage:
  python3 scripts/lighthouse-check.py
  python3 scripts/lighthouse-check.py --url http://127.0.0.1:8765/
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
sys.path.insert(0, SCRIPTS)

from site_server import serve_site  # noqa: E402

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def lighthouse_bin() -> list[str]:
    local = os.path.join(SCRIPTS, "node_modules", ".bin", "lighthouse")
    if os.path.isfile(local):
        return [local]
    npx = shutil.which("npx")
    if npx:
        return [npx, "--yes", "lighthouse"]
    raise RuntimeError(
        "Lighthouse not found. Run: npm install --prefix scripts"
    )


def run_lighthouse(url: str, out_path: str) -> dict:
    cmd = [
        *lighthouse_bin(),
        url,
        "--quiet",
        "--chrome-flags=--headless --no-sandbox --disable-gpu",
        "--only-categories=performance,accessibility,best-practices,seo",
        f"--output-path={out_path}",
        "--output=json",
    ]
    subprocess.run(cmd, check=True, cwd=ROOT)
    with open(out_path, encoding="utf-8") as fh:
        return json.load(fh)


def score(report: dict, category: str) -> int:
    raw = report["categories"][category]["score"]
    return int(round((raw or 0) * 100))


def metric(report: dict, audit_id: str) -> float:
    audit = report["audits"].get(audit_id) or {}
    value = audit.get("numericValue")
    return float(value if value is not None else 0)


def check(report: dict, budgets: dict, baseline: dict | None) -> list[str]:
    failures: list[str] = []
    passes: list[str] = []

    for category, minimum in budgets["categories"].items():
        got = score(report, category)
        label = category.replace("-", " ").title()
        if got < minimum:
            failures.append(f"{label} {got} < minimum {minimum}")
        else:
            passes.append(f"{label} {got} (min {minimum})")

        if baseline and category in baseline.get("categories", {}):
            base = baseline["categories"][category]
            max_drop = budgets.get("max_regression", {}).get(category, 0)
            if max_drop and got < base - max_drop:
                failures.append(
                    f"{label} regressed {base} → {got} (max drop {max_drop})"
                )

    for audit_id, maximum in budgets["metrics"].items():
        got = metric(report, audit_id)
        label = audit_id.upper().replace("-", " ")
        if got > maximum:
            failures.append(f"{label} {got:.0f} > max {maximum}")
        else:
            passes.append(f"{label} {got:.0f} (max {maximum})")

        if baseline and audit_id in baseline.get("metrics", {}):
            base = baseline["metrics"][audit_id]
            # Allow modest metric drift on local static runs.
            slack = {
                "largest-contentful-paint": 600,
                "total-blocking-time": 120,
                "first-contentful-paint": 400,
                "cumulative-layout-shift": 0.03,
            }.get(audit_id, 0)
            if slack and got > base + slack:
                failures.append(
                    f"{label} regressed {base:.0f} → {got:.0f} (slack {slack})"
                )

    print(f"{GREEN}Lighthouse checks{RESET}")
    for line in passes:
        print(f"  ✓  {line}")
    for line in failures:
        print(f"  {RED}✗  {line}{RESET}")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Lighthouse publish gate")
    parser.add_argument("--url", help="Existing site URL (skip local server)")
    parser.add_argument("--root", default=ROOT, help="Site root to serve")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Write scripts/lighthouse-baseline.json from this run",
    )
    args = parser.parse_args()

    budgets_path = os.path.join(SCRIPTS, "lighthouse-budgets.json")
    baseline_path = os.path.join(SCRIPTS, "lighthouse-baseline.json")
    budgets = load_json(budgets_path)
    baseline = load_json(baseline_path) if os.path.isfile(baseline_path) else None

    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "report.json")
        if args.url:
            report = run_lighthouse(args.url.rstrip("/") + "/", out_path)
        else:
            with serve_site(args.root) as base_url:
                report = run_lighthouse(base_url + "/", out_path)

    if args.update_baseline:
        payload = {
            "url": args.url or "local",
            "categories": {
                k: score(report, k) for k in budgets["categories"]
            },
            "metrics": {
                k: metric(report, k) for k in budgets["metrics"]
            },
        }
        with open(baseline_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        print(f"{YELLOW}Updated {baseline_path}{RESET}")

    failures = check(report, budgets, baseline)
    if failures:
        print(f"\n{RED}FAILED  Lighthouse gate: {len(failures)} issue(s){RESET}")
        return 1

    print(f"\n{GREEN}PASSED  Lighthouse gate{RESET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())