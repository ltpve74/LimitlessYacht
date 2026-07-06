# Slow-3G / Native-Image Handoff

Brief for the coding agent taking over. Same repo, branch **`experiment-slow-3g`**.
Read `CLAUDE.md` first for the branch/build rules (it governs this repo).

---

## Goal

Make the site fast and robust on slow/3G connections, and **simplify** the
image system. The previous approach used a large JS orchestrator
(`js/progressive-images.js`: a "hero gate", queues, IntersectionObserver, rAF)
that stripped `src`/`srcset` into `data-ly-*` and re-implemented image loading in
JS. It was fragile and broke repeatedly (blank images, scroll didn't load,
stalls in hidden tabs).

**Decision (confirmed by the owner):** replace it with **native `<img>` LQIP** —
real `src`/`srcset`, a blurred preview + lazy sharp that crossfades via existing
CSS on a one-line `onload`. Hero stays eager / `fetchpriority="high"`. No gate,
no queues, no IntersectionObserver, no rAF for images. Let the browser do the work.

---

## Immediate task: push

Five commits are done locally but **unpushed** (the previous agent's sandbox
couldn't reach GitHub). Working tree is clean. Just push:

    git push origin experiment-slow-3g

If `.git/*.lock` files block you, delete them first (zero-byte leftovers):
`rm -f .git/*.lock`. There may also be harmless junk like `.git/_r2`,
`.git/*.lock.*` you can remove.

The Pages preview workflow was extended to deploy this branch
(`.github/workflows/preview.yml`), so the push deploys to
**https://ltpve74.github.io/LimitlessYacht/** (~1-2 min). That URL is shared
with `experiment-no-prices` (last push wins).

### Unpushed commits (oldest -> newest)
- `eb6be8e` Fix hidden-tab reveal stall: make CSS reveal rAF-independent (net-tier.js)
- `2597315` Fix unclosed @media in critical CSS dropping hero progressive rules
- `5812888` Fix content images never loading: robust hero gate + JS cache-busting
- `cc2aae5` **Native LQIP images**: real <img> src/srcset + lazy load, drop JS orchestration
- `75264d7` Stop crash from vestigial JS image preloaders after native switch

---

## What's been done

1. **All 30 `<picture>` blocks converted to native LQIP** in `index.html` (hero,
   12 destination cards, gallery, about, amenities). Per image:

       <div class="ly-prog-wrap">
         <img class="ly-prog-preview" src="…-prev.jpg" loading="lazy" decoding="async"
              onload="this.parentNode.classList.add('ly-prog-preview-ready')">
         <picture class="…"><source srcset="…">…
           <img class="… ly-prog-sharp" src="…" loading="lazy" decoding="async"
                onload="this.closest('.ly-prog-wrap').classList.add('ly-prog-sharp-ready','ly-prog-sharp-visible')">
         </picture>
       </div>

   This **reuses the existing `.ly-prog-*` CSS** (critical inline + `css/layout.css`)
   that already does the blur->sharp fade — now driven by native `onload` instead
   of JS. Hero variant uses `.ly-prog-wrap--hero`, eager, `fetchpriority="high"`,
   and its preview `onload` also calls `LY_loadLayoutCss()` to trigger the reveal.

2. **`js/progressive-images.js` removed from the page** (script tag deleted). File
   still on disk, unreferenced — safe to `git rm`.

3. **Leftover hero-gate flags neutralized**: `window.LY_heroGateOpen = true`,
   `LY_heroGateBlocked()` returns false, `LY_onHeroSharpReady` kept as an array.

4. **Vestigial URL builders neutralized** (`LY_destCardUrl`, `LY_galleryCardUrl`,
   `LY_destLbUrl`, `LY_galleryLbUrl` -> `return ''`) because they called
   `LY_sharpTierSuffix` from the deleted file and threw on every carousel/gallery
   update. Stop-gap — see cleanup task below.

5. **Lightbox template restored** to its original JS-populated form.

6. **Locale pages rebuilt** (`de/ es/ fr/`) via `i18n/build-locales.py`. Locale
   image paths are root-relative `/images/…`; EN uses relative `images/…`.

**Static validation passed:** 234/234 referenced assets resolve (no 404s), tags
balanced, all 29 sharps + 29 previews have real `src`, 0 `LY_sharpTierSuffix`
calls remain. **Visual validation was NOT possible** — the owner's local dev
server kept going down and the sandbox can't host one reachable by the browser.
First real test is the Pages preview.

---

## What's LEFT (prioritized)

1. **Validate visually** (Pages preview or `python3 scripts/dev-server.py`):
   hero + destination + gallery + about images load with blur->sharp fade;
   **scrolling pulls in more** (the thing that was broken); no console errors;
   locale pages OK.

2. **Delete the dead preload subsystem** (owner explicitly wants this gone — it's
   the point of going native). Vestigial in `index.html`, remove with call sites:
   `LY_destCardUrl`, `LY_galleryCardUrl`, `LY_destLbUrl`, `LY_galleryLbUrl`,
   `LY_activateDestAdjacent`, `LY_activateGalleryCard`, `LY_activateUrl`,
   `LY_progressiveWrapForUrl`, `LY_cardTierFromMaster`, `LY_destMasterUrl`,
   `LY_galleryMasterUrl`, `LY_preloadedUrls`, and the image-preload parts of
   `LY_beginUserIntent` / `LY_urgentUrlsForNav` / `LY_cardUrlForEl`.
   **KEEP** the non-image logic they're tangled with: carousel/gallery/tab
   **navigation**, and availability-calendar + reviews fetching
   (`fetchAvail`/`fetchReviews`). Also `git rm js/progressive-images.js`.

3. **Lightbox** (tap-to-enlarge) still uses the old JS and won't load enlarged
   images. Migrate to native (read the card's existing `srcset`/`src`).

4. **CSS boundary fix** (owner's other request): in-page anchor jumps land wrong
   because `scroll-padding-top` / `scroll-margin-top` rules (esp. mobile-funnel:
   `html.ly-past-hero{scroll-padding-top}`, `#enquire-form`, `#avail-cal`) live in
   the **deferred `css/main.css`**. Move ALL functional/layout/anchor rules into
   `css/layout.css`; leave only non-essential polish in `main.css`. The split is
   generated by `scripts/split-css.py` — adjust the boundary there. Reference the
   live `main` branch for correct layout.

5. **Update tests.** `scripts/test-site.py` has ~35 failing checks — all assert the
   OLD progressive/`data-ly` architecture. Rewrite to assert native-LQIP structure.
   Keep the brace-balance + rAF-independent-reveal checks added earlier.

---

## Architecture / gotchas

- **Branch rules** (`CLAUDE.md`): edit only `experiment-slow-3g`. Never minify on
  dev. Never hand-edit `de/ es/ fr/` HTML — regenerate via `i18n/build-locales.py`.
- **CSS tiers:** inline critical (`<style id="critical-css">`, hero+nav, FCP) ->
  `css/layout.css` (reveal-critical, loaded by `js/net-tier.js`) -> `css/main.css`
  (deferred). `net-tier.js` adds `.ly-main-ready` to reveal below-hero content;
  it's rAF-independent now (softFrame) — keep that.
- **Cache-busting:** CSS uses `?v=N` (`scripts/bump-css-cache.py`). JS tags got
  `?v=2`; `build-locales.py` is version-aware for the `../js/` rewrite. Bump on change.
- **Image paths:** EN relative `images/…`; locales root-relative `/images/…` (do
  NOT change to `../` — `scripts/prepare-github-pages.py` only prefixes root-absolute
  paths for the Pages subpath). Every image has a `-prev.jpg` (blur baked, ~360px).
- The previous agent left **`.git` lock junk** (its sandbox couldn't delete in
  `.git`). Clean with `rm -f .git/*.lock .git/*.lock.* .git/_r2`.

---

## Validate quickly

    python3 scripts/dev-server.py     # http://127.0.0.1:8765/
    python3 scripts/test-site.py      # after updating tests
    # Browser (mobile + 3G throttle): hero + all images blur->sharp, scroll loads
    # more, no console errors, anchor links land correctly.
