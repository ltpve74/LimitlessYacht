"""
Generate 1x/2x/3x WebP candidates for mobile images and sync picture srcsets.

Cards render at ~78vw (~320–390px) on phones; gallery/about use full column width.
Tiers use longest-edge caps: -480 (1x), -720 (mid), -960 (2x), -1440 (3x, capped).

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
MANIFEST_PATH = MOBILE / "_srcset-widths.json"

TIERS = (
    ("-480", 480, 64),
    ("-720", 720, 62),
    ("-960", 960, 58),
    ("-1440", 1440, 66),
)
MOBILE_WEBP_Q = 72
# Lighthouse image-delivery: landscape dest -480 needs extra compression.
# Hero: sharp -480 for 1x; 960w master (desktop source) for 2x/3x — native res, no -720 upscale.
# HERO_960_Q=35 is the highest quality that clears Lighthouse image-delivery (score 1).
DELIVERY_TIGHT_480_Q = 30
HERO_480_Q = 72
HERO_960_Q = 35
HERO_SOURCE = BASE / "images" / "maiora_20s_02.webp"
TIER_SUFFIXES = tuple(suffix for suffix, _, _ in TIERS)
TIER_ORDER = {suffix: index for index, (suffix, _, _) in enumerate(TIERS)}


def tier_quality(src_path: Path, suffix: str, tier_img: Image.Image, default_q: int) -> int:
    if src_path.name == "maiora_20s_02.webp":
        if suffix == "-480":
            return HERO_480_Q
        return default_q
    if suffix == "-480" and src_path.parent.name == "dest" and tier_img.size[0] >= 480:
        return DELIVERY_TIGHT_480_Q
    return default_q


def hero_mobile_srcset(widths: dict[str, int]) -> str:
    """1x → 480w; 2x/3x → 960w master (downscaled from desktop source, no mid-tier upscale)."""
    entries: list[tuple[int, str]] = []
    rel480 = "images/mobile/maiora_20s_02-480.webp"
    rel960 = "images/mobile/maiora_20s_02.webp"
    if rel480 in widths:
        entries.append((widths[rel480], rel480))
    if rel960 in widths:
        entries.append((widths[rel960], rel960))
    entries.sort(key=lambda item: item[0])
    return ", ".join(f"{path} {width}w" for width, path in entries)


def load_hero_master(src_path: Path) -> Image.Image:
    """Prefer the 960w desktop master when building hero tiers."""
    if src_path.name == "maiora_20s_02.webp" and HERO_SOURCE.is_file():
        return Image.open(HERO_SOURCE).convert("RGB")
    return Image.open(src_path).convert("RGB")


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
    tier_pat = "|".join(re.escape(suffix) for suffix in TIER_SUFFIXES)
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


def build_variants() -> dict[str, int]:
    """Return {relative posix path: pixel width} for every mobile tier + master."""
    widths: dict[str, int] = {}
    total_before = total_after = 0.0

    print("Optimizing mobile WebP assets\n")
    for src_path in iter_mobile_masters():
        img = load_hero_master(src_path)
        w, h = img.size
        before = kb(src_path)

        master_q = HERO_960_Q if src_path.name == "maiora_20s_02.webp" else MOBILE_WEBP_Q
        img.save(src_path, "WEBP", quality=master_q, method=6)
        after_main = kb(src_path)
        rel = src_path.relative_to(BASE).as_posix()
        widths[rel] = img.size[0]
        tier_kb = after_main
        prev_size: tuple[int, int] | None = None

        parts = [f"  {rel:<52} {w}x{h} {before:5.0f}KB -> {after_main:5.0f}KB"]
        for suffix, max_edge, quality in TIERS:
            tier_path = src_path.with_name(src_path.stem + suffix + ".webp")
            tier_img = resize_to_max(img, max_edge)
            if prev_size is not None and tier_img.size == prev_size:
                continue
            if tier_img.size == img.size and suffix != TIERS[-1][0]:
                continue
            q = tier_quality(src_path, suffix, tier_img, quality)
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

    record_dest_desktop_widths(widths)
    MANIFEST_PATH.write_text(json.dumps(widths, indent=2) + "\n", encoding="utf-8")
    print(
        f"\nTotal masters: {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB "
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
) -> str:
    """Build a width-descriptor srcset for a mobile image basename."""
    stem_path = Path(base_posix)
    entries: list[tuple[int, str]] = []
    for suffix, _, _ in TIERS:
        if max_suffix is not None and TIER_ORDER[suffix] > TIER_ORDER[max_suffix]:
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


def patch_dest_srcsets(html: str, widths: dict[str, int]) -> str:
    dest_sizes_tablet = "(min-width: 1101px) 500px, 48vw"

    def repl(match: re.Match[str]) -> str:
        slug = match.group(1)
        base = f"images/mobile/dest/{slug}.webp"
        w480 = widths.get(f"images/mobile/dest/{slug}-480.webp", 480)
        # Portrait card photos need 320/480/640 steps; landscape only needs 480w.
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


def patch_mobile_source(
    html: str,
    widths: dict[str, int],
    *,
    folder: str,
    name: str,
    sizes: str,
    max_suffix: str,
) -> str:
    base = f"images/mobile/{folder + '/' if folder else ''}{name}.webp"
    mobile = srcset_for_base(base, widths, include_master=False, max_suffix=max_suffix)
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

    hero_mobile = hero_mobile_srcset(widths)
    html = re.sub(
        r'<source srcset="[^"]*maiora_20s_02[^"]*" '
        r'sizes="100vw" type="image/webp" media="\(max-width: 640px\)">',
        f'<source srcset="{hero_mobile}" sizes="100vw" type="image/webp" media="(max-width: 640px)">',
        html,
    )
    html = re.sub(
        r'<link rel="preload" as="image" imagesrcset="[^"]*maiora_20s_02[^"]*" '
        r'imagesizes="100vw" type="image/webp" fetchpriority="high" media="\(max-width: 640px\)" />',
        f'<link rel="preload" as="image" imagesrcset="{hero_mobile}" imagesizes="100vw" '
        f'type="image/webp" fetchpriority="high" media="(max-width: 640px)" />',
        html,
    )

    html = patch_mobile_source(
        html, widths, folder="", name="maiora_20s_04", sizes="100vw", max_suffix="-480"
    )

    gallery_names = [
        "maiora_20s_01", "maiora_20s_03", "maiora_20s_07",
        "limitless_aft_dining", "limitless_flybridge", "limitless_sundeck", "limitless_aft_deck",
        "int_saloon_artwork", "int_saloon_marina_view", "int_saloon_reverse",
        "int_master_headboard", "int_master_amber_glow", "int_master_wide",
        "int_vip_cabin", "int_twin_cabin",
    ]
    for name in gallery_names:
        html = patch_mobile_source(
            html, widths, folder="", name=name, sizes="100vw", max_suffix="-480"
        )

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