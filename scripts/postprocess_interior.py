"""
Interior photo post-processing for Limitless yacht.
Applies: white balance correction, exposure lift, contrast, shadow recovery,
saturation control, and mild sharpening.

Input:  media-library/chosen-interior/        (the 8 final chosen shots)
Output: media-library/chosen-interior_processed/
"""

import os
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

# Resolve project root from this script's location (scripts/ -> project root),
# so it keeps working if the project folder is moved.
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_DIR = os.path.join(BASE, "media-library", "chosen-interior")
OUTPUT_DIR = os.path.join(BASE, "media-library", "chosen-interior_processed")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Descriptive output name -> source filename in chosen-interior/
TOP_PICKS = {
    "01_master_amber_glow.jpg":   "36459b80-c34f-45d9-b6ae-c990d1daa6d6.jpeg",
    "02_twin_cabin.jpg":          "5806522e-f36e-4000-bac2-3b8c45b2a3bf.jpeg",
    "03_master_headboard.jpg":    "5c57e954-c067-4980-bf42-0039da0859a2.jpeg",
    "04_master_wide.jpg":         "687bf315-0b85-434b-8c65-cdde3e93ae90.jpeg",
    "05_vip_cabin.jpg":           "b305e60c-e46d-45ab-b5c7-e4a1a579a398.jpeg",
    "06_saloon_artwork.jpg":      "b52841e8-d8e1-4352-a9ea-b0b1c358ded1.jpeg",
    "07_saloon_reverse.jpg":      "d73ac06b-ec36-47b7-84bb-d4a26287a2f9.jpeg",
    "08_saloon_marina_view.jpg":  "e1ef76b2-8250-4ad2-9190-b4ed0a263ad6.jpeg",
}

def white_balance_correction(img_array, strength=0.55):
    """
    Reduce heavy orange/warm cast by pulling red channel down and
    boosting blue channel slightly. Strength 0–1.
    """
    arr = img_array.astype(np.float32)
    # Calculate per-channel means
    r_mean = arr[:, :, 0].mean()
    g_mean = arr[:, :, 1].mean()
    b_mean = arr[:, :, 2].mean()
    overall = (r_mean + g_mean + b_mean) / 3.0

    # Scale factors to bring channels toward grey-world neutral
    r_scale = (overall / r_mean - 1.0) * strength + 1.0
    g_scale = (overall / g_mean - 1.0) * strength + 1.0
    b_scale = (overall / b_mean - 1.0) * strength + 1.0

    arr[:, :, 0] = np.clip(arr[:, :, 0] * r_scale, 0, 255)
    arr[:, :, 1] = np.clip(arr[:, :, 1] * g_scale, 0, 255)
    arr[:, :, 2] = np.clip(arr[:, :, 2] * b_scale, 0, 255)
    return arr.astype(np.uint8)

def lift_shadows(img_array, lift=18):
    """Lift dark shadows by adding a base floor to all pixels."""
    arr = img_array.astype(np.int16)
    arr = np.clip(arr + lift, 0, 255)
    return arr.astype(np.uint8)

def process_image(src_path, dst_path, settings):
    img = Image.open(src_path).convert("RGB")
    arr = np.array(img)

    # 1. White balance
    arr = white_balance_correction(arr, strength=settings.get("wb_strength", 0.55))

    # 2. Shadow lift
    arr = lift_shadows(arr, lift=settings.get("shadow_lift", 15))

    img = Image.fromarray(arr)

    # 3. Brightness
    img = ImageEnhance.Brightness(img).enhance(settings.get("brightness", 1.08))

    # 4. Contrast
    img = ImageEnhance.Contrast(img).enhance(settings.get("contrast", 1.18))

    # 5. Saturation
    img = ImageEnhance.Color(img).enhance(settings.get("saturation", 0.92))

    # 6. Sharpness (mild)
    img = ImageEnhance.Sharpness(img).enhance(settings.get("sharpness", 1.25))

    # 7. Very subtle unsharp mask for detail
    img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=3))

    img.save(dst_path, "JPEG", quality=95, optimize=True)
    print(f"  Saved: {os.path.basename(dst_path)}")

# Per-image tuning. Cabins carry a heavier tungsten/amber cast, so they get
# stronger WB correction; saloon shots are a touch cooler already.
SETTINGS = {
    "01_master_amber_glow.jpg":  {"wb_strength": 0.60, "shadow_lift": 6, "brightness": 1.02, "contrast": 1.12, "saturation": 0.90, "sharpness": 1.20},
    "02_twin_cabin.jpg":         {"wb_strength": 0.58, "shadow_lift": 5, "brightness": 1.02, "contrast": 1.12, "saturation": 0.90, "sharpness": 1.18},
    "03_master_headboard.jpg":   {"wb_strength": 0.58, "shadow_lift": 5, "brightness": 1.01, "contrast": 1.10, "saturation": 0.90, "sharpness": 1.18},
    "04_master_wide.jpg":        {"wb_strength": 0.55, "shadow_lift": 5, "brightness": 1.01, "contrast": 1.10, "saturation": 0.91, "sharpness": 1.18},
    "05_vip_cabin.jpg":          {"wb_strength": 0.58, "shadow_lift": 5, "brightness": 1.01, "contrast": 1.10, "saturation": 0.90, "sharpness": 1.18},
    "06_saloon_artwork.jpg":     {"wb_strength": 0.45, "shadow_lift": 6, "brightness": 1.02, "contrast": 1.08, "saturation": 0.93, "sharpness": 1.15},
    "07_saloon_reverse.jpg":     {"wb_strength": 0.45, "shadow_lift": 6, "brightness": 1.02, "contrast": 1.08, "saturation": 0.93, "sharpness": 1.15},
    "08_saloon_marina_view.jpg": {"wb_strength": 0.48, "shadow_lift": 7, "brightness": 1.02, "contrast": 1.10, "saturation": 0.92, "sharpness": 1.15},
}

print(f"Processing {len(TOP_PICKS)} images into:\n  {OUTPUT_DIR}\n")
for out_name, src_name in TOP_PICKS.items():
    src = os.path.join(INPUT_DIR, src_name)
    dst = os.path.join(OUTPUT_DIR, out_name)
    s = SETTINGS.get(out_name, {})
    print(f"Processing {out_name}...")
    process_image(src, dst, s)

print("\nDone! All processed images saved.")
