#!/usr/bin/env python3
"""Bump ?v= on main.css links in English index.html (locales rebuilt by pre-commit)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'index.html'


def main() -> int:
    text = INDEX.read_text(encoding='utf-8')
    matches = re.findall(r'main\.css\?v=(\d+)', text)
    if not matches:
        print('bump-css-cache: no main.css?v= found in index.html', flush=True)
        return 1
    current = max(int(v) for v in matches)
    new = current + 1
    updated = re.sub(r'main\.css\?v=\d+', f'main.css?v={new}', text)
    if updated == text:
        print('bump-css-cache: nothing to update', flush=True)
        return 0
    INDEX.write_text(updated, encoding='utf-8')
    print(f'bump-css-cache: {current} → {new}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())