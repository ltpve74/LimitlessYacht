#!/usr/bin/env python3
"""Verify analytics wiring: suppressed on preview, present for production."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

GTAG_ID = 'AW-18209943491'
CLARITY_ID = 'x1y8i19q6e'


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def main() -> int:
    env_js = read('js/analytics-env.js')
    index = read('index.html')
    legal = read('legal.html')
    errors: list[str] = []

    if 'LY_IS_PREVIEW' not in env_js:
        errors.append('js/analytics-env.js must define LY_IS_PREVIEW')
    if '.github.io' not in env_js:
        errors.append('js/analytics-env.js must treat GitHub Pages as preview')
    if 'LY_OWNER_MODE' not in env_js:
        errors.append('js/analytics-env.js must set LY_OWNER_MODE when preview/owner')

    if 'LY_IS_PREVIEW' not in index:
        errors.append('index.html must define LY_IS_PREVIEW (inline or via js/analytics-env.js)')
    if GTAG_ID not in index:
        errors.append(f'index.html must reference Google tag {GTAG_ID} for production')
    if CLARITY_ID not in index:
        errors.append(f'index.html must reference Microsoft Clarity {CLARITY_ID} for production')
    if 'LY_OWNER_MODE' not in index:
        errors.append('index.html must guard analytics with LY_OWNER_MODE')

    if 'js/analytics-env.js' not in legal:
        errors.append('legal.html must load js/analytics-env.js')
    if GTAG_ID not in legal:
        errors.append(f'legal.html must reference Google tag {GTAG_ID} for production')
    if 'GTM-' in index or 'gtm.js?id=' in index:
        errors.append('index.html must not load Google Tag Manager (direct gtag only)')
    if 'GTM-' in legal or 'gtm.js?id=' in legal:
        errors.append('legal.html must not load Google Tag Manager (direct gtag only)')
    if 'LY_OWNER_MODE' not in legal:
        errors.append('legal.html must guard analytics with LY_OWNER_MODE')

    if re.search(r'if\s*\(\s*!window\.LY_OWNER_MODE\s*\)', index) is None:
        errors.append('index.html needs at least one !window.LY_OWNER_MODE guard')

    if errors:
        print('Analytics verification FAILED:', file=sys.stderr)
        for err in errors:
            print(f'  • {err}', file=sys.stderr)
        return 1

    print('PASSED  Analytics preview suppression + production wiring verified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())