"""
Generate ultra-light -prev.webp placeholders for progressive image loading.

~160px longest edge, heavy compression — typically 2–8 KB each.
Run: .venv/bin/python scripts/build_preview_images.py
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from PIL import Image

BASE = Path(__file__).resolve().parent.parent
IMAGES = BASE / "images"
MOBILE = BASE / "images" / "mobile"
PREVIEW_EDGE = 160
PREVIEW_Q = 52

TIER_SUFFIXES = re.compile(
    r"-(?:480|640|720|960|1280|1440|prev)\.webp$"
)

DEST_STEMS = tuple(f"{slug}-1" for slug in (
    "portals-vells", "el-toro-malgrats", "cala-llamp", "sa-dragonera",
    "cala-pi", "es-trenc", "cabrera", "calo-des-moro",
    "sa-calobra", "circumnavigation", "formentera", "menorca",
))

GALLERY_STEMS = (
    "maiora_20s_01", "maiora_20s_03", "maiora_20s_07",
    "limitless_aft_dining", "limitless_flybridge", "limitless_sundeck", "limitless_aft_deck",
    "int_saloon_artwork", "int_saloon_marina_view", "int_saloon_reverse",
    "int_master_headboard", "int_master_amber_glow", "int_master_wide",
    "int_vip_cabin", "int_twin_cabin",
)

CONTENT_STEMS = ("maiora_20s_02", "maiora_20s_04")


def resize_preview(img: Image.Image) -> Image.Image:
    w, h = img.size
    if max(w, h) <= PREVIEW_EDGE:
        return img
    if w >= h:
        nw, nh = PREVIEW_EDGE, round(h * PREVIEW_EDGE / w)
    else:
        nh, nw = PREVIEW_EDGE, round(w * PREVIEW_EDGE / h)
    return img.resize((max(1, nw), max(1, nh)), Image.LANCZOS)


def load_rgb(path: Path) -> Image.Image:
    jpg = path.with_suffix(".jpg")
    if jpg.is_file():
        return Image.open(jpg).convert("RGB")
    return Image.open(path).convert("RGB")


def write_preview(src: Path, out: Path) -> float:
    img = resize_preview(load_rgb(src))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "WEBP", quality=PREVIEW_Q, method=6)
    return out.stat().st_size / 1024


def master_for_stem(folder: Path, stem: str) -> Path | None:
    for name in (f"{stem}.webp", f"{stem}.jpg"):
        path = folder / name
        if path.is_file():
            return path
    return None


def build_set(folder: Path, stems: tuple[str, ...], label: str) -> float:
    total = 0.0
    count = 0
    for stem in stems:
        src = master_for_stem(folder, stem)
        if not src:
            print(f"  skip {label}/{stem} (no master)")
            continue
        out = folder / f"{stem}-prev.webp"
        kb = write_preview(src, out)
        total += kb
        count += 1
        print(f"  {out.relative_to(BASE).as_posix():<52} {kb:5.1f} KB")
    return total if count else 0.0


def main() -> None:
    print("Building -prev.webp placeholders…")
    total_kb = 0.0
    total_kb += build_set(IMAGES, CONTENT_STEMS + GALLERY_STEMS, "images")
    total_kb += build_set(IMAGES / "dest", DEST_STEMS, "images/dest")
    total_kb += build_set(MOBILE, CONTENT_STEMS + GALLERY_STEMS, "mobile")
    total_kb += build_set(MOBILE / "dest", DEST_STEMS, "mobile/dest")
    print(f"Done — {total_kb:.0f} KB total across previews")


if __name__ == "__main__":
    main()