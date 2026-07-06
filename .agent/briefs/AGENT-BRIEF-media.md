# Task brief — process new exterior drone photos

You are working **locally** in the `LimitlessYacht` git repository (a static website for a luxury
yacht charter). Your ONE job is to turn the owner's new **exterior drone photos of the boat** into
site-ready image assets and push them to the repo. You do **not** know this project yet — follow
these steps exactly. This brief is authoritative on *what* to do; `HANDOVER-MEDIA.md` in the repo
is your reference for setup mechanics and slot names.

## Step 0 — Get on the right code
From the repo root:
```bash
git fetch origin
git checkout develop && git pull origin develop
```
Then skim `HANDOVER-MEDIA.md` at the repo root (brand look, `scripts/process_media.py` usage, the
gallery slot list).

## The one hard rule: do NOT change the website
Touch image files under `images/` only, plus one manifest file. Never edit or run tools that edit
`index.html`, `legal.html`, `css/*`, `js/*`, `i18n/*`, `de/ es/ fr/*`, or `scripts/test-site.py`;
never run the minifier, the locale build, or any `--write-srcset` mode. You **select + process +
push**; the site agent **wires**.

## Scope of this batch
The new originals in `media-library/incoming/` are all **exterior aerial/drone shots** — the one
thing the site lacked real photography for. The site's **interior and deck** photos are already the
real boat: **do not touch any `int_*` or `limitless_*` slots.** These drone shots replace the
**borrowed exterior slots**, which are the generic `maiora_20s_*` family. There may also be a strong
**hero** candidate in here (the current hero may be a stock Maiora, not this hull) — look for it.

## Step 1 — Select
From `media-library/incoming/` (local-only, git-ignored — never commit that folder), pick the
sharpest, best-lit, most premium frames: clean turquoise water, good light, the boat well-composed.
Optional: run the contact-sheet snippet in HANDOVER-MEDIA.md to see them all at once.

## Step 2 — Set up (once)
```bash
python3 -m venv .venv
.venv/bin/pip install pillow
```

## Step 3 — Process each chosen photo
```bash
.venv/bin/python scripts/process_media.py <source> <category> <basename>
```
- **Best hero candidate** (one, ideally a wide landscape cruising/aerial frame of the boat):
  category `hero`, basename `maiora_20s_02` (replaces the current borrowed hero in place). Don't
  worry about exact crop/position — the site agent tunes hero framing.
- **Exterior gallery shots:** category `gallery`. Replace a borrowed slot by reusing its basename —
  the existing exterior gallery slots are `maiora_20s_01`, `maiora_20s_03`, `maiora_20s_07`. For
  additional good exteriors beyond those, use a new name `maiora_20s_16`, `maiora_20s_17`, …

The site centre-crops with `object-fit:cover`, so choose framing that survives a crop; the script
makes all sizes + the blur preview.

## Step 4 — Write the manifest
Create `NEW-MEDIA-MANIFEST.md` at the repo root: one row per processed image —
`source file | category | basename | replaces existing? | what it shows`. **Call out the hero
proposal explicitly** (which source you chose and why). Note any shots you rejected briefly, and
anything the site agent should know.

## Step 5 — Push (image files + manifest only)
```bash
git checkout -B assets/new-media origin/develop
git add images/ NEW-MEDIA-MANIFEST.md
git status      # MUST show only files under images/ and NEW-MEDIA-MANIFEST.md
                # if anything else changed, revert it: git checkout -- <file>
git commit -m "New media: real exterior drone shots + hero candidate (see NEW-MEDIA-MANIFEST.md)"
git push -u origin assets/new-media
```
Do not merge to `develop` or `main`. When pushed, report back: branch `assets/new-media` is up with
the manifest, plus a one-line summary (how many exteriors, and your hero pick).
