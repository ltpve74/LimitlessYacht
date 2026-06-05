"""
Generate web-ready destination card assets (jpg + webp) for the Destinations section cards (recalculated at 16 knots, west-coast multi-day redesign, circumnavigation, Ibiza crossing).

Sources:
  - Downloaded free-license masters in media-library/destinations/<slug>/
  - Existing project place_* assets copied in for continuity (portals, cala-llamp, es-trenc, sa-calobra)

Each source is resized so longest edge <= MAX_EDGE (1600) and written as
<slug>-N.jpg + <slug>-N.webp into images/dest/, printing final dims for markup.

Run: .venv/bin/python scripts/build_destination_assets.py
"""

import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST_DIR = os.path.join(BASE, "media-library", "destinations")
OUT_DIR = os.path.join(BASE, "images", "dest")
MAX_EDGE = 1600

# slug -> list of (out_index, source_path)  -- index 1 = hero for the card
JOBS = {
    "portals-vells": [
        (1, os.path.join(DEST_DIR, "portals-vells", "01_portals_vells_existing.jpg")),
        (2, os.path.join(DEST_DIR, "portals-vells", "02_portals_pano.jpg")),
    ],
    "el-toro-malgrats": [
        (1, os.path.join(DEST_DIR, "el-toro-malgrats", "01_el_toro_rocky_pexels.jpg")),
        (2, os.path.join(DEST_DIR, "el-toro-malgrats", "02_el_toro_waterfront_pexels.jpg")),
    ],
    "cala-llamp": [
        (1, os.path.join(DEST_DIR, "cala-llamp", "01_cala_llamp_existing.jpg")),
        (2, os.path.join(DEST_DIR, "cala-llamp", "02_cala_llamp_cliff_pexels.jpg")),
    ],
    "sa-dragonera": [
        (1, os.path.join(DEST_DIR, "sa-dragonera", "01_dragonera.jpg")),
        (2, os.path.join(DEST_DIR, "sa-dragonera", "02_dragonera_harbour.jpg")),
        (3, os.path.join(DEST_DIR, "sa-dragonera", "03_dragonera_sunset_pexels.jpg")),
    ],
    "es-trenc": [
        (1, os.path.join(DEST_DIR, "es-trenc", "01_es_trenc_beach.jpg")),
        (2, os.path.join(DEST_DIR, "es-trenc", "02_es_trenc_existing.jpg")),
        (3, os.path.join(DEST_DIR, "es-trenc", "03_es_trenc_aerial_pexels.jpg")),
        (4, os.path.join(DEST_DIR, "es-trenc", "04_es_trenc_covetes_pexels.jpg")),
    ],
    "cabrera": [
        (1, os.path.join(DEST_DIR, "cabrera", "01_cabrera_view.jpg")),
        (2, os.path.join(DEST_DIR, "cabrera", "02_cabrera_fort.jpg")),
    ],
    "calo-des-moro": [
        (1, os.path.join(DEST_DIR, "calo-des-moro", "01_calo_des_moro.jpg")),
        (2, os.path.join(DEST_DIR, "calo-des-moro", "02_calo_aerial_pexels.jpg")),
    ],
    "sa-calobra": [
        (1, os.path.join(DEST_DIR, "sa-calobra", "01_sa_calobra_cala.jpg")),
        (2, os.path.join(DEST_DIR, "sa-calobra", "02_sa_calobra_existing.jpg")),
        (3, os.path.join(DEST_DIR, "sa-calobra", "03_sa_calobra_road_pexels.jpg")),
    ],
    "formentera": [
        (1, os.path.join(DEST_DIR, "formentera", "01_ses_illetes.jpg")),
        (2, os.path.join(DEST_DIR, "formentera", "02_formentera_beach_pexels.jpg")),
        (3, os.path.join(DEST_DIR, "formentera", "03_formentera_boat_pexels.jpg")),
    ],
    "cala-pi": [
        (1, os.path.join(DEST_DIR, "cala-pi", "01_cala_pi_beach.jpg")),
        (2, os.path.join(DEST_DIR, "cala-pi", "02_cala_pi_view.jpg")),
        (3, os.path.join(DEST_DIR, "cala-pi", "03_cala_pi_panorama.jpg")),
    ],
    "circumnavigation": [
        (1, os.path.join(DEST_DIR, "circumnavigation", "west_mallorca_coastline.jpeg")),
    ],
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


os.makedirs(OUT_DIR, exist_ok=True)
print(f"Writing destination derivatives into: {OUT_DIR}\n")

for slug, jobs in JOBS.items():
    for idx, src in jobs:
        if not os.path.exists(src):
            print(f"  MISSING {slug}-{idx}: {src}")
            continue
        img = Image.open(src).convert("RGB")
        img = resize_to_max(img, MAX_EDGE)
        w, h = img.size
        base = f"{slug}-{idx}"
        jpg = os.path.join(OUT_DIR, base + ".jpg")
        webp = os.path.join(OUT_DIR, base + ".webp")
        img.save(jpg, "JPEG", quality=86, optimize=True)
        img.save(webp, "WEBP", quality=82, method=6)
        print(f"  {base:<22} {w}x{h}   -> .jpg + .webp")

print("\nDone. Use the printed width/height (for -1 heroes) in the card markup.")
print("Lightbox counts per card = number of N files generated for that slug.")
