#!/usr/bin/env python3
"""Copy the site into _site/ with root-absolute paths prefixed for GitHub Pages.

Project sites are served at https://<user>.github.io/<repo>/ — paths like /fonts/
must become /<repo>/fonts/. Production (Netlify root) is unchanged; this runs only
in the GitHub Pages preview workflow.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '_site'

# (prefix, path) — path must start with / and must not be // (protocol-relative)
_ROOT_PATH = re.compile(
    r'(?P<prefix>href="|src="|href=\'|src=\'|url\(\'|url\("|fetch\(\'|fetch\(")'
    r'(?P<path>/(?!/)[^\'"\s\)]*)'
)

SKIP_DIRS = {
    '.git',
    '_site',
    'screenshots',
    'scripts',
    'memory',
    '.claude',
    '.githooks',
    'node_modules',
    '__pycache__',
}

SKIP_FILES_SUFFIX = {'.md', '.pyc'}


def should_skip_dir(name: str) -> bool:
    return name in SKIP_DIRS or name.startswith('.')


def rewrite_text(text: str, base: str) -> str:
    if not base:
        return text

    def repl(m: re.Match[str]) -> str:
        path = m.group('path')
        # Leave external-looking paths alone (should not match, but guard anyway)
        if path.startswith('//'):
            return m.group(0)
        return f"{m.group('prefix')}{base}{path}"

    return _ROOT_PATH.sub(repl, text)


def copy_and_rewrite(base: str) -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    text_ext = {'.html', '.css', '.js', '.xml', '.txt', '.svg', '.json'}

    for src in ROOT.rglob('*'):
        if src.is_dir():
            continue
        rel = src.relative_to(ROOT)
        if any(part in SKIP_DIRS or part.startswith('.') for part in rel.parts):
            continue
        if src.suffix in SKIP_FILES_SUFFIX:
            continue
        if rel.parts and rel.parts[0] == 'google-ads-campaign-mallorca-local.md':
            continue

        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)

        if src.suffix.lower() in text_ext:
            raw = src.read_text(encoding='utf-8')
            dest.write_text(rewrite_text(raw, base), encoding='utf-8')
        else:
            shutil.copy2(src, dest)

    print(f'Prepared GitHub Pages artifact at {OUT} (base={base!r})', file=sys.stderr)


def main() -> int:
    base = os.environ.get('GITHUB_PAGES_BASE', '/LimitlessYacht').rstrip('/')
    if base and not base.startswith('/'):
        base = '/' + base
    copy_and_rewrite(base)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())