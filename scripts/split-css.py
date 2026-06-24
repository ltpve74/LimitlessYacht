#!/usr/bin/env python3
"""Split css/main.css into layout.css (early) + main.css (deferred). Run from repo root."""

from __future__ import annotations

import gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'css' / 'main.css'
LAYOUT = ROOT / 'css' / 'layout.css'

# 1-based inclusive line ranges inside @layer site { ... }
LAYOUT_RANGES = [
    (26, 55),      # :root tokens
    (57, 79),      # html/body
    (81, 263),     # nav + hamburger
    (380, 416),    # shared .btn-primary / .btn-ghost
    (468, 562),    # sections common + intro + about + carousel tabs
    (590, 617),    # gallery grid shell (before lightbox)
    (680, 747),    # progressive preview → sharp
    (1679, 1771),  # itinerary + destination cards
    (2297, 2337),  # section-cta + itinerary-bottom-bar
    (2356, 2361),  # reveal base
    (2419, 2658),  # tablet grid + mobile nav + immersive funnel
    (2659, 2747),  # phone tweaks + reveal mobile override
    (2749, 2805),  # mobile nav overlay
]

LAYOUT_HEADER = """/*
  Limitless Yacht — layout stylesheet (mobile funnel + below-fold shell)
  Loaded after hero preview, in parallel with hero sharp.
  Hero lives in inline #critical-css (unlayered). @layer layout beats deferred @layer site.
*/

@layer layout, site;

@layer layout {

"""

LAYOUT_PROBE = """
/* Readiness probe — last rule in layout sheet */
.ly-css-probe {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  pointer-events: none;
  visibility: hidden;
  --ly-css-tail: 1;
}

} /* @layer layout */
"""

MAIN_HEADER = """/*
  Limitless Yacht — deferred stylesheet (reviews, calendar, lightbox, desktop polish)
  layout.css loads first; this file enhances without blocking ly-main-ready.
*/

@layer site {

"""


def line_in_ranges(n: int, ranges: list[tuple[int, int]]) -> bool:
    return any(start <= n <= end for start, end in ranges)


def main() -> None:
    lines = MAIN.read_text(encoding='utf-8').splitlines(keepends=True)
    layer_start = next(i for i, ln in enumerate(lines) if ln.strip().startswith('@layer site'))
    layer_end = next(i for i, ln in enumerate(lines) if '} /* @layer site */' in ln)

    layout_lines: list[str] = []
    main_lines: list[str] = []

    for i, ln in enumerate(lines):
        n = i + 1
        if i <= layer_start or i >= layer_end:
            if i < layer_start:
                continue  # drop old file header; rewritten below
            if i >= layer_end:
                continue  # drop old footer + probe
            continue
        if line_in_ranges(n, LAYOUT_RANGES):
            layout_lines.append(ln)
        else:
            main_lines.append(ln)

    layout_body = ''.join(layout_lines).rstrip() + '\n'
    layout_out = LAYOUT_HEADER + layout_body + LAYOUT_PROBE

    main_body = ''.join(main_lines).rstrip() + '\n'
    main_out = MAIN_HEADER + main_body + '\n} /* @layer site */\n'

    LAYOUT.write_text(layout_out, encoding='utf-8')
    MAIN.write_text(main_out, encoding='utf-8')

    layout_raw = len(layout_out.encode())
    main_raw = len(main_out.encode())
    layout_gz = len(gzip.compress(layout_out.encode()))
    main_gz = len(gzip.compress(main_out.encode()))
    print(f'Wrote {LAYOUT.relative_to(ROOT)}  {layout_raw:,} B raw  {layout_gz:,} B gzip')
    print(f'Wrote {MAIN.relative_to(ROOT)}    {main_raw:,} B raw  {main_gz:,} B gzip')


if __name__ == '__main__':
    main()