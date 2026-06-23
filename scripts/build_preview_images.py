"""
Generate ultra-light progressive -prev.jpg placeholders for slow connections.

Blur on the source master, then downscale — avoids resize-then-blur banding.
~160px longest edge, progressive JPEG, pre-blurred in pixels (no CSS filter).
Run: .venv/bin/python scripts/build_preview_images.py
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

BASE = Path(__file__).resolve().parent.parent
IMAGES = BASE / "images"
MOBILE = BASE / "images" / "mobile"
PREVIEW_EDGE = 160
PREVIEW_Q = 54
HERO_PREVIEW_Q = 58
BLUR_WORK_EDGE = 1280
HERO_STEMS = frozenset({"maiora_20s_02"})
# Target blur strength in final 160px preview space (scaled up on source).
PREVIEW_BLUR = 2.8
HERO_PREVIEW_BLUR = 2.2
PREVIEW_SATURATE = 1.08
PREVIEW_BRIGHTNESS = 0.92
HERO_SATURATE = 1.06
HERO_BRIGHTNESS = 0.94

TIER_SUFFIXES = re.compile(
    r"-(?:480|640|720|960|1280|1440|prev)\.(?:webp|jpg)$"
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


def resize_preview(img: Image.Image, edge: int = PREVIEW_EDGE) -> Image.Image:
    w, h = img.size
    if max(w, h) <= edge:
        return img
    if w >= h:
        nw, nh = edge, round(h * edge / w)
    else:
        nh, nw = edge, round(w * edge / h)
    return img.resize((max(1, nw), max(1, nh)), Image.LANCZOS)


def work_image_for_blur(img: Image.Image) -> Image.Image:
    w, h = img.size
    longest = max(w, h)
    if longest <= BLUR_WORK_EDGE:
        return img
    scale = BLUR_WORK_EDGE / longest
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def blur_radius_for_preview(img: Image.Image, stem: str) -> float:
    preview_blur = HERO_PREVIEW_BLUR if stem in HERO_STEMS else PREVIEW_BLUR
    return preview_blur * max(img.size) / PREVIEW_EDGE


def soften_preview(img: Image.Image, stem: str) -> Image.Image:
    hero = stem in HERO_STEMS
    radius = blur_radius_for_preview(img, stem)
    img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    img = ImageEnhance.Color(img).enhance(HERO_SATURATE if hero else PREVIEW_SATURATE)
    img = ImageEnhance.Brightness(img).enhance(HERO_BRIGHTNESS if hero else PREVIEW_BRIGHTNESS)
    return img


def load_rgb(path: Path) -> Image.Image:
    jpg = path.with_suffix(".jpg")
    if jpg.is_file():
        return Image.open(jpg).convert("RGB")
    return Image.open(path).convert("RGB")


def build_preview_image(src: Path, stem: str) -> Image.Image:
    img = load_rgb(src)
    img = work_image_for_blur(img)
    img = soften_preview(img, stem)
    return resize_preview(img)


def write_preview(src: Path, out: Path, stem: str = "") -> float:
    img = build_preview_image(src, stem)
    out.parent.mkdir(parents=True, exist_ok=True)
    quality = HERO_PREVIEW_Q if stem in HERO_STEMS else PREVIEW_Q
    img.save(
        out,
        "JPEG",
        quality=quality,
        progressive=True,
        optimize=True,
        subsampling=0,
    )
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
        out = folder / f"{stem}-prev.jpg"
        kb = write_preview(src, out, stem)
        total += kb
        count += 1
        print(f"  {out.relative_to(BASE).as_posix():<52} {kb:5.1f} KB")
    return total if count else 0.0


def main() -> None:
    print("Building progressive -prev.jpg placeholders…")
    total_kb = 0.0
    total_kb += build_set(IMAGES, CONTENT_STEMS + GALLERY_STEMS, "images")
    total_kb += build_set(IMAGES / "dest", DEST_STEMS, "images/dest")
    total_kb += build_set(MOBILE, CONTENT_STEMS + GALLERY_STEMS, "mobile")
    total_kb += build_set(MOBILE / "dest", DEST_STEMS, "mobile/dest")
    print(f"Done — {total_kb:.0f} KB total across previews")


if __name__ == "__main__":
    main()