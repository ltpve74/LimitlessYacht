# Handover — new media selection & processing (co-work agent)

You are running **locally on the owner's machine** with full filesystem access. Your job is to
turn the owner's new photos/videos into **site-ready image assets and push them to the repo** so
the other agent (working on the live site in the cloud) can wire them in.

## The one hard rule

**Do not change the website.** Touch image files under `images/` only, plus the one manifest file
this doc asks you to write. Do **NOT** edit — or run tools that edit — any of:
`index.html`, `legal.html`, `css/*`, `js/*`, `i18n/*`, `de/ es/ fr/*`, `scripts/test-site.py`, or
run `minify_html.py` / `build-locales.py` / any `--write-srcset` mode. Wiring new imagery into the
page (srcsets, which photo goes in which gallery/destination slot) is the site agent's job — they
are more up to speed on the markup. You **select + process + push**; they **wire**.

## What the site looks like (so your selection matches the brand)

Limitless is a luxury private yacht charter (Maiora 21.5 m flybridge, Mallorca). Design language:
deep navy `#0a1628`, gold `#c9a84c`, Montserrat, restrained and editorial. Favour shots that are
**sharp, well-lit, richly coloured, and premium** — turquoise water, golden light, clean horizons,
uncluttered decks, warm interiors. Reject: soft/blurry, harsh midday flatness, cluttered/messy
frames, visible people who didn't consent, screenshots, anything that looks like stock. The point
of this batch is to **replace borrowed/stock imagery with the real boat**, so prefer authentic
Limitless shots over generic scenery.

## Where things are

- **New originals:** `media-library/incoming/` — this is the only pool you select from.
- `media-library/` is **git-ignored** (local only, never committed). Only the *processed
  derivatives* you generate under `images/` get committed.
- **Live image slots** already on the site are your targets (see "Slots" below).

Optional first step — eyeball everything at once with a contact sheet:
```bash
python3 - <<'PY'
from PIL import Image, ImageDraw; from pathlib import Path
imgs=sorted(p for p in Path('media-library/incoming').iterdir() if p.suffix.lower() in {'.jpg','.jpeg','.png','.heic','.webp'})
cols=5; thumb=320; rows=(len(imgs)+cols-1)//cols
sheet=Image.new('RGB',(cols*thumb,rows*thumb),(10,22,40)); d=ImageDraw.Draw(sheet)
for i,p in enumerate(imgs):
    try:
        im=Image.open(p).convert('RGB'); im.thumbnail((thumb,thumb))
        x,y=(i%cols)*thumb,(i//cols)*thumb; sheet.paste(im,(x,y)); d.text((x+4,y+4),p.name,fill=(201,168,76))
    except Exception as e: print('skip',p.name,e)
sheet.save('media-library/incoming/_contact_sheet.jpg'); print('wrote _contact_sheet.jpg')
PY
```
(That sheet is under the git-ignored folder — it stays local, just for your own review.)

## Setup (once)

```bash
python3 -m venv .venv
.venv/bin/pip install pillow
```

## Processing — one command per chosen photo

Use the repo's processor. It emits **every derivative the site needs** for one slot (desktop +
mobile masters, responsive WebP tiers, and the blur `-prev.jpg`), at the exact widths and quality
the site already uses. It writes image files only.

```bash
.venv/bin/python scripts/process_media.py <source> <category> <basename>
```

- `<source>`  – path to the chosen original in `media-library/incoming/`
- `<category>` – one of:
  - `gallery` – boat photos for the gallery carousel (exterior on-water, deck, interiors)
  - `dest`    – destination card hero (a place/cove). Basename **must end in `-1`**.
  - `content` – about-strip / lifestyle / misc content shot
  - `hero`    – the big landing LCP image. **Replace only if the owner explicitly asks** — flag it,
    don't do it on your own.
- `<basename>` – the slot name, no extension (details next).

