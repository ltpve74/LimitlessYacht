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
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
sys.path.insert(0, SCRIPTS)

from site_server import serve_site  # noqa: E402

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

DEFAULT_TIMEOUT_S = 180
DEFAULT_RETRIES = 3


def in_ci() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def default_retries() -> int:
    raw = os.environ.get("LIGHTHOUSE_RETRIES", "")
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return DEFAULT_RETRIES if in_ci() else 1


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


def warmup(url: str, timeout_s: int = 30) -> None:
    try:
        urllib.request.urlopen(url, timeout=timeout_s)
    except (urllib.error.URLError, TimeoutError, OSError):
        pass


def run_lighthouse(url: str, out_path: str, timeout_s: int) -> dict:
    cmd = [
        *lighthouse_bin(),
        url,
        "--quiet",
        "--chrome-flags=--headless --no-sandbox --disable-gpu",
        "--only-categories=performance,accessibility,best-practices,seo",
        "--max-wait-for-load=60000",
        f"--output-path={out_path}",
        "--output=json",
    ]
    subprocess.run(cmd, check=True, cwd=ROOT, timeout=timeout_s)
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


def collect_report(
    url: str | None,
    root: str,
    out_path: str,
    timeout_s: int,
) -> dict:
    target = url.rstrip("/") + "/" if url else None
    if target:
        warmup(target)
        return run_lighthouse(target, out_path, timeout_s)

    with serve_site(root) as base_url:
        target = base_url + "/"
        warmup(target)
        return run_lighthouse(target, out_path, timeout_s)


def main() -> int:
    parser = argparse.ArgumentParser(description="Lighthouse publish gate")
    parser.add_argument("--url", help="Existing site URL (skip local server)")
    parser.add_argument("--root", default=ROOT, help="Site root to serve")
    parser.add_argument(
        "--retries",
        type=int,
        default=default_retries(),
        help="Attempts before failing (CI defaults to 3)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_S,
        help="Per-run Lighthouse timeout in seconds",
    )
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

    attempts = max(1, args.retries)
    last_failures: list[str] = []
    report: dict | None = None

    with tempfile.TemporaryDirectory() as tmp:
        for attempt in range(1, attempts + 1):
            out_path = os.path.join(tmp, f"report-{attempt}.json")
            prefix = f"Attempt {attempt}/{attempts}"
            try:
                report = collect_report(args.url, args.root, out_path, args.timeout)
            except subprocess.TimeoutExpired:
                print(f"{YELLOW}{prefix}: Lighthouse timed out after {args.timeout}s{RESET}")
                last_failures = [f"Lighthouse timed out after {args.timeout}s"]
                if attempt < attempts:
                    time.sleep(2)
                continue
            except subprocess.CalledProcessError as exc:
                print(f"{YELLOW}{prefix}: Lighthouse exited {exc.returncode}{RESET}")
                last_failures = [f"Lighthouse exited {exc.returncode}"]
                if attempt < attempts:
                    time.sleep(2)
                continue

            failures = check(report, budgets, baseline)
            if not failures:
                if attempt > 1:
                    print(
                        f"\n{GREEN}PASSED  Lighthouse gate on attempt "
                        f"{attempt}/{attempts}{RESET}"
                    )
                else:
                    print(f"\n{GREEN}PASSED  Lighthouse gate{RESET}")
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
                return 0

            last_failures = failures
            if attempt < attempts:
                print(
                    f"{YELLOW}{prefix}: retrying after {len(failures)} issue(s){RESET}"
                )
                time.sleep(2)

    if args.update_baseline and report is not None:
        payload = {
            "url": args.url or "local",
            "categories": {k: score(report, k) for k in budgets["categories"]},
            "metrics": {k: metric(report, k) for k in budgets["metrics"]},
        }
        with open(baseline_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        print(f"{YELLOW}Updated {baseline_path}{RESET}")

    print(f"\n{RED}FAILED  Lighthouse gate: {len(last_failures)} issue(s){RESET}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())