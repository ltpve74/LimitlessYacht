#!/usr/bin/env python3
"""Reframe hero masters from the full-res top-down source, then run process_media.

Portrait: rotate −90° and pad water below so the boat sits higher — clearance for
the rates pill / CTAs on tall phones (iPhone 15, etc.).

Landscape: centred 16:9 crop from the 3840×2160 master.

Usage (feature branch):
    .venv/bin/python scripts/reframe_hero.py [source.jpg]
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / ".venv/bin/python3"
PROC = ROOT / "scripts/process_media.py"

PORTRAIT_PAD_RATIO = 0.30
LANDSCAPE_BOAT_Y = 0.50


def water_fill_color(im: Image.Image) -> tuple[int, int, int]:
    arr = np.asarray(im.convert("RGB"))
    patches = [arr[:48, :48], arr[:48, -48:], arr[-48:, :48], arr[-48:, -48:]]
    med = np.median(np.concatenate([p.reshape(-1, 3) for p in patches]), axis=0)
    return tuple(int(x) for x in med)


def reframe_landscape(im: Image.Image, boat_y: float = LANDSCAPE_BOAT_Y) -> Image.Image:
    im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size
    target_aspect = 16 / 9
    if w / h >= target_aspect:
        crop_h = h
        crop_w = round(h * target_aspect)
    else:
        crop_w = w
        crop_h = round(w / target_aspect)
    cx = w // 2
    cy = round(h * boat_y)
    left = max(0, min(cx - crop_w // 2, w - crop_w))
    top = max(0, min(cy - crop_h // 2, h - crop_h))
    return im.crop((left, top, left + crop_w, top + crop_h))


def reframe_portrait(im: Image.Image, bottom_pad_ratio: float = PORTRAIT_PAD_RATIO) -> Image.Image:
    rot = ImageOps.exif_transpose(im).convert("RGB").rotate(-90, expand=True)
    w, h = rot.size
    pad = round(h * bottom_pad_ratio)
    canvas = Image.new("RGB", (w, h + pad), water_fill_color(rot))
    canvas.paste(rot, (0, 0))
    return canvas


def main() -> int:
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    else:
        src = ROOT / "images/maiora_20s_18-source.jpg"
    if not src.is_file():
        fallback = ROOT / "media-library/incoming/video-frames/1/best_last_frame.jpg"
        if fallback.is_file():
            src = fallback
        else:
            print(f"error: source not found: {src}")
            return 1

    land = reframe_landscape(Image.open(src))
    port = reframe_portrait(Image.open(src))
    print(f"source {src.name}: {land.size[0]}×{land.size[1]} landscape, {port.size[0]}×{port.size[1]} portrait")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        land_path = tmp / "hero_landscape.jpg"
        port_path = tmp / "hero_portrait.jpg"
        land.save(land_path, "JPEG", quality=95, optimize=True)
        port.save(port_path, "JPEG", quality=95, optimize=True)
        subprocess.run([str(PY), str(PROC), str(land_path), "hero", "maiora_20s_18"], check=True)
        subprocess.run([str(PY), str(PROC), str(port_path), "hero", "maiora_20s_18p"], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())