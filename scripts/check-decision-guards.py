#!/usr/bin/env python3
"""Guard against silently weakening DECISION-marked tests.

Tests in scripts/test-site.py that carry a `# DECISION` comment encode the
load-bearing choices documented in DECISIONS.md. The whole point of those
tests is that you DON'T change them to make a diff pass — if one blocks you,
your change is undoing a deliberate decision.

This script snapshots each DECISION-tagged `r.check(...)` block (keyed by its
description) into scripts/decision-guards.lock. On every commit the pre-commit
hook re-runs it; if a tagged guard was weakened, retitled, un-tagged, or
removed without the lock being updated, the commit is blocked.

To intentionally change a guard (e.g. the reviews reserve because the review
count changed): update DECISIONS.md, edit the test, then run
  python3 scripts/check-decision-guards.py --accept
and stage scripts/decision-guards.lock. That --accept is the conscious
override — it shows up in the diff as "I changed a decision guard."
"""
import ast
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "test-site.py"
LOCK = ROOT / "scripts" / "decision-guards.lock"


def extract_guards() -> dict:
    src = SRC.read_text(encoding="utf-8")
    lines = src.splitlines()
    tree = ast.parse(src)
    guards = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "check"):
            continue
        start, end = node.lineno, node.end_lineno
        before = lines[start - 2] if start - 2 >= 0 else ""
        blob = "\n".join(lines[start - 1:end])
        if "# DECISION" not in blob and "# DECISION" not in before:
            continue
        desc = None
        if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
            desc = node.args[0].value
        key = desc or f"line:{start}"
        norm = re.sub(r"\s+", " ", blob).strip()
        guards[key] = hashlib.sha1(norm.encode("utf-8")).hexdigest()
    return guards


def load_lock() -> dict:
    if LOCK.exists():
        return json.loads(LOCK.read_text(encoding="utf-8"))
    return {}


def write_lock(guards: dict) -> None:
    LOCK.write_text(json.dumps(guards, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    guards = extract_guards()
    if "--accept" in sys.argv:
        write_lock(guards)
        print(f"[decision-guards] lock updated with {len(guards)} guard(s).")
        return 0

    lock = load_lock()
    removed = [k for k in lock if k not in guards]
    changed = [k for k in guards if k in lock and guards[k] != lock[k]]
    added = [k for k in guards if k not in lock]

    if not removed and not changed:
        # new guards are fine to add without ceremony, but record them
        if added:
            print(f"[decision-guards] {len(added)} new guard(s) detected — run --accept to record them in the lock.")
            return 1
        print(f"[decision-guards] OK — {len(guards)} guard(s) intact.")
        return 0

    print("──────────────────────────────────────────────────────────")
    print(" DECISION-guarded test(s) were changed or removed.")
    print(" These tests encode load-bearing choices — see DECISIONS.md.")
    print(" Do NOT weaken a guard to make your change pass; that undoes the decision.")
    for k in changed:
        print(f"   • CHANGED: {k}")
    for k in removed:
        print(f"   • REMOVED: {k}")
    print("")
    print(" If this is intentional AND you have updated DECISIONS.md:")
    print("   python3 scripts/check-decision-guards.py --accept")
    print("   git add scripts/decision-guards.lock")
    print("──────────────────────────────────────────────────────────")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
