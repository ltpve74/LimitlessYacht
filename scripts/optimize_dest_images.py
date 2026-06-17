"""
Optimize the 12 referenced destination hero images (<slug>-1.jpg/.webp) for the
web. Delegates to optimize_responsive_images.py (shared content quality settings).

Run: .venv/bin/python scripts/optimize_dest_images.py
"""

from __future__ import annotations

import optimize_responsive_images as ori


def main() -> None:
    widths: dict[str, int] = {}
    ori.optimize_dest_desktop(widths)
    for slug in ori.DEST_SLUGS:
        webp = ori.BASE / "images" / "dest" / f"{slug}-1.webp"
        if webp.is_file():
            with __import__("PIL").Image.open(webp) as img:
                w, h = img.size
            print(f"  {slug}: {w}x{h}")


if __name__ == "__main__":
    main()