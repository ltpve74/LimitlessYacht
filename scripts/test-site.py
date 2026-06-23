#!/usr/bin/env python3
"""
Pre-commit site test suite for limitlessyachtcharter.com

Checks conversion-critical elements across all locale pages and validates
inline JavaScript syntax. Runs automatically from .githooks/pre-commit after
minification on main. Exit 0 = all pass; non-zero blocks the commit.

Usage (manual):
  python3 scripts/test-site.py          # full suite
  python3 scripts/test-site.py --quick  # HTML/asset checks only, skip JS syntax
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LOCALE_FILES = [
    'index.html',
    'de/index.html',
    'fr/index.html',
    'es/index.html',
]

LEGAL_FILES = [
    'legal.html',
    'de/legal.html',
    'fr/legal.html',
    'es/legal.html',
]

LOCALE_META = {
    'index.html':      {'lang': 'en', 'form': 'contact-en', 'reviews_json': '/data/reviews.json'},
    'de/index.html':   {'lang': 'de', 'form': 'contact-de', 'reviews_json': '/data/reviews-de.json'},
    'fr/index.html':   {'lang': 'fr', 'form': 'contact-fr', 'reviews_json': '/data/reviews-fr.json'},
    'es/index.html':   {'lang': 'es', 'form': 'contact-es', 'reviews_json': '/data/reviews-es.json'},
}

LOCALE_REVIEW_FILES = {
    'de': 'data/reviews-de.json',
    'es': 'data/reviews-es.json',
    'fr': 'data/reviews-fr.json',
}

LEGAL_META = {
    'legal.html':    {'lang': 'en'},
    'de/legal.html': {'lang': 'de'},
    'fr/legal.html': {'lang': 'fr'},
    'es/legal.html': {'lang': 'es'},
}

SECTION_IDS = [
    'hero', 'intro', 'about', 'itinerary', 'gallery', 'charters',
    'availability', 'reviews', 'amenities', 'specs',
]

HREFLANGS = ('en', 'de', 'fr', 'es', 'x-default')


def css_rule_index(css: str, selector: str) -> int:
    """Start index of a CSS rule block (readable or minified). Returns -1 if missing."""
    parts = selector.split()
    pat = r'\s+'.join(re.escape(part) for part in parts) + r'\s*\{'
    m = re.search(pat, css)
    return m.start() if m else -1


def deferred_bootstrap_pos(html: str) -> int:
    """Marker after hero for deferred scripts (readable comment or minified token)."""
    hero = html.find('id="hero"')
    if hero < 0:
        return -1
    for marker in (
        '<!-- Deferred head bootstrap',
        'LY_afterLcp',
        "'/js/error-guard.js'",
    ):
        pos = html.find(marker)
        if pos > hero:
            return pos
    return -1


def is_minified_html(html: str) -> bool:
    """Heuristic: production pages are single-line after minify."""
    return len(html) > 10_000 and html.count('\n') < 15


# ── Output helpers ─────────────────────────────────────────────────────────────

GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'


class Runner:
    def __init__(self):
        self.failures: list[str] = []
        self.passes = 0

    def ok(self, label: str) -> None:
        self.passes += 1
        print(f'  {GREEN}✓{RESET}  {label}')

    def fail(self, label: str, detail: str = '') -> None:
        msg = label + (f' — {detail}' if detail else '')
        self.failures.append(msg)
        print(f'  {RED}✗{RESET}  {msg}')

    def warn(self, label: str) -> None:
        print(f'  {YELLOW}⚠{RESET}  {label}')

    def check(self, label: str, cond: bool, detail: str = '') -> None:
        if cond:
            self.ok(label)
        else:
            self.fail(label, detail)

    def summary(self) -> bool:
        total = self.passes + len(self.failures)
        print()
        print('─' * 58)
        if self.failures:
            print(f'{RED}FAILED{RESET}  {len(self.failures)}/{total} checks failed:')
            for f in self.failures:
                print(f'  • {f}')
        else:
            print(f'{GREEN}PASSED{RESET}  All {total} checks passed.')
        print('─' * 58)
        return len(self.failures) == 0


def read_file(rel: str) -> str | None:
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None


def read_site_css() -> str | None:
    """layout.css (reveal) + main.css (enhance) for checks spanning the split."""
    layout = read_file('css/layout.css')
    main = read_file('css/main.css')
    if layout is None and main is None:
        return None
    return (layout or '') + (main or '')


# ── HTML checks ────────────────────────────────────────────────────────────────

def check_html(r: Runner, rel: str, html: str) -> None:
    meta = LOCALE_META[rel]

    # Enquiry flow
    r.check('#enquire scroll anchor exists', 'id="enquire"' in html)
    r.check('enquiry CTAs link to #enquire', 'href="#enquire"' in html)
    r.check(
        'reviews and specs desktop keep single availability CTA',
        'section-cta-avail--desktop' in html
        and 'section-cta-quote--desktop' not in html
        and html.count('href="#availability" class="btn-primary section-cta-avail--desktop"') == 2
        and html.count('href="#avail-cal" class="btn-primary section-cta-avail--mobile"') == 2
        and html.count('href="#enquire" class="btn-ghost section-cta-quote--mobile"') == 2,
    )
    r.check(
        'charters section groups options with includes panel',
        'class="charters-main"' in html
    )
    r.check(
        'charters desktop cross-nav nudges availability and reviews',
        re.search(
            r'<section id="charters">[\s\S]*?href="#availability"[^>]*class="btn-ghost"'
            r'[\s\S]*?href="#reviews-land"[^>]*class="btn-ghost"',
            html,
        )
        is not None
        and 'section-cross-cta--desktop' in html,
    )
    r.check(
        'reviews desktop cross-nav nudges charters and amenities',
        re.search(
            r'<section id="reviews">[\s\S]*?href="#charters-land"[^>]*class="btn-ghost"'
            r'[\s\S]*?href="#amenities-land"[^>]*class="btn-ghost"',
            html,
        )
        is not None
        and re.search(
            r'<section id="reviews">[\s\S]*?</div>\s*<div class="section-cross-cta section-cross-cta--desktop',
            html,
        )
        is not None,
    )
    r.check(
        'about desktop cross-nav nudges charters and reviews',
        re.search(
            r'<section id="about">[\s\S]*?href="#charters-land"[^>]*class="btn-ghost"'
            r'[\s\S]*?href="#reviews-land"[^>]*class="btn-ghost"',
            html,
        )
        is not None,
    )
    r.check(
        'availability desktop cross-nav nudges charters and reviews',
        re.search(
            r'<section id="availability">[\s\S]*?href="#charters-land"[^>]*class="btn-ghost"'
            r'[\s\S]*?href="#reviews-land"[^>]*class="btn-ghost"',
            html,
        )
        is not None,
    )
    r.check(
        'amenities desktop cross-nav nudges charters and availability',
        re.search(
            r'<section id="amenities">[\s\S]*?href="#charters-land"[^>]*class="btn-ghost"'
            r'[\s\S]*?href="#availability"[^>]*class="btn-ghost"',
            html,
        )
        is not None,
    )
    r.check(
        'specs desktop cross-nav nudges charters and reviews',
        re.search(
            r'<section id="specs">[\s\S]*?href="#charters-land"[^>]*class="btn-ghost"'
            r'[\s\S]*?href="#reviews-land"[^>]*class="btn-ghost"',
            html,
        )
        is not None,
    )
    r.check(
        'charter enquiry cards land on funnel anchor with tier tab switch',
        re.search(
            r'<section id="charters">[\s\S]*?class="enquiry-card[^"]*"[^>]*href="#itinerary-funnel"[^>]*data-charter-tier="half-day"',
            html,
        )
        is not None
        and html.count('href="#itinerary-funnel"') >= 5
        and 'href="#half-day"' not in html.split('<section id="charters">')[1].split('</section>')[0]
        and "tier === 'weekend' || tier === 'extended' ? 'multi-day' : tier" in html
        and "sessionStorage.setItem('ly_funnel_tier', tabTier)" in html
        and "sessionStorage.setItem('ly_funnel_charter_tier', tier)" in html
        and 'function applyFunnelTierFromStorage()' in html
        and 'extended: 9' in html
        and "hash === 'itinerary-funnel'" in html.split('function checkHash')[1][:400]
        and "e.target.closest('#charters .enquiry-card')" in html
        and "location.hash === '#itinerary-funnel'" in html
        and 'Native #itinerary-funnel jump handles scroll' in html
        and "history.pushState(null, '', '#itinerary-funnel')" not in html.split('cardEvents = {')[1].split('})();')[0]
        and re.search(
            r'data-charter-tier="extended"[^>]*href="#itinerary-funnel"|href="#itinerary-funnel"[^>]*data-charter-tier="extended"',
            html.split('<section id="charters">')[1].split('</section>')[0],
        )
        is not None,
    )
    r.check(
        'charters mobile back-link nudges availability not destinations',
        re.search(
            r'<section id="charters">[\s\S]*?<p class="section-back-cta[^"]*">[\s\S]*?href="#availability"',
            html,
        )
        is not None
        and re.search(
            r'<section id="charters">[\s\S]*?section-back-cta[\s\S]*?href="#itinerary"',
            html,
        )
        is None,
    )
    r.check(
        'reviews section groups summary and grid in reviews-main',
        'class="reviews-main"' in html
        and re.search(
            r'<div class="reviews-main">[\s\S]*?id="reviewsGrid"',
            html,
        )
        is not None,
    )

    # WhatsApp — every wa.me link must carry a pre-filled ?text= message
    wa_links = re.findall(r'href="(https://wa\.me/[^"]+)"', html)
    if wa_links:
        bare = [l for l in wa_links if '?text=' not in l]
        r.check(
            f'All {len(wa_links)} WhatsApp link(s) have ?text= pre-fill',
            not bare,
            'bare links (user lands on blank chat): ' + ', '.join(bare) if bare else '',
        )
    else:
        r.fail('WhatsApp link(s) present', 'no wa.me links found in page')

    r.check('.form-col-wa WhatsApp button inside form column', 'form-col-wa' in html)

    # Contact form
    form_tag_m = re.search(r'<form\b[^>]*id="contactForm"[^>]*>', html)
    form_tag = form_tag_m.group(0) if form_tag_m else ''
    r.check('id="contactForm" exists', bool(form_tag))
    if form_tag:
        r.check('form has no novalidate (browser validation on)', 'novalidate' not in form_tag)

    form_name = meta['form']
    r.check(
        f'Netlify form name is {form_name}',
        f'name="{form_name}"' in html and f'value="{form_name}"' in html,
    )

    r.check(
        'name field is required',
        any('name="name"' in t and 'required' in t for t in re.findall(r'<input\b[^>]*>', html)),
    )
    r.check(
        'email field is required',
        any('name="email"' in t and 'required' in t for t in re.findall(r'<input\b[^>]*>', html)),
    )

    # Destination lightbox
    r.check('id="dest-lb-cta" lightbox CTA exists', 'id="dest-lb-cta"' in html)
    r.check(
        'destination lightbox CTA has viewport-specific labels',
        'class="dest-lb-cta-desktop"' in html
        and 'class="dest-lb-cta-mobile"' in html,
    )
    r.check(
        'destination lightbox CTA routes by viewport',
        'function syncDestLbCta()' in html
        and "'#enquire-land'" in html
        and "lbCta.href = w <= 640 ? '#avail-cal' : (w <= 1100 ? '#availability-land' : '#enquire-land')" in html
        and 'function lyGoAvailSectionLand()' in html
        and "a[href=\"#avail-cal\"], a[href=\"#availability\"]" in html
        and 'if (w < 641 || w > 1100) return' in html
        and "location.hash === '#availability-land'" in html
        and 'function closeDestLbAndGo(hash)' in html
        and "dest === '#availability-land'" in html
        and 'lyGoAvailSectionLand();' in html
        and "location.pathname + location.search" in html
        and 'location.hash = dest' in html,
    )
    r.check(
        'destination lightbox uses single CTA button',
        'dest-lb-cta-secondary' not in html
        and 'dest-lb-cta-avail' not in html
        and html.count('class="btn-primary dest-lb-cta"') == 1,
    )
    r.check(
        'gallery lightbox uses centralized images array',
        'window.LY_GALLERY_IMAGES = [' in html
        and 'window.LY_GALLERY_IMAGES_MOBILE = [' in html
        and 'const images = window.LY_GALLERY_IMAGES' in html
        and 'function showImage(idx)' in html,
    )
    r.check(
        'shared destination image registry (LY_DEST_IMAGES)',
        'window.LY_DEST_IMAGES = [' in html and 'window.LY_DEST_IMAGES_MOBILE = [' in html,
    )
    r.check(
        'destination lightbox uses shared image registry',
        'var destImages = window.LY_DEST_IMAGES' in html,
    )
    r.check(
        'destination carousel activates progressive wraps (no preload queues)',
        'window.LY_destMasterUrl' in html
        and 'window.LY_enqueueCardPreload' not in html
        and 'window.LY_enqueueLbPreload' not in html,
    )
    r.check(
        'itinerary carousel cards have data-dest-idx',
        html.count('data-dest-idx="') == 12,
    )
    r.check(
        'destination cards use responsive tier srcsets (lightbox reuses loaded tier)',
        'window.LY_syncDestCardImages' not in html
        and html.count('class="destination-card-bg"') == 12
        and html.count('sizes="78vw"') == 12
        and 'portals-vells-1-640.webp' in html
        and 'portals-vells-1-720.webp' in html
        and 'images/mobile/dest/portals-vells-1-960.webp 640w' in html
        and 'images/mobile/dest/portals-vells-1.webp 960w' in html
        # Lightbox: cache hit if card was visible; card srcset (WebP tiers only,
        # never .jpg fallback or master) if not yet loaded.
        and 'window.LY_cardLoadedSrc' in html
        and 'window.LY_cardSrcset' in html
        and 'lbImg2.src = loadedSrc' in html,
    )
    r.check(
        'gallery cards use responsive tier srcsets (lightbox reuses loaded tier)',
        'maiora_20s_01-640.webp' in html
        and 'maiora_20s_01-720.webp' in html
        and 'images/mobile/maiora_20s_03-960.webp 960w' in html
        and 'images/mobile/maiora_20s_03.webp 960w' not in html
        and '(min-width: 1101px) 25vw, 50vw' in html
        and 'applyGalleryLbFrame(targetIdx, window.LY_galleryMasterUrl' in html
        and 'window.LY_cardLoadedSrc(item)' in html
        and 'lbLoadGen' in html
        and 'class="lb-loader"' in html
        and 'id="lightbox-img" src="" alt="Limitless yacht gallery photo" sizes="100vw"' in html,
    )
    r.check(
        'lightbox never loads .jpg fallback for unvisited cards',
        # LY_cardLoadedSrc must only return currentSrc, not getAttribute("src")
        # which is the .jpg fallback. Unloaded cards must go through LY_cardSrcset.
        "sharp.getAttribute('src')" not in html.split('LY_cardLoadedSrc')[1][:500]
        and 'window.LY_cardSrcset' in html,
    )
    r.check(
        'carousel helpers use sharp-tier URLs after meaningful paint',
        'window.LY_afterMeaningfulPaint' in html
        and 'window.LY_cardPreloadQueue' not in html
        and 'window.LY_lbPreloadQueue' not in html,
    )
    r.check(
        'itinerary carousel fires scroll event (no adjacent progressive activation)',
        'window.lyCarouselStep' in html
        and "gr.dispatchEvent(new Event('scroll'))" in html,
    )
    r.check(
        'carousel step avoids offsetLeft on mobile (forced reflow guard)',
        'window.lyCarouselStep' in html
        and 'window.innerWidth * 0.78 + 12' in html
        and 'grid.classList.contains(\'gallery-grid\')' in html
        and 'requestAnimationFrame(update)' in html,
    )
    r.check(
        'nav height cached and initial section sync deferred to rAF',
        'refreshNavHeight' in html
        and '_navHeight' in html
        and re.search(
            r'requestAnimationFrame\(function\s*\(\)\s*\{[\s\S]*?refreshNavHeight\(\);[\s\S]*?updateNavSection\(\);',
            html,
        )
        is not None,
    )
    net_tier_js = read_file('js/net-tier.js') or ''
    r.check(
        'nav intent upgrades progressive wraps (no preload orchestration)',
        'window.LY_beginUserIntent' in html
        and 'window.LY_warmPreloadCaches' not in html
        and 'window.LY_preloadNeedsUserPriority' not in html
        and 'LY_PRELOAD_AGGRESSIVE' not in net_tier_js,
    )
    r.check(
        'carousel updates position indicator on scroll',
        'grid.addEventListener' in html
        and 'posEl.textContent' in html,
    )
    r.check(
        'lightbox navigation coalesces rapid clicks and shows loading state',
        'window.LY_formatLbCounter' in html
        and 'setGalleryLbLoading' in html
        and 'destLbLoadGen' in html
        and 'destLbImgWrap' in html
        and 'class="lb-loader"' in html
        and re.search(r'dest-lb-img-wrap[\s\S]*?class="lb-loader"', html) is not None,
    )
    r.check(
        'all connections use blurred preview then sharp fade upgrade',
        'LY_PROGRESSIVE_IMAGES' in net_tier_js
        and 'LY_PROGRESSIVE_IMAGES=true' in net_tier_js.replace(' ', '')
        and 'maiora_20s_02-prev.webp' not in net_tier_js
        # Progressive markup lives inline in index.html; the sharp tier ships in
        # data-ly-src / data-ly-srcset and is promoted by LY_promoteSharp.
        and 'data-ly-src=' in html
        and 'data-ly-srcset=' in html
        and 'window.LY_promoteSharp' in html
        and 'LY_loadLayoutCss' in net_tier_js
        and 'LY_loadMainCss' in net_tier_js
        and 'LY_applyPictureSrc' not in net_tier_js
        and 'ly-prog-critical' not in net_tier_js
        and '@layer layout' in (read_file('css/layout.css') or '')
        and '@layer layout, site' in (read_file('css/layout.css') or '')
        and '@layer site' in (read_file('css/main.css') or '')
        and '.ly-prog-wrap--hero' in html
        and 'ly-prog-wrap--hero{position:absolute;inset:0;overflow:hidden;background:transparent}' in re.sub(
            r'\s+', '', html[html.find('id="critical-css"'):html.find('</style>', html.find('id="critical-css"'))]
        )
        and '#hero.hero-bg:not(.ly-prog-sharp){opacity:0!important;visibility:hidden!important}' in re.sub(
            r'\s+', '', html[html.find('<style id="fouc-guard">'):html.find('</style>', html.find('id="fouc-guard"'))]
        )
        and 'object-position:52% 40%' in html
        and 'max-height:520px' in html
        and 'nav{opacity:0;visibility:hidden;pointer-events:none}' in re.sub(
            r'\s+', '', html[html.find('id="critical-css"'):html.find('</style>', html.find('id="critical-css"'))]
        )
        and 'build_preview_image' in (read_file('scripts/build_preview_images.py') or '')
        and re.search(
            r'def build_preview_image[\s\S]*?soften_preview[\s\S]*?resize_preview',
            read_file('scripts/build_preview_images.py') or '',
        ) is not None
        and "lyInjectPreload(lyImg('maiora_20s_02-1280.webp')" not in net_tier_js
        and 'class="ly-prog-preview"' in html
        and 'maiora_20s_02-prev.jpg' in html
        and re.search(
            r'class="ly-prog-preview"[^>]*decoding="async"[^>]*loading="eager"',
            html,
        ) is not None
        and '.ly-prog-wrap--hero.ly-prog-preview{z-index:0;opacity:1;transform:scale(1.06)}' in re.sub(
            r'\s+', '', html[html.find('id="critical-css"'):html.find('</style>', html.find('id="critical-css"'))]
        )
        and 'filter:blur(8px)' not in (read_file('css/layout.css') or '')
        and 'GaussianBlur' in (read_file('scripts/build_preview_images.py') or '')
        and 'LY_stemFromMasterUrl' in html
        and 'LY_NET_SLOW' not in html
        and "lyInjectPreload(lyImg('mobile/maiora_20s_02-720.webp')" not in net_tier_js
        and "lyInjectPreload(lyImg('maiora_20s_02-640.webp')" not in net_tier_js
        and 'LY_applySlowSrcsets' not in html
        and 'LY_warmPreloadCaches' not in html,
    )
    r.check(
        'preview placeholder assets exist for hero and destinations',
        os.path.isfile('images/maiora_20s_02-prev.jpg')
        and os.path.isfile('images/mobile/maiora_20s_02-prev.jpg')
        and os.path.isfile('images/dest/portals-vells-1-prev.jpg')
        and os.path.isfile('images/mobile/dest/portals-vells-1-prev.jpg'),
    )
    r.check(
        'preview placeholders are progressive JPEG for incremental paint',
        'progressive=True' in (read_file('scripts/build_preview_images.py') or '')
        and '-prev.jpg' in (read_file('scripts/build_preview_images.py') or ''),
    )

    def _is_progressive_jpeg(path: str) -> bool:
        try:
            with open(os.path.join(ROOT, path), 'rb') as fh:
                head = fh.read(4096)
            return b'\xff\xc2' in head
        except OSError:
            return False

    r.check(
        'hero preview JPEG is progressive-encoded (SOF2 scan)',
        _is_progressive_jpeg('images/mobile/maiora_20s_02-prev.jpg')
        and _is_progressive_jpeg('images/maiora_20s_02-prev.jpg'),
    )
    hero_prev_kb = os.path.getsize(os.path.join(ROOT, 'images/mobile/maiora_20s_02-prev.jpg')) / 1024
    dest_prev_kb = os.path.getsize(os.path.join(ROOT, 'images/dest/portals-vells-1-prev.jpg')) / 1024
    build_py = read_file('scripts/build_preview_images.py') or ''
    preview_blur = float(re.search(r'PREVIEW_BLUR\s*=\s*([0-9.]+)', build_py).group(1))
    preview_edge = int(re.search(r'PREVIEW_EDGE\s*=\s*([0-9]+)', build_py).group(1))
    r.check(
        'all previews share one pre-blur profile for Slow 3G progressive paint',
        8.0 <= hero_prev_kb <= 18.0
        and 6.0 <= dest_prev_kb <= 20.0
        and preview_edge == 360
        and 'PREVIEW_BLUR' in build_py
        and 'HERO_PREVIEW_BLUR' not in build_py
        and 'HERO_STEMS' not in build_py
        and 'BLUR_WORK_EDGE' in build_py
        and 'BLUR_PASSES' in build_py
        and 'apply_gaussian_blur' in build_py
        and 'subsampling=0' in build_py
        and 0.7 <= preview_blur <= 1.0,
    )
    r.check(
        'card images use blurred preview as loading state (no spinners)',
        'window.LY_initCardLoaders' not in html
        and 'window.LY_setCardLoading' not in html
        and 'markCarouselTarget' not in html
        and 'markGalleryTarget' not in html
        and 'ly-prog-preview' in html,
    )
    r.check(
        'previews load first; sharps deferred via data-ly-src (no bandwidth race)',
        # Previews keep a real src so they load immediately when near viewport.
        'class="ly-prog-preview" src="' in html
        # Every non-hero sharp ships deferred — no eager src/srcset to race the preview.
        and html.count('class="ly-prog-sharp" data-ly-src="') == 28
        and 'class="ly-prog-sharp" src=' not in html
        and html.count('data-ly-srcset="') >= 56
        # Hero stays eager (it is the LCP): its sharp keeps a real src.
        and 'class="hero-bg ly-prog-sharp" src="' in html,
    )
    r.check(
        'sharp promotion gated on preview-ready + viewport, held until meaningful paint',
        'window.LY_promoteSharp' in html
        and "wrap.querySelector('.ly-prog-sharp[data-ly-src]')" in html
        and "sharp.setAttribute('src', src)" in html
        # promote only after the preview has loaded so the blur always paints first
        and "wrap.classList.contains('ly-prog-preview-ready')" in html
        and 'function initSharpPromotion' in html
        and 'new IntersectionObserver' in html.split('function initSharpPromotion')[1][:600]
        # vertical-only rootMargin: preload on scroll-down but don't arm every
        # off-screen carousel card to the right at once (visible card must win)
        and "rootMargin: '400px 0px'" in html
        # most-visible card armed first so its sharp is requested ahead of peers
        and 'b.intersectionRatio - a.intersectionRatio' in html
        # hero excluded (it loads eagerly), and the whole phase waits for paint
        and ".ly-prog-wrap:not(.ly-prog-wrap--hero)" in html
        and 'LY_afterMeaningfulPaint(initSharpPromotion)' in html
        # armWrap exposed globally so gallery tab switches can re-arm without the IO
        and 'window.LY_armWrap = armWrap' in html,
    )
    r.check(
        'gallery tab switch arms wraps for Safari IO display:none bug',
        # setGalleryTab must explicitly arm wraps in the newly-active group so that
        # Safari's IO (which doesn't re-fire after display:none→block) still loads images
        'window.LY_armWrap' in html
        and "g.querySelectorAll('.ly-prog-wrap')" in html
        and 'window.LY_armWrap(ws[wi])' in html,
    )
    r.check(
        'anchor CTAs trigger progressive upgrade on nav',
        'window.LY_onNavIntent' in html
        and 'window.LY_sectionFromHash' in html
        and 'window.LY_GALLERY_TAB_IDX' in html
        and 'window.LY_loadAvailCalNow' in html
        and 'window.LY_loadReviewsNow' in html
        and re.search(
            r"document\.addEventListener\('click'[\s\S]*?LY_onNavIntent\(href\)",
            html,
        )
        is not None,
    )
    r.check(
        'destination preload not burst on DOMContentLoaded',
        'dest.forEach(function(src)' not in html,
    )

    # Lightbox click behaviour (gallery + itinerary parity)
    r.check(
        'gallery lightbox backdrop click closes',
        'if(e.target === lightbox) closeGalleryLb()' in html,
    )
    r.check(
        'gallery lightbox image half-tap navigates',
        "lbImg.addEventListener('click'" in html
        and 'lbWasSwiped' in html
        and 'showImage(currentIdx - 1)' in html
        and 'showImage(currentIdx + 1)' in html,
    )
    r.check(
        'gallery lightbox guards missing DOM nodes',
        'if (!lbImg || !images.length) return' in html
        and 'if (lightbox && lbImg)' in html,
    )
    r.check(
        'gallery lightbox swipe guard uses touchmove',
        "lightbox.addEventListener('touchmove'" in html
        and 'lbWasSwiped = true' in html,
    )
    r.check(
        'itinerary lightbox backdrop click closes',
        'if (e.target === destLb)' in html and 'closeLb()' in html,
    )
    r.check(
        'itinerary lightbox image half-tap navigates',
        "destLb.addEventListener('click'" in html
        and "matchMedia('(min-width: 1101px)')" in html
        and 'tapRect' in html
        and 'dlbWasSwiped' in html
        and 'showDest(destIdx - 1)' in html
        and 'showDest(destIdx + 1)' in html,
    )
    r.check(
        'itinerary lightbox resolves card index and null-safe showDest',
        'function destCardIndex(card)' in html
        and 'e.stopPropagation()' in html
        and 'if (!card) return' in html,
    )
    r.check(
        'itinerary lightbox vertical scroll guard preserves body swipe',
        'dlbWasScrolled' in html
        and "e.target.closest('button, a, input, select, textarea')" in html,
    )
    r.check(
        'itinerary lightbox swipe guard uses touchmove',
        "destLb.addEventListener('touchmove'" in html
        and 'dlbWasSwiped = true' in html
        and 'Math.abs(dx) > Math.abs(dy)' in html,
    )
    r.check(
        'itinerary cards open lightbox on all viewports',
        'openLb(card)' in html
        and 'if (swiped) return;' in html
        and 'swiped || window.innerWidth > 640' not in html,
    )

    # Availability calendar
    r.check('id="availCal" calendar widget exists', 'id="availCal"' in html)
    r.check(
        'calendar supports adjacent date range selection',
        'function buildContiguousRange' in html
        and 'id="calSelection"' in html
        and 'id="calEnquireBtn"' in html
        and 'preferred_date_end' in html
        and 'id="formDurWrap"' in html
        and 'function LY_syncFormDur' in html
        and 'charter_duration_auto' in html
        and "useDurAuto('multi-day')" in html
        and 'window.LY_setCharterLen' in html
        and 'durWrap.hidden = true' in html
        and 'durOptMultiDay' not in html
        and 'value="multi-day">Multi-Day' not in html
        and 'id="formDurWrap" hidden' in html
        and 'selected.length === 1' in html
        and 'preferred_date_end_btn' not in html
        and 'class="form-field form-end-date"' not in html
        and 'for="preferred_date_btn"' in html
        and 'data-selected=' in html
        and "node.closest('.cal-cell.free[data-date]')" in html,
    )
    r.check(
        'form uses themed date pickers instead of native date inputs',
        'class="form-date-wrap"' in html
        and 'id="formDatePopover"' in html
        and 'id="preferredDateWrap"' in html
        and 'type="hidden" name="preferred_date"' in html
        and 'type="hidden" name="preferred_date_end"' in html
        and 'type="date" name="preferred_date"' not in html
        and 'function openFormDatePopover' in html
        and 'function closeFormDatePopover' in html
        and 'function positionFormDatePopover' in html
        and 'window.LY_updateFormDateTriggers' in html
        and 'id="formDateStepHint"' in html
        and 'function pickFormDate' in html
        and 'formDatePickGuard' in html
        and 'class="form-date-icon"' in html
        and 'form-date-popup-open' in html
        and 'class="form-date-apply-btn"' in html
        and 'id="formDatePopoverDismiss"' in html
        and 'formDateModal' not in html
        and 'range-start' in html,
    )

    # Nav
    r.check('id="navbar" navigation exists', 'id="navbar"' in html)
    r.check(
        'desktop language selector uses popup menu',
        'id="navLangWrap"' in html
        and 'id="navLangTrigger"' in html
        and 'id="navLangPopover"' in html
        and 'class="nav-lang-popover"' in html
        and 'class="nav-lang"' not in html,
    )
    r.check(
        'cinema hero restores nav after scroll on mobile viewports',
        'updateHeroCinema' in html
        and 'ly-past-hero' in html
        and 'ly-hero-cinema' in html
        and "matchMedia('(max-width: 768px)')" in html
        and 'window.scrollY <= 56' in html
        and "classList.add('ly-past-hero')" in html
        and "classList.remove('ly-past-hero')" in html
        and 'lyHashLocked() && root.classList.contains' in html
        and "destId === 'hero'" in html
        and "document.documentElement.classList.remove('ly-past-hero')" in html
        and "destId === 'itinerary-funnel' || destId === 'gallery-funnel'" in html,
    )
    r.check(
        'nav scroll section highlighting script',
        'updateNavSection' in html
        and "classList.toggle('is-active'" in html
        and 'navSectionLinks' in html
        and "addEventListener('hashchange'" in html
        and 'navMarkerTop' in html
        and 'onNavJumpClick' in html
        and ".querySelectorAll('.nav-cta[href^=\"#\"]')" in html
        and 'scrollToLandAnchor' not in html
        and 'preventDefault' not in re.search(
            r'navSectionLinks\.forEach\(function\(a\)[\s\S]{0,400}',
            html,
        ).group(0),
    )
    r.check(
        'scroll updates canonical section hash without jumping',
        'updateScrollHash' in html
        and 'SCROLL_HASH_SECTIONS' in html
        and "'itinerary'" in html.split('SCROLL_HASH_SECTIONS')[1][:160]
        and "'enquire-form'" in html.split('SCROLL_HASH_SECTIONS')[1][:160]
        and 'history.replaceState(history.state' in html
        and 'LY_hashLockUntil' in html,
    )
    r.check(
        'hash changes fire Clarity section tags and per-section events',
        'LY_trackSectionHash' in html
        and "fn('set', 'ly_section', section)" in html
        and 'lyClaritySectionEventName' in html
        and "ly_section_view_' + String(section).replace(/-/g, '_')" in html
        and 'LY_flushClaritySectionQueue' in html,
    )
    r.check(
        'desktop nav uses native landing anchors',
        re.search(r'class="nav-links"[^>]*>[\s\S]*?href="#about"', html) is not None
        and 'href="#itinerary-land"' in html
        and 'href="#gallery-land"' in html
        and 'href="#charters-land"' in html
        and re.search(
            r'class="nav-links"[^>]*>[\s\S]*?href="#availability"',
            html,
        )
        is not None
        and 'href="#reviews-land"' in html
        and 'href="#amenities-land"' in html
        and 'href="#specs-land"' in html
        and 'id="about-land"' in html
        and 'id="charters-land"' in html
        and 'id="availability-land"' in html,
    )
    r.check(
        'desktop nav separates charters, availability, and quote CTA',
        'href="#charters-land"' in html
        and 'href="#availability" class="nav-cta nav-header-cta"' in html
        and 'href="#pricing-land"' not in html
        and 'id="charters"' in html
        and 'id="pricing"' not in html,
    )
    mobile_nav_m = re.search(
        r'<div class="mobile-nav" id="mobileNav"[^>]*>([\s\S]*?)</div>\s*</div>',
        html,
    )
    mobile_nav = mobile_nav_m.group(1) if mobile_nav_m else ''
    r.check(
        'mobile menu keeps section-top anchors',
        mobile_nav_m is not None
        and 'href="#about"' in mobile_nav
        and 'href="#about-land"' not in mobile_nav
        and 'href="#charters"' in mobile_nav
        and 'href="#charters-land"' not in mobile_nav,
    )
    r.check(
        'mobile menu splits quote form and calendar anchors',
        mobile_nav_m is not None
        and re.search(
            r'href="#enquire-form"[^>]*class="mobile-nav-cta"',
            mobile_nav,
        )
        is not None
        and 'href="#avail-cal"' in mobile_nav
        and 'href="#availability"' not in mobile_nav,
    )
    r.check(
        'about and amenities offer mobile forward links',
        'section-forward-cta' in html
        and re.search(
            r'<section id="about">[\s\S]*?section-forward-cta[\s\S]*?href="#charters"',
            html,
        )
        is not None
        and re.search(
            r'<section id="amenities">[\s\S]*?section-forward-cta[\s\S]*?href="#avail-cal"',
            html,
        )
        is not None,
    )

    # Netlify form detection
    r.check('Netlify form attribute present', ' netlify ' in html or ' netlify>' in html)

    # Page structure — key sections
    for sid in SECTION_IDS:
        r.check(f'section id="{sid}" exists', f'id="{sid}"' in html)

    # i18n / SEO
    r.check(
        f'<html lang="{meta["lang"]}">',
        re.search(rf'<html lang="{meta["lang"]}"', html) is not None,
    )
    for code in HREFLANGS:
        r.check(
            f'hreflang="{code}" alternate link',
            f'hreflang="{code}"' in html,
        )

    # Hero LCP
    r.check('hero <picture class="hero-bg-wrap">', 'class="hero-bg-wrap"' in html)
    r.check(
        'hero <img> has fetchpriority="high"',
        'class="hero-bg ly-prog-sharp"' in html and 'fetchpriority="high"' in html,
    )
    r.check(
        'net-tier boots before inline critical CSS',
        html.find('id="fouc-guard"') < html.find('net-tier.js')
        and html.find('net-tier.js') < html.find('id="critical-css"'),
    )
    net_tier = read_file('js/net-tier.js') or ''
    r.check(
        'net-tier.js loads layout.css then main.css without connection sniffing',
        'LY_PROGRESSIVE_IMAGES' in net_tier
        and 'LY_loadLayoutCss' in net_tier
        and 'LY_loadMainCss' in net_tier
        and 'LY_NET_SLOW' not in net_tier
        and 'effectiveType' not in net_tier
        and 'lyInjectPreload' not in net_tier
        and 'ly-prog-critical' not in net_tier,
    )
    r.check(
        'card tier URLs always use native responsive srcsets (no preload suffix stubs)',
        'LY_NET_SLOW' not in html
        and 'LY_applySlowSrcsets' not in html
        and 'LY_sharpTierSuffix' not in html,
    )
    r.check(
        'hero picture keeps responsive srcset (native loading)',
        'maiora_20s_02-480.webp 480w' in html
        and 'maiora_20s_02-720.webp' in html
        and 'maiora_20s_02-640.webp 640w' in html
        and 'maiora_20s_02-960.webp 960w' in html
        and 'class="hero-bg ly-prog-sharp"' in html
        and 'fetchpriority="high"' in html,
    )
    r.check(
        'mobile hero caps at -960 tier (no full-res mobile master)',
        'images/mobile/maiora_20s_02-960.webp 960w' in html
        and 'images/mobile/maiora_20s_02.webp 2000w' not in html,
    )
    img_root = 'images' if rel == 'index.html' else '/images'
    r.check(
        'hero picture has responsive srcsets for both mobile and desktop',
        re.search(
            rf'<source[^>]*{re.escape(img_root)}/mobile/maiora_20s_02-480\.webp 480w[^>]*'
            r'media="\(max-width: 640px\)"',
            html,
        )
        is not None
        and re.search(
            rf'<source[^>]*srcset="{re.escape(img_root)}/maiora_20s_02-640\.webp 640w',
            html,
        )
        is not None,
    )
    fouc_pos = html.find('id="fouc-guard"')
    style_pos = html.find('id="critical-css"')
    net_tier_pos = html.find('net-tier.js')
    r.check(
        'FOUC guard CSS precedes connection-tier script and hero critical CSS',
        fouc_pos > 0
        and net_tier_pos > fouc_pos
        and style_pos > net_tier_pos,
    )
    r.check(
        'hero image preloads discovered before deferred head scripts',
        html.find('fetchpriority="high"')
        > fouc_pos
        < html.find('LY_afterLcp')
        < html.find('window.LY_DEST_IMAGES'),
    )
    r.check(
        'analytics and preload bootstrap deferred until after hero',
        html.find('id="hero"') > 0 and html.find('id="hero"') < html.find('LY_afterLcp'),
    )
    bootstrap_pos = deferred_bootstrap_pos(html)
    itinerary_pos = html.find('id="itinerary"')
    first_dest_meta = html.find('class="destination-meta"')
    r.check(
        'deferred bootstrap is not nested inside destination cards',
        bootstrap_pos > html.find('id="hero"')
        and itinerary_pos > 0
        and first_dest_meta > 0
        and bootstrap_pos < itinerary_pos
        and bootstrap_pos < first_dest_meta,
    )
    r.check(
        'navigation precedes hero (prevents CLS before main.css)',
        html.find('id="navbar"') > 0 and html.find('id="navbar"') < html.find('id="hero"'),
    )
    r.check(
        'hero background decodes asynchronously (does not block title paint)',
        'class="hero-bg ly-prog-sharp"' in html
        and 'decoding="async"' in html.split('class="hero-bg ly-prog-sharp"')[1][:120],
    )
    r.check(
        'hero background is not aria-hidden (eligible LCP image candidate)',
        'class="hero-bg ly-prog-sharp"' in html
        and 'aria-hidden="true"' not in html.split('class="hero-bg ly-prog-sharp"')[1][:120],
    )
    crit_tag = html.find('<style id="critical-css">', fouc_pos)
    crit_end = html.find('</style>', crit_tag) if crit_tag >= 0 else -1
    r.check(
        'critical CSS is slim enough for fast head parse',
        crit_tag > 0 and crit_end - crit_tag < 12000,
    )
    crit_css = html[crit_tag:crit_end] if crit_tag >= 0 and crit_end > crit_tag else ''
    crit_flat = re.sub(r'\s+', '', crit_css)
    r.check(
        'critical CSS is brace-balanced (parses cleanly; hero progressive rules not dropped)',
        crit_css.count('{') == crit_css.count('}')
        and '.ly-prog-wrap--hero.ly-prog-sharp-ready.ly-prog-sharp-visible' in crit_flat,
    )
    fouc_flat = re.sub(r'\s+', '', html[html.find('<style id="fouc-guard">'):html.find('</style>', html.find('id="fouc-guard"'))])
    r.check(
        'FOUC guard kills blue links and hides below-fold until main.css',
        'html:not(.ly-main-ready)body>:not(nav):not(#hero){display:none!important}' in fouc_flat
        and 'a:any-link{color:#f5f0e8!important' in fouc_flat
        and 'a.itinerary-meet-cta,a.mobile-nav-cta{color:#0a1628!important' in fouc_flat,
    )
    r.check(
        'nav and desktop hero duplicates ship with inline display:none',
        '<ul class="nav-links" style="display:none">' in html
        and 'class="hamburger" id="hamburger" style="display:none"' in html
        and 'class="hero-eyebrow-link--desktop" style="display:none"' in html
        and 'class="hero-rates hero-rates-link season-rates hero-rates-link--desktop" style="display:none"' in html
        and 'class="btn-primary hero-cta-link--desktop" style="display:none"' in html,
    )
    r.check(
        'critical CSS locks desktop hero variants with !important',
        '.hero-cta-link--desktop,.hero-rates-link--desktop,.hero-eyebrow-link--desktop{display:none!important}' in crit_flat
        and '#heroa{color:inherit;text-decoration:none' in crit_flat
        and 'position:fixed' in crit_flat
        and 'nav{' in crit_flat
        and 'display:flex' in crit_flat
        and 'nav{opacity:0;visibility:hidden;pointer-events:none}' in crit_flat
        and '--h-t:clamp(2.2rem' in crit_flat.replace(' ', '')
        and '--h-rg:clamp(.62rem' in crit_flat.replace(' ', '')
        and '.hero-top{grid-row:1' in crit_flat.replace(' ', ''),
    )
    r.check(
        'critical CSS locks mobile hero to full viewport before main.css',
        'height:100svh' in crit_flat
        and 'overflow:hidden' in crit_flat
        and '.hero-bg-wrap,.hero-overlay{position:absolute;inset:0' in crit_flat
        and '.hero-value{display:none}' in crit_flat
        and '.hero-scroll,.hero-value{display:none}' not in crit_flat
        and '--hero-top-inset:max(1.05rem,calc(env(safe-area-inset-top,0px)+.8rem))' in crit_flat.replace(' ', '')
        and '--hero-bottom-inset:max(1.25rem,calc(env(safe-area-inset-bottom,0px)+1rem))' in crit_flat.replace(' ', '')
        and 'min(28%,9.5rem)' in crit_flat.replace(' ', '')
        and 'padding-top:1.05rem' in crit_flat.replace(' ', '')
        and 'padding-bottom:1.25rem' in crit_flat.replace(' ', '')
        and '.hero-top{grid-row:1' in crit_flat.replace(' ', '')
        and '.hero-content{position:absolute;inset:0' in crit_flat.replace(' ', '')
        and 'display:grid;grid-template-rows:auto1frauto' in crit_flat.replace(' ', '')
        and '.hero-bottom.hero-sub' in crit_flat.replace(' ', ''),
    )
    r.check(
        'layout.css load adds ly-main-ready; main.css enhances without blocking reveal',
        (html.count("classList.add('ly-main-ready')") >= 1 or "classList.add('ly-main-ready')" in net_tier)
        and "l.rel='stylesheet'" in net_tier.replace(' ', '')
        and 'LY_LAYOUT_CSS_HREF' in html
        and 'LY_MAIN_CSS_HREF' in html
        and 'requestAnimationFrame' in (html + net_tier)
        and 'LY_loadLayoutCss' in net_tier
        and 'layoutCssApplies' in net_tier
        and 'finishLayoutCss' in net_tier
        and 'LY_kickProgressiveAfterReveal' in net_tier
        and 'LY_loadMainCss' in net_tier
        and 'LY_scheduleMainCss' in net_tier
        and '.ly-css-probe' in (read_file('css/layout.css') or '')
        and '--ly-css-tail' in (read_file('css/layout.css') or '')
        and re.search(
            r'function finishLayoutCss\(cb\) \{[\s\S]{0,900}LY_scheduleMainCss',
            net_tier,
        )
        is not None
        and re.search(
            r'function finishLayoutCss\(cb\) \{[\s\S]*?\n  \}',
            net_tier,
        )
        is not None
        and 'g.LY_loadMainCss();' not in re.search(
            r'function finishLayoutCss\(cb\) \{[\s\S]*?\n  \}',
            net_tier,
        ).group(0),
    )
    r.check(
        'reveal is rAF-independent (hidden-tab safe): softFrame falls back to setTimeout',
        'function softFrame(fn)' in net_tier
        and re.search(r'function softFrame\(fn\)[\s\S]{0,220}?setTimeout\(go', net_tier)
        is not None
        and 'softFrame(revealMain)' in net_tier
        and "classList.add('ly-main-ready')" in net_tier,
    )
    r.check(
        'hash funnel landing re-syncs after main.css (scroll-margin + ly-past-hero)',
        'window.LY_fixupHashLanding' in html
        and 'itinerary-funnel' in html
        and 'ly-past-hero' in html
        and 'scrollIntoView' in html.split('LY_fixupHashLanding')[1][:600],
    )
    r.check(
        'critical CSS applies funnel scroll-padding when past hero (unlayered, beats deferred layers)',
        # The base mobile rule zeroes scroll-padding so the hero anchor lands flush.
        # When ly-past-hero is set, the funnel/tab anchors must clear the fixed nav.
        # Because layout.css/main.css wrap their rules in @layer, this override must
        # live unlayered in the critical CSS or it loses the cascade and the carousel
        # tabs land hidden behind the nav.
        'html{scroll-padding-top:0}html.ly-past-hero{scroll-padding-top:var(--mobile-funnel-land-offset,5.45rem)}' in crit_flat,
    )
    r.check(
        'critical CSS includes hero legibility scrims before main.css',
        '.hero-content::before' in crit_flat
        and '.hero-content::after' in crit_flat
        and 'text-shadow:01px2pxrgba(0,0,0,.9)' in crit_flat
        and (
            '#hero.hero-actions.btn-ghost{background:rgba(10,22,40,.28)' in crit_flat
            or '#hero.hero-actions.btn-ghost{background:rgba(10,22,40,.52)' in crit_flat
        )
        and 'border:1pxsolidtransparent' in crit_flat.replace(' ', ''),
    )
    r.check(
        'critical CSS hides duplicate hero rates and eyebrow links before main.css',
        '.hero-rates-link{display:block;text-decoration:none' in crit_flat
        and '.hero-cta-link--desktop,.hero-rates-link--desktop,.hero-eyebrow-link--desktop{display:none!important}' in crit_flat
        and '.hero-rates-link--mobile,.hero-eyebrow-link--mobile){display:none!important}' in crit_flat
        and '.hero-eyebrow-link--desktop{display:inline!important}' in crit_flat,
    )
    r.check(
        'critical CSS uses same hero spacing tokens as main.css',
        '--hero-top-inset:' in crit_flat
        and '--hero-top-gap:' in crit_flat
        and '--hero-bottom-gap:' in crit_flat
        and '--hero-cluster-gap:' in crit_flat
        and '--hero-bottom-inset:' in crit_flat
        and 'padding-bottom:1.25rem' in crit_flat.replace(' ', '')
        and '--hero-gap:' not in crit_flat,
    )
    r.check(
        'critical CSS locks hero text wrap before main.css (prevents reflow CLS)',
        'text-wrap:balance' in crit_flat
        and '.hero-rates[hidden]{display:none!important}' in crit_flat.replace(' ', ''),
    )
    r.check(
        'critical CSS matches mobile cinema hero grid layout',
        'display:grid;grid-template-rows:auto1frauto' in crit_flat.replace(' ', '')
        and '.hero-top,.hero-bottom{display:flex' in crit_flat
        and '.hero-bottom{grid-row:3;align-self:end' in crit_flat.replace(' ', '')
        and '.hero-bottom.hero-sub,.hero-scroll,.hero-trust{display:none!important}' in crit_flat.replace(' ', '')
        and '#hero.hero-actions{flex-direction:row' in crit_flat.replace(' ', '')
        and 'width:min(85vw,100%)' in crit_flat.replace(' ', '')
        and '.hero-top,.hero-bottom{display:flex;flex-direction:column;align-items:stretch;width:min(85vw,100%)' in crit_flat.replace(' ', '')
        and '.hero-content::before,.hero-content::after{left:0;right:0;width:auto;transform:none' in crit_flat.replace(' ', '')
        and '#hero.hero-actions{flex-direction:row' in crit_flat.replace(' ', '')
        and 'justify-content:center' in crit_flat.replace(' ', '')
        and (
            'padding:clamp(.95rem,5vw,1.18rem)clamp(.62rem,3.4vw,.92rem)' in crit_flat.replace(' ', '')
            or 'padding:var(--hero-cinema-btn-pad-y)var(--hero-cinema-btn-pad-x)' in crit_flat.replace(' ', '')
        )
        and 'letter-spacing:.07em' in crit_flat.replace(' ', '')
        and 'hyphens:none' in crit_flat.replace(' ', '')
        and 'line-height:1.4' in crit_flat.replace(' ', '')
        and 'font-weight:300' in crit_flat.replace(' ', '')
        and "font-family:'Montserrat','MontserratFallbackHero','MontserratFallback',sans-serif" in crit_flat.replace(' ', '')
        and 'HelveticaNeue-Thin' in crit_flat.replace(' ', '')
        and 'size-adjust:115%' in crit_flat.replace(' ', '')
        and 'min-height:2.85rem' in crit_flat.replace(' ', '')
        and '#hero.hero-actions.btn-primary{margin-left:' not in crit_flat.replace(' ', '')
        and '.hero-content{position:absolute;inset:0' in crit_flat
        and 'height:100svh' in crit_flat
        and 'overflow:hidden' in crit_flat
        and 'safe-area-inset-bottom' in crit_css,
    )
    r.check(
        'hero uses top/bottom clusters for mobile yacht stage',
        'class="hero-top">' in html
        and 'padding-top:max(5.35rem' not in html.split('class="hero-top"')[1][:80]
        and '<div class="hero-bottom">' in html
        and html.find('class="hero-top"') < html.find('<div class="hero-bottom">')
        and html.find('class="hero-title"') > html.find('class="hero-top"')
        and html.find('class="hero-sub"') > html.find('<div class="hero-bottom">')
        and html.find('class="hero-sub"') < html.find('class="hero-rates')
        and 'class="hero-top">' in html.split('<div class="hero-bottom">')[0]
        and 'class="hero-sub"' not in html.split('<div class="hero-bottom">')[0],
    )
    r.check(
        'critical CSS reserves hero child layout before main.css',
        '.hero-eyebrow{' in crit_flat
        and '.hero-rates{' in crit_flat
        and '.hero-actions{' in crit_flat
        and '.btn-primary{' in crit_flat
        and (
            '.hero-eyebrow,.hero-sub,.hero-rates' in crit_flat.replace(' ', '')
            or '#hero :is(.hero-eyebrow' in crit_css
        )
        and 'opacity:1' in crit_flat,
    )
    r.check(
        'carousel activation deferred until after meaningful paint / hero gate',
        'window.LY_afterMeaningfulPaint' in html and "gr.dispatchEvent(new Event('scroll'))" in html,
    )
    r.check(
        'destination carousel fires scroll after meaningful paint (no hero gate)',
        re.search(
            r'window\.LY_afterMeaningfulPaint\(function\(\)\s*\{[\s\S]*?dispatchEvent\(new Event\(.scroll.\)',
            html,
        ) is not None
        and 'LY_heroGateOpen' not in html,
    )
    head_end = html.find('</head>')
    head = html[:head_end] if head_end > 0 else ''
    r.check(
        'head has no image preloads (prev → sharp only)',
        head.count('rel="preload" as="image"') == 0
        and 'lyInjectPreload' not in net_tier
        and 'images/dest/' not in head
        and 'maiora_20s_04' not in head,
    )
    r.check(
        'destination cards use multi-tier desktop srcsets',
        'portals-vells-1-640.webp' in html
        and 'portals-vells-1-960.webp' in html
        and 'portals-vells-1-720.webp' in html,
    )
    minify_py = read_file('scripts/minify_html.py') or ''
    r.check(
        'production minifier includes first-party js/ assets',
        'def js_targets' in minify_py
        and "JS_DIR = 'js'" in minify_py
        and 'for rel in js_targets():' in minify_py,
    )
    try:
        import importlib.util

        minify_path = os.path.join(ROOT, 'scripts', 'minify_html.py')
        spec = importlib.util.spec_from_file_location('minify_html', minify_path)
        minify_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(minify_mod)
        env_src = read_file('js/analytics-env.js') or ''
        env_out = minify_mod.minify_js(env_src)
        r.check(
            'minify_js preserves analytics-env critical symbols',
            'LY_IS_PREVIEW' in env_out
            and 'LY_OWNER_MODE' in env_out
            and 'LY_TESTING_CLARITY' in env_out
            and '/**' not in env_out,
        )
    except Exception as exc:
        r.fail('minify_js smoke test', str(exc))

    opt_py = read_file('scripts/optimize_responsive_images.py') or ''
    r.check(
        'content image quality constants separated from hero LCP tuning',
        'DEST_DESKTOP_MAX_EDGE' in opt_py
        and 'DEST_CARD_DESKTOP_TIERS' in opt_py
        and 'GALLERY_DESKTOP_WEBP_Q' in opt_py
        and 'HERO_DESKTOP_MAX_EDGE' in opt_py
        and 'HERO_DESKTOP_WEBP_Q' in opt_py
        and 'DEST_DESKTOP_WEBP_Q' in opt_py,
    )
    hero_webp = os.path.join(ROOT, 'images', 'maiora_20s_02.webp')
    r.check(
        'hero desktop master kept sharp (not destination-grade compression)',
        os.path.isfile(hero_webp) and os.path.getsize(hero_webp) > 45 * 1024,
    )
    gallery_webp = os.path.join(ROOT, 'images', 'maiora_20s_01.webp')
    r.check(
        'gallery desktop master kept sharp (not destination-grade compression)',
        os.path.isfile(gallery_webp) and os.path.getsize(gallery_webp) > 35 * 1024,
    )
    portals_webp = os.path.join(ROOT, 'images', 'dest', 'portals-vells-1.webp')
    r.check(
        'destination master sharper than old single-tier compression',
        os.path.isfile(portals_webp) and os.path.getsize(portals_webp) > 25 * 1024,
    )
    es_trenc_720 = os.path.join(ROOT, 'images', 'mobile', 'dest', 'es-trenc-1-720.webp')
    r.check(
        'destination mobile tiers rebuild from media-library masters',
        'src_path.parent in (MOBILE, MOBILE / "dest")' in opt_py,
    )
    r.check(
        'destination mobile tiers use luxury-grade encoding (es-trenc sample)',
        '("-720", 720, 82)' in opt_py
        and 'DEST_DESKTOP_WEBP_Q = 86' in opt_py
        and os.path.isfile(es_trenc_720)
        and os.path.getsize(es_trenc_720) > 15 * 1024,
    )
    r.check(
        'about section uses multi-tier desktop srcset',
        'images/maiora_20s_04-640.webp 640w' in html
        and 'images/maiora_20s_04-960.webp 960w' in html
        and 'images/mobile/maiora_20s_04-960.webp 960w' in html
        and 'images/mobile/maiora_20s_04.webp 960w' not in html,
    )
    r.check(
        'hero title has no entrance animation in critical CSS (visible for LCP)',
        'heroTitleIn' not in html.split('</style>', 1)[0] and '.hero-title{' in html,
    )
    r.check(
        'hero scroll indicator lives inside bottom CTA cluster',
        re.search(
            r'<div class="hero-cta-group">[\s\S]*?<div class="hero-scroll">',
            html,
        )
        is not None,
    )
    r.check(
        'hero eyebrow desktop links use -land anchors',
        'href="#reviews-land" class="hero-eyebrow-link--desktop"' in html
        and 'href="#charters-land" class="hero-eyebrow-link--desktop"' in html,
    )
    r.check(
        'hero eyebrow mobile links keep section anchors',
        'href="#reviews" class="hero-eyebrow-link--mobile"' in html
        and 'href="#charters" class="hero-eyebrow-link--mobile"' in html,
    )
    r.check(
        'hero CTA desktop links use itinerary and gallery -land anchors',
        'href="#itinerary-land" class="btn-primary hero-cta-link--desktop"' in html
        and 'href="#gallery-land" class="btn-ghost hero-cta-link--desktop"' in html,
    )
    r.check(
        'hero CTA mobile links keep section anchors',
        'href="#itinerary-funnel" class="btn-primary hero-cta-link--mobile"' in html
        and 'href="#gallery-funnel" class="btn-ghost hero-cta-link--mobile"' in html
        and 'id="itinerary-funnel"' in html
        and 'id="gallery-funnel"' in html,
    )
    r.check(
        'carousel bottom-bar mobile links land on funnel anchors (tabs in view, not section title)',
        'href="#gallery-funnel" class="btn-ghost itinerary-bottom-link--mobile"' in html
        and 'href="#itinerary-funnel" class="btn-ghost itinerary-bottom-link--mobile"' in html
        and 'href="#gallery" class="btn-ghost itinerary-bottom-link--mobile"' not in html,
    )
    r.check(
        'critical CSS defines hero bottom cluster gaps',
        '.hero-cta-group{' in crit_flat
        and 'gap:var(--hero-cluster-gap)' in crit_flat
        and '--hero-bottom-inset:' in crit_flat,
    )
    r.check(
        'critical CSS vertically centers hero CTA label text',
        (
            '#hero.hero-actions:is(.btn-primary,.btn-ghost){display:inline-flex' in crit_flat
            or '#hero.hero-actions.btn-primary,#hero.hero-actions.btn-ghost{display:inline-flex' in crit_flat.replace(' ', '')
        )
        and 'justify-content:center' in crit_flat.replace(' ', '')
        and 'box-shadow:02px18pxrgba(10,22,40,.32)' in crit_flat.replace(' ', '')
        and '--btn-font:' in crit_flat.replace(' ', '')
        and '--hero-cinema-btn-pad-y:' in crit_flat.replace(' ', '')
        and 'align-items:center' in crit_flat,
    )

    # Cookie consent — must not steal LCP
    r.check('cookie consent banner exists', 'id="cookie-consent"' in html)
    r.check('cookie accept + decline controls', 'id="cookie-accept"' in html and 'id="cookie-decline"' in html)
    r.check(
        'cookie banner delayed past LCP window (6000ms)',
        'setTimeout(show, 6000)' in html and 'setTimeout(show, 1400)' not in html,
    )
    r.check(
        'cookie auto-accept on first interaction',
        re.search(r"function auto\w+OnInteraction\(\)", html) is not None,
    )
    r.check(
        'cookie auto-accept listens on window scroll (scroll does not bubble on document)',
        re.search(r"window\.addEventListener\('scroll', auto\w+OnInteraction", html) is not None
        and re.search(r"document\.addEventListener\('scroll', auto\w+OnInteraction", html) is None,
    )

    # Conversion tracking
    r.check('gtag_report_conversion (WhatsApp) defined', 'function gtag_report_conversion' in html)
    r.check('gtag_report_conversion_form defined', 'function gtag_report_conversion_form' in html)
    r.check(
        'Google Ads conversion labels present',
        'AW-18209943491/CkJfCKPt7rgcEMPflutD' in html
        and 'AW-18209943491/Pd-9CKDt7rgcEMPflutD' in html,
    )
    r.check(
        'no Google Tag Manager container (direct gtag only)',
        'gtm.js?id=' not in html and 'GTM-NN8V25BR' not in html,
    )

    # Data feeds
    reviews_json = meta['reviews_json']
    r.check(
        f'reviews fetch uses {reviews_json}',
        f"'{reviews_json}'" in html and 'LY_BASE' in html,
    )
    if rel != 'index.html':
        r.check('does not fetch English reviews.json', "'/data/reviews.json'" not in html)
    r.check('availability API fetch', '/api/availability' in html)
    if rel == 'index.html':
        r.check(
            'availability uses production API on GitHub Pages preview',
            'limitlessyachtcharter.com' in html and '.github.io' in html,
        )
        r.check('LY_BASE set for GitHub Pages subpath', 'window.LY_BASE' in html)
    r.check(
        'reviews fetch deferred until section nears viewport',
        'LY_whenNearSection' in html
        and "LY_whenNearSection('reviews'" in html,
    )
    r.check(
        'availability fetch deferred until section nears viewport',
        "LY_whenNearSection('availability'" in html,
    )
    if rel == 'index.html':
        r.check(
            'availability applies feed data with explicit calendar re-render',
            'lyApplyAvailCal' in html and 'lyScheduleAvailCalLoad' in html,
        )

    # Structured data
    r.check('schema.org JSON-LD present', 'application/ld+json' in html)

    # Locale subfolders — shared assets step up; images stay root-relative for Netlify
    if rel != 'index.html':
        r.check(
            f'{rel} LY_DEST_IMAGES uses root-relative paths',
            "'/images/dest/" in html,
        )
        r.check(
            f'{rel} no relative images/ in LY_DEST_IMAGES',
            "'images/dest/" not in html,
        )
        r.check(
            f'{rel} srcset mobile candidates are root-relative',
            ', images/mobile/' not in html,
        )
        r.check(
            f'{rel} shared assets use parent-relative paths',
            "LY_LAYOUT_CSS_HREF='../css/layout.css" in html
            and "LY_MAIN_CSS_HREF='../css/main.css" in html
            and 'href="../css/layout.css' in html
            and 'href="../css/main.css' in html
            and 'src="../js/net-tier.js' in html
            and 'href="../favicon.svg"' in html
            and 'href="/favicon.svg"' not in html,
        )
        r.check(
            f'{rel} lang switcher uses folder-relative hrefs',
            'href="../fr/"' in html or 'href="../de/"' in html,
        )
        r.check(
            f'{rel} does not use broken root-only font paths',
            'href="/fonts/' not in html and "url('/fonts/" not in html,
        )


def check_legal(r: Runner, rel: str, html: str) -> None:
    lang = LEGAL_META[rel]['lang']
    r.check(f'<html lang="{lang}">', re.search(rf'<html lang="{lang}"', html) is not None)
    r.check(
        f'{rel} uses direct gtag only (no GTM container)',
        'gtm.js?id=' not in html and 'GTM-NN8V25BR' not in html,
    )
    if rel == 'legal.html':
        r.check('links back to home', 'href="index.html"' in html)
    else:
        r.check('links back to home', 'href="../"' in html)
        r.check(
            'legal shared assets use parent-relative paths',
            'href="../css/main.css"' in html and 'href="../favicon.svg"' in html,
        )


def check_locale_parity(r: Runner, pages: dict[str, str]) -> None:
    ref = 'index.html'
    ref_ids = set(re.findall(r'<section id="([^"]+)"', pages[ref]))
    for rel, html in pages.items():
        if rel == ref:
            continue
        ids = set(re.findall(r'<section id="([^"]+)"', html))
        missing = ref_ids - ids
        extra = ids - ref_ids
        r.check(
            f'{rel} section parity with EN',
            not missing and not extra,
            f'missing={sorted(missing)} extra={sorted(extra)}' if missing or extra else '',
        )


def check_localized_reviews(r: Runner) -> None:
    en_raw = read_file('data/reviews.json')
    if en_raw is None:
        r.fail('data/reviews.json exists', 'file not found')
        return
    try:
        en_reviews = json.loads(en_raw).get('reviews', [])
    except json.JSONDecodeError as exc:
        r.fail('data/reviews.json is valid JSON', str(exc))
        return

    en_texts = {item.get('text', '') for item in en_reviews}
    r.check('English reviews.json is non-empty', len(en_reviews) > 0)

    for code, rel_path in LOCALE_REVIEW_FILES.items():
        raw = read_file(rel_path)
        r.check(f'{rel_path} exists', raw is not None)
        if raw is None:
            continue
        try:
            loc_reviews = json.loads(raw).get('reviews', [])
        except json.JSONDecodeError as exc:
            r.fail(f'{rel_path} is valid JSON', str(exc))
            continue

        r.check(
            f'{rel_path} review count matches EN ({len(en_reviews)})',
            len(loc_reviews) == len(en_reviews),
        )
        loc_texts = [item.get('text', '') for item in loc_reviews]
        r.check(
            f'{rel_path} review texts are translated',
            all(t and t not in en_texts for t in loc_texts),
            'one or more texts still match English source',
        )
        for i, (en_item, loc_item) in enumerate(zip(en_reviews, loc_reviews)):
            r.check(
                f'{rel_path} review[{i}] author matches EN',
                en_item.get('author') == loc_item.get('author'),
            )
            r.check(
                f'{rel_path} review[{i}] rating matches EN',
                en_item.get('rating') == loc_item.get('rating'),
            )


def check_locale_modules(r: Runner) -> None:
    """Ensure locale Python modules stay aligned with English review source."""
    sys.path.insert(0, os.path.join(ROOT, 'i18n'))
    try:
        from locales import de, es, fr  # noqa: WPS433
    except ImportError as exc:
        r.fail('locale modules importable', str(exc))
        return

    en_raw = read_file('data/reviews.json')
    if not en_raw:
        return
    en_count = len(json.loads(en_raw).get('reviews', []))
    for code, mod in (('de', de), ('es', es), ('fr', fr)):
        r.check(f'i18n/locales/{code}.py defines REVIEWS', hasattr(mod, 'REVIEWS'))
        r.check(f'i18n/locales/{code}.py defines REVIEWS_UI', hasattr(mod, 'REVIEWS_UI'))
        if hasattr(mod, 'REVIEWS'):
            r.check(
                f'i18n/locales/{code}.py REVIEWS count matches EN',
                len(mod.REVIEWS) == en_count,
            )


# English copy added with hero/charter pricing — must not leak into locale pages.
PRICING_EN_MARKERS = (
    'Half-day (4h) from €1,700',
    '6h from €2,400',
    '6h from €3,100',
    'From €1,700 (4h)',
    'Available year-round &nbsp;·&nbsp; We respond within 24 hours',
    'crew included',
)

LOCALE_PRICING_MARKERS = {
    'de': (
        'Halbtages-Charter (4h) ab 1.700 €',
        '6h ab 2.400 €',
        'Ganzjährig verfügbar &nbsp;·&nbsp; Wir antworten innerhalb von 24 Stunden',
    ),
    'es': (
        'Medio día (4h) desde 1.700 €',
        '6h desde 2.400 €',
        'Disponible todo el año &nbsp;·&nbsp; Respondemos en 24 horas',
    ),
    'fr': (
        'Demi-journée (4h) à partir de 1 700 €',
        '6h à partir de 2 400 €',
        "Disponible toute l'année &nbsp;·&nbsp; Nous répondons en 24 heures",
    ),
}


def _load_build_locales():
    import importlib.util

    build_path = os.path.join(ROOT, 'i18n', 'build-locales.py')
    spec = importlib.util.spec_from_file_location('build_locales', build_path)
    if spec is None or spec.loader is None:
        raise ImportError(f'cannot load {build_path}')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _pairs_active_in_en(pairs: list[tuple[str, str]], en_html: str) -> list[tuple[str, str]]:
    active: list[tuple[str, str]] = []
    for src, dst in pairs:
        if not src or src == dst:
            continue
        if len(src.strip()) < 8:
            continue
        if src not in en_html:
            continue
        active.append((src, dst))
    return active


def check_locale_translations(r: Runner, pages: dict[str, str]) -> None:
    """Locale pages must match build output and contain no leaked English PAIRS."""
    en_index = pages.get('index.html')
    en_legal = read_file('legal.html')
    if not en_index or not en_legal:
        r.fail('locale translation gate', 'missing English source pages')
        return

    sys.path.insert(0, os.path.join(ROOT, 'i18n'))
    try:
        from locales import de, es, fr  # noqa: WPS433
        build_mod = _load_build_locales()
    except Exception as exc:  # noqa: BLE001
        r.fail('locale build module importable', str(exc))
        return

    locale_mods = {'de': de, 'es': es, 'fr': fr}

    for code, mod in locale_mods.items():
        index_rel = f'{code}/index.html'
        legal_rel = f'{code}/legal.html'
        loc_index = pages.get(index_rel) or read_file(index_rel)
        loc_legal = read_file(legal_rel)
        if loc_index is None or loc_legal is None:
            r.fail(f'{code} locale pages present', 'index or legal missing')
            continue

        expected_index = build_mod.build_index(mod)
        expected_legal = build_mod.build_legal(mod)
        if is_minified_html(loc_index):
            import importlib.util

            minify_path = os.path.join(ROOT, 'scripts', 'minify_html.py')
            spec = importlib.util.spec_from_file_location('minify_html', minify_path)
            minify_mod = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(minify_mod)
            expected_index = minify_mod.minify_html(expected_index)
            expected_legal = minify_mod.minify_html(expected_legal)
        r.check(
            f'{index_rel} matches i18n/build-locales.py output',
            loc_index == expected_index,
            'run: python3 i18n/build-locales.py',
        )
        r.check(
            f'{legal_rel} matches i18n/build-locales.py output',
            loc_legal == expected_legal,
            'run: python3 i18n/build-locales.py',
        )

        for marker in PRICING_EN_MARKERS:
            r.check(
                f'{index_rel} has no untranslated pricing copy ({marker[:40]}…)',
                marker not in loc_index,
            )

        for marker in LOCALE_PRICING_MARKERS[code]:
            r.check(
                f'{index_rel} includes translated pricing copy',
                marker in loc_index,
            )

        leaked: list[str] = []
        for src, _dst in _pairs_active_in_en(mod.PAIRS, en_index):
            if src in loc_index:
                leaked.append(src[:72])
        r.check(
            f'{index_rel} has no leaked English PAIRS strings',
            not leaked,
            ', '.join(leaked[:5]) + ('…' if len(leaked) > 5 else ''),
        )

        legal_leaked: list[str] = []
        for src, _dst in _pairs_active_in_en(mod.LEGAL_PAIRS, en_legal):
            if src in loc_legal:
                legal_leaked.append(src[:72])
        r.check(
            f'{legal_rel} has no leaked English LEGAL_PAIRS strings',
            not legal_leaked,
            ', '.join(legal_leaked[:5]) + ('…' if len(legal_leaked) > 5 else ''),
        )

        pairs_blob = '\n'.join(src for src, _dst in mod.PAIRS)
        for marker in PRICING_EN_MARKERS:
            r.check(
                f'i18n/locales/{code}.py PAIRS defines pricing source ({marker[:36]}…)',
                marker in pairs_blob,
            )


def check_html_integrity(r: Runner) -> None:
    html = read_file('index.html')
    r.check('index.html ends with </html>', html is not None and html.rstrip().endswith('</html>'))
    if html:
        body_end = html.rfind('</body>')
        r.check(
            'navigation markup lives inside document body',
            html.find('id="navbar"') > 0 and html.find('id="navbar"') < body_end,
        )


def check_shared_assets(r: Runner) -> None:
    layout_css = read_file('css/layout.css')
    main_css = read_file('css/main.css')
    css = read_site_css()
    r.check('css/layout.css exists', layout_css is not None)
    if layout_css:
        r.check(
            'about-image progressive layers fill the wrap (no split preview/sharp)',
            '.about-image-wrap > .ly-prog-wrap > picture' in layout_css
            and '.about-image-wrap > .ly-prog-wrap .ly-prog-sharp' in layout_css
            and 'img:not(.ly-prog-preview):not(.ly-prog-sharp)' in layout_css,
        )
        layout_flat = re.sub(r'\s+', '', layout_css)
        r.check(
            'progressive picture is transparent so dest-card blur preview shows through',
            # .destination-card-bg has background:var(--deep); the progressive
            # rule must override it to transparent or the opaque picture paints
            # over the .ly-prog-preview blur (later DOM sibling, same z-level).
            re.search(
                r'\.ly-prog-wrap\s+\.destination-card-bg,[\s\S]*?\{[^}]*background:\s*transparent',
                layout_css,
            )
            is not None,
        )
        r.check(
            'layout.css does not restack hero CTAs to column on phone (matches critical)',
            re.search(
                r'@media\s*\(\s*max-width:\s*640px\s*\)[\s\S]*?#hero\s+\.hero-actions\s*\{[^}]*flex-direction:\s*row',
                layout_css,
            )
            is not None
            and '.hero-actions{flex-direction:column' not in layout_flat,
        )
    r.check('css/main.css exists', main_css is not None)
    index_html = read_file('index.html') or ''
    en_layout_v = re.search(r'layout\.css\?v=(\d+)', index_html)
    en_main_v = re.search(r'main\.css\?v=(\d+)', index_html)
    r.check(
        'layout.css cache-bust version is set on EN',
        en_layout_v is not None,
    )
    r.check(
        'main.css cache-bust version is set on EN',
        en_main_v is not None,
    )
    if en_layout_v:
        v = en_layout_v.group(1)
        for loc in ('de', 'es', 'fr'):
            loc_html = read_file(f'{loc}/index.html') or ''
            r.check(
                f'{loc}/index.html uses same layout.css cache version as EN',
                f'layout.css?v={v}' in loc_html,
            )
    if en_main_v:
        v = en_main_v.group(1)
        for loc in ('de', 'es', 'fr'):
            loc_html = read_file(f'{loc}/index.html') or ''
            r.check(
                f'{loc}/index.html uses same main.css cache version as EN',
                f'main.css?v={v}' in loc_html,
            )
    if css:
        r.check('main.css defines .hero-bg-wrap', '.hero-bg-wrap' in css)
        r.check('main.css has no hero entrance keyframes (critical CSS owns LCP)', 'heroTitleIn' not in css and 'heroFade' not in css)
        r.check(
            'main.css locks mobile cinema hero to full viewport grid',
            re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#hero\s*\{[^}]*height:\s*100svh[^}]*overflow:\s*hidden',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.hero-content\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto\s+1fr\s+auto',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?nav\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*min-width:\s*769px\s*\)\s*and\s*\(\s*max-height:\s*920px\s*\)',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.hero-top,\s*\.hero-bottom',
                css,
            )
            is not None,
        )
        css_flat = re.sub(r'\s+', '', css)
        r.check(
            'main.css collapses amenities + specs grids on mobile (wins load-order vs layout.css)',
            re.search(
                r'@media\(max-width:768px\)\{[^@]*?\.amenities-grid\{[^}]*grid-template-columns:1fr',
                css_flat,
            )
            is not None
            and re.search(
                r'@media\(max-width:768px\)\{[^@]*?\.specs-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)',
                css_flat,
            )
            is not None
            and re.search(
                r'@media\(max-width:768px\)\{[^@]*?\.spec-home\{[^}]*grid-column:span2',
                css_flat,
            )
            is not None,
        )
        r.check(
            'hero above-fold copy visible immediately (Speed Index safe)',
            re.search(r'\.hero-eyebrow\{[^}]*opacity:1', css_flat) is not None
            and re.search(r'\.hero-sub\{[^}]*opacity:1', css_flat) is not None
            and re.search(r'\.hero-rates\{[^}]*opacity:1', css_flat) is not None
            and re.search(r'\.hero-actions\{[^}]*opacity:1', css_flat) is not None
            and re.search(r'\.hero-eyebrow\{[^}]*opacity:0', css_flat) is None,
        )
        r.check(
            'hero bottom cluster uses shared flex gaps on all viewports',
            '.hero-cta-group{' in css_flat
            and 'gap:var(--hero-cluster-gap)' in css_flat
            and '--hero-bottom-inset:' in css_flat,
        )
        r.check(
            'short viewports compact hero title for bottom cluster clearance',
            re.search(
                r'@media\s*\(\s*min-width:\s*769px\s*\)\s*and\s*\(\s*max-height:\s*920px\s*\)[\s\S]*?--hero-cluster-gap',
                css,
            )
            is not None,
        )
        r.check(
            'mobile cinema hero hides chrome and pairs CTAs',
            re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.hero-bottom\s+\.hero-sub,\s*\.hero-scroll,\s*\.hero-trust\s*\{\s*display:\s*none',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#hero\s+\.hero-actions\s*\{[^}]*flex-direction:\s*row',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?nav\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?html\.ly-past-hero\s+nav\s*\{[^}]*opacity:\s*1',
                css,
            )
            is not None
            and '--hero-cinema-rates-gap' in css_flat
            and '--mobile-funnel-land-offset:5.45rem' in css_flat
            and re.search(
                r'html\.ly-hero-cinema:not\(\.ly-past-hero\)\s*#itinerary-funnel[\s\S]*?scroll-margin-top:\s*var\(--mobile-funnel-land-offset\)',
                css,
            )
            is not None

            and re.search(
                r'html\.ly-past-hero\s*\{[^}]*scroll-padding-top:\s*var\(--mobile-funnel-land-offset',
                css,
            )
            is not None
            and '--hero-cinema-top-span:min(85vw,100%)' in css_flat
            and 'justify-items:center' in css_flat
            and '.hero-content::before,.hero-content::after{left:0;right:0;width:auto;transform:none' in css_flat
            and '.hero-top,.hero-bottom{display:flex;flex-direction:column;align-items:stretch;width:var(--hero-cinema-top-span)' in css_flat
            and '#hero.hero-actions.btn-primary{margin-left:' not in css_flat,
        )
        r.check(
            'micro mobile hero tightens cinema tokens without overflow',
            'min-height: 520px' not in re.sub(
                r'/\*[\s\S]*?\*/',
                '',
                re.search(
                    r'@media\s*\(\s*max-width:\s*768px\s*\)\s*\{[^}]*#hero\s*\{[^}]*\}',
                    css,
                ).group(0) if re.search(
                    r'@media\s*\(\s*max-width:\s*768px\s*\)\s*\{[^}]*#hero\s*\{[^}]*\}',
                    css,
                ) else '',
            )
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?@media\s*\(\s*max-height:\s*520px\s*\)[\s\S]*?--hero-cinema-title:',
                css,
            )
            is not None
            and '--hero-cinema-side' in css_flat
            and '--hero-cinema-actions-inset' in css_flat
            and re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?html\.ly-past-hero\s+nav\s*\{[^}]*transition:[^}]*opacity',
                css,
            )
            is not None,
        )
        r.check(
            'desktop hero cluster rules do not override mobile cinema first paint',
            re.search(
                r'@media\s*\(\s*min-width:\s*769px\s*\)\s*\{[^}]*\.hero-top,\s*\.hero-bottom\s*\{\s*display:\s*contents',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*min-width:\s*769px\s*\)\s*\{[^}]*\.hero-rates\s*\{[^}]*margin-top:\s*0\.85rem',
                css,
            )
            is not None
            and '.hero-top,.hero-bottom{display:contents}' not in css_flat.replace('@media(min-width:769px)', ''),
        )
        r.check(
            'hero eyebrow toggles mobile vs desktop anchor targets',
            '.hero-eyebrow-link--desktop{' in css_flat
            and re.search(
                r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.hero-eyebrow-link--mobile[^{]*\{[^}]*display:\s*none',
                css,
            )
            is not None,
        )
        r.check(
            'hero CTA toggles mobile vs desktop anchor targets',
            re.search(
                r'#hero \.hero-actions \.hero-cta-link--desktop\s*\{[^}]*display:\s*none',
                css,
            )
            is not None
            and re.search(
                r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#hero \.hero-actions \.hero-cta-link--mobile[^{]*\{[^}]*display:\s*none',
                css,
            )
            is not None,
        )
        r.check(
            'hero CTA hide rules beat btn-primary display',
            css is not None
            and css_rule_index(css, '.btn-primary')
            < css_rule_index(css, '#hero .hero-actions .hero-cta-link--desktop'),
        )
        r.check(
            'hero value line no longer uses margin-top auto on desktop',
            '.hero-value{' in css_flat and 'margin-top:0' in css_flat,
        )
        r.check(
            'hero copy uses text-wrap to avoid orphans',
            '.hero-value{' in css_flat
            and 'text-wrap:balance' in css_flat
            and 'people and&nbsp;the views.' in index_html,
        )
        r.check(
            'hero shows clickable seasonal starting rates linked to charters',
            'hero-rates-link' in index_html
            and 'season-rates' in index_html
            and '6h from €2,400' in index_html
            and '6h from €3,100' in index_html
            and 'href="#charters-land"' in index_html
            and 'href="#charters"' in index_html
            and 'data-season-rate="low"' in index_html
            and 'm >= 6 && m <= 7' in index_html
            and '.hero-rates-link' in (css or '')
            and 'href="#pricing"' not in index_html,
        )
        r.check(
            'charters confirms seasonal rates with card pricing and Clarity events',
            'charter-rates-confirm' in index_html
            and 'charterRatesConfirm' in index_html
            and 'enquiry-price' in index_html
            and 'From €1,700 (4h) · €2,400 (6h)' in index_html
            and 'From €3,000' in index_html
            and 'Available year-round &nbsp;·&nbsp; We respond within 24 hours' in index_html
            and 'Rates vary by season' not in index_html
            and 'ly_hero_rates_click' in index_html
            and 'ly_charters_rates_view' in index_html
            and 'ly_charter_card_half_day' in index_html
            and 'ly_charter_card_full_day' in index_html
            and 'ly_charter_card_weekend' in index_html
            and 'ly_charter_card_extended' in index_html
            and '.charter-rates-confirm' in (css or ''),
        )
        r.check(
            'hero uses letterbox scrims and bright photo (no glass panels)',
            'hero-intro' not in index_html
            and '.hero-intro{' not in css_flat
            and '.hero-content::before' in (css or '')
            and '.hero-content::after' in (css or '')
            and 'object-position:58%48%' in css_flat,
        )
    r.check(
        'WhatsApp button meets contrast-safe green',
        css is not None and '#157a47' in css and '#25D366' not in css,
    )
    r.check(
        'calendar past dates use readable muted text',
        css is not None
        and '.cal-cell.past' in css
        and 'var(--text-muted)' in css
        and 'rgba(245,240,232,.22)' not in css,
    )
    r.check(
        'calendar shows past bookings with muted booked styling',
        css is not None
        and '.cal-cell.past.booked' in css
        and 'calDayCellHtml' in index_html
        and 'seasonStartIndex' in index_html,
    )
    r.check(
        'calendar booked dates meet contrast-safe rose',
        css is not None and '#8f4a52' in css and 'rgba(176,124,130,.9)' not in css,
    )
    r.check(
        'calendar selected dates are visually distinct',
        css is not None
        and '.cal-cell.selected' in css
        and '.cal-cell.free.selected' in css
        and '.cal-cell[data-selected="true"]' in css
        and '.cal-footer' in css
        and '.cal-enquire-btn.is-disabled' in css,
    )
    r.check(
        'calendar legend swatches are reliable at narrow widths',
        css is not None
        and '.cal-legend-swatch' in css
        and re.search(r'min-width:\s*12px', css) is not None
        and '.leg-selected' in css,
    )
    r.check(
        'narrow viewport calendar and CTA layout',
        css is not None
        and re.search(r'@media\s*\(max-width:\s*768px\)', css) is not None
        and re.search(
            r'@media\s*\(max-width:\s*768px\)[^{]*\{[^}]*\.cal\s*\{[^}]*max-width:\s*none',
            css,
            re.DOTALL,
        ) is not None
        and re.search(
            r'#availability\s*\.availability-actions\s*>\s*\.btn-primary[^}]*max-width:\s*none\s*!important',
            css,
        ) is not None
        and re.search(
            r'#availability\s*\.availability-actions\s*>\s*\.btn-primary[^}]*flex:\s*none\s*!important',
            css,
        ) is not None,
    )
    preview_yml = read_file('.github/workflows/preview.yml') or ''
    r.check(
        'GitHub Pages preview prepares subpath artifact',
        'prepare-github-pages.py' in preview_yml and "path: '_site'" in preview_yml,
    )
    r.check('prepare-github-pages script exists', os.path.isfile(os.path.join(ROOT, 'scripts/prepare-github-pages.py')))
    dev_server = read_file('scripts/dev-server.py') or ''
    r.check(
        'local dev server script exists',
        os.path.isfile(os.path.join(ROOT, 'scripts/dev-server.py'))
        and os.path.isfile(os.path.join(ROOT, 'scripts/serve.sh'))
        and '/api/availability' in dev_server
        and 'AVAILABILITY_PROXY_URL' in dev_server
        and 'limitlessyachtcharter.com/api/availability' in dev_server,
    )
    publish_yml = read_file('.github/workflows/publish.yml') or ''
    r.check(
        'publish gate workflow runs on main',
        'publish-gate.py' in publish_yml and 'branches: [main]' in publish_yml,
    )
    r.check('publish gate script exists', os.path.isfile(os.path.join(ROOT, 'scripts/publish-gate.py')))
    r.check('lighthouse check script exists', os.path.isfile(os.path.join(ROOT, 'scripts/lighthouse-check.py')))
    lh_py = read_file('scripts/lighthouse-check.py') or ''
    r.check(
        'lighthouse check retries and times out in CI',
        'def default_retries()' in lh_py
        and 'LIGHTHOUSE_RETRIES' in lh_py
        and 'subprocess.TimeoutExpired' in lh_py
        and '--max-wait-for-load=60000' in lh_py
        and 'def warmup(' in lh_py,
    )
    r.check(
        'publish gate workflow caps job duration',
        'timeout-minutes:' in publish_yml and 'LIGHTHOUSE_RETRIES' in publish_yml,
    )
    r.check('ux smoke test script exists', os.path.isfile(os.path.join(ROOT, 'scripts/ux-test.py')))
    ux_py = read_file('scripts/ux-test.py') or ''
    r.check(
        'ux smoke exercises mobile nav booking anchors',
        'MOBILE_NAV_HREFS' in ux_py
        and 'expected_mobile_quote_href' in ux_py
        and 'LARGE_PHONE_VIEWPORT' in ux_py
        and 'LARGE_PHONE_TALL_VIEWPORT' in ux_py
        and 'assert_enquire_quote_landing' in ux_py
        and '#avail-cal' in ux_py
        and 'assert_mobile_nav_hrefs' in ux_py,
    )
    r.check(
        'ux smoke exercises mobile forward and desktop cross-nav links',
        'section-forward-cta' in ux_py
        and 'section-cross-cta--desktop' in ux_py
        and 'assert_single_visible_primary_cta' in ux_py,
    )
    r.check('error guard script exists', os.path.isfile(os.path.join(ROOT, 'js/error-guard.js')))
    error_guard = read_file('js/error-guard.js') or ''
    r.check(
        'error guard captures window errors and safe wrappers',
        'LY_errors' in error_guard
        and 'LY_safe' in error_guard
        and 'addEventListener(' in error_guard
        and "'error'" in error_guard
        and "'unhandledrejection'" in error_guard,
    )
    r.check(
        'index.html loads error guard async after hero via LY_BASE',
        "LY_BASE" in index_html
        and '/js/error-guard.js' in index_html
        and 's.async = true' in index_html
        and 'document.write' not in index_html
        and 'src="/js/error-guard.js"' not in index_html,
    )
    guard_pos = index_html.find("'/js/error-guard.js'")
    r.check(
        'error guard is deferred until after hero (not render-blocking in head)',
        guard_pos > index_html.find('id="hero"'),
    )
    legal_html = read_file('legal.html') or ''
    r.check(
        'legal.html loads error guard async via LY_BASE',
        "(window.LY_BASE||'')+'/js/error-guard.js'" in legal_html
        and 's.async=true' in legal_html
        and 'document.write' not in legal_html
        and 'src="/js/error-guard.js"' not in legal_html,
    )
    r.check(
        'error guard logs on preview and skips dataLayer there',
        "console.warn('[Limitless]'" in error_guard
        and 'LY_IS_PREVIEW' in error_guard
        and 'ly_script_error' in error_guard,
    )
    r.check(
        'error guard ignores opaque cross-origin Script errors',
        'isOpaqueScriptError' in error_guard
        and 'isBenignAnalyticsResource' in error_guard,
    )
    r.check(
        'Clarity loads after paint on production testing (not on raw window load)',
        'function _ly_loadClarity' in index_html
        and 'window._ly_loadClarity = _ly_loadClarity' in index_html
        and 'LY_TESTING_CLARITY' in index_html
        and 'if (window.LY_TESTING_CLARITY && window._ly_loadClarity)' in index_html,
    )
    r.check(
        'clarity consent grants recording during testing when not declined',
        'LY_TESTING_CLARITY' in (read_file('js/clarity-consent.js') or '')
        and "stored !== 'denied'" in (read_file('js/clarity-consent.js') or ''),
    )
    r.check(
        'ux smoke captures JS errors across booking journeys',
        'page.on("pageerror"' in ux_py
        and 'scenario_cookie_consent_all_viewports' in ux_py
        and 'COOKIE_TEST_VIEWPORTS' in ux_py
        and 'scenario_full_page_scroll' in ux_py
        and 'scenario_gallery_lightbox' in ux_py
        and 'scenario_reviews_load' in ux_py
        and 'scenario_calendar_booking' in ux_py
        and 'scenario_booking_funnel_mobile' in ux_py
        and 'scenario_locales_mobile' in ux_py,
    )
    for loc in ('de', 'es', 'fr'):
        loc_html = read_file(f'{loc}/index.html') or ''
        r.check(
            f'{loc}/index.html keeps stable mobile menu close id',
            'id="mobileClose"' in loc_html
            and 'getElementById(\'mobileClose\')' in loc_html,
        )
    r.check('lighthouse budgets file exists', os.path.isfile(os.path.join(ROOT, 'scripts/lighthouse-budgets.json')))
    index_html = read_file('index.html') or ''
    crit_block = index_html[index_html.find('id="critical-css"'):index_html.find('</style>', index_html.find('id="critical-css"'))]
    crit_flat = re.sub(r'\s+', '', crit_block)
    net_tier_src = read_file('js/net-tier.js') or ''
    r.check(
        'Montserrat deferred until after hero (critical uses fallback only)',
        "url('../fonts/montserrat-latin.woff2')" in (read_file('css/main.css') or '')
        and 'font-display:optional' in (read_file('css/main.css') or '').replace(' ', '')
        and "url('fonts/montserrat-latin.woff2')" not in crit_block.replace(' ', '')
        and 'LY_loadFont' in net_tier_src
        and "font.rel='preload'" not in net_tier_src.replace(' ', '')
        and 'href="/fonts/montserrat-latin.woff2"' not in index_html
        and 'LY_LAYOUT_CSS_HREF' in index_html
        and 'LY_MAIN_CSS_HREF' in index_html,
    )
    css_flat = re.sub(r'\s+', '', css or '')
    r.check(
        'main.css uses metric-adjusted Montserrat fallback (font CLS guard)',
        css is not None
        and "font-family:'MontserratFallback'" in css_flat
        and "font-family:'MontserratFallbackHero'" in css_flat
        and 'size-adjust' in css_flat
        and 'ascent-override' in css_flat,
    )
    r.check(
        'fallback faces mimic Montserrat Light (light system src + metric overrides)',
        css is not None
        and 'HelveticaNeue-Thin' in css_flat
        and 'size-adjust:115%' in css_flat
        and 'size-adjust:114%' in css_flat
        and 'SegoeUILight' in css_flat.replace(' ', '')
        and "font-family:'Montserrat','MontserratFallbackHero','MontserratFallback',sans-serif" in css_flat
        and ".nav-logo{flex:01auto" in crit_flat
        and "font-family:'Montserrat','MontserratFallback',sans-serif" in crit_flat.split('.nav-logo')[1][:200]
        and "font-family:'Montserrat','MontserratFallback',sans-serif" in (read_file('css/layout.css') or '').split('.nav-logo')[1][:160].replace(' ', ''),
    )
    r.check(
        'hero text-wrap stays balance-only (no pretty reflow on main.css)',
        css is not None
        and '@supports(text-wrap:pretty)' in css_flat
        and '.hero-rates{text-wrap:pretty}' not in css_flat
        and '.hero-sub{text-wrap:pretty}' not in css_flat,
    )
    if css:
        non_composited = (
            'color', 'background', 'border', 'box-shadow', 'outline',
            'fill', 'stroke', 'all',
        )
        bad_transitions: list[str] = []
        for m in re.finditer(r'transition\s*:\s*([^;}{]+)', css):
            decl = m.group(1).strip().lower()
            if decl == 'none':
                continue
            for prop in non_composited:
                if re.search(rf'\b{re.escape(prop)}\b', decl):
                    bad_transitions.append(f'{prop} in "{decl[:60]}"')
                    break
        r.check(
            'main.css transitions are composited-only (opacity/transform/filter)',
            not bad_transitions,
            '; '.join(bad_transitions[:5]) if bad_transitions else '',
        )
    r.check(
        'behavior-analytics loads via LY_BASE',
        "LY_BASE || '') + '/js/behavior-analytics.js'" in index_html
        and 'src="/js/behavior-analytics.js"' not in index_html,
    )
    r.check(
        'preview hosts suppress analytics before GA and Clarity load',
        'LY_IS_PREVIEW' in index_html
        and index_html.find('LY_IS_PREVIEW') < index_html.find('googletagmanager.com/gtag/js')
        and 'if (window.LY_OWNER_MODE) return;' in index_html,
    )
    r.check(
        'gtag.js lazy-loads on consent or conversion (not on window load)',
        'function _ly_loadAnalytics' in index_html
        and 'window._ly_loadAnalytics = _ly_loadAnalytics' in index_html
        and "window.addEventListener('load', _ly_loadAnalytics)" not in index_html
        and 'if (window._ly_loadAnalytics) window._ly_loadAnalytics();' in index_html,
    )
    r.check(
        'analytics defer until after meaningful paint',
        'LY_afterMeaningfulPaint(function()' in index_html
        and 'window._ly_loadAnalytics' in index_html
        and 'window._ly_loadClarity' in index_html,
    )
    legal_html = read_file('legal.html') or ''
    r.check(
        'external analytics scripts use crossOrigin anonymous for error visibility',
        "_gt.crossOrigin='anonymous'" in index_html
        and 'clarity.ms/tag/' in index_html
        and re.search(
            r"createElement\(r\);t\.async=1;t\.crossOrigin='anonymous';t\.src=\"https://www\.clarity\.ms/tag/\"",
            index_html,
        )
        is not None
        and "_gt.crossOrigin='anonymous'" in legal_html,
    )
    r.check(
        'hero cinema CTA buttons use generous scoped padding on mobile',
        css is not None
        and '--hero-cinema-btn-pad-y:clamp(0.95rem,5vw,1.18rem)' in re.sub(r'\s+', '', css)
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#hero\s+\.hero-actions\s+\.btn-primary[^}]*min-height:\s*2\.85rem',
            css,
        )
        is not None
        and not re.search(
            r'#hero\s+\.hero-actions\s+\.btn-primary[^}]*max-width:\s*170px',
            css,
        ),
    )
    r.check(
        'hero CTA buttons vertically center label text',
        css is not None
        and '#hero.hero-actions.btn-primary,#hero.hero-actions.btn-ghost{display:inline-flex'
        in re.sub(r'\s+', '', css)
        and '#hero.hero-actions.btn-primary{border:1pxsolidtransparent'
        in re.sub(r'\s+', '', css),
    )
    r.check(
        'end date submitted via hidden field only',
        'type="hidden" name="preferred_date_end"' in index_html
        and 'preferred_date_end_btn' not in index_html
        and 'LY_applyDurDateLayout' not in index_html,
    )
    r.check(
        'calendar hint lives inside the calendar card',
        'class="cal-footer"' in index_html and 'id="calHint"' in index_html,
    )
    r.check(
        'calendar legend uses swatch spans',
        'class="cal-legend-swatch leg-selected"' in index_html,
    )
    r.check(
        'calendar pans to keep selection visible',
        'function ensureSelectionVisible()' in index_html,
    )
    r.check(
        'calendar next/prev advance by visible month count',
        'function shift(dir)' in index_html
        and 'viewIndex + dir * count' in index_html,
    )
    r.check(
        'paired desktop calendar renders two months not three on wide viewports',
        "closest('.contact-cal-pair')" in index_html
        and 'count > 2 && calRoot.closest' in index_html,
    )
    r.check(
        'availability and form calendars fire distinct Clarity events',
        'LY_clarityEvent' in index_html
        and 'ly_cal_avail_month_next' in index_html
        and 'ly_cal_avail_date_select' in index_html
        and 'ly_cal_form_open' in index_html
        and 'ly_cal_form_month_next' in index_html
        and 'ly_cal_form_date_select' in index_html
        and 'ly_hero_rates_click' in index_html
        and 'ly_charters_rates_view' in index_html,
    )
    r.check(
        'calendar enquire focuses name field on desktop only',
        "getElementById('name')" in index_html
        and 'if (isCalendarFormPaired())' in index_html
        and 'nameInput.focus()' in index_html
        and 'startInput.focus' not in index_html,
    )
    r.check(
        'desktop paired layout shows enquire bridge, hides calendar WhatsApp',
        css is not None
        and re.search(
            r'\.contact-cal-pair\s+#availability\s+\.availability-actions\s*\{[^}]*display:\s*flex',
            css,
        ) is not None
        and re.search(
            r'\.contact-cal-pair\s+#availability\s+\.cal-wa-btn\s*\{\s*display:\s*none',
            css,
        ) is not None
        and re.search(
            r'@media\s*\(min-width:\s*769px\)[^{]*\{[^}]*\.form-col-wa[^}]*display:\s*none',
            css,
            re.DOTALL,
        ) is not None,
    )
    r.check(
        'desktop calendar enquire button has continue copy',
        'cal-enquire-desktop' in index_html
        and 'Continue to enquiry →' in index_html
        and 'cal-enquire-mobile' in index_html,
    )
    r.check(
        'desktop destination cards show click affordance',
        css is not None
        and '.destination-card-body::after' in css
        and re.search(r"content:\s*'View full details →'", css) is not None
        and '.destination-card:hover .destination-card-body::after' in css,
    )
    r.check(
        'destination lightbox enquire CTA focuses name field on desktop',
        'function applyDestLbPrefill()' in index_html
        and "nameInput.focus({ preventScroll: true })" in index_html
        and 'dest-lb-cta-secondary' not in index_html,
    )
    r.check(
        'desktop immersive sections use mobile-style funnel CTAs',
        index_html.count('class="itinerary-bottom-actions"') >= 2
        and 'href="#gallery-land" class="btn-ghost itinerary-bottom-link--desktop">The yacht</a>' in index_html
        and 'href="#gallery-funnel" class="btn-ghost itinerary-bottom-link--mobile">The yacht</a>' in index_html
        and 'href="#itinerary-land" class="btn-ghost itinerary-bottom-link--desktop">destinations</a>' in index_html
        and 'href="#itinerary-funnel" class="btn-ghost itinerary-bottom-link--mobile">destinations</a>' in index_html
        and css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-wrap[\s\S]*?min-height:\s*calc\(100svh\s*-\s*var\(--nav-scroll-offset\)\s*-\s*14rem\)',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery,\s*#itinerary\s*\{[^}]*height:\s*auto',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-grid[\s\S]*?flex:\s*1\s*1\s*0',
            css,
        )
        is not None
        and 'immersive-chrome' not in css
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.gallery-wrap\s*>\s*\.itinerary-bottom-bar',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.section-cta-desktop[\s\S]*?display:\s*none',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.carousel-nav[\s\S]*?display:\s*flex',
            css,
        )
        is not None,
    )
    r.check(
        'gallery lightbox uses viewport-specific browse hint',
        'Use arrow keys or click sides to browse' in index_html
        and "matchMedia('(min-width: 769px)')" in index_html,
    )
    r.check(
        'lightboxes share unified navigation chrome classes',
        'class="lb-close"' in index_html
        and 'class="lb-nav lb-nav--prev"' in index_html
        and 'class="lb-nav lb-nav--next"' in index_html
        and 'class="lb-counter"' in index_html
        and 'class="lb-hint"' in index_html
        and css is not None
        and css_rule_index(css, '.lb-close') >= 0
        and css_rule_index(css, '.lb-nav') >= 0
        and css_rule_index(css, '.lb-counter') >= 0
        and css_rule_index(css, '.lb-loader') >= 0
        and '#lightbox.lb-loading #lightbox-img' in css
        and '.dest-lb-img-wrap.lb-loading #dest-lb-img' in css
        and css_rule_index(css, '.card-loader') < 0
        and '.destination-card.card-loading' not in css
        and css_rule_index(css, '.ly-prog-wrap') >= 0
        and '.ly-prog-wrap.ly-prog-skip-preview' in css
        and '.ly-prog-wrap.ly-prog-sharp-ready.ly-prog-sharp-visible .ly-prog-sharp' in css
        and css_rule_index(css, '#dest-lb-close') < 0
        and '#lightbox-prev' not in css,
    )
    r.check(
        'destination lightbox shows same browse hint as gallery',
        'ly_dest_hinted' in index_html
        and 'id="dest-lb-hint"' in index_html
        and "matchMedia('(min-width: 1101px)')" in index_html,
    )
    r.check(
        'calendar enquire scrolls on mobile, skips scroll on desktop when paired',
        'function isCalendarFormPaired()' in index_html
        and 'if (isCalendarFormPaired())' in index_html
        and 'scrollIntoView' in index_html,
    )
    r.check(
        'mobile funnel CTAs route to availability calendar',
        index_html.count('href="#avail-cal" class="btn-primary itinerary-bottom-link--mobile">availability</a>') == 2,
    )
    r.check(
        'gallery bottom bar pairs destinations with availability hero-style',
        index_html.count('class="btn-ghost itinerary-bottom-link--mobile">destinations</a>') == 1
        and index_html.count('class="btn-ghost itinerary-bottom-link--desktop">destinations</a>') == 1
        and 'CHECK AVAILABILITY →' not in index_html,
    )
    r.check(
        'destinations bottom bar pairs yacht with availability hero-style',
        index_html.count('class="btn-primary itinerary-bottom-link--mobile">availability</a>') == 2
        and index_html.count('class="btn-primary itinerary-bottom-link--desktop">availability</a>') == 2
        and index_html.count('class="btn-ghost itinerary-bottom-link--mobile">The yacht</a>') == 1
        and 'Seen somewhere you\'d love to go?' not in index_html.split('id="itinerary"')[1].split('id="gallery"')[0]
        and css is not None
        and '.itinerary-bottom-actions' in css
        and re.search(
            r'\.itinerary-bottom-actions\s+\.btn-primary[\s\S]*?flex:\s*1\s*1\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.gallery-wrap\s*>\s*\.itinerary-bottom-bar',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#(?:gallery|itinerary)\s+\.itinerary-bottom-bar[\s\S]*?margin:\s*\.5rem\s+0\s+\.75rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#(?:gallery|itinerary)\s+\.itinerary-bottom-bar[\s\S]*?margin:\s*\.75rem\s+0\s+\.85rem',
            css,
        )
        is not None
        and 'LY_syncMobileFunnelChrome' not in index_html
        and 'position: fixed' not in css.split('#itinerary .itinerary-bottom-bar')[1].split('@media')[0],
    )
    r.check(
        'desktop funnel CTAs use nav-style landing anchors',
        index_html.count('href="#availability" class="btn-primary itinerary-bottom-link--desktop">availability</a>') == 2
        and 'href="#gallery-land" class="btn-ghost itinerary-bottom-link--desktop">The yacht</a>' in index_html
        and 'href="#itinerary-land" class="btn-ghost itinerary-bottom-link--desktop">destinations</a>' in index_html
        and css is not None
        and re.search(
            r'\.itinerary-bottom-actions\s+\.itinerary-bottom-link--desktop[\s\S]*?display:\s*none\s*!important',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.itinerary-bottom-actions\s+\.itinerary-bottom-link--mobile[\s\S]*?display:\s*none\s*!important',
            css,
        )
        is not None,
    )
    r.check(
        'mobile gallery section fills viewport like itinerary',
        css is not None
        and re.search(
            r'#gallery,\s*#itinerary\s*\{[^}]*min-height:\s*100svh',
            css,
        ) is not None
        and re.search(
            r'#gallery\s+\.gallery-group\s+\.gallery-item\s*\{[^}]*height:\s*calc\(100svh\s*-\s*15\.75rem\)',
            css,
        ) is not None
        and re.search(
            # Destination card trimmed more than the gallery item (taller 2-line
            # tabs) so the bottom CTA bar stays in view on funnel landing.
            r'\.destination-card\s*\{[^}]*height:\s*calc\(100svh\s*-\s*16\.25rem\)',
            css,
        ) is not None,
    )
    r.check(
        'destination lightbox CTA labels swap on mobile',
        css is not None
        and '.dest-lb-cta-mobile' in css
        and '.dest-lb-cta-desktop' in css
        and re.search(r'@media\s*\(max-width:\s*768px\)[^{]*\{[^}]*\.dest-lb-cta-desktop\s*\{\s*display:\s*none', css) is not None,
    )
    r.check(
        'destination lightbox mobile CTA copy is trip-specific',
        'Check dates for this trip →' in index_html
        and 'dest-lb-cta-mobile' in index_html,
    )
    r.check(
        'tablet carousel navigation uses larger touch targets',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.carousel-btn\s*\{[^}]*width:\s*2\.55rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.carousel-pos\s*\{[^}]*font-size:\s*\.6rem',
            css,
        )
        is not None,
    )
    r.check(
        'destination lightbox chrome spans full card on desktop',
        'class="dest-lb-chrome"' in index_html
        and 'class="dest-lb-main"' in index_html
        and 'class="dest-lb-content"' in index_html
        and index_html.index('dest-lb-chrome') < index_html.index('dest-lb-main')
        and index_html.index('id="dest-lb-close"') < index_html.index('dest-lb-img-wrap'),
    )
    r.check(
        'tablet availability section shows title and intro',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.contact-cal-pair\s+#availability\s+\.section-title\s*\{[^}]*display:\s*block',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.contact-cal-pair\s+#availability\s+\.availability-intro\s*\{[^}]*display:\s*block',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.contact-cal-pair\s+#availability\s+\.cal\s*\{[^}]*margin-top:\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?#availability-land\s*\{[^}]*scroll-margin-top:\s*1rem',
            css,
        )
        is not None,
    )
    r.check(
        'destination lightbox stacked on tablet, two-column on desktop only',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.dest-lb-img-wrap\s*\{[^}]*flex:\s*1\s*1\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*641px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?\.dest-lb-body\s*\{[^}]*flex:\s*0\s*0\s*auto',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*1101px\s*\)[\s\S]*?\.dest-lb-main\s*\{[^}]*flex-direction:\s*row',
            css,
        )
        is not None
        and re.search(
            r'\.dest-lb-chrome\s*\{[^}]*position:\s*absolute',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*1101px\s*\)[\s\S]*?\.dest-lb-body\s*\{[^}]*padding:[^;]*clamp\(4rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*1101px\s*\)[\s\S]*?\.dest-lb-chrome\s+\.lb-nav--next\s*\{[^}]*right:',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*640px\s*\)[\s\S]*?\.dest-lb-body\s*\{[^}]*flex:\s*1',
            css,
        )
        is not None,
    )
    r.check(
        'form date hint links to availability calendar overview',
        'class="form-date-hint"' in index_html
        and 'class="form-date-hint-link"' in index_html
        and 'href="#avail-cal"' in index_html
        and 'select free date(s) above.' in index_html
        and css is not None
        and '.form-date-hint-link' in css,
    )
    r.check(
        'form date popover is a field-attached popup with on-brand trigger',
        css is not None
        and '.form-date-wrap' in css
        and '.form-date-popover.opens-up' in css
        and '.form-date-popover.opens-down' in css
        and '.form-date-popover-toolbar' in css
        and '.form-date-month-nav' in css
        and 'form-date-month-nav' in index_html
        and '.form-date-prev' not in index_html.split('form-date-popover-toolbar')[1].split('form-date-cal-grid')[0]
        and 'class="form-date-popover cal opens-up"' in index_html
        and 'function positionFormDatePopover' in index_html
        and "formDatePopover.style.position = 'fixed'" not in index_html
        and 'formDatePopover.style.overflowY' not in index_html
        and 'opens-down' in index_html
        and 'form-date-row-open' not in index_html
        and '.form-row.form-date-row-open' not in css
        and '.form-row:has(#formDurWrap[hidden])' not in css
        and re.search(r'max-width:\s*18\.5rem', css) is not None
        and '.form-date-trigger' in css
        and '.form-date-icon' in css
        and '.form-date-popover .cal-cell' in css
        and '.form-date-apply-btn' in css
        and 'class="cal-nav form-date-nav form-date-popover-dismiss"' in index_html
        and '.form-date-popover-dismiss' in css
        and '.form-date-popover .form-date-clear-btn' in css
        and 'form-date-close-hint' not in index_html
        and '.form-date-modal' not in css
        and '.form-date-backdrop' not in css
        and re.search(r'\.form-date-popover(?:\.cal)?\s*\{[^}]*background:\s*var\(--deep\)', css) is not None
        and 'body.form-date-popup-open::before' not in css
        and 'body.form-date-popup-open .form-date-popover:not([hidden])' not in css
        and '.form-date-popover.opens-up' in css
        and re.search(r'\.form-date-popover(?:\.cal)?\s*\{[^}]*position:\s*absolute', css) is not None,
    )
    r.check(
        'mobile quote links pick enquire anchor from viewport height',
        css is not None
        and 'function lyEnquireSectionFitsViewport()' in index_html
        and 'function lyEnquireQuoteHref()' in index_html
        and 'function syncEnquireQuoteHrefs()' in index_html
        and "matchMedia('(max-width: 768px)')" in index_html
        and 'getComputedStyle(document.documentElement).scrollPaddingTop' not in index_html
        and 'requestAnimationFrame(function () {' in index_html.split('syncEnquireQuoteHrefs')[1][:500]
        and "return '#enquire';" in index_html
        and 'window.LY_enquireSectionFitsViewport = lyEnquireSectionFitsViewport' in index_html
        and 'visualViewport' in index_html
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#enquire\s*\{[^}]*scroll-margin-top:\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*401px\s*\)\s*and\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#enquire-land\s*\{[^}]*scroll-margin-top:\s*1rem',
            css,
        )
        is not None,
    )
    r.check(
        'desktop date popover stacks below fixed nav',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.form-date-wrap\.is-open\s*\{[^}]*z-index:\s*50',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.form-date-popover(?:,\s*\.form-date-popover\.cal)?\s*\{[^}]*z-index:\s*50',
            css,
        )
        is not None,
    )
    r.check(
        'mobile date popover stacks below fixed nav',
        css is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.form-date-wrap\.is-open\s*\{[^}]*z-index:\s*50',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.form-date-popover(?:,\s*\.form-date-popover\.cal)?\s*\{[^}]*z-index:\s*50',
            css,
        )
        is not None,
    )
    r.check(
        'desktop nav keeps single row on narrow viewports',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)\s*and\s*\(\s*max-width:\s*1100px\s*\)[\s\S]*?nav\s*\{[^}]*display:\s*flex',
            css,
        )
        is not None
        and 'grid-template-areas: "logo end" "links links"' not in css,
    )
    r.check(
        'nav language popup and active link styles',
        css is not None
        and '.nav-lang-wrap' in css
        and '.nav-lang-popover' in css
        and '.nav-links a.is-active' in css
        and re.search(
            r'\.nav-cta:focus:not\(:focus-visible\)\s*\{[^}]*background:\s*transparent',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*hover:\s*hover\s*\)\s*and\s*\(\s*pointer:\s*fine\s*\)[\s\S]*?\.nav-cta:hover',
            css,
        )
        is not None,
    )
    r.check(
        'buttons share unified fill and ghost colour tokens',
        css is not None
        and '--btn-fill: var(--gold)' in css
        and '--btn-ghost-border:' in css
        and '--btn-ghost-text: var(--cream)' in css
        and '.btn-primary {' in css
        and 'background: var(--btn-fill)' in css
        and '.btn-ghost {' in css
        and 'border: 1px solid var(--btn-ghost-border)' in css
        and '.nav-cta {' in css
        and 'color: var(--btn-ghost-text)' in css.split('.nav-cta {')[1].split('}')[0]
        and '.mobile-nav-cta {' in css
        and '.cookie-btn-ghost {' in css
        and 'color: var(--btn-on-fill)' in css.split('.mobile-nav-cta {')[1][:500],
    )
    r.check(
        'desktop nav landing keeps labels and uses nav scroll offset',
        css is not None
        and '--nav-scroll-offset' in css
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?html\s*\{[^}]*scroll-padding-top:\s*var\(--nav-scroll-offset\)',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#charters-land[\s\S]*?scroll-margin-top:\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#availability\s*\{[^}]*scroll-margin-top:\s*1rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#enquire-land\s*\{[^}]*scroll-margin-top:\s*1\.5rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s*>\s*\.container,\s*#itinerary\s*>\s*\.container\s*\{[^}]*flex-shrink:\s*0',
            css,
        )
        is not None,
    )
    r.check(
        'desktop gallery and destinations show intro copy for natural scroll',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s*>\s*\.container,\s*#itinerary\s*>\s*\.container\s*\{[^}]*flex-shrink:\s*0',
            css,
        )
        is not None
        and 'itinerary-intro' in index_html
        and 'class="section-intro reveal reveal-delay-2">Explore life aboard Limitless' in index_html
        and 'class="section-title reveal reveal-delay-1">On<em>board Gallery</em>' in index_html
        and css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery,\s*#itinerary\s*\{[^}]*padding-bottom:\s*5rem',
            css,
        )
        is not None,
    )
    r.check(
        'reviews and specs desktop show only availability CTA',
        css is not None
        and '.section-cta-avail--desktop' in css
        and 'section-cta-quote--desktop' not in css
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#reviews\s+\.section-cta-avail--mobile[\s\S]*?display:\s*none',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#specs\s+\.section-cta-avail--desktop[\s\S]*?display:\s*inline-block',
            css,
        )
        is not None,
    )
    r.check(
        'tablet and phone share immersive destinations gallery funnel',
        css is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#gallery,\s*#itinerary\s*\{[^}]*min-height:\s*100svh',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?#gallery\s+\.itinerary-bottom-bar[\s\S]*?display:\s*block',
            css,
        )
        is not None,
    )
    r.check(
        'mobile forward links stay hidden on desktop',
        css is not None
        and re.search(
            r'\.section-forward-cta\s*\{[^}]*display:\s*none',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.section-forward-cta\s*\{[^}]*display:\s*block',
            css,
        )
        is not None,
    )
    r.check(
        'mobile hides desktop-only section CTAs and cross-nav',
        css is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.section-cta-avail--desktop[\s\S]*?display:\s*none\s*!important',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.section-cross-cta--desktop[\s\S]*?display:\s*none\s*!important',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.section-cta-btns\s*>\s*\.btn-primary:not\(\.section-cta-avail--desktop\)',
            css,
        )
        is not None,
    )
    r.check(
        'desktop availability pair compacts for viewport-height landing',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.contact-cal-pair\s+#availability,\s*\.contact-cal-pair\s+\.enquire-section\s*\{[^}]*padding-top:\s*3\.5rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)\s*and\s*\(\s*max-height:\s*920px\s*\)[\s\S]*?\.contact-cal-pair',
            css,
        )
        is not None
        and not re.search(
            r'\.contact-cal-pair\s+#availability,\s*\.contact-cal-pair\s+\.enquire-section\s*\{[^}]*padding-top:\s*7rem',
            css,
        ),
    )
    r.check(
        'charters hides text back-link when desktop CTA buttons show',
        re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#charters \.section-back-cta\s*\{[^}]*display:\s*none',
            css,
        )
        is not None,
    )
    r.check(
        'section cross-nav uses shared ghost button cluster styles',
        '.section-cross-cta--desktop{' in css_flat
        and re.search(
            r'\.section-cross-cta--desktop\s*\{[^}]*border-top:',
            css,
        )
        is not None,
    )
    r.check(
        'section cross-nav desktop keeps ghost buttons in one row',
        re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.section-cross-cta--desktop \.section-cta-btns\s*\{[^}]*flex-wrap:\s*nowrap',
            css,
        )
        is not None,
    )
    cross_hide_m = (
        re.search(r'\.section-cross-cta--desktop\s*\{[^}]*display:\s*none', css)
        if css is not None
        else None
    )
    cross_show_m = (
        re.search(r'\.section-cross-cta--desktop\s*\{[^}]*display:\s*block', css)
        if css is not None
        else None
    )
    r.check(
        'section cross-nav desktop show rule follows mobile hide rule',
        cross_hide_m is not None
        and cross_show_m is not None
        and cross_hide_m.start() < cross_show_m.start(),
    )
    r.check(
        'reviews desktop uses compact two-column grid',
        re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.reviews-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2',
            css,
        )
        is not None,
    )
    reviews_grid_base = css_rule_index(css, '.reviews-grid') if css is not None else -1
    reviews_grid_desktop = -1
    if css is not None:
        for marker in (
            'grid-template-columns:repeat(2,minmax(0,1fr))',
            'grid-template-columns: repeat(2, minmax(0, 1fr))',
        ):
            reviews_grid_desktop = max(reviews_grid_desktop, css.rfind(marker))
    r.check(
        'reviews desktop grid overrides come after base single-column rule',
        reviews_grid_base >= 0
        and reviews_grid_desktop > reviews_grid_base,
    )
    r.check(
        'reviews short viewports compact section padding',
        re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)\s*and\s*\(\s*max-height:\s*920px\s*\)[\s\S]*?#reviews',
            css,
        )
        is not None,
    )
    r.check(
        'charters section keeps includes visible on desktop viewports',
        css is not None
        and '.charters-main' in css
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#charters\s*\{[^}]*padding-top:\s*3\.5rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*1000px\s*\)[\s\S]*?\.charters-main[\s\S]*?grid-template-columns',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*1000px\s*\)[\s\S]*?\.charters-main\s+\.charter-includes[\s\S]*?position:\s*sticky',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)\s*and\s*\(\s*max-height:\s*920px\s*\)[\s\S]*?#charters',
            css,
        )
        is not None,
    )
    r.check(
        'calendar nav buttons avoid sticky touch hover',
        css is not None
        and re.search(r'@media\s*\(\s*hover:\s*hover\s*\)\s*and\s*\(\s*pointer:\s*fine\s*\)', css) is not None
        and re.search(r'\.cal-nav:hover:not\(:disabled\)', css) is not None
        and '.cal-nav:focus:not(:focus-visible)' in css
        and 'e.currentTarget.blur()' in index_html,
    )
    r.check(
        'availability calendar has app-style landing anchor',
        'id="avail-cal"' in index_html
        and 'class="availability-picker"' in index_html
        and 'availability-intro' in index_html
        and '#avail-cal' in (css or ''),
    )
    r.check(
        'availability intro visible in paired mobile layout',
        css is not None
        and re.search(
            r'\.contact-cal-pair\s+#availability\s+\.availability-intro\s*\{',
            css,
        ) is not None
        and '.contact-cal-pair #availability .availability-intro { display: none' not in css,
    )
    r.check(
        'availability section title visible on mobile paired layout',
        css is not None
        and re.search(
            r'\.contact-cal-pair\s+#availability\s+\.section-title\s*\{[^}]*display:\s*block',
            css,
        ) is not None
        and '.contact-cal-pair #availability .section-title { display: none' not in css,
    )
    r.check(
        'calendar selection updates WhatsApp enquiry links',
        'function syncWaEnquiryLinks(msg)' in index_html
        and "document.querySelector('.form-col-wa')" in index_html
        and 'syncWaEnquiryLinks(msg)' in index_html
        and 'syncWaEnquiryLinks(null)' in index_html,
    )
    r.check(
        'WhatsApp CTA copy uses enquire voice',
        'Ask on WhatsApp' not in index_html
        and 'Enquire on WhatsApp' in index_html
        and 'Enquire via WhatsApp' in index_html,
    )
    r.check(
        'calendar WhatsApp label reflects selected dates',
        'data-wa-label-dates="WhatsApp these dates"' in index_html
        and 'function syncCalWaLabel(hasDates)' in index_html
        and 'syncCalWaLabel(true)' in index_html,
    )
    pair_start = index_html.find('class="contact-cal-pair"')
    pair_end = index_html.find('id="reviews"', pair_start)
    pair_html = index_html[pair_start:pair_end] if pair_start != -1 and pair_end != -1 else ''
    r.check(
        'calendar precedes enquiry form in page structure',
        pair_html.find('id="availability"') != -1
        and pair_html.find('class="enquire-section"') != -1
        and pair_html.find('id="availability"') < pair_html.find('class="enquire-section"'),
    )
    r.check(
        'desktop paired layout keeps form left of calendar',
        css is not None
        and re.search(r'@media\s*\(min-width:\s*769px\)', css) is not None
        and re.search(r'\.contact-cal-pair\s+\.enquire-section\s*\{\s*order:\s*1', css) is not None
        and re.search(r'\.contact-cal-pair\s+#availability\s*\{\s*order:\s*2', css) is not None,
    )
    r.check(
        'destination cards use pointer cursor (clickable like gallery)',
        css is not None
        and re.search(r'\.destination-card\s*\{[^}]*cursor:\s*pointer', css) is not None,
    )
    if main_css:
        r.check(
            'mobile grids single-column: contact-grid, enquiry-grid, form-row override in @layer site',
            # contact-grid must go 1-col on phones (layout.css @layer layout can't beat @layer site)
            re.search(
                r'@media\s*\(\s*max-width:\s*768px\s*\)[^{]*\{[^}]*\.contact-grid\s*\{[^}]*grid-template-columns:\s*1fr',
                main_css,
            ) is not None
            # enquiry-grid (charter cards) must go 1-col on phone
            and re.search(
                r'@media\s*\(\s*max-width:\s*640px\s*\)[^{]*\{[^}]*\.enquiry-grid\s*\{[^}]*grid-template-columns:\s*1fr',
                main_css,
            ) is not None
            # form field rows must go 1-col on phone
            and re.search(
                r'@media\s*\(\s*max-width:\s*640px\s*\)[^{]*\{[^}]*\.form-row\s*\{[^}]*grid-template-columns:\s*1fr',
                main_css,
            ) is not None,
        )

    for rel in (
        'fonts/montserrat-latin.woff2',
        'images/mobile/maiora_20s_02.webp',
        'images/mobile/maiora_20s_02-480.webp',
        'images/mobile/maiora_20s_02-720.webp',
        'images/maiora_20s_02.webp',
        'images/maiora_20s_02-640.webp',
        'images/maiora_20s_02-960.webp',
        'images/maiora_20s_02-1280.webp',
        'images/dest/portals-vells-1.webp',
        'images/mobile/dest/portals-vells-1.webp',
        'images/maiora_20s_04-640.webp',
        'images/maiora_20s_04-960.webp',
        'images/mobile/dest/el-toro-malgrats-1-480.webp',
        'images/mobile/dest/el-toro-malgrats-1-720.webp',
        'images/mobile/_srcset-widths.json',
        'data/reviews.json',
        'netlify/functions/availability.mjs',
        'netlify/functions/reviews.mjs',
    ):
        r.check(f'{rel} exists', os.path.isfile(os.path.join(ROOT, rel)))

    availability_mjs = read_file('netlify/functions/availability.mjs') or ''
    r.check(
        'availability ICS parser handles dashed dates and tentative status',
        'expandEvent' in availability_mjs
        and 'STATUS' in availability_mjs
        and 'RRULE' in availability_mjs
        and r'(\d{4})-?(\d{2})-?(\d{2})' in availability_mjs,
    )

    reviews_raw = read_file('data/reviews.json')
    if reviews_raw is not None:
        try:
            data = json.loads(reviews_raw)
            reviews = data.get('reviews', [])
            r.check('reviews.json has reviews array', isinstance(reviews, list) and len(reviews) > 0)
            if reviews:
                sample = reviews[0]
                r.check(
                    'reviews.json entries have author/rating/text',
                    all(k in sample for k in ('author', 'rating', 'text')),
                )
        except json.JSONDecodeError as exc:
            r.fail('reviews.json is valid JSON', str(exc))


# ── JS syntax check ────────────────────────────────────────────────────────────

def check_js(r: Runner, rel: str) -> None:
    html = read_file(rel)
    if html is None:
        r.fail(f'{rel} readable for JS check', 'file not found')
        return

    blocks = re.findall(
        r'<script(?![^>]*\bsrc\b)(?![^>]*type=["\'][^"\']*(?:json|template|text/html))[^>]*>'
        r'(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if not blocks:
        r.warn(f'No inline script blocks found in {rel}')
        return

    combined = ';\n'.join(b.strip() for b in blocks if b.strip())
    char_count = len(combined)
    tmp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix='.js', mode='w', encoding='utf-8', delete=False,
        ) as tf:
            tf.write(combined)
            tmp_path = tf.name

        result = subprocess.run(
            ['node', '--check', tmp_path],
            capture_output=True,
            text=True,
            timeout=15,
        )

        if result.returncode == 0:
            r.ok(f'{rel} inline JS valid ({len(blocks)} blocks, {char_count:,} chars)')
        else:
            first_err = result.stderr.strip().split('\n')[0].replace(tmp_path, rel)
            r.fail(f'{rel} inline JS syntax', first_err)

    except FileNotFoundError:
        r.warn('node not installed — skipping JS syntax checks')
    except subprocess.TimeoutExpired:
        r.warn(f'node --check timed out for {rel} (>15 s) — skipping')
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description='Limitless site test suite')
    parser.add_argument(
        '--quick',
        action='store_true',
        help='HTML/asset checks only — skip JS syntax (faster)',
    )
    args = parser.parse_args()

    print('━' * 58)
    print('  Limitless site tests')
    print('━' * 58)

    r = Runner()
    pages: dict[str, str] = {}

    for rel in LOCALE_FILES:
        print(f'\n[{rel}]')
        html = read_file(rel)
        if html is None:
            r.fail(f'{rel}', 'file not found')
            continue
        pages[rel] = html
        check_html(r, rel, html)

    print('\n[locale parity]')
    if pages:
        check_locale_parity(r, pages)

    print('\n[legal pages]')
    for rel in LEGAL_FILES:
        html = read_file(rel)
        if html is None:
            r.fail(f'{rel}', 'file not found')
            continue
        check_legal(r, rel, html)

    print('\n[localized reviews]')
    check_localized_reviews(r)

    print('\n[locale modules]')
    check_locale_modules(r)

    print('\n[locale translations]')
    check_locale_translations(r, pages)

    print('\n[html integrity]')
    check_html_integrity(r)

    print('\n[shared assets]')
    check_shared_assets(r)

    if not args.quick:
        print('\n[JS syntax]')
        for rel in LOCALE_FILES:
            check_js(r, rel)

    passed = r.summary()
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()