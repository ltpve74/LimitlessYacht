#!/usr/bin/env python3
"""Capture gallery water carousel at mobile viewports; detect boat crop.

Usage:
    python3 scripts/preview_gallery_framing.py [--url URL] [--out DIR]
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

DEVICES = (
    ("iphone-xr", 414, 896),
    ("iphone-14", 390, 844),
    ("iphone-se", 375, 667),
    ("pixel-7", 412, 915),
)

WATER_INDICES = tuple(range(7))

BOAT_PROBE_JS = """
(indices) => {
  const grid = document.querySelector('.gallery-group .gallery-grid');
  if (!grid) return { error: 'no gallery grid' };
  const items = Array.from(grid.querySelectorAll('.gallery-item'));
  const rows = [];
  for (const idx of indices) {
    const item = items[idx];
    if (!item) { rows.push({ index: idx, error: 'missing item' }); continue; }
    const img = item.querySelector('.ly-prog-sharp');
    if (!img || !img.complete || !img.naturalWidth) {
      rows.push({ index: idx, error: 'img not ready', src: img && (img.currentSrc || img.src) });
      continue;
    }
    const ir = img.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(ir.width));
    canvas.height = Math.max(1, Math.round(ir.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const boat = [];
    const step = Math.max(1, Math.floor(Math.min(w, h) / 100));
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
    const fails = [];
    if (!boat.length) fails.push('no hull pixels');
    else {
      const xs = boat.map((p) => p.x);
      const ys = boat.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const pad = 8;
      if (minX < pad) fails.push('hull clipped left');
      if (maxX > w - pad) fails.push('hull clipped right');
      if (minY < pad) fails.push('hull clipped top');
      if (maxY > h - pad) fails.push('hull clipped bottom');
      if (maxX - minX < w * 0.12) fails.push('hull too small');
    }
    rows.push({
      index: idx,
      src: (img.currentSrc || img.src).split('/').pop(),
      fails,
      box: { width: Math.round(ir.width), height: Math.round(ir.height) },
    });
  }
  return rows;
}
"""


def require_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        print("playwright required", file=sys.stderr)
        raise SystemExit(1) from exc
    return sync_playwright


def run(base_url: str, out_dir: Path) -> list[dict]:
    sync_playwright = require_playwright()
    out_dir.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=os.environ.get("LY_CHROMIUM") or None,
        )
        page = browser.new_page()
        page.goto(f"{base_url}/#gallery-funnel", wait_until="networkidle", timeout=60000)
        page.evaluate(
            """() => {
              document.documentElement.classList.add('ly-main-ready', 'ly-past-hero');
              document.querySelectorAll('.gallery-group .ly-prog-wrap').forEach((w) => {
                w.classList.add('ly-prog-preview-ready', 'ly-prog-sharp-ready', 'ly-prog-sharp-visible');
              });
            }"""
        )
        page.wait_for_timeout(600)

        for name, width, height in DEVICES:
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(300)
            for idx in WATER_INDICES:
                page.evaluate(
                    """(i) => {
                      const grid = document.querySelector('.gallery-group .gallery-grid');
                      if (grid) grid.scrollTo({ left: i * window.innerWidth, behavior: 'auto' });
                    }""",
                    idx,
                )
                page.wait_for_timeout(200)
            probes = page.evaluate(BOAT_PROBE_JS, list(WATER_INDICES))
            shot = out_dir / f"{name}-{width}x{height}-water.png"
            page.locator("#gallery .gallery-group .gallery-grid").screenshot(path=str(shot))
            failed = [p for p in probes if p.get("fails")]
            row = {
                "device": name,
                "viewport": f"{width}x{height}",
                "screenshot": str(shot.relative_to(ROOT)),
                "panels": probes,
                "failed": len(failed),
            }
            all_rows.append(row)
            status = "PASS" if not failed else "FAIL"
            print(f"  {status:4}  {name:12}  {width}x{height}  {len(failed)}/{len(probes)} panels flagged")
            for p in failed:
                print(f"         [{p['index']}] {p.get('src','?')}: {', '.join(p['fails'])}")

        browser.close()
    return all_rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Gallery water framing preview")
    parser.add_argument("--url", help="Existing site URL")
    parser.add_argument("--out", default="screenshots/gallery-preview")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    out_dir = ROOT / args.out

    print("Gallery water framing preview")
    if args.url:
        rows = run(args.url.rstrip("/"), out_dir)
    else:
        with serve_site(str(ROOT)) as base_url:
            rows = run(base_url, out_dir)

    if args.json:
        print(json.dumps(rows, indent=2))

    bad = sum(r["failed"] for r in rows)
    total = len(rows)
    passed = total - sum(1 for r in rows if r["failed"])
    print(f"\n{passed}/{total} viewports passed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())