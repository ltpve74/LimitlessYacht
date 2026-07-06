# Limitless Yacht — Agent Guidelines

> ⚠️ **Before making any change, read [`DECISIONS.md`](DECISIONS.md).** It records *why* several
> counterintuitive choices were made (font off the critical path, inlined net‑tier loader, the
> 300 ms main.css gap, CLS reserves, …). Some look like bugs or easy wins but are deliberate. If a
> request would undo something there, flag it and confirm before proceeding — don't reverse a
> positive change on a hunch. In particular: **a reported "font shift" is not a reason to re‑add the
> Montserrat `@font-face` to CSS — measure CLS first; the live site does not shift.**

Read this before editing the site. The repo uses a **three-tier workflow**: feature branches for individual work, `develop` as the integration branch (readable source, always matches what's live), and `main` for minified production.

---

## Quick start (agents)

```sh
git checkout develop                         # integration branch — always start here
git config core.hooksPath .githooks          # one-time per clone
```

| Question | Answer |
|----------|--------|
| Local preview without GitHub Pages? | `python3 scripts/dev-server.py` → http://127.0.0.1:8765/ (analytics off on localhost) |
| Which branch is the source of truth? | **`develop`** — always reflects what's on the live site |
| Feature work? | Branch from `develop`, work there, merge back into `develop` when done |
| Which files are source of truth? | `index.html`, `legal.html`, `css/main.css`, `data/reviews.json`, `i18n/locales/*.py` |
| Which files are generated? | `de/`, `es/`, `fr/` HTML and `data/reviews-{de,es,fr}.json` — never hand-edit |
| When do locales rebuild? | On commit to `develop` (if EN source changed) |
| When does minification happen? | On commit to **`main`** only (publish step) |
| Publish QA gate? | Pre-commit on **`main`**: minify → `scripts/publish-gate.py` (site tests + UX smoke + Lighthouse). CI: `.github/workflows/publish.yml` |
| What goes live? | Push to **`main`** → Netlify deploys `limitlessyachtcharter.com` |
| Preview branch? | **`develop` only** → GitHub Pages preview. Feature branches must be merged into `develop` first. |
| Analytics on preview? | **Off** — `js/analytics-env.js` sets `LY_OWNER_MODE` on `*.github.io`, localhost, Netlify branch deploys |
| Analytics on production? | **On** — `limitlessyachtcharter.com` only (verified in publish gate) |

---

## Visual feedback: the `screenshots/` folder

The repo owner uses a **`screenshots/` folder** (repo root) to give visual feedback to whoever is
working on the site — Claude Code or another agent.

| Fact | Detail |
|------|--------|
| Location | `screenshots/` at the repo root |
| In git? | **Yes on `develop`** — so cloud agents can read them. **Never on `main`** — stripped automatically on publish commits; also excluded from Netlify (`.netlifyignore`) and GitHub Pages (`prepare-github-pages.py`). |
| Purpose | The owner drops in screenshots showing a bug, a current state, and/or the desired state |
| How to read | **Check it at the start of a visual/UX task.** If present and non-empty, open the images before changing layout/CSS/scroll behaviour |

**Reading conventions**

- When two images are provided for one issue, the owner's message says which is which.
  The common pattern is: **first = current/buggy behaviour, second = desired behaviour.**
- Images often include the browser/device chrome (e.g. iPhone SE 375×667, DPR/Save-Data
  toggles) — use that to reproduce at the same viewport.

**For agents:** treat `screenshots/` as read-only feedback input. Do **not** delete its contents.
Reproduce the reported state with Playwright at the matching viewport before and after your fix to
confirm you've addressed what the screenshot shows.

---

## Media library (owner's originals — NOT in the repo)

The owner's photo/video **media library lives on the owner's computer only**. It is never
committed. The repo carries **only processed, site-ready assets** that are part of the live site
(`images/` masters + `-480/-640/-960/-1280` tiers + `-prev.jpg` blur previews, `images/mobile/`
variants).

| Fact | Detail |
|------|--------|
| Originals location | Owner's machine (like `screenshots/` — local, untracked, may be absent in remote/CI checkouts) |
| What gets committed | Only processed derivatives actually referenced by the site |
| New-media workflow | Owner shares/drops files → agent triages (contact sheet, best-shot selection) → generate tiers + previews (`scripts/build_preview_images.py`, `scripts/optimize_responsive_images.py`) → commit only those outputs |
| Never | Commit originals/raw video, or reference paths outside the repo from the site |

Every processed image must enter the **prev→sharp progressive pipeline** (decision-guarded:
blur preview first, everywhere, always).

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

### Clarity events fired by the site

All custom events go through `window.LY_clarityEvent(name)` (defined in `index.html`), which no-ops in `LY_OWNER_MODE` and otherwise calls `clarity('event', name)`. They auto-register under **Clarity → Settings → Smart events** after the first consented visitor fires each one — **production only**, so you won't see them on preview/localhost.

| Event | When |
|-------|------|
| `ly_section_view_<id>` | A page section is reached (hash/scroll). `<id>` is the section id with `-` → `_` (e.g. `ly_section_view_gallery`). |
| `ly_gallery_view_on_water` / `_deck` / `_interiors` | The **gallery** carousel settles (~1s) on a panel in that category. |
| `ly_section_view_half_day` / `_full_day` / `_multi_day` | The **destinations** carousel settles (~1s) on a panel in that tier. |
| `ly_review_view_<author>` | A specific guest review card has been ≥50% in view for ~1.5s (a genuine reading/dwell signal). Fires **once per review per page-load**. `<author>` is the slugified review author (e.g. `ly_review_view_maurice`). This is the source of truth for "which reviews do users actually read." |
| `ly_review_expand` (generic) + `ly_review_expand_<author>` | The reader clicks the **…more** link to expand a review. The generic event aggregates all expands; the per-author variant tells you *which* review was expanded. |
| `ly_charter_card_*`, `ly_cal_*`, `ly_hero_rates_click`, `ly_whatsapp_click`, `ly_form_view`, … | Various funnel / CTA interactions (grep `LY_clarityEvent(` in `index.html` for the full list). |

**Reviews engagement (added for analyzing the reviews section):** each review card carries a `data-rv-slug` (author slug, via `lyRvSlug()`). A per-card `IntersectionObserver` fires `ly_review_view_<author>` after a 1.5s dwell at ≥50% visibility (once per card, tracked in `grid._rvSeen`); the `.review-expand` click handler fires both `ly_review_expand` and `ly_review_expand_<author>`. Combined with `ly_section_view_reviews` (section reached) you can tell: did they reach the section → did they read individual reviews → which ones → did they expand any. All suppressed on preview/localhost (production-only).

**Reviews snippet + CLS reserve:** the visible snippet is clamped to **4 lines** (`.review-text--clamped{-webkit-line-clamp:4;min-height:4lh}`) — `min-height:4lh` makes every clamped card the same height. The reviews load lazily into `#reviewsGrid` (replacing `#reviewsLoading`), so to stop a layout shift the placeholder **and** the grid reserve the loaded height: `min-height:49rem` mobile / `24rem` desktop (≈ 3 cards stacked / 2-col 2-row). **These reserves are sized for exactly 3 reviews — if you add/remove a review, re-measure and update both `min-height` values**, or the section will shift on load again (CLS). The `…more` expand still works (removing `.review-text--clamped` drops the clamp + reserve).

The carousel category events (`ly_gallery_view_*`, `ly_section_view_{half,full,multi}_day`) fire on **swipe-settle**, not on tab click — debounced ~1s and gated to when the section is on screen, so a fast flick-through doesn't spam events and the counts reflect deliberate views. This is the source of truth for "which destinations/gallery categories do mobile users actually look at."

### Immersive carousels (gallery + destinations)

Both `#gallery` and `#itinerary` are **single continuous swipe carousels**, driven by one shared helper `window.LY_wireCarousel(cfg)` in `index.html`:

- **One track each**: a single `.gallery-group > .gallery-grid` (15 `.gallery-item`, each tagged `data-cat="water|deck|interior"`) and a single `.dest-group > .itinerary-grid` (12 `.destination-card`, each tagged `data-tier="half-day|full-day|multi-day"`). Do **not** re-split these into per-category groups — swiping must reach every category, and several tests assert the single-track counts.
- **Tabs are clickable shortcuts AND live position indicators**: clicking a tab scrolls to that category's first panel; swiping updates `.tab--active` + `aria-selected` on the matching tab. Tabs are never the only way to reach a category.
- **Viewport-fit on mobile:** the wraps are `100svh − --mobile-funnel-land-offset − safe-area`;
  the offset is set by JS to the measured nav height (+2px), so tabs land skirting the nav and the
  bottom CTAs always keep breathing room. The card flexes to absorb device-height differences.
  Decision-guarded — see DECISIONS.md "Mobile funnel layout".
- **Step math** lives in `window.lyCarouselStep` (mobile only does the horizontal carousel; desktop shows the grid).
- **Destinations funnel** still flows through `window._setDestTab`, the pending-tier drain (`applyFunnelTierFromStorage`), and hash deep-links `#half-day`/`#full-day`/`#multi-day`. Deep-link tiers are captured **synchronously** at parse time into `_initTier` because the nav's `updateScrollHash` strips the hash at scrollY≈0, then re-applied once layout settles.
- **Gallery has no lightbox** (removed — was unused + a null-`classList` crash surface). The **destinations lightbox is retained** (`#dest-lightbox`); its tier badge reads the card's own `data-tier`. The two lightboxes share `.lb-*` CSS classes, so don't delete those when touching one.

### Seasonal pricing (low + high shown together)

Charter prices appear in 5 `.season-rates` blocks (hero rate link ×2, `#charterRatesConfirm`, and the Half-Day / Full-Day enquiry cards). Each block holds a `<span data-season-rate="low">` and a `<span data-season-rate="high">`, each prefixed with a `<span class="season-rate-label">Low/High season</span>`.

- **Both seasons are always displayed** (the high span is no longer `hidden`). The date script (`high` = month index 6–7, i.e. Jul–Aug; `low` otherwise) only **highlights** the current season by adding `.season-rate--current` (gold label) — it does not hide the other.
- The `crew & VAT included` note renders **once** per block (a sibling after the two lines), not inside each season span — so edit it in one place.
- That rates IIFE (season highlight + `ly_hero_rates_click` + `ly_charters_rates_view` IO + charter-card funnel clicks) is wired **inside `lyInitRates()` gated on `DOMContentLoaded`**. It sits mid-document, *above* `#charters`; running it eagerly (as it used to) meant `querySelectorAll('.season-rates …')` and `getElementById('charterRatesConfirm')` missed everything below the script. Keep it deferred.
- Label text + the price lines + the note are translated via PAIRS in each `i18n/locales/*.py` (`Low season`/`High season (Jul–Aug)`, the `Half-day … from €…` lines, and `crew &amp; VAT included`). High season is **Jul–Aug** (owner-confirmed); low season is the rest of the year (the site is "available year-round"). Only the high label carries the month window.
- **Hero promo pill removed (2 Jul 2026):** the early-bird campaign banner (`.hero-promo`) was
  deleted when the campaign ended — HTML, phase JS in `lyInitRates()`, CSS (main + critical), locale
  PAIRS, and `ly_promo_click`. Its pill styling (radius 999px, gold border, navy bg, blur, shadow)
  now lives on the **hero rates panel** (`.hero-rates`, mobile + desktop variants, mirrored in
  critical CSS). A test guards against promo remnants (they would flash at load). To run a future
  campaign, restore from git history instead of rebuilding.

### Daily dev / preview workflow

1. Work on `develop`, push → GitHub Pages preview deploys.
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
| `develop` | Integration — always matches what's live | Readable (multi-line) | Rebuild locales when EN source changes. **No minify.** |
| feature branches | Individual work (lead-gen, 3g-opt, etc.) | Readable | Same as develop. Merge into `develop` when ready. |
| `main` | Production (Netlify) | Minified (single-line) | **Minify → publish gate** (site tests, UX smoke, Lighthouse). Locales already built on dev. |

**Rules**
- `develop` is the single source of truth — it always reflects what's on the live site.
- Feature branches fork from `develop`, get merged back into `develop` when complete.
- Never minify on `develop` or feature branches.
- Never edit English source directly on `main` — always merge from `develop`.
- Never hand-edit `de/`, `es/`, `fr/` HTML — use `i18n/build-locales.py`.
- Locales are built **once** on dev; publish only minifies (no double locale rebuild).

---

## Development workflow

### 1. Make changes (on `develop`)

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

**Pre-commit on `develop`** (if staged files include `index.html`, `legal.html`, or `i18n/locales/*.py`):

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
git push origin develop
```

---

## Publishing workflow (dev → production)

Use this when the user asks to **go live** or **publish**.

```sh
# 1. Ensure dev branch is committed and pushed
git checkout develop
git status   # clean working tree

# 2. Merge into main (prefer dev version on conflicts)
git checkout main
git pull origin main
git merge develop
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
| `python3 i18n/build-locales.py` | After EN HTML or locale `.py` changes | `develop` |
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
| Re-splitting gallery/destinations into per-category groups | They are intentionally **one continuous swipe carousel** each (see "Immersive carousels"); swiping must reach every category and tests assert single-track counts |
| Deleting `.lb-*` CSS or adding a gallery lightbox back | Gallery has no lightbox by design; `.lb-*` classes are shared with the retained `#dest-lightbox` |

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

### Hero first paint = inline critical CSS (`<style id="critical-css">` in `index.html` head)

`css/main.css` and `css/layout.css` load **async**, so anything the hero needs on first paint must be duplicated into the inline critical-css block, or it flashes/duplicates until the sheets arrive. **When you change hero CSS, mirror it in critical CSS too** (promo pill `.hero-promo .promo-msg`, `.season-rate-*`, `.hero-rates` panels all live there as well as in `main.css`). Two gotchas:

- **Use `var()`-free literals in critical CSS** — CSS custom properties (`--gold` etc.) are defined in `layout.css`, which hasn't loaded yet, so write `#c9a84c`, not `var(--gold)`.
- **Mobile/desktop variant hide must be a descendant selector**: `#hero :is(.hero-cta-link--mobile,…)` (note the space). The compound `#hero:is(…)` matches an element that *is* `#hero` and has those classes — i.e. nothing — so the mobile variants weren't hidden on desktop until `main.css` loaded, showing duplicate CTAs/rates/eyebrow. There's a budget (~13.5KB) + a `test-site.py` check guarding both the descendant selector and the inlined hero rules.

### CSS / boot loading (critical request chain)

The page boots from inline pieces so nothing renders behind a network round-trip: the **net-tier loader is inlined** (`<script id="ly-net-tier">`, kept byte-identical to `js/net-tier.js` by a build-locales protect/restore + a drift-guard test) and it loads `layout.css` then `main.css` (~300ms apart — small gap that protects the hero LCP, do not parallelize). **Do not turn net-tier back into an external `<script src>`** — that re-adds a render-blocking fetch ahead of all the CSS.

**Montserrat is loaded on idle, off the critical path.** There is **no `@font-face` with the `.woff2` in `main.css` or the critical block** — only the metric-matched `Montserrat Fallback` faces (local fonts, `size-adjust`/`ascent-override`) render first paint. The real font is injected by `LY_loadFont` and triggered via `LY_afterMeaningfulPaint` (post-load idle), with `font-display:optional` so it never swaps/shifts the current page (shows on the next cached load). **Don't re-add a Montserrat `@font-face` to CSS or a `<link rel=preload>` for the font** — that puts the 35KB back on the critical chain for a font that isn't used on first paint anyway.

---

## Anchor position pattern

Zero-height span marks the exact landing point inside a section:

```html
<span id="target" style="display:block;height:0;overflow:hidden" aria-hidden="true"></span>
```

Place the span where content should appear on landing; use `scroll-margin-top` in CSS to reveal content above it on tall viewports.