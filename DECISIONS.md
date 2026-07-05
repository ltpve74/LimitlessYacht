# DECISIONS — why things are the way they are

**Read this before touching performance, fonts, CSS/JS loading, CLS, or the build.**

Several choices below look like bugs or "easy wins" but are **deliberate, measured, hard‑won**.
Do **not** "fix" them without checking here first. Each entry lists what *not* to undo, and the
**symptom that looks like a regression but isn't** — so a misdiagnosis doesn't reverse a good change.

> Workflow rule: when a change is requested, scan this file first. If the request would undo
> something here, say so and confirm before proceeding. Add a new entry when you make a
> non‑obvious decision.

### How this is enforced (so it isn't just a doc nobody reads)

1. **SessionStart hook** (`.claude/settings.json` → `scripts/session-brief.sh`): prints the
   "DO NOT undo" list into context at the start of every session, so it's in front of the agent
   before any work begins.
2. **`# DECISION`‑tagged tests** in `scripts/test-site.py` encode these invariants (e.g. "Montserrat
   …off the critical path", the CLS reserves, the minifier‑safe selector). The point: you do **not**
   edit one to make a diff pass.
3. **Lock + pre‑commit** (`scripts/check-decision-guards.py` + `scripts/decision-guards.lock`): the
   pre‑commit hook re‑hashes every `# DECISION` test on **every commit, all branches**. If one was
   weakened, retitled, un‑tagged, or removed without the lock being updated, the commit is **blocked**.
   Changing a guard on purpose requires re‑reading this file and running
   `python3 scripts/check-decision-guards.py --accept` (a conscious override that shows up in the diff).

---

## Performance / loading

### 1. Montserrat is loaded OFF the critical path — NO `@font-face` in CSS
- **Decision:** the real `montserrat-latin.woff2` is **not** declared by any `@font-face` in
  `css/main.css` or the inline critical CSS. It is injected at runtime by `LY_loadFont` (inside the
  inlined `#ly-net-tier` boot script) and fired **after the page is interactive**. First paint uses
  the metric‑matched `Montserrat Fallback` / `Montserrat Fallback Hero` faces (local system fonts +
  `size-adjust`/`ascent-override`/`descent-override`, **zero download**).
- **Why:** keeps the 35 KB font off the critical request chain so it never steals bandwidth from the
  hero **LCP** image. LCP went 1.7 s → **1.1 s** and Speed Index 4.0 s → 1.1 s largely because of this.
  The font is `font-display:optional`, so first paint shows the fallback regardless.
- **DO NOT:** re‑add a Montserrat `@font-face` to `main.css` or the critical block; add
  `<link rel=preload>` for the font; or move the font load earlier. Each puts the 35 KB back on the
  critical chain and slows LCP. *(This was reverted once by mistake — don't repeat it.)*
- **Looks like a regression but isn't:** on a fresh/slow load you may briefly see system‑font text,
  then Montserrat appears. That is the intended fallback→font behaviour. The fallback is
  **metric‑matched**, so there is **no layout shift** — **the live site does not shift** (owner‑confirmed).
  If someone reports "font shifting," **measure CLS first** (it's ~0.01); do not revert this.

### 2. net‑tier boot loader is INLINED, not an external `<script src>`
- **Decision:** the loader lives inline as `<script id="ly-net-tier">` in `index.html`. The source of
  truth is `js/net-tier.js`; `i18n/build-locales.py` protects the block during rewrites and a
  `test-site.py` drift‑guard asserts the inline copy matches the file byte‑for‑byte.
- **Why:** as an external `<script src>` it was a render‑blocking fetch (~700 ms in the field) that
  gated **all** the CSS. Inlining removes that round‑trip and unblocks the parser (helps FCP).
- **DO NOT:** turn it back into `<script src="js/net-tier.js">`. **DO NOT** put `?v=` query strings in
  the net‑tier CSS *fallback* hrefs (`cssRoot + 'main.css'`) — the cache‑bump hook rewrites `?v=` in
  the inline copy but not the file, which trips the drift guard. The fallbacks are dead code anyway
  (`LY_*_CSS_HREF` is always set).

### 3. `main.css` loads ~300 ms after `layout.css` — this gap is intentional
- **Decision:** the boot script defers `main.css` by **300 ms** after `layout.css` applies.
- **Why:** `main.css` (~13 KB) loading dead‑parallel with the hero would compete with the **LCP image**
  for bandwidth. The 300 ms protects LCP. (It used to be **1500 ms** — far too slow, pushing main.css
  to ~2.6 s; cutting to 300 ms was a win.)
- **DO NOT:** parallelize `main.css` with the hero (risks the 1.1 s LCP); restore the 1500 ms; or
  combine `layout.css`+`main.css` (loses the structure‑first tiering).

### 4. The remaining "critical request chain" diagnostic is acceptable — stop chasing it
- **Decision:** Lighthouse's "Avoid chaining critical requests" still shows `HTML → layout.css →
  main.css`. We chose to stop optimizing it.
- **Why:** it is marked **"LCP Unscored"** — it does not feed any scored metric. All metrics are green
  (FCP/LCP/SI ~1.1 s, TBT 0, CLS ~0.01). Every further lever (preload, combine, inline‑all‑CSS) trades
  real complexity/risk for a cosmetic diagram change. See the chat where the owner agreed to stop.
- **DO NOT:** rearchitect the CSS build to shave this diagram. It's not worth it.

---

## CLS reserves — removing these brings the shift back

- **Reviews grid:** `#reviewsLoading` **and** `.reviews-grid` reserve `min-height:49rem` mobile /
  `24rem` desktop. The grid loads lazily and would jump ~+720 px without this. **Sized for exactly 3
  reviews** — re‑measure both values if the review count changes. (See CLAUDE.md "Reviews snippet + CLS reserve".)
- **Review snippet:** clamped to **4 lines** with `min-height:4lh` so every card is the same height.
- **Hero pull‑quote:** `.hero-pull-quote` has its `margin-top` mirrored into the **critical CSS**.
  Without it the bottom‑anchored hero cluster grew ~9 px when `layout.css` loaded (CLS 0.136).
- **Carousel nav:** mobile `.carousel-nav` has `min-height:3.2rem` so the position indicator/padding
  settling late doesn't resize the carousel cards.

## Critical CSS gotchas (see CLAUDE.md "Hero first paint")

- Mirror hero CSS into the inline critical block; use **`var()`‑free literals** (e.g. `#c9a84c`, not
  `var(--gold)` — `layout.css` isn't loaded yet).
- Mobile/desktop variant hide must be a **plain class list** (`.hero-cta-link--mobile,…{display:none!important}`),
  **not** `#hero :is(…)` — the minifier strips the space, collapsing it to the no‑op `#hero:is(…)` and
  the duplicates come back on desktop. Guarded by a `test-site.py` check.
- Critical CSS budget is ~13.5 KB (test‑guarded).

---

## Mobile funnel layout (destinations + gallery) — viewport-fit, nav-measured

- **Decision (2 Jul 2026, owner request after repeated regressions):** on mobile, the funnel
  sections are sized so that **tabs + card + chevron nav + bottom CTAs always fit the screen**:
  - JS (`refreshNavHeight()` in `index.html`) sets `--mobile-funnel-land-offset` to the **measured
    nav height + 2px** (re-measured on resize, on anchor clicks and when `ly-past-hero` flips), so
    the tabs' top edge lands skirting the nav bottom edge on any device — no hardcoded rem offsets.
  - `.gallery-wrap`/`.itinerary-wrap` = `calc(100svh − offset − max(.6rem, safe-area-inset-bottom))`,
    flex column; the card is `height:100%` of the flexible grid, so **the card (image) absorbs the
    size difference between devices** and the bottom buttons keep breathing room — never cut.
  - **Destination lightbox (≤640px) is image-first AND flick-stable:** `.dest-lb-img-wrap{flex:1 1 0%;
    min-height:34vh}` + `.dest-lb-body{flex:0 0 auto}` — zero flex-basis so the photo's intrinsic
    size can't reshuffle the layout per card; the body is constant via text reserves
    (`.dest-lb-name{min-height:2lh}`, desc clamp 4 + `4lh`, tagline 1 line, meta `5.5rem`).
    The image swap always sets a concrete `src` (master fallback under `srcset`), with the
    `.lb-loading` veil + generation guard so a stale photo can never linger when flicking.
  - **Blur preview → sharp fade is UNIVERSAL (owner directive, 3 Jul 2026):** every image —
    including the destination lightbox on every flick — loads its tiny `-prev.jpg` first via the
    standard `ly-prog` wrap, then fades the sharp in. The lightbox once bypassed this (HAR showed
    tier fetches with no preview); do not bypass it again. `# DECISION`-guarded.
  - **Lightbox counter / swipe hint / arrows live INSIDE `.dest-lb-img-wrap`** (anchored to the
    photo), not in the full-screen chrome with computed band offsets — so they can never overlap
    the text content regardless of body height. The **counter sits top-right of the blue body
    panel, baseline-aligned with the num/region line** (`.dest-lb-head-row`, owner request).
    Chrome keeps only the close button + tier badge.
- **DO NOT:** reintroduce fixed wrap heights (`calc(100svh - 3.8rem)`), hardcode the landing offset,
  or give the lightbox body `flex:1` back. Guarded by a `# DECISION` test
  ("mobile funnel sections are viewport-fit…"). Verified at 414×896, 390×844, 375×667:
  nav gap 2px, bottom breathing ~22px, deep-link tier drain intact.
- **Looks like a bug but isn't:** the card height varies per device (SE ~409px vs XR ~638px) —
  that's the adaptive design prioritising fit; don't "fix" it with a fixed aspect ratio.

## Build / git

- **Three‑tier flow:** work on `develop` (readable) → publish merges into `main` (minified). Each
  publish is a `main`‑only commit, so GitHub shows "develop is N commits behind main." **That is
  normal** — `develop` has all the source; `main` just carries the minified snapshots. **Never**
  back‑merge `main → develop` (it would pull minified files into the readable branch).
- **Check the source is readable BEFORE editing it.** This actually happened: a `main` "Publish:"
  commit (`b158b1c`, Jun 17 2026) got merged into the integration lineage and `index.html` /
  `legal.html` / `css/*.css` sat **minified on develop for weeks**, with real work committed on top.
  Un‑minified on 2 Jul 2026 with a byte‑exact round‑trip proof (`minify(unminified) == committed
  bytes`, EN + all locale pages) so production didn't change. The pre‑commit hook now **blocks**
  committing a <50‑line index.html/legal.html/main.css/layout.css on any non‑main branch. If you
  ever see single‑line source on develop: stop, don't edit it — un‑minify first with the same
  round‑trip proof, or you entrench the damage. Gotcha from the repair: locale PAIR strings
  containing `><` must keep their exact bytes or `build-locales.py` silently stops translating them.
  (Inline `<script>`/`<style>` bodies and `js/*.js` are still one‑line from that incident —
  un‑minifying those needs a string‑aware tokenizer; do it with the same proof or not at all.)
- Locale pages (`de/ es/ fr/`) are generated from `index.html` by `i18n/build-locales.py`. Never
  hand‑edit them. New visible English strings need PAIRS in all three `i18n/locales/*.py`.

---

## Hero uses a DIFFERENT image on mobile vs desktop (portrait vs landscape)

- **Decision (3 Jul 2026, owner request):** the hero serves a **portrait** shot on mobile
  (`maiora_20s_07`, bow-quarter at speed) and a **landscape** shot on desktop (`maiora_20s_02`,
  full profile). A landscape hero centre-cropped into a tall phone viewport loses the bow and
  stern — only the mid-hull shows. The split is wired in the existing hero `<picture>`: the
  `media="(max-width: 640px)"` `<source>` (and a matching `<source>` on the preview `<picture>`)
  point at the mobile 07 tiers; the default source + fallback `<img>` stay 02.
- **Both are the real Limitless** (replaced the stock Maiora, same batch).
- **The mobile hero image is deliberately cropped with the boat in the upper ~half** so the
  bottom-anchored rates pill sits over clean water and never overlaps the hull. On phones the
  viewport is always narrower than the photo, so the browser shows the full image height and
  `object-position` can't move the boat — the clearance has to be baked into the crop. Verified
  360×640 → 430×932. If you swap the mobile hero shot, re-crop so the boat clears the lower ~44%.
- **The portrait vs landscape hero switch is by `@media (orientation: portrait)`, NOT a width
  breakpoint** — so tablets in portrait (iPad, etc.) get the portrait shot too, and any landscape
  viewport (desktop, tablet landscape) gets the landscape shot, regardless of pixel width. Both the
  `<picture>` `<source media>` and the object-position rule use `orientation: portrait`.
- **Mobile hero `object-position` is `35% 40%`** (not centred) so the boat's BOW stays in frame — it
  is a bow-quarter shot and a centred crop cut the bow off the left. Desktop stays `58% 48%`.
- **Resolution note:** the portrait 07 tiles top out ~850px (processed from the co-work batch), so on
  large Retina tablets the portrait hero is slightly soft. If crispness matters there, reprocess 07
  from the full-res drone original at hero resolution (`process_media.py <src> hero maiora_20s_07`).
- **Gallery card 1 (`maiora_20s_01` aerial) uses `object-position:25% 60%`** so the tall portrait
  card lands on the boat (stern/flybridge/guests + cove), not the open water to its right. The old
  `90% 30%` was tuned for the previous stock photo; re-tune per image if card 1 is swapped.
- **DO NOT** "unify" the hero back to a single image to simplify the markup — mobile needs the
  portrait framing. The hero srcset tests assert mobile=maiora_20s_07 / desktop=maiora_20s_02.
- **Note:** `maiora_20s_07` is the mobile-hero image only — it is deliberately **not** in the
  gallery (owner: no duplication). The preview `<img>` onload uses `this.closest('.ly-prog-wrap')`
  (not `parentNode`) because it now sits inside a `<picture>`; keep it as `closest` or the CSS
  boot (`LY_loadLayoutCss`, `ly-prog-preview-ready`) breaks.

## Product decisions

- **Both seasonal prices shown** (low + high), high season labelled **Jul–Aug** (owner‑confirmed).
- **Hero promo pill REMOVED (2 Jul 2026, owner request).** The early‑bird campaign (previous €3,500
  high‑season rate for bookings by 1 July) ended; past its end date the pill rendered then hid via
  JS — a flash at page load. Removed entirely: HTML block, `lyInitRates()` phase JS, `.hero-promo`
  CSS (main.css + critical), the 3 PAIRS per locale, and `ly_promo_click`. **Its pill styling now
  lives on the hero rates panel** (`.hero-rates`: radius 999px, gold border .5, navy .82, blur,
  shadow — mirrored in critical CSS; keep both in sync). A guard test asserts no promo remnants.
  For a future campaign, resurrect from git history (`git log --grep=promo`, e.g. ac15354) rather
  than rebuilding from scratch.
- **Reviews Clarity events** (`ly_review_view_<author>`, `ly_review_expand[_<author>]`) — don't touch;
  used to measure reading vs expanding.
- **Calendar on‑hold dates are selectable for enquiry** (booked/past stay blocked). On‑hold cells are
  interactive (`.cal-cell[data-date]`, not `.free` only); a note explains "in talks with another
  guest — you can still enquire." Don't make on‑hold non‑selectable again.
