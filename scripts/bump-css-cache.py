#!/usr/bin/env python3
"""Bump ?v= on layout.css and/or main.css links in index.html (EN source)."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'index.html'

SHEETS = {
    'layout': 'layout.css',
    'main': 'main.css',
}


def bump_sheet(text: str, filename: str) -> tuple[str, int | None, int | None]:
    pattern = rf'{re.escape(filename)}\?v=(\d+)'
    versions = [int(v) for v in re.findall(pattern, text)]
    if not versions:
        return text, None, None
    current = max(versions)
    new = current + 1
    updated = re.sub(rf'{re.escape(filename)}\?v=\d+', f'{filename}?v={new}', text)
    return updated, current, new


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout', action='store_true', help='bump layout.css?v=')
    parser.add_argument('--main', action='store_true', help='bump main.css?v=')
    args = parser.parse_args()

    if not INDEX.exists():
        print('bump-css-cache: index.html not found', flush=True)
        return 1

    targets = []
    if args.layout:
        targets.append('layout')
    if args.main:
        targets.append('main')
    if not targets:
        targets = ['layout', 'main']

    text = INDEX.read_text(encoding='utf-8')
    updated = text
    bumped: list[str] = []

    for key in targets:
        filename = SHEETS[key]
        updated, current, new = bump_sheet(updated, filename)
        if new is None:
            print(f'bump-css-cache: no {filename}?v= found in index.html', flush=True)
            return 1
        bumped.append(f'{filename} {current} → {new}')

    if updated == text:
        print('bump-css-cache: nothing to update', flush=True)
        return 0

    INDEX.write_text(updated, encoding='utf-8')
    print(f"bump-css-cache: {', '.join(bumped)}", flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())