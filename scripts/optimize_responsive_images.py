"""
Generate responsive WebP candidates for every site picture and sync srcsets in index.html.

Unified model (hero, about, gallery, destinations):
  Mobile tiers: -480, -720, -960, -1440 (capped at native width).
  Desktop tiers: -640, -960, master (up to 1280px where the source allows).

Quality is viewport-matched: lean encoding on card/grid tiers, higher on lightbox masters.

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

# Destination: card tiers in carousel srcset; masters for fullscreen lightbox.
DEST_MOBILE_TIERS = (
    ("-480", 480, 68),
    ("-720", 720, 72),
    ("-960", 960, 70),
)
DEST_MOBILE_WEBP_Q = 78
DEST_CARD_DESKTOP_TIERS = (
    ("-640", 640, 76),
    ("-960", 960, 74),
)
DEST_DESKTOP_MAX_EDGE = 960
DEST_DESKTOP_WEBP_Q = 80
DEST_DESKTOP_JPEG_Q = 84

# Misc mobile fallbacks (non-dest / non-gallery / non-hero).
CONTENT_MOBILE_TIERS = DEST_MOBILE_TIERS
CONTENT_MOBILE_WEBP_Q = 72
DEST_MOBILE_MAX_EDGE = 960
DEST_HERO_SOURCES: dict[str, Path] = {
    "portals-vells": BASE / "media-library" / "destinations" / "portals-vells" / "01_portals_vells_existing.jpg",
    "el-toro-malgrats": BASE / "media-library" / "destinations" / "el-toro-malgrats" / "01_el_toro_rocky_pexels.jpg",
    "cala-llamp": BASE / "media-library" / "destinations" / "cala-llamp" / "01_cala_llamp_existing.jpg",
    "sa-dragonera": BASE / "media-library" / "destinations" / "sa-dragonera" / "01_dragonera.jpg",
    "cala-pi": BASE / "media-library" / "destinations" / "cala-pi" / "01_cala_pi_beach.jpg",
    "es-trenc": BASE / "media-library" / "destinations" / "es-trenc" / "01_es_trenc_beach.jpg",
    "cabrera": BASE / "media-library" / "destinations" / "cabrera" / "01_cabrera_view.jpg",
    "calo-des-moro": BASE / "media-library" / "destinations" / "calo-des-moro" / "01_calo_des_moro.jpg",
    "sa-calobra": BASE / "media-library" / "destinations" / "sa-calobra" / "01_sa_calobra_cala.jpg",
    "circumnavigation": BASE / "media-library" / "destinations" / "circumnavigation" / "west_mallorca_coastline.jpeg",
    "formentera": BASE / "media-library" / "destinations" / "formentera" / "01_ses_illetes.jpg",
    "menorca": BASE / "media-library" / "destinations" / "menorca" / "cala_macarella.jpg",
}

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
    ("-480", 480, 72),
    ("-720", 720, 74),
    ("-960", 960, 72),
)
GALLERY_MOBILE_WEBP_Q = 82
GALLERY_CARD_DESKTOP_TIERS = (
    ("-640", 640, 78),
    ("-960", 960, 76),
)
DESKTOP_GALLERY_TIERS = GALLERY_CARD_DESKTOP_TIERS
GALLERY_DESKTOP_MAX_EDGE = 1280
GALLERY_DESKTOP_WEBP_Q = 86

# About strip (grid tiers + single master, no lightbox).
ABOUT_NAME = "maiora_20s_04"
ABOUT_DESKTOP_MAX_EDGE = 960
ABOUT_DESKTOP_WEBP_Q = 82
DESKTOP_ABOUT_TIERS = GALLERY_CARD_DESKTOP_TIERS
DESKTOP_CONTENT_TIERS = GALLERY_CARD_DESKTOP_TIERS

# Hero (LCP): native 2000px Maiora 20S cruising shot (charter promo master).
HERO_STEM = "maiora_20s_02"
HERO_SOURCE = BASE / "media-library" / "hero-source" / "maiora-20s-cruising-2000.jpeg"
HERO_JPG = IMAGES / f"{HERO_STEM}.jpg"
HERO_DESKTOP_WEBP = IMAGES / f"{HERO_STEM}.webp"
HERO_DESKTOP_MAX_EDGE = 1920
HERO_MOBILE_TIERS = (
    ("-480", 480, 74),
    ("-720", 720, 72),
    ("-960", 960, 70),
)
HERO_MOBILE_WEBP_Q = 78
DESKTOP_HERO_TIERS = (
    ("-640", 640, 78),
    ("-960", 960, 76),
    ("-1280", 1280, 76),
)
HERO_DESKTOP_WEBP_Q = 82

DEST_SLUGS = (
    "portals-vells", "el-toro-malgrats", "cala-llamp", "sa-dragonera",
    "cala-pi", "es-trenc", "cabrera", "calo-des-moro",
    "sa-calobra", "circumnavigation", "formentera", "menorca",
)

TIER_SUFFIXES = tuple({
    suffix
    for suffix, _, _ in (
        DEST_MOBILE_TIERS
        + GALLERY_MOBILE_TIERS
        + HERO_MOBILE_TIERS
        + DEST_CARD_DESKTOP_TIERS
        + DESKTOP_GALLERY_TIERS
        + DESKTOP_HERO_TIERS
    )
})


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
    if profile == "hero":
        return HERO_MOBILE_TIERS
    if profile == "dest":
        return DEST_MOBILE_TIERS
    return CONTENT_MOBILE_TIERS


def mobile_master_q(profile: str) -> int:
    if profile == "hero":
        return HERO_MOBILE_WEBP_Q
    if profile == "gallery":
        return GALLERY_MOBILE_WEBP_Q
    if profile == "dest":
        return DEST_MOBILE_WEBP_Q
    return CONTENT_MOBILE_WEBP_Q


def hero_mobile_srcset(widths: dict[str, int]) -> str:
    return srcset_for_base(
        f"images/mobile/{HERO_STEM}.webp",
        widths,
        include_master=True,
        max_suffix="-960",
        tiers=HERO_MOBILE_TIERS,
    )


def desktop_tier_srcset(
    stem: str,
    widths: dict[str, int],
    *,
    folder: str = "images",
    tiers: tuple[tuple[str, int, int], ...] = DESKTOP_CONTENT_TIERS,
) -> str:
    """Build desktop srcset from tier files + master webp."""
    prefix = f"{folder}/" if folder else ""
    entries: list[tuple[int, str]] = []
    for suffix, _, _ in tiers:
        rel = f"{prefix}{stem}{suffix}.webp"
        if rel in widths:
            entries.append((widths[rel], rel))
    master = f"{prefix}{stem}.webp"
    if master in widths:
        w = widths[master]
        if not any(width == w for width, _ in entries):
            entries.append((w, master))
    entries.sort(key=lambda item: item[0])
    return ", ".join(f"{path} {width}w" for width, path in entries)


def hero_desktop_srcset(widths: dict[str, int]) -> str:
    return desktop_tier_srcset(HERO_STEM, widths, tiers=DESKTOP_HERO_TIERS)


def load_hero_rgb() -> Image.Image:
    """Rebuild hero from the archived 2000px source, then deploy-folder fallbacks."""
    if HERO_SOURCE.is_file():
        return Image.open(HERO_SOURCE).convert("RGB")
    if HERO_JPG.is_file():
        return Image.open(HERO_JPG).convert("RGB")
    return Image.open(HERO_DESKTOP_WEBP).convert("RGB")


def load_rgb_source(webp: Path) -> Image.Image:
    """Prefer matching JPEG when re-encoding for maximum source detail."""
    jpg = webp.with_suffix(".jpg")
    if jpg.is_file():
        return Image.open(jpg).convert("RGB")
    return Image.open(webp).convert("RGB")


def dest_slug_from_stem(stem: str) -> str:
    return stem[:-2] if stem.endswith("-1") else stem


def load_dest_hero_rgb(stem: str) -> Image.Image:
    """Rebuild destination heroes from media-library masters when available."""
    slug = dest_slug_from_stem(stem)
    src = DEST_HERO_SOURCES.get(slug)
    if src and src.is_file():
        return Image.open(src).convert("RGB")
    for candidate in (
        IMAGES / "dest" / f"{stem}.jpg",
        IMAGES / "dest" / f"{stem}.webp",
    ):
        if candidate.is_file():
            return load_rgb_source(candidate)
    return load_rgb_source(MOBILE / "dest" / f"{stem}.webp")


def load_mobile_master(src_path: Path) -> Image.Image:
    """Mobile tiers: prefer full-resolution desktop JPEG for gallery/content."""
    if src_path.parent == MOBILE / "dest":
        return load_dest_hero_rgb(src_path.stem)
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


def resize_to_target_max(img: Image.Image, max_edge: int) -> Image.Image:
    """Downscale or upscale so the longest edge matches max_edge (hero large desktops)."""
    w, h = img.size
    if max(w, h) == max_edge:
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


def save_desktop_tiers(
    img: Image.Image,
    stem: str,
    *,
    folder: Path,
    tiers: tuple[tuple[str, int, int], ...],
    master_q: int,
    widths: dict[str, int],
) -> float:
    """Write master webp + desktop tier files; return total KB written."""
    master_path = folder / f"{stem}.webp"
    img.save(master_path, "WEBP", quality=master_q, method=6)
    total_kb = kb(master_path)
    rel = master_path.relative_to(BASE).as_posix()
    widths[rel] = img.size[0]
    prev_size: tuple[int, int] | None = None
    for suffix, max_edge, quality in tiers:
        tier_path = folder / f"{stem}{suffix}.webp"
        tier_img = resize_to_max(img, max_edge)
        if prev_size is not None and tier_img.size == prev_size:
            continue
        tier_img.save(tier_path, "WEBP", quality=quality, method=6)
        total_kb += kb(tier_path)
        tier_rel = tier_path.relative_to(BASE).as_posix()
        widths[tier_rel] = tier_img.size[0]
        prev_size = tier_img.size
    return total_kb


def optimize_dest_desktop(widths: dict[str, int]) -> None:
    """High-quality destination masters + desktop tiers (cards + lightbox)."""
    dest = IMAGES / "dest"
    print("\nOptimizing destination images (viewport tiers, media-library sources)\n")
    total_before = total_after = 0.0
    for slug in DEST_SLUGS:
        stem = f"{slug}-1"
        base = dest / stem
        jpg, webp = base.with_suffix(".jpg"), base.with_suffix(".webp")
        before = (kb(jpg) if jpg.is_file() else 0) + (kb(webp) if webp.is_file() else 0)
        img = load_dest_hero_rgb(stem)
        img = resize_to_max(img, DEST_DESKTOP_MAX_EDGE)
        w, h = img.size
        img.save(jpg, "JPEG", quality=DEST_DESKTOP_JPEG_Q, optimize=True)
        tier_kb = save_desktop_tiers(
            img,
            stem,
            folder=dest,
            tiers=DEST_CARD_DESKTOP_TIERS,
            master_q=DEST_DESKTOP_WEBP_Q,
            widths=widths,
        )
        after = kb(jpg) + tier_kb
        total_before += before
        total_after += after
        print(f"  {slug:<18} {w}x{h}   {before:6.0f}KB -> {after:6.0f}KB")
    if total_before:
        print(
            f"\nDestination desktop: {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB"
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
    """High-quality hero master (up to 1280px) + desktop viewport tiers."""
    if not HERO_JPG.is_file() and not HERO_DESKTOP_WEBP.is_file():
        return
    print("\nOptimizing hero image (high quality, viewport tiers)\n")
    img = resize_to_max(load_hero_rgb(), HERO_DESKTOP_MAX_EDGE)
    img.save(HERO_JPG, "JPEG", quality=86, optimize=True)
    before = kb(HERO_DESKTOP_WEBP) if HERO_DESKTOP_WEBP.is_file() else 0.0
    tier_kb = save_desktop_tiers(
        img,
        HERO_STEM,
        folder=IMAGES,
        tiers=DESKTOP_HERO_TIERS,
        master_q=HERO_DESKTOP_WEBP_Q,
        widths=widths,
    )
    master_kb = kb(HERO_DESKTOP_WEBP)
    parts = [f"  {HERO_STEM:<32} {img.size[0]}x{img.size[1]} {before:5.0f}KB -> {tier_kb:5.0f}KB"]
    for suffix, _, _ in DESKTOP_HERO_TIERS:
        tier_path = IMAGES / f"{HERO_STEM}{suffix}.webp"
        if tier_path.is_file():
            with Image.open(tier_path) as tier_img:
                tw, th = tier_img.size
            parts.append(f"+ {tier_path.name} ({tw}x{th}) {kb(tier_path):5.0f}KB")
    print(" ".join(parts))


def optimize_about_desktop(widths: dict[str, int]) -> None:
    """About-section photo: same multi-tier desktop model as gallery."""
    webp = IMAGES / f"{ABOUT_NAME}.webp"
    if not webp.is_file() and not (IMAGES / f"{ABOUT_NAME}.jpg").is_file():
        return
    print("\nOptimizing about-section desktop image\n")
    img = resize_to_max(load_rgb_source(webp), ABOUT_DESKTOP_MAX_EDGE)
    before = kb(webp) if webp.is_file() else 0.0
    tier_kb = save_desktop_tiers(
        img,
        ABOUT_NAME,
        folder=IMAGES,
        tiers=DESKTOP_ABOUT_TIERS,
        master_q=ABOUT_DESKTOP_WEBP_Q,
        widths=widths,
    )
    print(f"  {ABOUT_NAME:<32} {img.size[0]}x{img.size[1]} {before:5.0f}KB -> {tier_kb:5.0f}KB")


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
            if profile == "dest":
                img = resize_to_max(img, DEST_MOBILE_MAX_EDGE)
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
            tier_img.save(tier_path, "WEBP", quality=quality, method=6)
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
    return desktop_tier_srcset(name, widths, tiers=DESKTOP_GALLERY_TIERS)


def patch_dest_srcsets(html: str, widths: dict[str, int]) -> str:
    dest_sizes_tablet = "(min-width: 1101px) 500px, 48vw"

    def repl(match: re.Match[str]) -> str:
        stem = match.group(1)
        base = f"images/mobile/dest/{stem}.webp"
        mobile = srcset_for_base(
            base,
            widths,
            include_master=True,
            max_suffix="-960",
            tiers=DEST_MOBILE_TIERS,
        )
        desktop = desktop_tier_srcset(
            stem,
            widths,
            folder="images/dest",
            tiers=DEST_CARD_DESKTOP_TIERS,
        )
        return (
            f'<source type="image/webp" media="(max-width: 640px)" '
            f'srcset="{mobile}" sizes="78vw" />\n            '
            f'<source type="image/webp" srcset="{desktop}" '
            f'sizes="{dest_sizes_tablet}" />'
        )

    return re.sub(
        r'<source type="image/webp" media="\(max-width: 640px\)" '
        r'srcset="images/mobile/dest/([a-z0-9-]+)[^"]*"'
        r'(?: sizes="78vw")? />\s*'
        r'<source type="image/webp" srcset="images/dest/\1[^"]*"'
        r'(?: sizes="[^"]*")? />',
        repl,
        html,
    )


def patch_desktop_content_srcset(
    html: str,
    widths: dict[str, int],
    stem: str,
    sizes: str,
    *,
    tiers: tuple[tuple[str, int, int], ...] = DESKTOP_CONTENT_TIERS,
) -> str:
    """Sync multi-tier desktop <source srcset> (about photo, etc.)."""
    desktop = desktop_tier_srcset(stem, widths, tiers=tiers)
    pattern = (
        rf'<source type="image/webp" srcset="images/{re.escape(stem)}[^"]*" '
        rf'sizes="{re.escape(sizes)}" />'
    )
    replacement = f'<source type="image/webp" srcset="{desktop}" sizes="{sizes}" />'
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
        rf'srcset="images/mobile/{re.escape(name)}[^"]*"(?: sizes="[^"]*")? />'
        rf'<source type="image/webp" srcset="images/{re.escape(name)}[^"]*"(?: sizes="[^"]*")? />'
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
        r'<link rel="preload" as="image" (?:href="images/maiora_20s_02\.webp"|imagesrcset="[^"]*maiora_20s_02[^"]*") '
        r'(?:imagesizes="100vw" )?type="image/webp" fetchpriority="high" media="\(min-width: 641px\)" />',
        f'<link rel="preload" as="image" imagesrcset="{hero_desktop}" imagesizes="100vw" '
        f'type="image/webp" fetchpriority="high" media="(min-width: 641px)" />',
        html,
    )
    hero_w = widths.get(f"images/{HERO_STEM}.webp")
    if hero_w:
        with Image.open(HERO_DESKTOP_WEBP) as hero_img:
            hw, hh = hero_img.size
        html = re.sub(
            r'(<img class="hero-bg" src="images/maiora_20s_02\.jpg" alt="" )width="\d+" height="\d+"',
            rf'\1width="{hw}" height="{hh}"',
            html,
            count=1,
        )

    about_mobile = srcset_for_base(
        f"images/mobile/{ABOUT_NAME}.webp",
        widths,
        include_master=True,
        max_suffix="-960",
        tiers=GALLERY_MOBILE_TIERS,
    )
    html = re.sub(
        rf'<source type="image/webp" media="\(max-width: 640px\)" '
        rf'srcset="images/mobile/{re.escape(ABOUT_NAME)}[^"]*" sizes="100vw" />',
        f'<source type="image/webp" media="(max-width: 640px)" '
        f'srcset="{about_mobile}" sizes="100vw" />',
        html,
        count=1,
    )
    html = patch_desktop_content_srcset(
        html,
        widths,
        ABOUT_NAME,
        "(min-width: 1101px) 50vw, 100vw",
        tiers=DESKTOP_ABOUT_TIERS,
    )
    if (IMAGES / f"{ABOUT_NAME}.jpg").is_file():
        with Image.open(IMAGES / f"{ABOUT_NAME}.jpg") as about_img:
            aw, ah = about_img.size
        html = re.sub(
            rf'(<img loading="lazy" decoding="async" src="images/{ABOUT_NAME}\.jpg" )'
            rf'width="\d+" height="\d+"',
            rf'\1width="{aw}" height="{ah}"',
            html,
            count=1,
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