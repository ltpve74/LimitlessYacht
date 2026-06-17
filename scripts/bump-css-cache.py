#!/usr/bin/env python3
"""Bump ?v= on main.css links in all site index pages."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PAGES = [
    ROOT / 'index.html',
    ROOT / 'de' / 'index.html',
    ROOT / 'es' / 'index.html',
    ROOT / 'fr' / 'index.html',
]


def main() -> int:
    versions = []
    for path in INDEX_PAGES:
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        versions.extend(int(v) for v in re.findall(r'main\.css\?v=(\d+)', text))

    if not versions:
        print('bump-css-cache: no main.css?v= found', flush=True)
        return 1

    current = max(versions)
    new = current + 1
    changed = 0
    for path in INDEX_PAGES:
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8')
        updated = re.sub(r'main\.css\?v=\d+', f'main.css?v={new}', text)
        if updated != text:
            path.write_text(updated, encoding='utf-8')
            changed += 1

    if not changed:
        print('bump-css-cache: nothing to update', flush=True)
        return 0

    print(f'bump-css-cache: {current} → {new} ({changed} file(s))', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())