"""
Generate 1x/2x/3x WebP candidates for mobile images and sync picture srcsets.

Cards render at ~78vw (~320px) on phones; gallery/about use full column width.
Tiers use longest-edge caps: -480 (1x), -960 (2x), -1440 (3x, capped to source).

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
    ("-480", 480, 72),
    ("-960", 960, 74),
    ("-1440", 1440, 76),
)
MOBILE_WEBP_Q = 75


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
    for root, _, files in os.walk(MOBILE):
        for name in sorted(files):
            if not name.endswith(".webp"):
                continue
            if re.search(r"-(?:480|960|1440)\.webp$", name):
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
        img = Image.open(src_path).convert("RGB")
        w, h = img.size
        before = kb(src_path)

        img.save(src_path, "WEBP", quality=MOBILE_WEBP_Q, method=6)
        after_main = kb(src_path)
        rel = src_path.relative_to(BASE).as_posix()
        widths[rel] = img.size[0]
        tier_kb = after_main

        parts = [f"  {rel:<52} {w}x{h} {before:5.0f}KB -> {after_main:5.0f}KB"]
        for suffix, max_edge, quality in TIERS:
            tier_path = src_path.with_name(src_path.stem + suffix + ".webp")
            tier_img = resize_to_max(img, max_edge)
            if tier_img.size == img.size and suffix != TIERS[-1][0]:
                continue
            tier_img.save(tier_path, "WEBP", quality=quality, method=6)
            tw, th = tier_img.size
            tier_kb += kb(tier_path)
            tier_rel = tier_path.relative_to(BASE).as_posix()
            widths[tier_rel] = tw
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
        if max_suffix is not None and suffix > max_suffix:
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


def write_srcsets(widths: dict[str, int]) -> None:
    index = BASE / "index.html"
    html = index.read_text(encoding="utf-8")
    original = html

    dest_sizes_tablet = '(min-width: 1101px) 500px, 48vw'

    def replace_dest_card(match: re.Match[str]) -> str:
        slug = match.group(1)
        base = f"images/mobile/dest/{slug}.webp"
        mobile = srcset_for_base(base, widths, include_master=False, max_suffix="-960")
        desktop_w = widths.get(f"images/dest/{slug}.webp")
        desktop = f"images/dest/{slug}.webp {desktop_w or 800}w"
        return (
            f'<source type="image/webp" media="(max-width: 640px)" '
            f'srcset="{mobile}" sizes="78vw" />\n            '
            f'<source type="image/webp" srcset="{desktop}" sizes="{dest_sizes_tablet}" />'
        )

    html = re.sub(
        r'<source type="image/webp" media="\(max-width: 640px\)" '
        r'srcset="images/mobile/dest/([a-z0-9-]+)-480\.webp 480w, images/mobile/dest/\1\.webp 800w" '
        r'sizes="78vw" />\s*'
        r'<source type="image/webp" srcset="images/dest/\1\.webp \d+w" sizes="500px" />',
        replace_dest_card,
        html,
    )

    def replace_mobile_block(match: re.Match[str]) -> str:
        folder = match.group(1)
        name = match.group(2)
        sizes = match.group(3)
        base = f"images/mobile/{folder + '/' if folder else ''}{name}.webp"
        mobile = srcset_for_base(base, widths, include_master=False, max_suffix="-960")
        return (
            f'<source type="image/webp" media="(max-width: 640px)" '
            f'srcset="{mobile}" sizes="{sizes}" />'
        )

    html = re.sub(
        r'<source type="image/webp" media="\(max-width: 640px\)" '
        r'srcset="images/mobile/((?:dest/)?)([a-z0-9_]+)-480\.webp 480w, images/mobile/\1\2\.webp 800w" '
        r'sizes="([^"]+)" />',
        replace_mobile_block,
        html,
    )

    hero_mobile = srcset_for_base(
        "images/mobile/maiora_20s_02.webp", widths, include_master=False, max_suffix="-1440"
    )
    html = re.sub(
        r'<source srcset="images/mobile/maiora_20s_02-480\.webp 480w, images/mobile/maiora_20s_02\.webp 800w" '
        r'sizes="100vw" type="image/webp" media="\(max-width: 640px\)">',
        f'<source srcset="{hero_mobile}" sizes="100vw" type="image/webp" media="(max-width: 640px)">',
        html,
    )
    html = re.sub(
        r'<link rel="preload" as="image" href="images/mobile/maiora_20s_02\.webp" '
        r'type="image/webp" fetchpriority="high" media="\(max-width: 640px\)" />',
        f'<link rel="preload" as="image" imagesrcset="{hero_mobile}" imagesizes="100vw" '
        f'type="image/webp" fetchpriority="high" media="(max-width: 640px)" />',
        html,
    )

    if html == original:
        raise SystemExit("write-srcset: no picture sources were updated — check patterns")

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