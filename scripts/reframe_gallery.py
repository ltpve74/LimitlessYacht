#!/usr/bin/env python3
"""Compose mobile-gallery masters: full boat visible, blur letterbox fill.

Landscape (and portrait) masters are centre-fitted inside the gallery aspect with
a Gaussian-blurred, colour-matched backdrop so object-fit:cover on the phone
carousel never crops the hull. Top-down shots (01, 19) rotate -90° first so the
boat runs vertically on mobile.

Usage:
    .venv/bin/python scripts/reframe_gallery.py --all-water
    .venv/bin/python scripts/reframe_gallery.py maiora_20s_03
    .venv/bin/python scripts/reframe_gallery.py maiora_20s_01 --vertical --source=path.jpg
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / ".venv/bin/python3"
PROC = ROOT / "scripts/process_media.py"
IMAGES = ROOT / "images"

OUT_W, OUT_H = 1080, 1578  # ≈ 414×580 gallery image area

# All On the Water slots that ship a *-gm mobile master.
WATER_MOBILE = (
    "maiora_20s_01",
    "maiora_20s_03",
    "maiora_20s_16",
    "maiora_20s_17",
    "maiora_20s_19",
    "maiora_20s_20",
    "maiora_20s_04",
)

# Top-down landscape → rotate before letterbox (bow down on portrait screens).
VERTICAL_TOPDOWN = frozenset({"maiora_20s_01", "maiora_20s_19"})


def compose_letterbox(
    src: Image.Image,
    out_w: int,
    out_h: int,
    *,
    blur_ratio: float = 0.042,
) -> Image.Image:
    """Fit the full image inside the frame; fill margins with blurred cover crop."""
    src = ImageOps.exif_transpose(src).convert("RGB")
    sw, sh = src.size

    cover_scale = max(out_w / sw, out_h / sh)
    bw, bh = max(1, round(sw * cover_scale)), max(1, round(sh * cover_scale))
    bg = src.resize((bw, bh), Image.Resampling.LANCZOS)
    left = max(0, (bw - out_w) // 2)
    top = max(0, (bh - out_h) // 2)
    bg = bg.crop((left, top, left + out_w, top + out_h))

    radius = max(out_w, out_h) * blur_ratio
    if radius > 0.5:
        bg = bg.filter(ImageFilter.GaussianBlur(radius=radius))
    bg = ImageEnhance.Brightness(bg).enhance(0.9)
    bg = ImageEnhance.Color(bg).enhance(1.04)

    fit_scale = min(out_w / sw, out_h / sh)
    fw, fh = max(1, round(sw * fit_scale)), max(1, round(sh * fit_scale))
    fg = src.resize((fw, fh), Image.Resampling.LANCZOS)

    canvas = bg.copy()
    canvas.paste(fg, ((out_w - fw) // 2, (out_h - fh) // 2))
    return canvas


def reframe_gallery_mobile(src: Image.Image) -> Image.Image:
    return compose_letterbox(src, OUT_W, OUT_H)


def reframe_gallery_mobile_vertical(src: Image.Image, *, rotate: int = -90) -> Image.Image:
    upright = ImageOps.exif_transpose(src).convert("RGB").rotate(
        rotate, expand=True, resample=Image.Resampling.LANCZOS
    )
    return compose_letterbox(upright, OUT_W, OUT_H)


def process_slot(basename: str, *, vertical: bool = False, source: Path | None = None) -> bool:
    src_path = source or (IMAGES / f"{basename}.jpg")
    if not src_path.is_file():
        print(f"  skip {basename}: no {src_path.name}")
        return False

    src = Image.open(src_path)
    use_vertical = vertical or basename in VERTICAL_TOPDOWN
    out_name = f"{basename}gm"
    framed = reframe_gallery_mobile_vertical(src) if use_vertical else reframe_gallery_mobile(src)
    print(f"  {out_name}: {framed.size[0]}×{framed.size[1]}  letterbox")

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
        slots = list(WATER_MOBILE)
    else:
        slots = [a.removesuffix(".jpg").removesuffix("gm") for a in cleaned if a != "--all-water"]

    ok = True
    for slot in slots:
        if not process_slot(slot, vertical=vertical, source=source):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())