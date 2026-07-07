#!/usr/bin/env python3
"""
Publish gate — runs after minification on main.

Default (publish pipeline):
  1. scripts/test-site.py        (structure, assets, inline JS syntax)
  2. scripts/verify-analytics.py (preview guard + production tag IDs)

Optional manual checks (not run on publish):
  python3 scripts/publish-gate.py --with-ux
  python3 scripts/publish-gate.py --with-lighthouse
  python3 scripts/publish-gate.py --with-ux --with-lighthouse
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.environ.get("PUBLISH_GATE_PYTHON", sys.executable)


def check_no_screenshots() -> int:
    """screenshots/ is develop-only feedback — must not reach production."""
    tracked = subprocess.run(
        ["git", "ls-files", "screenshots"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    paths = [p for p in tracked.stdout.splitlines() if p.strip()]
    if paths:
        print("\n\033[91mFAILED  screenshots/ is tracked on main — develop-only folder\033[0m")
        for p in paths[:5]:
            print(f"  {p}")
        if len(paths) > 5:
            print(f"  … and {len(paths) - 5} more")
        return 1
    return 0


def run(label: str, script: str, extra: list[str] | None = None) -> int:
    cmd = [PY, os.path.join(ROOT, "scripts", script), *(extra or [])]
    print(f"\n{'━' * 58}\n  {label}\n{'━' * 58}")
    return subprocess.run(cmd, cwd=ROOT).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Limitless publish gate")
    parser.add_argument(
        "--with-ux",
        action="store_true",
        help="Also run scripts/ux-test.py (manual — not part of publish)",
    )
    parser.add_argument(
        "--with-lighthouse",
        action="store_true",
        help="Also run scripts/lighthouse-check.py (manual — not part of publish)",
    )
    parser.add_argument("--quick-ux", action="store_true", help="Shorter UX suite (with --with-ux)")
    args = parser.parse_args()

    if check_no_screenshots() != 0:
        return 1

    steps: list[tuple[str, str, list[str]]] = [
        ("Site tests", "test-site.py", []),
        ("Analytics wiring", "verify-analytics.py", []),
    ]
    if args.with_ux:
        ux_args = ["--quick"] if args.quick_ux else []
        steps.append(("UX smoke tests", "ux-test.py", ux_args))
    if args.with_lighthouse:
        steps.append(("Lighthouse gate", "lighthouse-check.py", []))

    for label, script, extra in steps:
        code = run(label, script, extra)
        if code != 0:
            return code

    print("\n\033[92mPASSED  Publish gate — safe to go live\033[0m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())