#!/usr/bin/env python3
"""Capture hero at representative viewports and detect boat/UI overlap.

Usage:
    python3 scripts/preview_hero_framing.py [--url URL] [--out DIR]

Writes PNGs per device and prints a pass/fail table. Exit 1 if any viewport fails.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from site_server import serve_site  # noqa: E402

# Devices from owner screenshots + common QA viewports.
DEVICES = (
    ("iphone-se", 375, 667),
    ("galaxy-s8", 360, 740),
    ("pixel-3", 393, 786),
    ("iphone-14", 390, 844),
    ("iphone-15-pro", 393, 852),
    ("pixel-7", 412, 915),
    ("iphone-14-pro-max", 430, 932),
    ("ipad-mini", 768, 1024),
    ("ipad-air", 820, 1180),
    ("desktop", 1280, 900),
)

# Sample boat pixels in the rendered hero <img> (non-water ≈ hull/deck).
BOAT_PROBE_JS = """
() => {
  const hero = document.getElementById('hero');
  const img = hero && hero.querySelector('.hero-bg');
  if (!hero || !img || !img.complete || !img.naturalWidth) return { error: 'hero img not ready' };

  const uiSelectors = [
    '.hero-top',
    '.hero-rates',
    '.hero-actions',
    '.hero-pull-quote',
  ];
  const ui = {};
  for (const sel of uiSelectors) {
    const el = hero.querySelector(sel);
    if (!el || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    ui[sel] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  const heroRect = hero.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(heroRect.width));
  canvas.height = Math.max(1, Math.round(heroRect.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, ir.left - heroRect.left, ir.top - heroRect.top, ir.width, ir.height);

  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const boat = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 120));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const water = g > r && g > b * 0.9 && g > 80;
      const hull = r > 215 && g > 215 && b > 215;
      if (hull && !water) boat.push({ x, y });
    }
  }
  if (!boat.length) return { error: 'no boat pixels detected' };

  const pct = (arr, p) => arr[Math.floor(arr.length * p)] ?? arr[arr.length - 1];
  const xs = boat.map((p) => p.x).sort((a, b) => a - b);
  const ys = boat.map((p) => p.y).sort((a, b) => a - b);
  const minX = pct(xs, 0.06);
  const maxX = pct(xs, 0.94);
  const minY = pct(ys, 0.08);
  const maxY = pct(ys, 0.90);
  const boatBox = {
    left: minX + heroRect.left,
    top: minY + heroRect.top,
    right: maxX + heroRect.left,
    bottom: maxY + heroRect.top,
  };

  const pad = 10;
  const fails = [];
  const boatScreen = boatBox;
  const hullW = boatScreen.right - boatScreen.left;
  if (hullW > heroRect.width * 0.98) fails.push('boat too wide for viewport');

  const cinema = window.matchMedia('(max-width: 768px)').matches;
  const topEl = hero.querySelector('.hero-top');
  const bottomEl = hero.querySelector('.hero-bottom');
  let safe = null;
  if (cinema && topEl && bottomEl) {
    const t = topEl.getBoundingClientRect();
    const b = bottomEl.getBoundingClientRect();
    safe = { top: t.bottom, bottom: b.top };
    if (boatScreen.top < safe.top + pad) fails.push('into top cluster');
    if (boatScreen.bottom > safe.bottom - pad) fails.push('into bottom cluster');
    const cx = (boatScreen.left + boatScreen.right) / 2;
    const hx = (heroRect.left + heroRect.right) / 2;
    if (Math.abs(cx - hx) > heroRect.width * 0.08) fails.push('off horizontal center');
  } else {
    const blocks = ['.hero-title', '.hero-rates', '.hero-actions', '.hero-pull-quote'];
    for (const sel of blocks) {
      const el = hero.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const overlapY = boatScreen.top < r.bottom - pad && boatScreen.bottom > r.top + pad;
      const overlapX = boatScreen.left < r.right - pad && boatScreen.right > r.left + pad;
      if (overlapX && overlapY) fails.push('touches ' + sel);
    }
  }

  const src = img.currentSrc || img.src;
  return {
    src: src.split('/').pop(),
    boatBox,
    ui,
    safe,
    fails,
    hero: { width: heroRect.width, height: heroRect.height },
  };
}
"""


def require_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        print("playwright required: .venv/bin/pip install -r scripts/dev-requirements.txt", file=sys.stderr)
        raise SystemExit(1) from exc
    return sync_playwright


def run(base_url: str, out_dir: Path) -> list[dict]:
    sync_playwright = require_playwright()
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=os.environ.get("LY_CHROMIUM") or None,
        )
        context = browser.new_context()
        page = context.new_page()
        page.goto(f"{base_url}/", wait_until="networkidle", timeout=60000)
        page.wait_for_selector("#hero .hero-bg", timeout=15000)
        page.evaluate(
            """() => {
              const wrap = document.querySelector('.ly-prog-wrap--hero');
              if (wrap) {
                wrap.classList.add('ly-prog-preview-ready', 'ly-prog-sharp-ready', 'ly-prog-sharp-visible');
              }
              document.documentElement.classList.add('ly-main-ready', 'ly-hero-cinema');
            }"""
        )
        page.wait_for_timeout(400)

        for name, width, height in DEVICES:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(250)
            probe = page.evaluate(BOAT_PROBE_JS)
            shot = out_dir / f"{name}-{width}x{height}.png"
            page.locator("#hero").screenshot(path=str(shot))
            row = {
                "device": name,
                "viewport": f"{width}x{height}",
                "screenshot": str(shot.relative_to(ROOT)),
                **probe,
            }
            rows.append(row)
            status = "PASS" if probe.get("fails") == [] else "FAIL"
            asset = probe.get("src", probe.get("error", "?"))
            detail = ", ".join(probe.get("fails", [])) or "ok"
            print(f"  {status:4}  {name:18}  {width}x{height}  {asset:28}  {detail}")

        browser.close()
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Hero framing preview across viewports")
    parser.add_argument("--url", help="Existing site URL (skip local server)")
    parser.add_argument("--out", default="screenshots/hero-preview", help="Output directory")
    parser.add_argument("--json", action="store_true", help="Print JSON report to stdout")
    args = parser.parse_args()
    out_dir = ROOT / args.out

    print("Hero framing preview")
    if args.url:
        rows = run(args.url.rstrip("/"), out_dir)
    else:
        with serve_site(str(ROOT)) as base_url:
            rows = run(base_url, out_dir)

    if args.json:
        print(json.dumps(rows, indent=2))

    failed = [r for r in rows if r.get("fails")]
    print(f"\n{len(rows) - len(failed)}/{len(rows)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())