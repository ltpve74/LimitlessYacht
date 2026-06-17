#!/usr/bin/env python3
"""Patch index.html card srcsets from images/mobile/_srcset-widths.json (no PIL)."""

from __future__ import annotations

import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
MANIFEST = BASE / "images" / "mobile" / "_srcset-widths.json"

DEST_MOBILE_TIERS = (
    ("-480", 480, 68),
    ("-720", 720, 72),
    ("-960", 960, 70),
)
GALLERY_MOBILE_TIERS = (
    ("-480", 480, 72),
    ("-720", 720, 74),
    ("-960", 960, 72),
)
DEST_CARD_DESKTOP_TIERS = (("-640", 640, 76), ("-960", 960, 74))
GALLERY_CARD_DESKTOP_TIERS = (("-640", 640, 78), ("-960", 960, 76))
DESKTOP_GALLERY_TIERS = GALLERY_CARD_DESKTOP_TIERS

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


def srcset_for_base(
    base_posix: str,
    widths: dict[str, int],
    *,
    include_master: bool,
    max_suffix: str | None,
    tiers: tuple[tuple[str, int, int], ...],
) -> str:
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


def desktop_tier_srcset(
    stem: str,
    widths: dict[str, int],
    *,
    folder: str = "images",
    tiers: tuple[tuple[str, int, int], ...] = DESKTOP_CONTENT_TIERS,
) -> str:
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


def patch_dest_srcsets(html: str, widths: dict[str, int]) -> str:
    dest_sizes = "(min-width: 1101px) 500px, 48vw"

    def repl(match: re.Match[str]) -> str:
        stem = match.group(1)
        mobile = srcset_for_base(
            f"images/mobile/dest/{stem}.webp",
            widths,
            include_master=True,
            max_suffix="-960",
            tiers=DEST_MOBILE_TIERS,
        )
        desktop = desktop_tier_srcset(
            stem, widths, folder="images/dest", tiers=DEST_CARD_DESKTOP_TIERS
        )
        return (
            f'<source type="image/webp" media="(max-width: 640px)" '
            f'srcset="{mobile}" sizes="78vw" />\n            '
            f'<source type="image/webp" srcset="{desktop}" sizes="{dest_sizes}" />'
        )

    def repl_from_img(match: re.Match[str]) -> str:
        stem = match.group(1)
        mobile = srcset_for_base(
            f"images/mobile/dest/{stem}.webp",
            widths,
            include_master=True,
            max_suffix="-960",
            tiers=DEST_MOBILE_TIERS,
        )
        desktop = desktop_tier_srcset(
            stem, widths, folder="images/dest", tiers=DEST_CARD_DESKTOP_TIERS
        )
        return (
            f'<picture class="destination-card-bg">\n            '
            f'<source type="image/webp" media="(max-width: 640px)" '
            f'srcset="{mobile}" sizes="78vw" />\n            '
            f'<source type="image/webp" srcset="{desktop}" sizes="{dest_sizes}" />\n            '
            f'<img loading="lazy" decoding="async" src="images/dest/{stem}.jpg"'
        )

    html = re.sub(
        r'<picture class="destination-card-bg">\s*'
        r'<source type="image/webp" media="\(max-width: 640px\)" '
        r'srcset="[^"]*" sizes="78vw" />\s*'
        r'<source type="image/webp" srcset="[^"]*" sizes="[^"]*" />\s*'
        r'<img loading="lazy" decoding="async" src="images/dest/([a-z0-9-]+)\.jpg"',
        repl_from_img,
        html,
    )
    # Single-master legacy cards only (do not re-match multi-tier srcsets).
    return re.sub(
        r'<source type="image/webp" media="\(max-width: 640px\)" '
        r'srcset="images/mobile/dest/([a-z0-9-]+)\.webp" />\s*'
        r'<source type="image/webp" srcset="images/dest/\1\.webp" />',
        repl,
        html,
    )


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
    desktop = desktop_tier_srcset(name, widths)
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


def main() -> None:
    widths = json.loads(MANIFEST.read_text(encoding="utf-8"))
    index = BASE / "index.html"
    html = index.read_text(encoding="utf-8")
    original = html
    html = patch_dest_srcsets(html, widths)
    for name, featured in GALLERY_ITEMS:
        html = patch_gallery_picture(html, name, featured, widths)
    if html == original:
        print("index.html card srcsets already up to date")
        return
    index.write_text(html, encoding="utf-8")
    print("Updated card srcsets in index.html from manifest")


if __name__ == "__main__":
    main()