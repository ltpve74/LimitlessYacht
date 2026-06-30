# HANDOVER — start here

You're picking up an established codebase, **not** a blank slate. A lot of measured, deliberate
work is already done. Your first job is to load the existing knowledge so you don't re-derive,
re-guess, or undo good changes.

## Read these first, in this order
1. **`DECISIONS.md`** — *why* the load-bearing choices were made (fonts off the critical path,
   inlined net-tier loader, the 300 ms main.css gap, CLS reserves, minifier-safe selectors).
   Several look like bugs or easy wins but are intentional. Each entry says what **not** to undo
   and the **"symptom that looks like a regression but isn't."**
2. **`CLAUDE.md`** — how the repo works: the three-tier git workflow, locale build, critical CSS,
   carousels, analytics/Clarity events, seasonal pricing, the calendar.
3. **This file** — current state + open items + operating notes that aren't obvious from code.

These three are the "memory." **Keep developing it** — when you make a non-obvious decision, add an
entry to DECISIONS.md (and tag a guard test, see below). When you finish a chunk of work, update the
"Current state / open items" here.

## The one rule that matters most
**Do not reverse a deliberate decision on a hunch.** This is not hypothetical — in the session that
created this handover, a misread "font shift" report led to nearly re-adding the Montserrat
`@font-face` to CSS, which would have undone the LCP work. The owner caught it. That's why the
enforcement below exists. If a request seems to undo something in DECISIONS.md, **say so and confirm
with the owner before doing it. Measure first** (e.g. CLS) rather than assuming a regression.

## How the memory is enforced (you'll hit these — they're on your side)
- **SessionStart hook** (`.claude/settings.json` → `scripts/session-brief.sh`) prints the
  "DO NOT undo" list into your context at session start.
- **`# DECISION`-tagged tests** in `scripts/test-site.py` encode the invariants.
- **Lock + pre-commit** (`scripts/check-decision-guards.py` + `scripts/decision-guards.lock`):
  every commit re-hashes the tagged tests; if one was weakened/removed without the lock updated, the
  commit is **blocked**. To change a guard on purpose: update DECISIONS.md, edit the test, run
  `python3 scripts/check-decision-guards.py --accept`, stage the lock. That `--accept` is the
  conscious, diff-visible override. **Never weaken a guard just to make your diff pass.**

---

## Current state (update this as you go)
- **Branches:** work on `develop` (readable source); publish merges into `main` (minified,
  Netlify-deployed to `limitlessyachtcharter.com`). GitHub Pages preview deploys from `develop`.
  GitHub showing "develop is N commits behind main" is **normal** (publish commits live only on
  `main`); never back-merge `main → develop`.
- **Live on production (`main`):** the full performance overhaul + reviews + promo + pricing
  (see "What's been done"). All metrics green.
- **On `develop`, NOT yet published:** the **calendar on-hold feature** — dates marked "on hold"
  (tentative in the availability feed) are now selectable for an enquiry (booked/past stay blocked),
  with a note explaining "in talks with another guest — you can still enquire." Plus the
  **memory/enforcement system** (DECISIONS.md, hook, guards). Owner was reviewing the calendar on
  the preview. **Open question for the owner: publish this batch to production?**

## What's been done (knowledge — don't relearn the hard way)
- **CLS:** 0.59 → **0.013**. Fixes: hero pull-quote `margin-top` mirrored into critical CSS;
  reviews grid reserves `min-height` (49rem mobile / 24rem desktop, **sized for exactly 3 reviews**);
  carousel-nav `min-height`. Removing any of these brings the shift back.
- **Speed Index** 4.0 s → **1.1 s**, **LCP** 1.7 s → **1.1 s**. Done by: inlining the net-tier boot
  loader (was a render-blocking external fetch), cutting the main.css defer 1500 ms → 300 ms, and
  loading Montserrat **off the critical path** (no `@font-face` in CSS; injected by `LY_loadFont`
  after the page is interactive; first paint uses the metric-matched fallback). **This font setup is
  deliberate — see DECISIONS.md §1. A "font shift" is not a reason to revert it.**
- **Critical request chain:** 2,773 ms → ~650 ms. The remaining `HTML → layout.css → main.css` is
  "LCP Unscored" and **we agreed to stop chasing it** — don't rearchitect the CSS build for a
  cosmetic diagram.
- **Reviews:** snippet expanded to **4 lines** (`-webkit-line-clamp:4` + `min-height:4lh`, uniform
  cards); Clarity engagement events (`ly_review_view_<author>`, `ly_review_expand[_<author>]`).
- **Pricing/promo:** both seasonal prices shown (high = **Jul–Aug**); date-driven early-bird promo
  pill (standard → urgent → last → hidden) holding the previous €3,500 high-season day rate for
  bookings by 1 July; clickable, fires `ly_promo_click`.
- **Calendar:** on-hold dates selectable (above).

## Open items / next steps
1. **Publish the `develop` batch** (calendar on-hold + memory system) to production once the owner
   confirms. Publish flow is in CLAUDE.md ("Publishing workflow"); the gate runs `test-site.py`.
2. **Check Clarity field data** after a few days of real traffic: CLS/INP across sessions, review
   read vs expand rates, promo clicks. (Owner's plan — don't judge perf off a single lab run.)
3. **Don't** chase the font out of the critical-chain diagram further, and **don't** touch the font
   loading on a "shift" report without measuring CLS first.

## Operating notes (gotchas not visible in the code)
- **Local dev server is not production-representative for loading.** `scripts/dev-server.py` loads
  CSS via the tiered `net-tier` mechanism and proxies the availability feed to production. For
  measurements: force `main.css` to load (Playwright `add_style_tag(url=…/css/main.css)`); trigger
  the calendar fetch with `window.LY_beginUserIntent({fetchAvail:true})`; to test availability
  states, temporarily edit the stub in `dev-server.py` (revert before committing) — the calendar
  only renders one month, so navigate with `#calNext`.
- **Production URL is blocked** by the agent proxy — you can't Playwright `https://limitlessyachtcharter.com`.
  Verify against the committed `main` branch and the GitHub Pages preview instead.
- **Playwright:** Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (pass
  `executable_path=`); 96 % of traffic is mobile, so test at 375×667 first.
- **The minifier strips significant whitespace.** A descendant selector like `#hero :is(…)` collapses
  to the no-op `#hero:is(…)` in production — use plain class lists in critical CSS (guarded).
- **Verify by running the app**, not by re-running tests. The app shows real behaviour; tests are
  the author's claim. Measure CLS/timing with a PerformanceObserver; screenshot at the actual
  viewport before/after a fix.
- **i18n:** locale pages (`de/ es/ fr/`) are generated from `index.html` by `i18n/build-locales.py`.
  Never hand-edit them. New visible English strings need PAIRS in all three `i18n/locales/*.py`.

## When you finish work
- Update "Current state" above and add any new decision to DECISIONS.md (+ tag a guard test +
  `--accept` the lock). Leave the memory better than you found it — that's the whole point.
