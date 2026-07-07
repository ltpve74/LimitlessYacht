#!/usr/bin/env python3
"""Crop mobile-destination masters from wide panorama sources.

Panorama video frames (e.g. Portals Vells @ 00:28) are tall-slice cropped from
the original 4K frame so object-fit:cover on the 78vw phone carousel fills the
card with no blur letterbox. Focus point keeps Limitless in frame.

Usage:
    .venv/bin/python scripts/reframe_dest.py portals-vells-1
    .venv/bin/python scripts/reframe_dest.py portals-vells-1 --source=path.jpg
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / ".venv/bin/python3"
PROC = ROOT / "scripts/process_media.py"
IMAGES = ROOT / "images" / "dest"

# Gallery mobile frame is 1080×1578 (100vw). Dest cards are 78vw — same height.
OUT_W, OUT_H = round(1080 * 0.78), 1578

# Original video-frame sources (media-library is local-only; never committed).
ORIGINAL_SOURCES: dict[str, Path] = {
    "portals-vells-1": ROOT / "media-library/incoming/video-frames/portals_vells_t28.jpg",
}


@dataclass(frozen=True)
class PanoramaFocus:
    """Normalized crop centre (0–1) and zoom (>1 = tighter on subject)."""

    fx: float
    fy: float
    zoom: float = 1.0


# Limitless motor yacht sits left-of-centre in the t28 panorama.
PANORAMA_FOCUS: dict[str, PanoramaFocus] = {
    "portals-vells-1": PanoramaFocus(fx=0.36, fy=0.57, zoom=1.62),
}


def compose_panorama_portrait(
    src: Image.Image,
    out_w: int,
    out_h: int,
    *,
    focus: PanoramaFocus,
) -> Image.Image:
    """Crop a portrait slice from a landscape panorama; resize to output."""
    src = ImageOps.exif_transpose(src).convert("RGB")
    sw, sh = src.size
    target_aspect = out_w / out_h

    crop_h = max(1, round(sh / focus.zoom))
    crop_w = max(1, round(crop_h * target_aspect))
    crop_w = min(crop_w, sw)
    crop_h = min(max(1, round(crop_w / target_aspect)), sh)

    cx = int(sw * focus.fx)
    cy = int(sh * focus.fy)
    left = max(0, min(cx - crop_w // 2, sw - crop_w))
    top = max(0, min(cy - crop_h // 2, sh - crop_h))

    crop = src.crop((left, top, left + crop_w, top + crop_h))
    return crop.resize((out_w, out_h), Image.Resampling.LANCZOS)


def reframe_dest_mobile(src: Image.Image, basename: str) -> Image.Image:
    focus = PANORAMA_FOCUS.get(basename)
    if focus is None:
        raise ValueError(f"no panorama focus configured for {basename}")
    return compose_panorama_portrait(src, OUT_W, OUT_H, focus=focus)


def process_slot(basename: str, *, source: Path | None = None) -> bool:
    src_path = source or ORIGINAL_SOURCES.get(basename) or (IMAGES / f"{basename}.jpg")
    if not src_path.is_file() and basename in ORIGINAL_SOURCES:
        src_path = IMAGES / f"{basename}.jpg"
    if not src_path.is_file():
        print(f"  skip {basename}: no {src_path.name}")
        return False

    out_name = f"{basename}gm"
    framed = reframe_dest_mobile(Image.open(src_path), basename)
    print(f"  {out_name}: {framed.size[0]}×{framed.size[1]}  panorama crop")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / f"{out_name}.jpg"
        framed.save(tmp_path, "JPEG", quality=98, subsampling=0, optimize=True)
        subprocess.run([str(PY), str(PROC), str(tmp_path), "dest_gm", out_name], check=True)
    return True


def main() -> int:
    args = sys.argv[1:]
    source: Path | None = None
    cleaned: list[str] = []
    for a in args:
        if a.startswith("--source="):
            source = Path(a.split("=", 1)[1])
            if not source.is_absolute():
                source = ROOT / source
        else:
            cleaned.append(a)

    if not cleaned:
        print(__doc__)
        return 2

    slots = [a.removesuffix(".jpg").removesuffix("gm") for a in cleaned]
    ok = True
    for slot in slots:
        if not process_slot(slot, source=source):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())