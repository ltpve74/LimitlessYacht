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

## Build / git

- **Three‑tier flow:** work on `develop` (readable) → publish merges into `main` (minified). Each
  publish is a `main`‑only commit, so GitHub shows "develop is N commits behind main." **That is
  normal** — `develop` has all the source; `main` just carries the minified snapshots. **Never**
  back‑merge `main → develop` (it would pull minified files into the readable branch).
- Locale pages (`de/ es/ fr/`) are generated from `index.html` by `i18n/build-locales.py`. Never
  hand‑edit them. New visible English strings need PAIRS in all three `i18n/locales/*.py`.

---

## Product decisions

- **Both seasonal prices shown** (low + high), high season labelled **Jul–Aug** (owner‑confirmed).
- **Early‑bird promo** (`.hero-promo`): date‑driven tiers (standard → urgent → last → hidden), keeps
  the previous €3,500 high‑season day rate for bookings by **1 July**. Update copy + date boundaries
  + locale PAIRS together when the campaign changes.
- **Reviews Clarity events** (`ly_review_view_<author>`, `ly_review_expand[_<author>]`) — don't touch;
  used to measure reading vs expanding.
- **Calendar on‑hold dates are selectable for enquiry** (booked/past stay blocked). On‑hold cells are
  interactive (`.cal-cell[data-date]`, not `.free` only); a note explains "in talks with another
  guest — you can still enquire." Don't make on‑hold non‑selectable again.
