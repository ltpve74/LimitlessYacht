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

## Videos (not processed)

Drone originals are stills only. Under `media-library/incoming/` there are also large `.mp4` files (`CD TEAM BUILDING DAY*.mp4`, `Videos/1–10.mp4`) — video wiring is out of scope for this batch; list for a separate decision.

## Notes for site agent

- `maiora_20s_16` and `maiora_20s_17` are **new basenames** — gallery markup/srcset wiring required if you want them live.
- `maiora_20s_07` alt text says "head-on at full speed"; best available frame is elevated speed shot (0358), not a true bow-on. Consider alt-text tweak on wire.
- Hero replaces stock Maiora with the real Limitless hull — worth a quick LCP/CLS check after deploy.
- All derivatives include desktop + mobile masters, WebP tiers, and `-prev.jpg` blur placeholders.