Example:
```bash
.venv/bin/python scripts/process_media.py media-library/incoming/IMG_5001.jpeg gallery maiora_20s_16
.venv/bin/python scripts/process_media.py media-library/incoming/IMG_5002.jpeg dest    cala-llamp-1
```

The processor resizes by longest edge (no crop) — the site uses `object-fit:cover`, so **choose
framing that survives a centre crop** to portrait (cards) or landscape (gallery/hero). Pick the
shot for composition; the script handles sizes.

## Slots — replace in place, or add new

**Two patterns — the manifest (below) records which you used for each file:**

1. **Replace a borrowed/stock slot in place** — reuse the *existing basename*. The site already
   points at that name, so it updates with **zero wiring**. This is the preferred path for swapping
   out stock. The current **destination** slots (borrowed imagery — prime candidates to replace),
   each basename is `<slug>-1`:
   `portals-vells-1, el-toro-malgrats-1, cala-llamp-1, sa-dragonera-1, cala-pi-1, es-trenc-1,
   cabrera-1, calo-des-moro-1, sa-calobra-1, circumnavigation-1, formentera-1, menorca-1`.
   Only reuse a destination slot if the new photo genuinely depicts that place.
   Current **gallery** slots (already the real boat — replace only with a clearly better frame):
   `maiora_20s_01, maiora_20s_03, maiora_20s_07, limitless_aft_dining, limitless_flybridge,
   limitless_sundeck, limitless_aft_deck, int_saloon_artwork, int_saloon_marina_view,
   int_saloon_reverse, int_master_headboard, int_master_amber_glow, int_master_wide,
   int_vip_cabin, int_twin_cabin`.

2. **Add a genuinely new slot** — use a **new** descriptive basename following the existing
   convention: boat/gallery/content = `snake_case` (e.g. `maiora_20s_16`, `limitless_bow_sunset`);
   destination = `kebab-slug-1`. New slots need the site agent to wire them — that's expected;
   just record them in the manifest.

If unsure whether a shot replaces a slot or is new, **leave it as a new descriptive name** and note
your suggestion in the manifest — the site agent decides placement.

## Write the manifest (this is how the site agent wires your work)

Create **`NEW-MEDIA-MANIFEST.md`** at the repo root and commit it. One row per processed image:

| source file | category | basename | replaces existing? | what it shows / suggested use |
|-------------|----------|----------|--------------------|-------------------------------|
| IMG_5001.jpeg | gallery | maiora_20s_16 | new | aft deck at golden hour → gallery "deck" |
| IMG_5002.jpeg | dest | cala-llamp-1 | yes (was borrowed) | real Cala Llamp from the water |

Also note anything the site agent should know: videos you couldn't process (list them, with a
one-line description — video wiring is a separate decision), shots you rejected and why (brief), and
any slot you think should change tier/category.

## Git — push image files + the manifest only

Work on a dedicated branch so you never collide with the site agent's code changes:

```bash
git fetch origin
git checkout -B assets/new-media origin/develop
git add images/ NEW-MEDIA-MANIFEST.md
git status                      # confirm: ONLY files under images/ and the manifest
git commit -m "New media: processed <N> real photos (see NEW-MEDIA-MANIFEST.md)"
git push -u origin assets/new-media
```

If `git status` shows any change outside `images/` and `NEW-MEDIA-MANIFEST.md`, **stop and revert
that file** — something edited the site. (`git checkout -- <file>` to drop it.)

## Hand back

Tell the site agent: branch `assets/new-media` is pushed, manifest lists every asset and its
intended slot. They'll review the shots, wire the new/replaced slots into the page, run the
prev→sharp + CLS + test checks, and publish. Do not merge to `develop`/`main` yourself.

---
*Pipeline reference (for anyone auditing `scripts/process_media.py`): widths + quality mirror
`scripts/optimize_responsive_images.py`; blur preview mirrors `scripts/build_preview_images.py`.
Every processed image lands in the site's guarded prev→sharp progressive system automatically.*
