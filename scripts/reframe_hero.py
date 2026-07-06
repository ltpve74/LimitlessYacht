#!/usr/bin/env python3
"""Compose viewport-specific hero masters from the full-res top-down source.

Validates each frame against real viewport sizes + object-fit:cover crop so the
boat stays inside the hero middle band and clear of UI overlays.

Outputs (process_media hero):
  maiora_20s_18    — desktop (1920×1080, horizontal boat)
  maiora_20s_18ph  — short phone ≤739px tall (1080×1920, horizontal boat)
  maiora_20s_18pv  — tall phone ≥740px (1080×2340, vertical boat, bow down)
  maiora_20s_18p   — tablet portrait ≥768px (1080×1920, vertical boat, bow down)

Usage:
    .venv/bin/python scripts/reframe_hero.py [source.jpg]
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / ".venv/bin/python3"
PROC = ROOT / "scripts/process_media.py"

SIDE_MARGIN = 0.08
HULL_PAD = 12


@dataclass(frozen=True)
class Viewport:
    w: int
    h: int
    top_ui: float
    bottom_ui: float


# Measured from Playwright on mobile cinema + desktop layouts.
PHONE_TALL_VPS = (
    Viewport(360, 740, 0.14, 0.34),
    Viewport(393, 786, 0.14, 0.32),
    Viewport(390, 844, 0.13, 0.30),
    Viewport(393, 852, 0.13, 0.29),
    Viewport(412, 915, 0.12, 0.27),
    Viewport(430, 932, 0.12, 0.26),
    Viewport(768, 1024, 0.11, 0.20),
)
PHONE_SHORT_VPS = (Viewport(375, 667, 0.16, 0.40),)
TABLET_VPS = (Viewport(820, 1180, 0.38, 0.24),)
DESKTOP_VPS = (Viewport(1280, 900, 0.34, 0.22),)


def water_fill_color(im: Image.Image) -> tuple[int, int, int]:
    arr = np.asarray(im.convert("RGB"))
    patches = [arr[:48, :48], arr[:48, -48:], arr[-48:, :48], arr[-48:, -48:]]
    med = np.median(np.concatenate([p.reshape(-1, 3) for p in patches]), axis=0)
    return tuple(int(x) for x in med)


def boat_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    water = (g > r) & (g > b * 0.9) & (g > 80)
    ys, xs = np.where(~water)
    if len(xs) == 0:
        w, h = im.size
        return 0, 0, w, h
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def cover_window(img_w: int, img_h: int, vp_w: int, vp_h: int) -> tuple[float, float, float, float]:
    """Visible region of the composed image under object-fit:cover; center position."""
    img_ar = img_w / img_h
    vp_ar = vp_w / vp_h
    if vp_ar >= img_ar:
        scale = vp_w / img_w
        vis_h = vp_h / scale
        crop_y = (img_h - vis_h) / 2
        return 0.0, crop_y, float(img_w), crop_y + vis_h
    scale = vp_h / img_h
    vis_w = vp_w / scale
    crop_x = (img_w - vis_w) / 2
    return crop_x, 0.0, crop_x + vis_w, float(img_h)


def boat_fits_viewports(
    boat: tuple[int, int, int, int],
    img_w: int,
    img_h: int,
    viewports: tuple[Viewport, ...],
    *,
    side_margin: float,
) -> bool:
    bx0, by0, bx1, by1 = boat
    bcx = (bx0 + bx1) / 2
    for vp in viewports:
        cx0, cy0, cx1, cy1 = cover_window(img_w, img_h, vp.w, vp.h)
        if bx0 < cx0 + img_w * side_margin:
            return False
        if bx1 > cx1 - img_w * side_margin:
            return False
        if by0 < cy0 + img_h * vp.top_ui:
            return False
        if by1 > cy1 - img_h * vp.bottom_ui:
            return False
        vis_cx = (cx0 + cx1) / 2
        if abs(bcx - vis_cx) > img_w * 0.06:
            return False
    return True


def compose_framed(
    src: Image.Image,
    out_w: int,
    out_h: int,
    *,
    top_ui: float,
    bottom_ui: float,
    boat_center_y_frac: float,
    viewports: tuple[Viewport, ...],
    side_margin: float = SIDE_MARGIN,
    tight_crop: bool = False,
) -> Image.Image:
    """Scale source so the whole boat fits in safe bands; fill with sampled water."""
    src = ImageOps.exif_transpose(src).convert("RGB")
    fill = water_fill_color(src)
    if tight_crop:
        x0, y0, x1, y1 = boat_bbox(src)
        pad_x = int((x1 - x0) * 0.28)
        pad_y = int((y1 - y0) * 0.28)
        w, h = src.size
        src = src.crop(
            (
                max(0, x0 - pad_x),
                max(0, y0 - pad_y),
                min(w, x1 + pad_x),
                min(h, y1 + pad_y),
            )
        )
    x0, y0, x1, y1 = boat_bbox(src)
    bcx = (x0 + x1) / 2
    bcy = (y0 + y1) / 2
    bw = max(x1 - x0, 1)
    bh = max(y1 - y0, 1)

    safe_w = out_w * (1 - 2 * side_margin)
    safe_h = out_h * (1 - top_ui - bottom_ui)
    safe_top = out_h * top_ui
    safe_bottom = out_h * (1 - bottom_ui)

    base_scale = min(safe_w / bw, safe_h / bh)
    tcx = out_w / 2
    tcy = out_h * boat_center_y_frac

    def layout(scale: float) -> tuple[Image.Image, tuple[int, int, int, int]]:
        sw, sh = max(1, round(src.size[0] * scale)), max(1, round(src.size[1] * scale))
        scaled = src.resize((sw, sh), Image.LANCZOS)
        paste_x = round(tcx - bcx * scale)
        paste_y = round(tcy - bcy * scale)

        boat_top = paste_y + y0 * scale
        boat_bot = paste_y + y1 * scale
        if boat_top < safe_top:
            paste_y += round(safe_top - boat_top)
        if boat_bot > safe_bottom:
            paste_y -= round(boat_bot - safe_bottom)
        boat_left = paste_x + x0 * scale
        boat_right = paste_x + x1 * scale
        if boat_left < out_w * side_margin:
            paste_x += round(out_w * side_margin - boat_left)
        if boat_right > out_w * (1 - side_margin):
            paste_x -= round(boat_right - out_w * (1 - side_margin))

        cover = max(out_w / sw, out_h / sh, 1.0)
        if cover > 1.0:
            return layout(scale * cover)

        canvas = Image.new("RGB", (out_w, out_h), fill)
        canvas.paste(scaled, (paste_x, paste_y))
        return canvas, boat_bbox(canvas)

    canvas = None
    boat = (0, 0, out_w, out_h)
    for attempt in range(16):
        scale = base_scale * (0.93 ** attempt)
        canvas, boat = layout(scale)
        if (
            boat[0] > HULL_PAD
            and boat[1] > HULL_PAD
            and boat[2] < out_w - HULL_PAD
            and boat[3] < out_h - HULL_PAD
            and boat[1] >= safe_top
            and boat[3] <= safe_bottom
            and boat_fits_viewports(boat, out_w, out_h, viewports, side_margin=side_margin)
        ):
            return canvas
    assert canvas is not None
    return canvas


def reframe_desktop(src: Image.Image) -> Image.Image:
    return compose_framed(
        src, 1920, 1080,
        top_ui=0.34, bottom_ui=0.24,
        boat_center_y_frac=0.58,
        viewports=DESKTOP_VPS,
        side_margin=0.07,
    )


def reframe_phone_short(src: Image.Image) -> Image.Image:
    return compose_framed(
        src, 1080, 1920,
        top_ui=0.16, bottom_ui=0.40,
        boat_center_y_frac=0.38,
        viewports=PHONE_SHORT_VPS,
        side_margin=0.07,
        tight_crop=True,
    )


def reframe_phone_tall(src: Image.Image) -> Image.Image:
    rot = ImageOps.exif_transpose(src).convert("RGB").rotate(-90, expand=True)
    return compose_framed(
        rot, 1080, 2340,
        top_ui=0.14, bottom_ui=0.34,
        boat_center_y_frac=0.40,
        viewports=PHONE_TALL_VPS,
        side_margin=0.07,
        tight_crop=True,
    )


def reframe_tablet_portrait(src: Image.Image) -> Image.Image:
    rot = ImageOps.exif_transpose(src).convert("RGB").rotate(-90, expand=True)
    return compose_framed(
        rot, 1080, 1920,
        top_ui=0.40, bottom_ui=0.24,
        boat_center_y_frac=0.60,
        viewports=TABLET_VPS,
        side_margin=0.08,
        tight_crop=True,
    )


def main() -> int:
    if len(sys.argv) > 1:
        src_path = Path(sys.argv[1])
    else:
        src_path = ROOT / "images/maiora_20s_18-source.jpg"
    if not src_path.is_file():
        fallback = ROOT / "media-library/incoming/video-frames/1/best_last_frame.jpg"
        if fallback.is_file():
            src_path = fallback
        if not src_path.is_file():
            print(f"error: source not found: {src_path}")
            return 1

    src = Image.open(src_path)
    jobs_img = [
        (reframe_desktop(src), "maiora_20s_18"),
        (reframe_phone_short(src), "maiora_20s_18ph"),
        (reframe_phone_tall(src), "maiora_20s_18pv"),
        (reframe_tablet_portrait(src), "maiora_20s_18p"),
    ]
    for im, slot in jobs_img:
        print(f"  {slot}: {im.size[0]}×{im.size[1]}", end="")
        x0, y0, x1, y1 = boat_bbox(im)
        print(f"  boat {x0},{y0}–{x1},{y1}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for im, slot in jobs_img:
            path = tmp / f"{slot}.jpg"
            im.save(path, "JPEG", quality=95, optimize=True)
            subprocess.run([str(PY), str(PROC), str(path), "hero", slot], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())