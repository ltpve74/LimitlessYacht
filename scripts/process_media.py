#!/usr/bin/env python3
"""
Turn ONE chosen source photo into the full set of site-ready derivatives.

This is the single entry point for adding new imagery: pick a shot from the
media library, decide which site slot it fills, and this script emits every
file the site references for that slot — desktop + mobile masters, responsive
WebP tiers, and the blur `-prev.jpg` placeholder — at the exact widths and
quality the existing pipeline uses (mirrors optimize_responsive_images.py and
build_preview_images.py so output is identical to the hand-built assets).

It writes ONLY image files under images/. It never touches index.html, CSS,
JS, locales, or any other source — wiring the new slot into the page is a
separate, deliberate step done by whoever owns the site code.

Usage:
    .venv/bin/python scripts/process_media.py <source> <category> <basename>

    <source>    path to the chosen master (jpg/jpeg/png/webp, full-res)
    <category>  gallery | dest | content | hero   (controls widths + quality)
    <basename>  slot name WITHOUT extension, e.g. maiora_20s_09 (gallery/
                content/hero) or cala-llamp-1 (dest — note the -1 suffix).
                Reuse an existing basename to REPLACE that slot in place
                (site updates with no code change); use a new name for a
                genuinely new slot (needs wiring afterwards).

Examples:
    .venv/bin/python scripts/process_media.py \
        media-library/incoming/IMG_5001.jpeg gallery maiora_20s_09
    .venv/bin/python scripts/process_media.py \
        media-library/incoming/IMG_5002.jpeg dest cala-llamp-1

Requires Pillow:  .venv/bin/pip install pillow
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

BASE = Path(__file__).resolve().parent.parent
IMAGES = BASE / "images"

# ── Per-category spec — mirrors optimize_responsive_images.py exactly ────────
# (desktop_max_edge, jpeg_q, webp_master_q, [(suffix,width,q)...] desktop tiers,
#  mobile_max_edge, mobile_master_q, [(suffix,width,q)...] mobile tiers, subdir)
SPEC = {
    "gallery": dict(
        d_max=1280, jpg_q=88, d_webp_q=86,
        d_tiers=[("-640", 640, 78), ("-960", 960, 76)],
        m_max=960, m_webp_q=82,
        m_tiers=[("-480", 480, 72), ("-720", 720, 74), ("-960", 960, 72)],
        subdir="",
    ),
    "dest": dict(
        d_max=960, jpg_q=88, d_webp_q=86,
        d_tiers=[("-640", 640, 82), ("-960", 960, 80)],
        m_max=960, m_webp_q=84,
        m_tiers=[("-480", 480, 80), ("-720", 720, 82), ("-960", 960, 80)],
        subdir="dest",
    ),
    "content": dict(  # about strip / lifestyle / non-gallery content
        d_max=960, jpg_q=88, d_webp_q=82,
        d_tiers=[("-640", 640, 78), ("-960", 960, 76)],
        m_max=960, m_webp_q=72,
        m_tiers=[("-480", 480, 72), ("-720", 720, 74), ("-960", 960, 72)],
        subdir="",
    ),
    "hero": dict(  # LCP image — replace only with owner sign-off
        d_max=1920, jpg_q=86, d_webp_q=82,
        d_tiers=[("-640", 640, 78), ("-960", 960, 76), ("-1280", 1280, 76)],
        m_max=960, m_webp_q=78,
        m_tiers=[("-480", 480, 74), ("-720", 720, 72), ("-960", 960, 70)],
        subdir="",
    ),
}

# ── Blur preview settings — mirror build_preview_images.py exactly ──────────
PREVIEW_EDGE = 360
PREVIEW_Q = 72
BLUR_WORK_EDGE = 1920
BLUR_PASSES = 1
BLUR_PASS_RATIO = 0.92
PREVIEW_BLUR = 0.85
PREVIEW_SATURATE = 1.03
PREVIEW_BRIGHTNESS = 0.97


def resize_max(img: Image.Image, edge: int) -> Image.Image:
    w, h = img.size
    longest = max(w, h)
    if longest <= edge:
        return img
    s = edge / longest
    return img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def _resize_preview(img: Image.Image, edge: int = PREVIEW_EDGE) -> Image.Image:
    w, h = img.size
    longest = max(w, h)
    if longest <= edge:
        return img
    if longest > edge * 2:  # two-step downscale avoids banding
        mid = edge * 2
        s = mid / longest
        img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        w, h = img.size
    if w >= h:
        nw, nh = edge, round(h * edge / w)
    else:
        nh, nw = edge, round(w * edge / h)
    return img.resize((max(1, nw), max(1, nh)), Image.LANCZOS)


def write_preview(master: Image.Image, out: Path) -> None:
    img = resize_max(master, BLUR_WORK_EDGE)
    radius = PREVIEW_BLUR * max(img.size) / PREVIEW_EDGE
    if radius > 0.05:
        for _ in range(BLUR_PASSES):
            img = img.filter(ImageFilter.GaussianBlur(radius=radius * BLUR_PASS_RATIO))
    img = ImageEnhance.Color(img).enhance(PREVIEW_SATURATE)
    img = ImageEnhance.Brightness(img).enhance(PREVIEW_BRIGHTNESS)
    img = _resize_preview(img)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=PREVIEW_Q, progressive=True, optimize=True, subsampling=0)


def emit(source: Path, category: str, basename: str) -> list[Path]:
    spec = SPEC[category]
    src = Image.open(source).convert("RGB")

    d_dir = IMAGES / spec["subdir"] if spec["subdir"] else IMAGES
    m_dir = IMAGES / "mobile" / spec["subdir"] if spec["subdir"] else IMAGES / "mobile"
    d_dir.mkdir(parents=True, exist_ok=True)
    m_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    # desktop master (jpg + webp) + tiers
    d_master = resize_max(src, spec["d_max"])
    jpg = d_dir / f"{basename}.jpg"
    d_master.save(jpg, "JPEG", quality=spec["jpg_q"], optimize=True); written.append(jpg)
    webp = d_dir / f"{basename}.webp"
    d_master.save(webp, "WEBP", quality=spec["d_webp_q"], method=6); written.append(webp)
    for suffix, width, q in spec["d_tiers"]:
        t = resize_max(d_master, width)
        p = d_dir / f"{basename}{suffix}.webp"
        t.save(p, "WEBP", quality=q, method=6); written.append(p)

    # mobile master (webp) + tiers
    m_master = resize_max(src, spec["m_max"])
    mwebp = m_dir / f"{basename}.webp"
    m_master.save(mwebp, "WEBP", quality=spec["m_webp_q"], method=6); written.append(mwebp)
    for suffix, width, q in spec["m_tiers"]:
        t = resize_max(m_master, width)
        p = m_dir / f"{basename}{suffix}.webp"
        t.save(p, "WEBP", quality=q, method=6); written.append(p)

    # blur previews — desktop + mobile
    for folder in (d_dir, m_dir):
        p = folder / f"{basename}-prev.jpg"
        write_preview(d_master, p); written.append(p)

    return written


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[2] not in SPEC:
        print(__doc__)
        return 2
    source = Path(sys.argv[1])
    category, basename = sys.argv[2], sys.argv[3]
    if not source.is_file():
        print(f"error: source not found: {source}")
        return 1
    if "/" in basename or basename.endswith((".jpg", ".webp", ".png")):
        print("error: <basename> must be a bare slot name, no path or extension")
        return 1
    written = emit(source, category, basename)
    print(f"[{category}] {source.name} -> {basename}: {len(written)} files")
    for p in written:
        print(f"  {p.relative_to(BASE).as_posix():<48} {p.stat().st_size/1024:6.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
