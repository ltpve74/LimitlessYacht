"""
Generate 480w WebP candidates for mobile carousel images and recompress
oversized mobile heroes. Cards render at ~78vw (~390px); gallery carousel
is full-width on mobile.

Run: .venv/bin/python scripts/optimize_responsive_images.py
"""

import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SMALL_EDGE = 480
MOBILE_WEBP_Q = 75
SMALL_WEBP_Q = 72


def kb(path):
    return os.path.getsize(path) / 1024


def resize_to_max(img, max_edge):
    w, h = img.size
    if max(w, h) <= max_edge:
        return img
    if w >= h:
        nw, nh = max_edge, round(h * max_edge / w)
    else:
        nh, nw = max_edge, round(w * max_edge / h)
    return img.resize((nw, nh), Image.LANCZOS)


def process_webp(src_path, make_small=True, recompress=True):
    img = Image.open(src_path).convert("RGB")
    w, h = img.size
    before = kb(src_path)

    if recompress:
        img.save(src_path, "WEBP", quality=MOBILE_WEBP_Q, method=6)
    after_main = kb(src_path)

    small_path = None
    small_after = 0
    if make_small:
        small_path = src_path.replace(".webp", "-480.webp")
        small = resize_to_max(img, SMALL_EDGE)
        small.save(small_path, "WEBP", quality=SMALL_WEBP_Q, method=6)
        small_after = kb(small_path)
        sw, sh = small.size
        print(f"  {os.path.relpath(src_path, BASE):<48} {w}x{h} {before:5.0f}KB -> {after_main:5.0f}KB"
              f"  + -480 ({sw}x{sh}) {small_after:5.0f}KB")
    else:
        print(f"  {os.path.relpath(src_path, BASE):<48} {w}x{h} {before:5.0f}KB -> {after_main:5.0f}KB")

    return before, after_main + small_after


def iter_mobile_webps():
    mobile = os.path.join(BASE, "images", "mobile")
    for root, _, files in os.walk(mobile):
        for name in sorted(files):
            if not name.endswith(".webp") or name.endswith("-480.webp"):
                continue
            yield os.path.join(root, name)


print("Optimizing mobile WebP assets\n")
total_before = total_after = 0
for path in iter_mobile_webps():
    b, a = process_webp(path)
    total_before += b
    total_after += a

print(f"\nTotal: {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB "
      f"({100*(1-total_after/total_before):.0f}% smaller)")