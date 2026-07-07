#!/usr/bin/env python3
"""Compose mobile-gallery masters so the boat survives object-fit:cover.

The mobile gallery carousel is full-bleed (100vw × measured grid height). Landscape
masters get centre-cropped and often lose the hull. This script emits portrait
``*-gm`` slots validated against real gallery viewport sizes.

Usage:
    .venv/bin/python scripts/reframe_gallery.py [basename ...]
    .venv/bin/python scripts/reframe_gallery.py --all-water
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / ".venv/bin/python3"
PROC = ROOT / "scripts/process_media.py"
IMAGES = ROOT / "images"

# Import hero reframe helpers (shared boat bbox + compose logic).
sys.path.insert(0, str(ROOT / "scripts"))
from reframe_hero import Viewport, boat_bbox, compose_framed  # noqa: E402

# Measured gallery image area on mobile (grid flex height inside cinema funnel).
GALLERY_MOBILE_VPS = (
    Viewport(360, 500, 0.04, 0.04),
    Viewport(375, 520, 0.04, 0.04),
    Viewport(390, 540, 0.04, 0.04),
    Viewport(393, 550, 0.04, 0.04),
    Viewport(414, 580, 0.04, 0.04),
    Viewport(430, 600, 0.04, 0.04),
)

OUT_W, OUT_H = 1080, 1578  # ≈ 414/580 gallery aspect

WATER_LANDSCAPE = (
    "maiora_20s_01",
    "maiora_20s_03",
    "maiora_20s_17",
    "maiora_20s_04",
    "maiora_20s_19",
    "maiora_20s_20",
)

# Top-down masters: mobile uses a -90° portrait (bow down), not landscape compose.
VERTICAL_TOPDOWN = frozenset({"maiora_20s_01"})


def reframe_gallery_mobile(src: Image.Image) -> Image.Image:
    return compose_framed(
        src,
        OUT_W,
        OUT_H,
        top_ui=0.05,
        bottom_ui=0.05,
        boat_center_y_frac=0.52,
        viewports=GALLERY_MOBILE_VPS,
        side_margin=0.06,
        tight_crop=True,
    )


def reframe_gallery_mobile_vertical(src: Image.Image, *, rotate: int = -90) -> Image.Image:
    """Top-down landscape → portrait mobile (boat runs bow-down like hero 18pv)."""
    upright = ImageOps.exif_transpose(src).convert("RGB").rotate(
        rotate, expand=True, resample=Image.Resampling.LANCZOS
    )
    return compose_framed(
        upright,
        OUT_W,
        OUT_H,
        top_ui=0.05,
        bottom_ui=0.05,
        boat_center_y_frac=0.48,
        viewports=GALLERY_MOBILE_VPS,
        side_margin=0.07,
        tight_crop=True,
    )


def process_slot(basename: str, *, vertical: bool = False, source: Path | None = None) -> bool:
    src_path = source or (IMAGES / f"{basename}.jpg")
    if not src_path.is_file():
        print(f"  skip {basename}: no {src_path.name}")
        return False
    src = Image.open(src_path)
    w, h = src.size
    use_vertical = vertical or basename in VERTICAL_TOPDOWN
    if not use_vertical and h > w * 1.05:
        print(f"  skip {basename}: already portrait ({w}×{h})")
        return True

    out_name = f"{basename}gm"
    framed = reframe_gallery_mobile_vertical(src) if use_vertical else reframe_gallery_mobile(src)
    x0, y0, x1, y1 = boat_bbox(framed)
    print(f"  {out_name}: {framed.size[0]}×{framed.size[1]}  boat {x0},{y0}–{x1},{y1}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / f"{out_name}.jpg"
        framed.save(tmp_path, "JPEG", quality=95, optimize=True)
        subprocess.run([str(PY), str(PROC), str(tmp_path), "gallery", out_name], check=True)
    return True


def main() -> int:
    args = sys.argv[1:]
    vertical = False
    source: Path | None = None
    cleaned: list[str] = []
    for a in args:
        if a == "--all-water":
            cleaned.append(a)
        elif a == "--vertical":
            vertical = True
        elif a.startswith("--source="):
            source = Path(a.split("=", 1)[1])
            if not source.is_absolute():
                source = ROOT / source
        else:
            cleaned.append(a)

    if not cleaned or cleaned == ["--all-water"]:
        slots = list(WATER_LANDSCAPE)
    else:
        slots = [a.removesuffix(".jpg").removesuffix("gm") for a in cleaned if a != "--all-water"]

    ok = True
    for slot in slots:
        if not process_slot(slot, vertical=vertical, source=source):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())