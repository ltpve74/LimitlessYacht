# New media manifest — exterior drone batch (2026-06-26)

Processed from `media-library/incoming/Photos/` (15 DJI frames + 1 non-yacht outlier). Scope: replace borrowed `maiora_20s_*` exterior slots and propose a real-boat hero. **No `int_*` or `limitless_*` slots touched.**

## Hero proposal

**`DJI_20260626180844_0365_D.JPG` → `maiora_20s_02` (hero, replaces existing)**

Chosen because it is a wide landscape underway shot: full starboard profile, white wake, deep turquoise water, and a distant Mallorca coastline under clear sky. Sharp, premium light, and the hull reads clearly at hero scale. Framing survives centre-crop. (Site agent can tune `object-position` if needed.)

## Gallery replacements (borrowed exterior slots)

| source file | category | basename | replaces existing? | what it shows |
|-------------|----------|----------|--------------------|---------------|
| DJI_20260626132137_0266_D.JPG | gallery | maiora_20s_01 | yes (borrowed stock) | High aerial over Limitless at anchor near a rocky Mallorca cove — turquoise water, coastal villas, "Limitless" on transom |
| DJI_20260626180827_0362_D.JPG | gallery | maiora_20s_03 | yes (borrowed stock) | Side-profile underway on open sea with wake and flybridge visible |
| DJI_20260626180807_0358_D.JPG | gallery | maiora_20s_07 | yes (borrowed stock) | Elevated drone, yacht at speed on deep blue water — closest available to "head-on / full speed" (no true bow-on frame in batch) |

## New exterior slots (need wiring)

| source file | category | basename | replaces existing? | what it shows / suggested use |
|-------------|----------|----------|--------------------|-------------------------------|
| DJI_20260626180430_0346_D.JPG | gallery | maiora_20s_16 | new | Dramatic stern aerial — Limitless name on transom, large wake, open ocean |
| DJI_20260626180918_0368_D.JPG | gallery | maiora_20s_17 | new | Clean side profile on calm open sea — minimal clutter, editorial |

## Rejected (brief)

| source | reason |
|--------|--------|
| DJI_20260626133335_0289_D.JPG | Zuma floating pool with guests — not the yacht; consent/brand risk |
| DJI_20260626135447_0297_D.JPG | Near-duplicate of 0298 cove anchor shot; kept 0298's sibling framing via 0266 instead |
| DJI_20260626135457_0298_D.JPG | Good cove shot but redundant with 0266; 16/17 used for variety |
| DJI_20260626140157_0310_D.JPG | Marina/coastscape — no yacht as subject |
| DJI_20260626140208_0311_D.JPG | Marina/coastscape — no yacht as subject |
| DJI_20260626140217_0312_D.JPG | Cove swim spot — scenic but not boat-focused |
| DJI_20260626151043_0336_D.JPG | Busy public beach; foreground vessel may not be Limitless |
| DJI_20260626180343_0341_D.JPG | Strong stern underway but redundant with 0346 (kept sharper wake frame) |
| DJI_20260626180347_0342_D.JPG | Similar rear-quarter speed shot to 0341/0346 |
| DJI_20260626180847_0366_D.JPG | Near-duplicate of hero pick 0365 |

## Video frame batch (2026-07-06)

Extracted from 11 clips (`CD TEAM BUILDING DAY NO LOGO.mp4` + `Videos/1–10.mp4`; **excluded** `CD TEAM BUILDING DAY.mp4` with logo overlay). Sharpness-scored at 2 fps; top 3 per clip saved to `media-library/incoming/video-frames/`. Six best frames processed below.

### Hero update (video replaces drone still)

**`9.mp4 @ 2.5s` → `maiora_20s_02` (hero, replaces drone-still version from photo batch)**

Three-quarter profile on turquoise water with coastal town and hills behind — clean, bright, real Limitless hull. Stronger hero candidate than the photo-batch pick; site agent should confirm framing after wire.

### Gallery — borrowed slot replacement

| source | category | basename | replaces existing? | what it shows |
|--------|----------|----------|--------------------|---------------|
| 10.mp4 @ 8.0s | gallery | maiora_20s_04 | yes (borrowed stock) | Side profile underway with wake — fits about-strip "cruising Mallorca coastline" slot |

### New exterior slots from video (need wiring)

| source | category | basename | replaces existing? | what it shows / suggested use |
|--------|----------|----------|--------------------|-------------------------------|
| 1.mp4 @ 13.5s | gallery | maiora_20s_18 | new | Overhead drone — yacht on vivid turquoise water |
| 1.mp4 @ 11.5s | gallery | maiora_20s_19 | new | Overhead variant, slightly different angle |
| 2.mp4 @ 8.0s | gallery | maiora_20s_20 | new | Stern view — "Limitless" on transom, rocky Mallorca coast |
| 6.mp4 @ 0.5s | gallery | maiora_20s_21 | new | Stern wake shot with sailboat in mid-ground — cinematic open water |

### Video frames extracted but not processed

| source | reason |
|--------|--------|
| team_building_no_logo @ 10–29s | Cocktail/tender boats (Espurna, Cocktail Boat) — not Limitless exterior |
| 3.mp4, 4.mp4, 5.mp4 | Floating platform + swimmers / busy guest activity — consent & clutter |
| 7.mp4 | Shirtless guests prominent on deck |
| 8.mp4 | Low sharpness; wide seascape with distant sailboats |
| 9.mp4 ranks 2–3, 10.mp4 rank 2 | Near-duplicates of processed picks or MAIORA hull text too dominant |
| Remaining rank-2/3 frames per clip | Redundant with processed #1 picks from same clip |

Raw `.mp4` files remain local under `media-library/incoming/` — video *playback* wiring is still a separate decision.

## Notes for site agent

- `maiora_20s_16`, `maiora_20s_17`, `maiora_20s_18`–`_21` are **new basenames** — gallery markup/srcset wiring required if you want them live.
- `maiora_20s_04` now has real-boat video still — about-strip updates in place with no code change.
- **Hero** on this branch is the video frame (`9.mp4 @ 2.5s`), overriding the earlier drone-photo hero — review both and pick one before publish.
- `maiora_20s_07` alt text says "head-on at full speed"; best available frame is elevated speed shot (0358), not a true bow-on. Consider alt-text tweak on wire.
- Hero replaces stock Maiora with the real Limitless hull — worth a quick LCP/CLS check after deploy.
- All derivatives include desktop + mobile masters, WebP tiers, and `-prev.jpg` blur placeholders.