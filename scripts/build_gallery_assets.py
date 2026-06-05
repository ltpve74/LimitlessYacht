"""
Generate web-ready gallery derivatives (jpg + webp) for the new images that
are NOT yet in the flat deploy folder `images/`.

Sources:
  - The 8 colour-corrected interiors in unused media/chosen-interior_processed/
  - One lifestyle/destination shot (sunset above the clouds): media-library/IMG_3193.jpeg

Each source is resized so its longest edge is <= MAX_EDGE and written as both a
JPEG and a WebP into images/, printing final width/height for the <img> tags.
"""

import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROCESSED_DIR = os.path.join(BASE, "media-library", "chosen-interior_processed")
OUT_DIR = os.path.join(BASE, "images")
MAX_EDGE = 1280

# output basename (without extension)  ->  source absolute path
JOBS = {
    "int_master_amber_glow":   os.path.join(PROCESSED_DIR, "01_master_amber_glow.jpg"),
    "int_twin_cabin":          os.path.join(PROCESSED_DIR, "02_twin_cabin.jpg"),
    "int_master_headboard":    os.path.join(PROCESSED_DIR, "03_master_headboard.jpg"),
    "int_master_wide":         os.path.join(PROCESSED_DIR, "04_master_wide.jpg"),
    "int_vip_cabin":           os.path.join(PROCESSED_DIR, "05_vip_cabin.jpg"),
    "int_saloon_artwork":      os.path.join(PROCESSED_DIR, "06_saloon_artwork.jpg"),
    "int_saloon_reverse":      os.path.join(PROCESSED_DIR, "07_saloon_reverse.jpg"),
    "int_saloon_marina_view":  os.path.join(PROCESSED_DIR, "08_saloon_marina_view.jpg"),
    "lifestyle_sunset":        os.path.join(BASE, "media-library", "IMG_3193.jpeg"),
}


def resize_to_max(img, max_edge):
    w, h = img.size
    if max(w, h) <= max_edge:
        return img
    if w >= h:
        nw, nh = max_edge, round(h * max_edge / w)
    else:
        nh, nw = max_edge, round(w * max_edge / h)
    return img.resize((nw, nh), Image.LANCZOS)


print(f"Writing derivatives into: {OUT_DIR}\n")
for name, src in JOBS.items():
    img = Image.open(src).convert("RGB")
    img = resize_to_max(img, MAX_EDGE)
    w, h = img.size
    jpg = os.path.join(OUT_DIR, name + ".jpg")
    webp = os.path.join(OUT_DIR, name + ".webp")
    img.save(jpg, "JPEG", quality=86, optimize=True)
    img.save(webp, "WEBP", quality=82, method=6)
    print(f"  {name:<26} {w}x{h}   -> .jpg + .webp")

print("\nDone. Use the printed width/height in the <img> tags.")
