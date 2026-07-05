# Task brief — life-aboard (people) + area/location shots

You are working **locally** in the `LimitlessYacht` git repo. Your job is to pull **two kinds of
new imagery** from the owner's videos and push them as processed assets:

1. **Life aboard** — real guests **enjoying** the boat: laughter on deck, swimming/jumping off the
   stern, on the water toys (Seabobs, paddleboard, tender), sundowners, dining, relaxing on the
   flybridge/sunpads. Candid and joyful — this is the aspiration that sells a charter.
2. **The area** — where you charter: Mallorca coves and turquoise anchorages, dramatic coastline,
   Palma / Club de Mar, sunset over the water, the wider seascape. Sense of place.

You do **not** know this project — follow these steps exactly.

## Step 0 — Get on the LATEST code (important)
```bash
git fetch origin
git checkout develop && git pull origin develop
```
Then create your work branch **from the latest develop** (last round a branch off a stale copy caused
conflicts):
```bash
git checkout -B assets/lifestyle-media origin/develop
```
Skim `HANDOVER-MEDIA.md` for the pipeline; this brief is authoritative on scope.

## The hard rules (both matter — the last round broke both)
- **Image files + one manifest ONLY.** Do **NOT** edit `index.html`, `legal.html`, `css/*`, `js/*`,
  `i18n/*`, `de/ es/ fr/*`, `scripts/*` (including `scripts/test-site.py` and
  `scripts/process_media.py`), and do **NOT** run the minifier or locale build. Wiring into the page
  is the site agent's job. You **select + process + push**; they **wire**.
- **Do NOT modify `scripts/process_media.py`.** It already honours EXIF orientation on `develop` —
  use it as-is. (A previous run reverted that fix; don't.)

## Step 1 — Select
Sources are in `media-library/` (local, git-ignored): the **video clips** (`CD TEAM BUILDING DAY NO
LOGO.mp4`, `Videos/1–10.mp4` — **exclude** the logo-overlay version) and any unused drone frames.
- Extract candidate frames (e.g. sharpest frames sampled a few fps), then pick the best.
- **Life-aboard picks:** faces/bodies look natural and happy, not mid-blink or awkward; framing is
  clean; nobody appears not to want to be shown. Prefer variety (deck, swimming, toys, dining).
- **Area picks:** turquoise water, good light, strong sense of Mallorca; the boat can be present or
  absent.
- Skip: anything blurry, backlit-to-grey, cluttered, or with the boat/people looking unflattering.
- Optional: build a contact sheet (snippet in `HANDOVER-MEDIA.md`) to review at a glance.

## Step 2 — Set up (once)
```bash
python3 -m venv .venv
.venv/bin/pip install pillow
```

## Step 3 — Process each pick
```bash
.venv/bin/python scripts/process_media.py <source> gallery <basename>
```
Use category `gallery` for both life-aboard and area shots. Use **new descriptive basenames** so the
site agent can place them — suggestions:
- Life aboard: `life_deck_laughter`, `life_swim_stern`, `life_seabob`, `life_paddleboard`,
  `life_dining`, `life_sundowner`, `life_flybridge` …
- Area: `area_cove_turquoise`, `area_coastline`, `area_palma`, `area_sunset`, `area_anchorage` …

The site centre-crops with `object-fit:cover`, so pick framing that survives a crop. If a shot is
strongly vertical/horizontal, note it in the manifest (the site agent may use it in a portrait or
landscape slot).

## Step 4 — Write the manifest
Create `NEW-MEDIA-MANIFEST-lifestyle.md` at the repo root: one row per processed image —
`source (clip @ time) | basename | kind (life-aboard / area) | what it shows | orientation (landscape/portrait)`.
Flag your 3–4 strongest life-aboard shots and 2–3 strongest area shots. Note rejects briefly.

## Step 5 — Push (image files + manifest only)
```bash
git add images/ NEW-MEDIA-MANIFEST-lifestyle.md
git status     # MUST be only files under images/ and the manifest — revert anything else: git checkout -- <file>
git commit -m "Lifestyle + area media: processed <N> frames (see NEW-MEDIA-MANIFEST-lifestyle.md)"
git push -u origin assets/lifestyle-media
```
Do **not** merge to develop/main. Report back: branch `assets/lifestyle-media` pushed, with a
one-line summary (how many life-aboard, how many area, your top picks).
