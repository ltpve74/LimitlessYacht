#!/usr/bin/env python3
"""Crop high-res masters for the desktop/tablet immersive carousel (16:9 cover).

Mobile keeps portrait *-gm letterbox masters; desktop immersive sections need
landscape crops that fill the wide carousel stage with object-fit:cover.

Usage:
    .venv/bin/python scripts/reframe_immersive.py --all-water
    .venv/bin/python scripts/reframe_immersive.py --all-dest
    .venv/bin/python scripts/reframe_immersive.py maiora_20s_16
    .venv/bin/python scripts/reframe_immersive.py portals-vells-1
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
IMAGES = ROOT / "images"

# Working crop — process_media.py downsizes to gallery/dest max edges.
OUT_W, OUT_H = 1920, 1080

Image.MAX_IMAGE_PIXELS = 200_000_000


@dataclass(frozen=True)
class Focus:
    """Normalized crop centre (0–1), zoom (>1 = tighter), optional rotate (degrees)."""

    fx: float
    fy: float
    zoom: float = 1.0
    rotate: int = 0


def compose_cover_crop(
    src: Image.Image,
    out_w: int,
    out_h: int,
    *,
    focus: Focus,
) -> Image.Image:
    src = ImageOps.exif_transpose(src).convert("RGB")
    if focus.rotate:
        src = src.rotate(focus.rotate, expand=True, resample=Image.Resampling.LANCZOS)
    sw, sh = src.size
    target_aspect = out_w / out_h

    crop_h = max(1, round(sh / focus.zoom))
    crop_w = max(1, round(crop_h * target_aspect))
    if crop_w > sw:
        crop_w = sw
        crop_h = max(1, round(crop_w / target_aspect))
    crop_h = min(crop_h, sh)
    crop_w = min(crop_w, sw)

    cx = int(sw * focus.fx)
    cy = int(sh * focus.fy)
    left = max(0, min(cx - crop_w // 2, sw - crop_w))
    top = max(0, min(cy - crop_h // 2, sh - crop_h))

    crop = src.crop((left, top, left + crop_w, top + crop_h))
    return crop.resize((out_w, out_h), Image.Resampling.LANCZOS)


GALLERY_WATER: dict[str, tuple[Path, Focus]] = {
    "maiora_20s_01": (
        ROOT / "media-library/incoming/video-frames/chosen/best_01_t005.5s.jpg",
        Focus(0.56, 0.50, 1.35),
    ),
    "maiora_20s_03": (
        ROOT / "media-library/incoming/Photos/DJI_20260626180827_0362_D.JPG",
        Focus(0.52, 0.55, 1.25),
    ),
    "maiora_20s_16": (
        ROOT / "media-library/incoming/Photos/DJI_20260626180430_0346_D.JPG",
        Focus(0.5, 0.58, 1.35),
    ),
    "maiora_20s_17": (
        ROOT / "media-library/incoming/Photos/DJI_20260626180918_0368_D.JPG",
        Focus(0.5, 0.52, 1.2),
    ),
    "maiora_20s_19": (
        ROOT / "media-library/incoming/video-frames/1/best_02_t011.5s.jpg",
        Focus(0.5, 0.50, 1.4),
    ),
    # Cove anchor stern — must match mobile gm (not the top-down video frame).
    "maiora_20s_20": (
        ROOT / "media-library/incoming/Photos/DJI_20260626132137_0266_D.JPG",
        Focus(0.46, 0.58, 1.3),
    ),
    "maiora_20s_04": (
        ROOT / "media-library/incoming/Photos/DJI_20260626180844_0365_D.JPG",
        Focus(0.54, 0.55, 1.25),
    ),
}

DEST_SLOTS: dict[str, tuple[Path, Focus]] = {
    "portals-vells-1": (
        ROOT / "media-library/destinations/portals-vells/02_portals_pano.jpg",
        Focus(0.36, 0.57, 1.35),
    ),
    "el-toro-malgrats-1": (
        ROOT / "media-library/destinations/el-toro-malgrats/02_el_toro_waterfront_pexels.jpg",
        Focus(0.5, 0.5, 1.2),
    ),
    "cala-llamp-1": (
        ROOT / "media-library/destinations/cala-llamp/02_cala_llamp_cliff_pexels.jpg",
        Focus(0.5, 0.45, 1.25),
    ),
    "sa-dragonera-1": (
        ROOT / "media-library/destinations/sa-dragonera/01_dragonera.jpg",
        Focus(0.5, 0.5, 1.15),
    ),
    "cala-pi-1": (
        ROOT / "media-library/destinations/cala-pi/03_cala_pi_panorama.jpg",
        Focus(0.5, 0.5, 1.2),
    ),
    "es-trenc-1": (
        ROOT / "media-library/destinations/es-trenc/03_es_trenc_aerial_pexels.jpg",
        Focus(0.5, 0.45, 1.2),
    ),
    "cabrera-1": (
        ROOT / "media-library/destinations/cabrera/01_cabrera_view.jpg",
        Focus(0.5, 0.5, 1.15),
    ),
    "calo-des-moro-1": (
        ROOT / "media-library/destinations/calo-des-moro/02_calo_aerial_pexels.jpg",
        Focus(0.5, 0.42, 1.25),
    ),
    "sa-calobra-1": (
        ROOT / "media-library/destinations/sa-calobra/01_sa_calobra_cala.jpg",
        Focus(0.5, 0.5, 1.2),
    ),
    "circumnavigation-1": (
        ROOT / "media-library/destinations/circumnavigation/west_mallorca_coastline.jpeg",
        Focus(0.5, 0.5, 1.1),
    ),
    "formentera-1": (
        ROOT / "media-library/destinations/formentera/01_ses_illetes.jpg",
        Focus(0.5, 0.45, 1.2),
    ),
    "menorca-1": (
        ROOT / "media-library/destinations/menorca/cala_macarella.jpg",
        Focus(0.5, 0.45, 1.2),
    ),
}


def _fallback_source(basename: str, category: str) -> Path | None:
    if category == "gallery":
        p = IMAGES / f"{basename}.jpg"
    else:
        p = IMAGES / "dest" / f"{basename}.jpg"
    return p if p.is_file() else None


def process_slot(basename: str, *, category: str, source: Path | None, focus: Focus) -> bool:
    src_path = source
    if src_path is None or not src_path.is_file():
        src_path = _fallback_source(basename, category)
    if src_path is None or not src_path.is_file():
        print(f"  skip {basename}: no source")
        return False

    framed = compose_cover_crop(Image.open(src_path), OUT_W, OUT_H, focus=focus)
    print(f"  {basename}: {framed.size[0]}×{framed.size[1]}  cover crop  ({src_path.name})")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / f"{basename}.jpg"
        framed.save(tmp_path, "JPEG", quality=95, optimize=True)
        subprocess.run([str(PY), str(PROC), str(tmp_path), category, basename], check=True)
    return True


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2

    slots: list[tuple[str, str]] = []
    if "--all-water" in args:
        slots.extend((n, "gallery") for n in GALLERY_WATER)
    if "--all-dest" in args:
        slots.extend((n, "dest") for n in DEST_SLOTS)
    for a in args:
        if a.startswith("--"):
            continue
        base = a.removesuffix(".jpg")
        if base in GALLERY_WATER:
            slots.append((base, "gallery"))
        elif base in DEST_SLOTS:
            slots.append((base, "dest"))
        else:
            print(f"  unknown slot: {a}")
            return 1

    if not slots:
        print(__doc__)
        return 2

    ok = True
    seen: set[str] = set()
    for basename, category in slots:
        key = f"{category}:{basename}"
        if key in seen:
            continue
        seen.add(key)
        if category == "gallery":
            src, focus = GALLERY_WATER[basename]
        else:
            src, focus = DEST_SLOTS[basename]
        if not process_slot(basename, category=category, source=src, focus=focus):
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())