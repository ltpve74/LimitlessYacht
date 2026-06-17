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
| Local preview without GitHub Pages? | `python3 scripts/dev-server.py` → http://127.0.0.1:8765/ (analytics off on localhost) |
| Which branch do I edit? | **`experiment-no-prices`** only |
| Which files are source of truth? | `index.html`, `legal.html`, `css/main.css`, `data/reviews.json`, `i18n/locales/*.py` |
| Which files are generated? | `de/`, `es/`, `fr/` HTML and `data/reviews-{de,es,fr}.json` — never hand-edit |
| When do locales rebuild? | On commit to `experiment-no-prices` (if EN source changed) |
| When does minification happen? | On commit to **`main`** only (publish step) |
| Publish QA gate? | Pre-commit on **`main`**: minify → `scripts/publish-gate.py` (site tests + UX smoke + Lighthouse). CI: `.github/workflows/publish.yml` |
| What goes live? | Push to **`main`** → Netlify deploys `limitlessyachtcharter.com` |
| Preview branch? | Push to `experiment-no-prices` → GitHub Pages preview (see `.github/workflows/preview.yml`) |
| Analytics on preview? | **Off** — `js/analytics-env.js` sets `LY_OWNER_MODE` on `*.github.io`, localhost, Netlify branch deploys |
| Analytics on production? | **On** — `limitlessyachtcharter.com` only (verified in publish gate) |

---

## Analytics & preview (do not pollute GA / Clarity)

**Single source of truth:** `js/analytics-env.js` (load first in `<head>` on `index.html` and `legal.html`).

| Host | `LY_IS_PREVIEW` | Analytics |
|------|-----------------|-------------|
| `*.github.io` (GitHub Pages preview) | yes | Suppressed |
| `localhost` / `127.0.0.1` | yes | Suppressed |
| `*.netlify.app` (not production domain) | yes | Suppressed |
| `limitlessyachtcharter.com` | no | **Live** (GA4/Ads, Clarity, behavior-analytics) |

When suppressed (`LY_OWNER_MODE`), the site skips: Google tag, Microsoft Clarity, `behavior-analytics.js`, cookie banner, and conversion `dataLayer` events.

**Owner override (any host):** visit `?ly_owner=set` once to suppress on that browser; `?ly_owner=unset` to re-enable.

### Daily dev / preview workflow

1. Work on `experiment-no-prices`, push → GitHub Pages preview deploys.
2. Preview automatically suppresses analytics — safe for UX iteration and agent testing.
3. Do **not** remove analytics snippets from HTML; suppression is host-based.

### Go-live workflow (re-enable analytics on production)

Analytics turn back on automatically when Netlify serves `limitlessyachtcharter.com` — no manual toggle.

Before pushing `main`:

```sh
python3 scripts/verify-analytics.py   # preview guard + production IDs present
python3 scripts/publish-gate.py       # includes verify-analytics + site tests + UX + Lighthouse
```

After deploy (~60s), spot-check production:

```sh
curl -sL https://limitlessyachtcharter.com/ | grep -o 'AW-18209943491'
curl -sL https://limitlessyachtcharter.com/ | grep -o 'analytics-env.js'
```

Expect: both match. On preview (`ltpve74.github.io/LimitlessYacht/`), `analytics-env.js` is present but Clarity/gtag must not load (check DevTools Network tab).

**Publish gate** (`scripts/publish-gate.py` on `main` commit): runs `verify-analytics.py` after `test-site.py`.

---

## Branch strategy

| Branch | Purpose | HTML/CSS format | Pre-commit on commit |
|--------|---------|-----------------|----------------------|
| `experiment-no-prices` | Daily development | Readable (multi-line) | Rebuild locales when EN source changes. **No minify.** |
| `main` | Production (Netlify) | Minified (single-line) | **Minify → publish gate** (site tests, UX smoke, Lighthouse). Locales already built on dev. |

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

**Guest reviews:** English copy lives in `data/reviews.json`. Translations live in each locale module as `REVIEWS` (plus `REVIEWS_UI` for JS labels). `build-locales.py` writes `data/reviews-de.json`, `data/reviews-es.json`, `data/reviews-fr.json` and patches each locale page to fetch the matching file. When adding or editing a review, update **English JSON and all three `REVIEWS` lists** (same count, same `author`/`rating`).

### 3. Add tests for new behaviour

Any new or changed functionality must include checks in `scripts/test-site.py` (HTML structure, JS patterns, CSS rules, or asset paths as appropriate). The pre-commit hook on `main` runs the full suite — missing tests means regressions can ship unnoticed.

### 4. Stage and commit

```sh
git add index.html legal.html css/main.css i18n/locales/ scripts/test-site.py   # as needed
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

### 5. Push dev branch (optional preview)

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

# 3. Commit on main — hook minifies + publish gate (no locale rebuild)
#    One-time QA setup: scripts/setup-qa.sh
git commit -m "Publish: <summary of changes>"

# 4. Deploy
git push origin main
```

**Pre-commit on `main`** (every commit):

1. Runs `python3 scripts/minify_html.py` (HTML + `css/main.css`)
2. Runs `python3 scripts/publish-gate.py` (site tests, UX smoke, Lighthouse budgets)
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
| `python3 scripts/test-site.py` | Part of publish gate; run after feature work | any |
| `python3 scripts/publish-gate.py` | Automatic on `main` commit; manual before merge | `main` / pre-publish |
| `python3 scripts/verify-analytics.py` | Preview suppression + production tag IDs (part of publish gate) | `main` / pre-publish |
| `scripts/setup-qa.sh` | One-time install of Playwright + Lighthouse for publish gate | any |
| `python3 scripts/dev-server.py` | Local static server + `/api/availability` stub | any |

---

## File map

```
index.html, legal.html     ← EN source (edit)
css/main.css               ← shared styles (edit)
i18n/locales/de.py         ← DE translations (edit)
i18n/locales/es.py         ← ES translations (edit)
i18n/locales/fr.py         ← FR translations + REVIEWS (edit)
data/reviews.json          ← EN guest reviews source (edit)
i18n/build-locales.py      ← locale generator (rarely edit)

de/index.html, de/legal.html   ← generated (do not edit)
es/index.html, es/legal.html   ← generated
fr/index.html, fr/legal.html   ← generated
data/reviews-de.json           ← generated from de.py REVIEWS
data/reviews-es.json           ← generated from es.py REVIEWS
data/reviews-fr.json           ← generated from fr.py REVIEWS

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
| Hand-editing `de/es/fr/` HTML or `data/reviews-*.json` | Overwritten on next locale build |
| Adding a review only to `data/reviews.json` | Locale `REVIEWS` lists must stay in sync — build will fail |
| Running `minify_html.py` on dev branch | Destroys readable source |
| Committing on `main` without merging dev | Skips readable source of truth |
| Forgetting locale `.py` tuples | Non-English pages keep old or English text |
| Expecting Netlify to minify | It does not — minify happens in pre-commit on `main` |
| Testing UX on preview with Clarity/GA open | Preview suppresses automatically; use production URL to validate tags |
| Removing analytics snippets before preview | Wrong — use `analytics-env.js` host detection instead |

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