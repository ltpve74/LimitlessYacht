---
name: gallery-mobile-framing
description: "On the Water gallery on mobile — *-gm reframes, no borrowed life_* in water tier"
metadata:
  node_type: memory
  type: project
  originSessionId: gallery-water-mobile-2026-07-07
---

**On the Water gallery on vertical mobile must show the full hull — never crop the boat off-screen
(owner directive + screenshots, 7 Jul 2026).**

## Problem

The mobile gallery carousel is full-bleed (`100vw` × ~646px tall on iPhone XR) with
`object-fit: cover`. Landscape `maiora_*` masters (1280×853) centre-crop to wake/sky and lose the
hull. A desktop-only `object-position: 25% 60%` on panel 0 made slide 1/21 show wake only on phones.
Borrowed `life_seabob`, `life_jetski`, `life_swim_jump` were wired into the water tier — replace with
owned Limitless drone/video frames.

## Fix (implemented 7 Jul 2026, commit `34b0f37`)

1. **`scripts/reframe_gallery.py`** — composes `*-gm` masters (1080×1578): sharp photo
   **centre-fitted** (contain) with Gaussian-blurred, colour-matched margins so `object-fit:cover`
   on the carousel never crops the hull. Top-down slots (`01`, `19`) rotate -90° first. Run:
   `.venv/bin/python scripts/reframe_gallery.py --all-water`
2. **HTML `<picture>`** — every water panel: first source `media="(max-width: 768px)"` →
   `images/mobile/<basename>gm-{480,720,960}.webp`; desktop keeps the landscape/portrait master.
3. **Water tier slots (7 panels, `data-cat="water"`):**
   - `01` — `video-frames/chosen/best_01_t005.5s.jpg` (top-down aerial); mobile `01gm` is **-90°
     portrait** (bow down) via `reframe_gallery.py --vertical` / `VERTICAL_TOPDOWN` set
   - `03`, `17` — DJI slots + `03gm` / `17gm` on mobile
   - `16` — portrait stern aerial + `16gm` letterbox on mobile
   - `19` — top-down drone (`video-frames/1/best_02_t011.5s.jpg`) replaces `life_seabob`;
     mobile `19gm` rotates -90° then letterbox (same as `01`)
   - `20` — stern/cove shot replaces `life_jetski`
   - `04` — underway wake shot replaces `life_swim_jump`
4. **CSS** — `object-position: 25% 60%` on `data-index="0"` is **desktop grid only**
   (`min-width: 769px` in `css/layout.css`); must not apply in the mobile carousel.
5. **QA** — `scripts/preview_gallery_framing.py` (Playwright); visual refs in
   `screenshots/gallery-preview/`. Automated hull-pixel probe is noisy — trust screenshots.

## Rules for future gallery work

- **Water tier = owned `maiora_*` only** — no `life_*` (lifestyle belongs in deck/content, not
  borrowed into exterior water).
- Every water slot needs a `*-gm` letterbox master before wiring (including portrait sources like `16`).
- Pick sources from `media-library/incoming/` (DJI `Photos/` or `video-frames/chosen/`); process via
  `scripts/process_media.py gallery <basename>`, then reframe if landscape.
- `scripts/test-site.py` guards: no `life_*` in water blocks, `*gm-480.webp` wired, assets on disk.

**Related:** [[agent-files-off-main]] (briefs in `.agent/briefs/NEW-MEDIA-MANIFEST.md`),
[[screenshots-off-main]] (read owner screenshots before visual fixes).