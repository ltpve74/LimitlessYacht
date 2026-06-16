# Limitless Yacht — Agent Guidelines

Read this before editing the site. The repo uses a **two-branch workflow**: readable dev source on `experiment-no-prices`, minified production on `main`.

---

## Quick start (agents)

```sh
git checkout experiment-no-prices          # always start here
git config core.hooksPath .githooks          # one-time per clone
```

| Question | Answer |
|----------|--------|
| Which branch do I edit? | **`experiment-no-prices`** only |
| Which files are source of truth? | `index.html`, `legal.html`, `css/main.css`, `i18n/locales/*.py` |
| Which files are generated? | `de/`, `es/`, `fr/` HTML — never hand-edit |
| When do locales rebuild? | On commit to `experiment-no-prices` (if EN source changed) |
| When does minification happen? | On commit to **`main`** only (publish step) |
| What goes live? | Push to **`main`** → Netlify deploys `limitlessyachtcharter.com` |
| Preview branch? | Push to `experiment-no-prices` → GitHub Pages preview (see `.github/workflows/preview.yml`) |

---

## Branch strategy

| Branch | Purpose | HTML/CSS format | Pre-commit on commit |
|--------|---------|-----------------|----------------------|
| `experiment-no-prices` | Daily development | Readable (multi-line) | Rebuild locales when EN source changes. **No minify.** |
| `main` | Production (Netlify) | Minified (single-line) | **Minify → 49 site tests.** Locales already built on dev. |

**Rules**
- Never minify on `experiment-no-prices`.
- Never edit English source directly on `main` — always merge from dev.
- Never hand-edit `de/`, `es/`, `fr/` HTML — use `i18n/build-locales.py`.
- Locales are built **once** on dev; publish only minifies (no double locale rebuild).

---

## Development workflow

### 1. Make changes (on `experiment-no-prices`)

Edit source files:

- **Pages:** `index.html`, `legal.html`
- **Styles:** `css/main.css`
- **Translations:** `i18n/locales/de.py`, `es.py`, `fr.py`
- **JS:** `js/` (shared; not locale-generated)
- **Images:** `images/`, `images/mobile/`

### 2. Translations (when English copy changes)

For every new or changed visible English string:

1. Add matching tuples to **all three** locale files (`PAIRS` or `LEGAL_PAIRS`).
2. English side of each tuple must match the HTML **exactly** (whitespace, tags, classes).
3. Order in the lists does not matter (build sorts longest-first).

Calendar month/day labels live in locale modules (`MONTHS`, `DOW`).

### 3. Stage and commit

```sh
git add index.html legal.html css/main.css i18n/locales/   # as needed
git commit -m "Describe the change"
```

**Pre-commit on `experiment-no-prices`** (if staged files include `index.html`, `legal.html`, or `i18n/locales/*.py`):

1. Runs `python3 i18n/build-locales.py`
2. Stages regenerated `de/`, `es/`, `fr/` pages
3. Does **not** minify

You can run the build manually first:

```sh
python3 i18n/build-locales.py
```

**Tip:** Stage English edits before committing so the hook sees final source.

### 4. Push dev branch (optional preview)

```sh
git push origin experiment-no-prices
```

---

## Publishing workflow (dev → production)

Use this when the user asks to **go live** or **publish**.

```sh
# 1. Ensure dev branch is committed and pushed
git checkout experiment-no-prices
git status   # clean working tree

# 2. Merge into main (prefer dev version on conflicts)
git checkout main
git pull origin main
git merge experiment-no-prices
# If conflicts: git checkout --theirs <file>   # dev wins
git add -A

# 3. Commit on main — hook minifies + runs tests (no locale rebuild)
git commit -m "Publish: <summary of changes>"

# 4. Deploy
git push origin main
```

**Pre-commit on `main`** (every commit):

1. Runs `python3 scripts/minify_html.py` (HTML + `css/main.css`)
2. Runs `python3 scripts/test-site.py` (49 checks)
3. Re-stages minified files

**Netlify** (`netlify.toml`): `publish = "."` — no build step. Serves committed files as-is.

**Verify live** (after ~30–60s):

```sh
curl -sL https://limitlessyachtcharter.com/ | head -c 500
```

---

## Scripts reference

| Script | When to run | Branch |
|--------|-------------|--------|
| `python3 i18n/build-locales.py` | After EN HTML or locale `.py` changes | `experiment-no-prices` |
| `python3 scripts/minify_html.py` | Automatic on `main` commit; do not run on dev | `main` only |
| `python3 scripts/test-site.py` | Automatic on `main` commit; can run manually to sanity-check | any |

---

## File map

```
index.html, legal.html     ← EN source (edit)
css/main.css               ← shared styles (edit)
i18n/locales/de.py         ← DE translations (edit)
i18n/locales/es.py         ← ES translations (edit)
i18n/locales/fr.py         ← FR translations (edit)
i18n/build-locales.py      ← locale generator (rarely edit)

de/index.html, de/legal.html   ← generated (do not edit)
es/index.html, es/legal.html   ← generated
fr/index.html, fr/legal.html   ← generated

.githooks/pre-commit       ← branch-aware hook (edit with care)
scripts/minify_html.py       ← production minifier
scripts/test-site.py         ← publish gate tests
netlify.toml                 ← Netlify config (production)
```

---

## Common mistakes (avoid)

| Mistake | Why it's wrong |
|---------|----------------|
| Editing `main` HTML directly | Files are minified; changes are unreadable and bypass locale build |
| Hand-editing `de/es/fr/` HTML | Overwritten on next locale build |
| Running `minify_html.py` on dev branch | Destroys readable source |
| Committing on `main` without merging dev | Skips readable source of truth |
| Forgetting locale `.py` tuples | Non-English pages keep old or English text |
| Expecting Netlify to minify | It does not — minify happens in pre-commit on `main` |

---

## Navigation / scrolling

**Always use native browser anchor navigation.** CSS handles positioning:

- `html { scroll-padding-top }` — keeps anchors below the fixed nav
- `#target { scroll-margin-top }` — per-element viewport-specific offsets
- `html { scroll-behavior: smooth }` under `@media (prefers-reduced-motion: no-preference)`

Only reach for JS when doing something genuinely beyond native capability:

- Scrolling to a *different* element than the href target (e.g. skipping a hidden section header)
- Activating a tab or triggering a side effect alongside navigation
- In those cases: fire the JS, then let the native action complete — do not replicate scrolling in JS

Never intercept anchor clicks just to recompute a scroll offset that CSS already handles.

---

## CSS architecture

- Mobile breakpoint: `max-width: 640px`
- Tablet breakpoint: `max-width: 768px` / `min-width: 769px`
- `scroll-padding-top`: 5rem default, 4.9rem at ≤640px, 6.25rem at 769–1100px
- Viewport-conditional landing (e.g. `#enquire`): use `scroll-margin-top` inside `@media (min-height: …)` queries — no JS

---

## Anchor position pattern

Zero-height span marks the exact landing point inside a section:

```html
<span id="target" style="display:block;height:0;overflow:hidden" aria-hidden="true"></span>
```

Place the span where content should appear on landing; use `scroll-margin-top` in CSS to reveal content above it on tall viewports.