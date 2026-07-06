---
name: interior-photo-enhancement
description: Interior yacht photo selection + post-processing workflow and where the files live
metadata: 
  node_type: memory
  type: project
  originSessionId: 1b62144d-44dd-4710-a58e-6732204ec60f
---

Ongoing task: select & enhance interior photos of the Limitless yacht for the promo site.

- Source masters now live in the git-ignored `media-library/` (renamed from `unused media/`), organized in `media-library/by-area/{master-cabin,vip-cabin,twin-cabin,saloon,aft-deck,flybridge,exterior-stern,lifestyle,_deck-series-unsorted}/`. See `media-library/README.md` for the reshuffle workflow.
- The 8 chosen raws: `media-library/chosen-interior/`; corrected masters: `media-library/chosen-interior_processed/` — `01_master_amber_glow.jpg` … `08_saloon_marina_view.jpg` (3 master, 1 VIP, 1 twin, 3 saloon).
- Enhancement pipeline: `scripts/postprocess_interior.py` (grey-world WB, shadow lift, contrast, saturation, sharpen; per-image SETTINGS dict). Web derivatives: `scripts/build_gallery_assets.py` → resizes to 1280px + writes jpg+webp into flat `images/` (prefix `int_*`, plus `lifestyle_sunset`).
- Deps not in system Python (PEP 668). Use project venv: `.venv/bin/python scripts/...` (numpy + pillow). `.venv/` is git-ignored.
- Done 2026-06-05: gallery re-curated to 17 items (3 exterior + 4 deck/helm + 3 saloon + 3 master + 1 VIP + 1 twin + 1 lifestyle) across all 4 locale files (`index.html`, `de/`, `es/`, `fr/`). Both the `.gallery-item` markup AND the lightbox `images[]` array must stay in sync. Old amateur interiors (IMG_3952/3974/3990) and repetitive aerials removed from markup (files kept in `images/`).
