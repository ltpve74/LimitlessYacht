"""
Optimize the 12 referenced destination hero images (<slug>-1.jpg/.webp) for the
web: resize longest edge to 1200px and re-encode at sensible quality, overwriting
in place. These render as destination-card backgrounds; 1600px was ~2x oversized.

Run: .venv/bin/python scripts/optimize_dest_images.py
"""

import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(BASE, "images", "dest")
MAX_EDGE = 1200

SLUGS = [
    "portals-vells", "el-toro-malgrats", "cala-llamp", "sa-dragonera",
    "cala-pi", "es-trenc", "cabrera", "calo-des-moro",
    "sa-calobra", "circumnavigation", "formentera", "menorca",
]

def kb(path):
    return os.path.getsize(path) / 1024

def resize(img):
    w, h = img.size
    if max(w, h) <= MAX_EDGE:
        return img
    if w >= h:
        nw, nh = MAX_EDGE, round(h * MAX_EDGE / w)
    else:
        nh, nw = MAX_EDGE, round(w * MAX_EDGE / h)
    return img.resize((nw, nh), Image.LANCZOS)

total_before = total_after = 0
print(f"Optimizing {len(SLUGS)} destination heroes in {DEST}\n")
dims = {}
for slug in SLUGS:
    base = os.path.join(DEST, slug + "-1")
    jpg, webp = base + ".jpg", base + ".webp"
    src = jpg if os.path.exists(jpg) else webp
    img = Image.open(src).convert("RGB")
    img = resize(img)
    w, h = img.size
    dims[slug] = (w, h)
    before = (kb(jpg) if os.path.exists(jpg) else 0) + (kb(webp) if os.path.exists(webp) else 0)
    img.save(jpg, "JPEG", quality=82, optimize=True)
    img.save(webp, "WEBP", quality=80, method=6)
    after = kb(jpg) + kb(webp)
    total_before += before
    total_after += after
    print(f"  {slug:<18} {w}x{h}   {before:6.0f}KB -> {after:6.0f}KB")

print(f"\nTotal (jpg+webp): {total_before/1024:.2f}MB -> {total_after/1024:.2f}MB "
      f"({100*(1-total_after/total_before):.0f}% smaller)")
print("\nDimensions (for <img> width/height):")
for slug, (w, h) in dims.items():
    print(f"  {slug}: {w}x{h}")
