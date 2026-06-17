"""
Generate responsive WebP candidates for mobile + desktop gallery tiers and sync srcsets.

Cards render at ~78vw (~320–390px) on phones; gallery/about use full column width.
Mobile tiers: -480 (1x), -720 (mid), -960 (2x), -1440 (3x, capped).
Desktop gallery tiers: -640, -960, master (up to 1280px) for grid + lightbox sharpness.

Run: .venv/bin/python scripts/optimize_responsive_images.py
      .venv/bin/python scripts/optimize_responsive_images.py --write-srcset
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from PIL import Image

BASE = Path(__file__).resolve().parent.parent
MOBILE = BASE / "images" / "mobile"
IMAGES = BASE / "images"
MANIFEST_PATH = MOBILE / "_srcset-widths.json"

# Destination / misc below-fold (compress for Lighthouse; lazy-loaded).
CONTENT_MOBILE_TIERS = (
    ("-480", 480, 52),
    ("-720", 720, 50),
    ("-960", 960, 48),
    ("-1440", 1440, 50),
)
CONTENT_MOBILE_WEBP_Q = 58
CONTENT_DEST_MAX_EDGE = 640
CONTENT_DESKTOP_WEBP_Q = 55
CONTENT_DESKTOP_JPEG_Q = 76
DELIVERY_TIGHT_480_Q = 36

# Gallery: high quality, viewport-matched tiers (grid + fullscreen lightbox).
GALLERY_NAMES = frozenset({
    "maiora_20s_01", "maiora_20s_03", "maiora_20s_07",
    "limitless_aft_dining", "limitless_flybridge", "limitless_sundeck", "limitless_aft_deck",
    "int_saloon_artwork", "int_saloon_marina_view", "int_saloon_reverse",
    "int_master_headboard", "int_master_amber_glow", "int_master_wide",
    "int_vip_cabin", "int_twin_cabin",
})
GALLERY_ITEMS = (
    ("maiora_20s_01", True),
    ("maiora_20s_03", False),
    ("maiora_20s_07", False),
    ("limitless_aft_dining", True),
    ("limitless_flybridge", False),
    ("limitless_sundeck", False),
    ("limitless_aft_deck", False),
    ("int_saloon_artwork", True),
    ("int_saloon_marina_view", False),
    ("int_saloon_reverse", False),
    ("int_master_headboard", False),
    ("int_master_amber_glow", False),
    ("int_master_wide", False),
    ("int_vip_cabin", False),
    ("int_twin_cabin", False),
)
GALLERY_MOBILE_TIERS = (
    ("-480", 480, 78),
    ("-720", 720, 76),
    ("-960", 960, 74),
    ("-1440", 1440, 76),
)
GALLERY_MOBILE_WEBP_Q = 80
DESKTOP_GALLERY_TIERS = (
    ("-640", 640, 84),
    ("-960", 960, 82),
)
GALLERY_DESKTOP_MAX_EDGE = 1280
GALLERY_DESKTOP_WEBP_Q = 84

# About strip (single photo; moderate quality).
ABOUT_NAME = "maiora_20s_04"
ABOUT_DESKTOP_MAX_EDGE = 960
ABOUT_DESKTOP_WEBP_Q = 78

# Hero (LCP): sharp viewport-matched tiers; native master is 960px wide.
HERO_STEM = "maiora_20s_02"
HERO_JPG = IMAGES / f"{HERO_STEM}.jpg"
HERO_DESKTOP_WEBP = IMAGES / f"{HERO_STEM}.webp"
HERO_MOBILE_TIERS = (
    ("-480", 480, 80),
    ("-720", 720, 78),
    ("-960", 960, 76),
    ("-1440", 1440, 78),
)
HERO_MOBILE_WEBP_Q = 80
DESKTOP_HERO_TIERS = (
    ("-640", 640, 84),
)
HERO_DESKTOP_WEBP_Q = 84

DEST_SLUGS = (
    "portals-vells", "el-toro-malgrats", "cala-llamp", "sa-dragonera",
    "cala-pi", "es-trenc", "cabrera", "calo-des-moro",
    "sa-calobra", "circumnavigation", "formentera", "menorca",
)

TIER_SUFFIXES = tuple({
    suffix
    for suffix, _, _ in (
        CONTENT_MOBILE_TIERS
        + GALLERY_MOBILE_TIERS
        + HERO_MOBILE_TIERS
        + DESKTOP_GALLERY_TIERS
        + DESKTOP_HERO_TIERS
    )
})
TIER_ORDER = {suffix: index for index, (suffix, _, _) in enumerate(CONTENT_MOBILE_TIERS)}


def is_hero_asset(path: Path) -> bool:
    return path.name == "maiora_20s_02.webp"


def is_gallery_stem(stem: str) -> bool:
    return stem in GALLERY_NAMES


def mobile_profile(src_path: Path) -> str:
    if is_hero_asset(src_path):
        return "hero"
    if src_path.parent.name == "dest":
        return "dest"
    if is_gallery_stem(src_path.stem):
        return "gallery"
    return "content"


def mobile_tiers_for(profile: str) -> tuple[tuple[str, int, int], ...]:
    if profile == "gallery":
        return GALLERY_MOBILE_TIERS
    return HERO_MOBILE_TIERS if profile == "hero" else CONTENT_MOBILE_TIERS


def mobile_master_q(profile: str) -> int:
    if profile == "hero":
        return HERO_MOBILE_WEBP_Q
    if profile == "gallery":
        return GALLERY_MOBILE_WEBP_Q
    return CONTENT_MOBILE_WEBP_Q


def tier_quality(
    src_path: Path,
    suffix: str,
    tier_img: Image.Image,
    default_q: int,
    profile: str,
) -> int:
    if profile == "dest" and suffix == "-480" and tier_img.size[0] >= 480:
        return DELIVERY_TIGHT_480_Q
    return default_q


def hero_mobile_srcset(widths: dict[str, int]) -> str:
    return srcset_for_base(
        f"images/mobile/{HERO_STEM}.webp",
        widths,
        include_master=True,
        max_suffix="-960",
        tiers=HERO_MOBILE_TIERS,
    )


def hero_desktop_srcset(widths: dict[str, int]) -> str:
    entries: list[tuple[int, str]] = []
    for suffix, _, _ in DESKTOP_HERO_TIERS:
        rel = f"images/{HERO_STEM}{suffix}.webp"
        if rel in widths:
            entries.append((widths[rel], rel))
    master = f"images/{HERO_STEM}.webp"
    if master in widths:
        w = widths[master]
        if not any(width == w for width, _ in entries):
            entries.append((w, master))
    entries.sort(key=lambda item: item[0])
    return ", ".join(f"{path} {width}w" for width, path in entries)


def load_hero_rgb() -> Image.Image:
    """Always rebuild hero from the full native JPEG/WebP master on disk."""
    if HERO_JPG.is_file():
        return Image.open(HERO_JPG).convert("RGB")
    return Image.open(HERO_DESKTOP_WEBP).convert("RGB")


def load_rgb_source(webp: Path) -> Image.Image:
    """Prefer matching JPEG when re-encoding for maximum source detail."""
    jpg = webp.with_suffix(".jpg")
    if jpg.is_file():
        return Image.open(jpg).convert("RGB")
    return Image.open(webp).convert("RGB")


def load_mobile_master(src_path: Path) -> Image.Image:
    """Mobile tiers: prefer full-resolution desktop JPEG for gallery/content."""
    if src_path.parent == MOBILE and is_gallery_stem(src_path.stem):
        desktop_jpg = IMAGES / f"{src_path.stem}.jpg"
        if desktop_jpg.is_file():
            return Image.open(desktop_jpg).convert("RGB")
    if src_path.parent == MOBILE and src_path.stem == ABOUT_NAME:
        desktop_jpg = IMAGES / f"{ABOUT_NAME}.jpg"
        if desktop_jpg.is_file():
            return Image.open(desktop_jpg).convert("RGB")
    return load_rgb_source(src_path)


def kb(path: Path) -> float:
    return path.stat().st_size / 1024


def resize_to_max(img: Image.Image, max_edge: int) -> Image.Image:
    w, h = img.size
    if max(w, h) <= max_edge:
        return img
    if w >= h:
        nw, nh = max_edge, round(h * max_edge / w)
    else:
        nh, nw = max_edge, round(w * max_edge / h)
    return img.resize((nw, nh), Image.LANCZOS)


def iter_mobile_masters() -> list[Path]:
    paths: list[Path] = []
    tier_pat = "|".join(re.escape(suffix) for suffix in set(TIER_SUFFIXES))
    for root, _, files in os.walk(MOBILE):
        for name in sorted(files):
            if not name.endswith(".webp"):
                continue
            if re.search(rf"(?:{tier_pat})\.webp$", name):
                continue
            paths.append(Path(root) / name)
    return paths


def record_dest_desktop_widths(widths: dict[str, int]) -> None:
    dest = BASE / "images" / "dest"
    for path in sorted(dest.glob("*-1.webp")):
        with Image.open(path) as img:
            widths[path.relative_to(BASE).as_posix()] = img.size[0]


def optimize_dest_desktop(widths: dict[str, int]) -> None:
    """Re-encode destination card heroes (desktop + JPEG fallbacks)."""
    dest = BASE / "images" / "dest"
    print("\nOptimizing desktop destination card images\n")
    total_before = total_after = 0.0
    for slug in DEST_SLUGS:
        base = dest / f"{slug}-1"
        jpg, webp = base.with_suffix(".jpg"), base.with_suffix(".webp")
        src = jpg if jpg.is_file() else webp
        if not src.is_file():
            continue
        img = Image.open(src).convert("RGB")
        img = resize_to_max(img, CONTENT_DEST_MAX_EDGE)
        w, h = img.size
        before = (kb(jpg) if jpg.is_file() else 0) + (kb(webp) if webp.is_file() else 0)
        img.save(jpg, "JPEG", quality=CONTENT_DESKTOP_JPEG_Q, optimize=True)
        img.save(webp, "WEBP", quality=CONTENT_DESKTOP_WEBP_Q, method=6)
        after = kb(jpg) + kb(webp)
        total_before += before
        total_after += after
        rel = webp.relative_to(BASE).as_posix()
        widths[rel] = w
        print(f"  {slug:<18} {w}x{h}   {before:6.0f}KB -> {after:6.0f}KB")
    if total_before:
        print(
            f"\nDestination desktop: {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB "
            f"({100*(1-total_after/total_before):.0f}% smaller)"
        )


def optimize_gallery_desktop(widths: dict[str, int]) -> None:
    """High-quality desktop gallery masters + grid tiers (also used by lightbox)."""
    print("\nOptimizing desktop gallery images (high quality)\n")
    total_before = total_after = 0.0
    for name in sorted(GALLERY_NAMES):
        webp = IMAGES / f"{name}.webp"
        if not webp.is_file() and not (IMAGES / f"{name}.jpg").is_file():
            continue
        img = load_rgb_source(webp)
        before = kb(webp) if webp.is_file() else 0.0
        img = resize_to_max(img, GALLERY_DESKTOP_MAX_EDGE)
        img.save(webp, "WEBP", quality=GALLERY_DESKTOP_WEBP_Q, method=6)
        master_kb = kb(webp)
        tier_kb = master_kb
        rel = webp.relative_to(BASE).as_posix()
        widths[rel] = img.size[0]
        parts = [f"  {name:<32} {img.size[0]}x{img.size[1]} {before:5.0f}KB -> {master_kb:5.0f}KB"]
        prev_size: tuple[int, int] | None = None
        for suffix, max_edge, quality in DESKTOP_GALLERY_TIERS:
            tier_path = IMAGES / f"{name}{suffix}.webp"
            tier_img = resize_to_max(img, max_edge)
            if prev_size is not None and tier_img.size == prev_size:
                continue
            tier_img.save(tier_path, "WEBP", quality=quality, method=6)
            tier_kb += kb(tier_path)
            tier_rel = tier_path.relative_to(BASE).as_posix()
            widths[tier_rel] = tier_img.size[0]
            prev_size = tier_img.size
            parts.append(f"+ {tier_path.name} ({tier_img.size[0]}x{tier_img.size[1]}) {kb(tier_path):5.0f}KB")
        print(" ".join(parts))
        total_before += before
        total_after += tier_kb
    if total_before:
        print(
            f"\nGallery desktop: {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB"
        )


def optimize_hero_desktop(widths: dict[str, int]) -> None:
    """High-quality hero master + desktop grid tiers (native 960px cap)."""
    if not HERO_JPG.is_file() and not HERO_DESKTOP_WEBP.is_file():
        return
    print("\nOptimizing hero image (high quality, viewport tiers)\n")
    img = load_hero_rgb()
    before = kb(HERO_DESKTOP_WEBP) if HERO_DESKTOP_WEBP.is_file() else 0.0
    img.save(HERO_DESKTOP_WEBP, "WEBP", quality=HERO_DESKTOP_WEBP_Q, method=6)
    master_kb = kb(HERO_DESKTOP_WEBP)
    tier_kb = master_kb
    rel = HERO_DESKTOP_WEBP.relative_to(BASE).as_posix()
    widths[rel] = img.size[0]
    parts = [f"  {HERO_STEM:<32} {img.size[0]}x{img.size[1]} {before:5.0f}KB -> {master_kb:5.0f}KB"]
    prev_size: tuple[int, int] | None = None
    for suffix, max_edge, quality in DESKTOP_HERO_TIERS:
        tier_path = IMAGES / f"{HERO_STEM}{suffix}.webp"
        tier_img = resize_to_max(img, max_edge)
        if prev_size is not None and tier_img.size == prev_size:
            continue
        tier_img.save(tier_path, "WEBP", quality=quality, method=6)
        tier_kb += kb(tier_path)
        tier_rel = tier_path.relative_to(BASE).as_posix()
        widths[tier_rel] = tier_img.size[0]
        prev_size = tier_img.size
        parts.append(f"+ {tier_path.name} ({tier_img.size[0]}x{tier_img.size[1]}) {kb(tier_path):5.0f}KB")
    print(" ".join(parts))


def optimize_about_desktop(widths: dict[str, int]) -> None:
    """About-section photo: sharper than dest cards, lighter than full gallery master."""
    webp = IMAGES / f"{ABOUT_NAME}.webp"
    if not webp.is_file() and not (IMAGES / f"{ABOUT_NAME}.jpg").is_file():
        return
    print("\nOptimizing about-section desktop image\n")
    img = load_rgb_source(webp)
    before = kb(webp) if webp.is_file() else 0.0
    img = resize_to_max(img, ABOUT_DESKTOP_MAX_EDGE)
    img.save(webp, "WEBP", quality=ABOUT_DESKTOP_WEBP_Q, method=6)
    rel = webp.relative_to(BASE).as_posix()
    widths[rel] = img.size[0]
    print(f"  {ABOUT_NAME:<32} {img.size[0]}x{img.size[1]} {before:5.0f}KB -> {kb(webp):5.0f}KB")


def patch_dest_img_dimensions(html: str, widths: dict[str, int]) -> str:
    """Sync <img width height> on destination cards with re-encoded assets."""

    def repl(match: re.Match[str]) -> str:
        slug = match.group(1)
        rel = f"images/dest/{slug}.webp"
        jpg = f"images/dest/{slug}.jpg"
        if rel not in widths:
            return match.group(0)
        with Image.open(BASE / rel) as img:
            iw, ih = img.size
        return (
            f'<img loading="lazy" decoding="async" src="{jpg}" alt="" '
            f'width="{iw}" height="{ih}" />'
        )

    return re.sub(
        r'<img loading="lazy" decoding="async" src="images/dest/([a-z0-9-]+)\.jpg" '
        r'alt="" width="\d+" height="\d+" />',
        repl,
        html,
    )


def build_variants() -> dict[str, int]:
    """Return {relative posix path: pixel width} for every mobile tier + master."""
    widths: dict[str, int] = {}
    total_before = total_after = 0.0

    print("Optimizing mobile WebP assets\n")
    for src_path in iter_mobile_masters():
        profile = mobile_profile(src_path)
        tiers = mobile_tiers_for(profile)
        if profile == "hero":
            img = load_hero_rgb()
        elif src_path.parent == MOBILE:
            img = load_mobile_master(src_path)
        else:
            img = load_rgb_source(src_path)
        w, h = img.size
        before = kb(src_path)

        master_q = mobile_master_q(profile)
        img.save(src_path, "WEBP", quality=master_q, method=6)
        after_main = kb(src_path)
        rel = src_path.relative_to(BASE).as_posix()
        widths[rel] = img.size[0]
        tier_kb = after_main
        prev_size: tuple[int, int] | None = None

        parts = [f"  {rel:<52} {w}x{h} {before:5.0f}KB -> {after_main:5.0f}KB"]
        for suffix, max_edge, quality in tiers:
            tier_path = src_path.with_name(src_path.stem + suffix + ".webp")
            tier_img = resize_to_max(img, max_edge)
            if prev_size is not None and tier_img.size == prev_size:
                continue
            if tier_img.size == img.size and suffix != tiers[-1][0]:
                continue
            q = tier_quality(src_path, suffix, tier_img, quality, profile)
            tier_img.save(tier_path, "WEBP", quality=q, method=6)
            tw, th = tier_img.size
            tier_kb += kb(tier_path)
            tier_rel = tier_path.relative_to(BASE).as_posix()
            widths[tier_rel] = tw
            prev_size = tier_img.size
            parts.append(f"+ {tier_path.name} ({tw}x{th}) {kb(tier_path):5.0f}KB")
        print(" ".join(parts))

        total_before += before
        total_after += tier_kb

    optimize_dest_desktop(widths)
    optimize_hero_desktop(widths)
    optimize_gallery_desktop(widths)
    optimize_about_desktop(widths)
    record_dest_desktop_widths(widths)
    MANIFEST_PATH.write_text(json.dumps(widths, indent=2) + "\n", encoding="utf-8")
    print(
        f"\nTotal mobile masters: {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB "
        f"({100*(1-total_after/max(total_before,1)):.0f}% smaller incl. tiers)"
    )
    print(f"Wrote {MANIFEST_PATH.relative_to(BASE)}")
    return widths


def srcset_for_base(
    base_posix: str,
    widths: dict[str, int],
    *,
    include_master: bool,
    max_suffix: str | None = None,
    tiers: tuple[tuple[str, int, int], ...] = CONTENT_MOBILE_TIERS,
) -> str:
    """Build a width-descriptor srcset for a mobile image basename."""
    stem_path = Path(base_posix)
    tier_order = {suffix: index for index, (suffix, _, _) in enumerate(tiers)}
    entries: list[tuple[int, str]] = []
    for suffix, _, _ in tiers:
        if max_suffix is not None and tier_order[suffix] > tier_order[max_suffix]:
            continue
        rel = stem_path.with_name(stem_path.stem + suffix + ".webp").as_posix()
        if rel in widths:
            entries.append((widths[rel], rel))
    if include_master and base_posix in widths:
        w = widths[base_posix]
        if not any(width == w for width, _ in entries):
            entries.append((w, base_posix))
    entries.sort(key=lambda item: item[0])
    return ", ".join(f"{path} {width}w" for width, path in entries)


def desktop_gallery_srcset(name: str, widths: dict[str, int]) -> str:
    entries: list[tuple[int, str]] = []
    for suffix, _, _ in DESKTOP_GALLERY_TIERS:
        rel = f"images/{name}{suffix}.webp"
        if rel in widths:
            entries.append((widths[rel], rel))
    master = f"images/{name}.webp"
    if master in widths:
        w = widths[master]
        if not any(width == w for width, _ in entries):
            entries.append((w, master))
    entries.sort(key=lambda item: item[0])
    return ", ".join(f"{path} {width}w" for width, path in entries)


def patch_dest_srcsets(html: str, widths: dict[str, int]) -> str:
    dest_sizes_tablet = "(min-width: 1101px) 500px, 48vw"

    def repl(match: re.Match[str]) -> str:
        slug = match.group(1)
        base = f"images/mobile/dest/{slug}.webp"
        w480 = widths.get(f"images/mobile/dest/{slug}-480.webp", 480)
        max_suffix = "-720" if w480 < 400 else "-480"
        mobile = srcset_for_base(base, widths, include_master=False, max_suffix=max_suffix)
        desktop_w = widths.get(f"images/dest/{slug}.webp", 800)
        return (
            f'<source type="image/webp" media="(max-width: 640px)" '
            f'srcset="{mobile}" sizes="78vw" />\n            '
            f'<source type="image/webp" srcset="images/dest/{slug}.webp {desktop_w}w" '
            f'sizes="{dest_sizes_tablet}" />'
        )

    return re.sub(
        r'<source type="image/webp" media="\(max-width: 640px\)" '
        r'srcset="images/mobile/dest/([a-z0-9-]+?)-\d+\.webp[^"]*" sizes="78vw" />\s*'
        r'<source type="image/webp" srcset="images/dest/\1\.webp \d+w" '
        r'sizes="[^"]*" />',
        repl,
        html,
    )


def patch_desktop_content_srcset(
    html: str,
    widths: dict[str, int],
    rel_webp: str,
    sizes: str,
) -> str:
    """Sync single-file desktop <source srcset> (about photo, etc.)."""
    w = widths.get(rel_webp)
    if not w:
        return html
    name = Path(rel_webp).name
    pattern = (
        rf'<source type="image/webp" srcset="images/{re.escape(name)} \d+w" '
        rf'sizes="{re.escape(sizes)}" />'
    )
    replacement = f'<source type="image/webp" srcset="images/{name} {w}w" sizes="{sizes}" />'
    return re.sub(pattern, replacement, html, count=1)


def patch_gallery_picture(
    html: str,
    name: str,
    featured: bool,
    widths: dict[str, int],
) -> str:
    mobile = srcset_for_base(
        f"images/mobile/{name}.webp",
        widths,
        include_master=True,
        max_suffix="-960",
        tiers=GALLERY_MOBILE_TIERS,
    )
    desktop = desktop_gallery_srcset(name, widths)
    desktop_sizes = (
        "(min-width: 1101px) 50vw, 100vw" if featured else "(min-width: 1101px) 25vw, 50vw"
    )
    pattern = (
        rf'<picture><source type="image/webp" media="\(max-width: 640px\)" '
        rf'srcset="images/mobile/{re.escape(name)}[^"]*" sizes="[^"]*" />'
        rf'<source type="image/webp" srcset="images/{re.escape(name)}[^"]*" sizes="[^"]*" />'
        rf'(<img loading="lazy" decoding="async" src="images/{re.escape(name)}\.jpg"[^>]*/>)'
        rf'</picture>'
    )
    replacement = (
        f'<picture><source type="image/webp" media="(max-width: 640px)" '
        f'srcset="{mobile}" sizes="100vw" />'
        f'<source type="image/webp" srcset="{desktop}" sizes="{desktop_sizes}" />'
        rf'\1</picture>'
    )
    return re.sub(pattern, replacement, html, count=1)


def patch_mobile_source(
    html: str,
    widths: dict[str, int],
    *,
    folder: str,
    name: str,
    sizes: str,
    max_suffix: str,
    tiers: tuple[tuple[str, int, int], ...] = CONTENT_MOBILE_TIERS,
) -> str:
    base = f"images/mobile/{folder + '/' if folder else ''}{name}.webp"
    mobile = srcset_for_base(
        base, widths, include_master=False, max_suffix=max_suffix, tiers=tiers
    )
    pattern = (
        rf'<source type="image/webp" media="\(max-width: 640px\)" '
        rf'srcset="images/mobile/{re.escape(folder + "/") if folder else ""}{re.escape(name)}[^"]*" '
        rf'sizes="{re.escape(sizes)}" />'
    )
    replacement = (
        f'<source type="image/webp" media="(max-width: 640px)" '
        f'srcset="{mobile}" sizes="{sizes}" />'
    )
    return re.sub(pattern, replacement, html, count=1)


def write_srcsets(widths: dict[str, int]) -> None:
    index = BASE / "index.html"
    html = index.read_text(encoding="utf-8")
    original = html

    html = patch_dest_srcsets(html, widths)
    html = patch_dest_img_dimensions(html, widths)

    hero_mobile = hero_mobile_srcset(widths)
    hero_desktop = hero_desktop_srcset(widths)
    html = re.sub(
        r'<source srcset="[^"]*maiora_20s_02[^"]*" '
        r'sizes="100vw" type="image/webp" media="\(max-width: 640px\)">',
        f'<source srcset="{hero_mobile}" sizes="100vw" type="image/webp" media="(max-width: 640px)">',
        html,
    )
    html = re.sub(
        r'<source srcset="images/maiora_20s_02[^"]*" sizes="100vw" type="image/webp">',
        f'<source srcset="{hero_desktop}" sizes="100vw" type="image/webp">',
        html,
    )
    html = re.sub(
        r'<link rel="preload" as="image" imagesrcset="[^"]*maiora_20s_02[^"]*" '
        r'imagesizes="100vw" type="image/webp" fetchpriority="high" media="\(max-width: 640px\)" />',
        f'<link rel="preload" as="image" imagesrcset="{hero_mobile}" imagesizes="100vw" '
        f'type="image/webp" fetchpriority="high" media="(max-width: 640px)" />',
        html,
    )
    html = re.sub(
        r'<link rel="preload" as="image" href="images/maiora_20s_02\.webp" '
        r'type="image/webp" fetchpriority="high" media="\(min-width: 641px\)" />',
        f'<link rel="preload" as="image" imagesrcset="{hero_desktop}" imagesizes="100vw" '
        f'type="image/webp" fetchpriority="high" media="(min-width: 641px)" />',
        html,
    )
    if HERO_JPG.is_file():
        with Image.open(HERO_JPG) as hero_img:
            hw, hh = hero_img.size
        html = re.sub(
            r'(<img class="hero-bg" src="images/maiora_20s_02\.jpg" alt="" )width="\d+" height="\d+"',
            rf'\1width="{hw}" height="{hh}"',
            html,
            count=1,
        )

    html = patch_mobile_source(
        html,
        widths,
        folder="",
        name=ABOUT_NAME,
        sizes="100vw",
        max_suffix="-960",
        tiers=GALLERY_MOBILE_TIERS,
    )
    html = patch_desktop_content_srcset(
        html, widths, f"images/{ABOUT_NAME}.webp", "(min-width: 1101px) 50vw, 100vw"
    )

    for name, featured in GALLERY_ITEMS:
        html = patch_gallery_picture(html, name, featured, widths)

    if html == original:
        print("write-srcset: index.html already up to date")
        return

    index.write_text(html, encoding="utf-8")
    print(f"Updated picture srcsets in {index.relative_to(BASE)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write-srcset",
        action="store_true",
        help="Patch index.html picture srcsets using generated widths",
    )
    args = parser.parse_args()
    widths = build_variants()
    if args.write_srcset:
        write_srcsets(widths)


if __name__ == "__main__":
    main()