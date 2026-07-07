#!/usr/bin/env python3
"""Compose mobile-destination masters: full scene visible, blur letterbox fill.

Landscape dest masters are centre-fitted inside the destination-card aspect
(78vw × carousel height ≈ gallery height) with a Gaussian-blurred backdrop so
object-fit:cover on the phone carousel never crops the aerial panorama.

Usage:
    .venv/bin/python scripts/reframe_dest.py portals-vells-1
    .venv/bin/python scripts/reframe_dest.py portals-vells-1 --source=path.jpg
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

from reframe_gallery import compose_letterbox

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / ".venv/bin/python3"
PROC = ROOT / "scripts/process_media.py"
IMAGES = ROOT / "images" / "dest"

# Gallery mobile frame is 1080×1578 (100vw). Dest cards are 78vw — same height.
OUT_W, OUT_H = round(1080 * 0.78), 1578


def reframe_dest_mobile(src: Image.Image) -> Image.Image:
    return compose_letterbox(src, OUT_W, OUT_H)


def process_slot(basename: str, *, source: Path | None = None) -> bool:
    src_path = source or (IMAGES / f"{basename}.jpg")
    if not src_path.is_file():
        print(f"  skip {basename}: no {src_path.name}")
        return False

    out_name = f"{basename}gm"
    framed = reframe_dest_mobile(Image.open(src_path))
    print(f"  {out_name}: {framed.size[0]}×{framed.size[1]}  letterbox")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / f"{out_name}.jpg"
        framed.save(tmp_path, "JPEG", quality=95, optimize=True)
        subprocess.run([str(PY), str(PROC), str(tmp_path), "dest", out_name], check=True)
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