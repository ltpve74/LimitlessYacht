#!/usr/bin/env python3
"""
Publish gate — runs after minification on main.

1. scripts/test-site.py   (structure, assets, inline JS syntax)
2. scripts/ux-test.py     (browser flows + JS error capture)
3. scripts/lighthouse-check.py (performance regression guard)

Usage:
  python3 scripts/publish-gate.py
  python3 scripts/publish-gate.py --skip-lighthouse   # faster local run
  python3 scripts/publish-gate.py --skip-ux
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.environ.get("PUBLISH_GATE_PYTHON", sys.executable)


def run(label: str, script: str, extra: list[str] | None = None) -> int:
    cmd = [PY, os.path.join(ROOT, "scripts", script), *(extra or [])]
    print(f"\n{'━' * 58}\n  {label}\n{'━' * 58}")
    return subprocess.run(cmd, cwd=ROOT).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Limitless publish gate")
    parser.add_argument("--skip-lighthouse", action="store_true")
    parser.add_argument("--skip-ux", action="store_true")
    parser.add_argument("--quick-ux", action="store_true", help="Shorter UX suite")
    args = parser.parse_args()

    steps: list[tuple[str, str, list[str]]] = [
        ("Site tests", "test-site.py", []),
    ]
    if not args.skip_ux:
        ux_args = ["--quick"] if args.quick_ux else []
        steps.append(("UX smoke tests", "ux-test.py", ux_args))
    if not args.skip_lighthouse:
        steps.append(("Lighthouse gate", "lighthouse-check.py", []))

    for label, script, extra in steps:
        code = run(label, script, extra)
        if code != 0:
            return code

    print("\n\033[92mPASSED  Publish gate — safe to go live\033[0m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())