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
    """Heuristic: production pages are single-line (0 newlines) after minify."""
    return len(html) > 10_000 and html.count('\n') == 0


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
    r.check('#enquire quote section is gone', '<span id="enquire"' not in html and 'enquire-section' not in html)
    r.check('no in-page links point at the removed quote section', 'href="#enquire"' not in html and 'href="#enquire-land"' not in html and 'href="#enquire-form"' not in html)
    r.check(
        'page order is gallery → charters → availability → reviews',
        html.find('id="gallery"') < html.find('id="charters"')
        and html.find('id="charters"') < html.find('id="availability"')
        and html.find('id="availability"') < html.find('id="reviews"')
        and html.find('id="reviews"') < html.find('id="amenities"')
        and 'id="avail-cal"' in html
        and html.find('id="availability"') < html.find('id="avail-cal"') < html.find('id="reviews"'),
    )
    r.check(
        'reviews and specs desktop keep single availability CTA',
        'section-cta-avail--desktop' in html
        and 'section-cta-quote--desktop' not in html
        and html.count('href="#availability" class="btn-primary section-cta-avail--desktop"') == 2
        and html.count('href="#avail-cal" class="btn-primary section-cta-avail--mobile"') == 3
        and html.count('href="#avail-cal" class="btn-ghost section-cta-quote--mobile"') == 1
        and html.count('href="#itinerary-funnel" class="btn-ghost section-cta-quote--mobile"') == 1,
    )
    r.check(
        'charters section groups options with includes panel',
        'class="charters-main"' in html
    )
    r.check(
        'reviews fire per-review Clarity engagement events',
        # Each card is tagged with an author slug, dwell-views fire
        # ly_review_view_<slug>, and expands fire ly_review_expand_<slug>
        'function lyRvSlug(' in html
        and 'data-rv-slug="' in html
        and "ly_review_view_'+s" in html
        and "ly_review_expand_'+(_ec.getAttribute('data-rv-slug')" in html,
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
        'reviews desktop cross-nav nudges availability and amenities',
        re.search(
            r'<section id="reviews">[\s\S]*?href="#availability"[^>]*class="btn-ghost"'
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
        and "href === '#itinerary-funnel' && location.hash === '#itinerary-funnel'" in html
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

    r.check('request-a-quote WhatsApp column is gone', 'class="whatsapp-btn"' not in html and 'enquire-section' not in html)

    # WhatsApp soft-conversion system (floating CTA + booked-date capture)
    r.check('ly-wa-softconvert script present', 'id="ly-wa-softconvert"' in html)
    r.check(
        'soft-conversion fires owner-gated Clarity events via LY_clarityEvent',
        'window.LY_clarityEvent' in html
        and all(e in html for e in ('ly_wa_fab_click', 'ly_cal_booked_tap',
            'ly_cal_booked_whatsapp', 'ly_cal_show_open_dates')),
    )
    r.check(
        'soft-conversion only intercepts booked (not on-hold/free) dates',
        "classList.contains(\"booked\")" in html,
    )
    r.check(
        'WA FAB hides on hero and animates in after scroll past',
        'watchFab' in html
        and '.ly-wa-fab.is-in' in html
        and 'IntersectionObserver' in html
        and 'opacity:0' in html,
    )

    # Contact: WhatsApp + mailto (enquiry form removed)
    r.check(
        'enquiry form and Netlify contact form are gone',
        'id="contactForm"' not in html
        and 'id="formDatePopover"' not in html
        and 'id="emailSheet"' not in html
        and 'id="enquire-form"' not in html,
    )
    r.check(
        'email fallback mailto lives under the calendar WhatsApp',
        html.count('class="email-fallback-link"') == 1
        and 'mailto:info@limitlessyachtcharter.com' in html
        and 'id="calMailtoLink"' in html
        and 'ly_email_click' in html,
    )
    r.check(
        'privacy policy still linked from the page footer',
        'legal.html' in html
        and 'id="ly_hp"' not in html
        and 'id="cal_ly_hp"' not in html,
    )

    # Destination lightbox
    r.check('id="dest-lb-cta" lightbox CTA exists', 'id="dest-lb-cta"' in html)
    r.check(
        'destination lightbox CTA has viewport-specific labels',
        'class="dest-lb-cta-desktop"' in html
        and 'class="dest-lb-cta-mobile"' in html,
    )
    r.check(
        'destination lightbox CTA routes to the availability calendar',
        'function syncDestLbCta()' in html
        and "lbCta.href = '#avail-cal'" in html
        and 'function lyGoAvailSectionLand()' in html
        and "a[href=\"#avail-cal\"], a[href=\"#availability\"]" in html
        and 'if (w < 641 || w > 1100) return' in html
        and 'function closeDestLbAndGo(hash)' in html
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
        and html.count('media="(min-width: 769px)"') == 41
        and html.count('media="(min-width: 769px)" data-ly-srcset=') == 41
        and 'media="(min-width: 769px)" data-ly-srcset="images/mobile/' not in html
        and 'reframe_immersive.py' in (read_file('scripts/reframe_immersive.py') or '')
        and 'DJI_20260626132137_0266_D.JPG' in (read_file('scripts/reframe_immersive.py') or '')
        and 'Focus(0.56, 0.50, 1.35)' in (read_file('scripts/reframe_immersive.py') or '')
        and '01_portals_vells_existing.jpg' in (read_file('scripts/reframe_immersive.py') or '')
        and '01_el_toro_rocky_pexels.jpg' in (read_file('scripts/reframe_immersive.py') or '')
        and '02_portals_pano.jpg' not in (read_file('scripts/reframe_immersive.py') or '')
        and '02_el_toro_waterfront_pexels.jpg' not in (read_file('scripts/reframe_immersive.py') or '')
        and ', 2.' not in (read_file('scripts/reframe_immersive.py') or '').split('GALLERY_WATER')[1].split('DEST_SLOTS')[0]
        and 'portals-vells-1-640.webp' in html
        and 'portals-vells-1gm-720.webp' in html
        and 'images/mobile/dest/portals-vells-1gm.webp 842w' in html
        and 'images/mobile/dest/portals-vells-1gm-480.webp 480w' in html
        # Lightbox: cache hit if card was visible; card srcset (WebP tiers only,
        # never .jpg fallback or master) if not yet loaded.
        and 'window.LY_cardLoadedSrc' in html
        and 'window.LY_cardSrcset' in html
        and 'lbImg2.src = loadedSrc' in html,
    )
    r.check(
        'gallery cards use responsive tier srcsets',
        'maiora_20s_01-640.webp' in html
        and 'maiora_20s_01gm-720.webp' in html
        and (
            'images/mobile/maiora_20s_03gm-960.webp 960w' in html
            or '/images/mobile/maiora_20s_03gm-960.webp 960w' in html
        )
        and 'images/mobile/maiora_20s_03.webp 960w' not in html
        and '/images/mobile/maiora_20s_03.webp 960w' not in html
        and (
            'media="(min-width: 769px)" data-ly-srcset="images/maiora_20s_03-640.webp' in html
            or 'media="(min-width: 769px)" data-ly-srcset="/images/maiora_20s_03-640.webp' in html
        )
        and 'media="(min-width: 769px)" data-ly-srcset="images/mobile/maiora_20s_03gm' not in html
        and 'media="(min-width: 769px)" data-ly-srcset="/images/mobile/maiora_20s_03gm' not in html,
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
        and 'window.innerWidth > 768' in html
        and 'grid.classList.contains(\'gallery-grid\')' in html
        and 'requestAnimationFrame(updateNav)' in html,
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
        'gallery is one continuous swipe carousel (single track tagged by category)',
        html.count('class="gallery-group') == 1
        and html.count('class="gallery-grid"') == 1
        and html.count('class="gallery-item') == 28
        and html.count('data-cat="water"') == 7
        and html.count('data-cat="deck"') == 13
        and html.count('data-cat="interior"') == 8,
    )
    r.check(
        'deck life narrative shots from Jul 2026 charter day are wired',
        all(stem in html for stem in (
            'life_aft_grazing', 'life_swim_pad', 'life_portals_ensign',
            'life_portals_paddle', 'life_bow_hang', 'life_bow_sunset', 'life_rock_dusk',
        ))
        and all(f'images/mobile/{stem}gm-480.webp' in html for stem in (
            'life_aft_grazing', 'life_swim_pad', 'life_portals_ensign',
            'life_portals_paddle', 'life_bow_hang', 'life_bow_sunset', 'life_rock_dusk',
        )),
    )
    # Per-panel slices (not a naive split) so the last water panel does not
    # bleed into deck and false-positive on life_* lifestyle stems.
    _water_opens = list(re.finditer(r'<div class="gallery-item\b[^>]*data-cat="water"[^>]*>', html))
    water_panels = []
    for i, m in enumerate(_water_opens):
        end = _water_opens[i + 1].start() if i + 1 < len(_water_opens) else html.find('<div class="gallery-item', m.start() + 20)
        if end < 0:
            end = m.start() + 1500
        water_panels.append(html[m.start():end])
    r.check(
        'water gallery uses owned Limitless drone/video frames (no borrowed life_* slots)',
        len(water_panels) == 7
        and all('life_' not in panel for panel in water_panels)
        and 'maiora_20s_19' in water_panels[4]
        and 'maiora_20s_20' in water_panels[5]
        and 'maiora_20s_04' in water_panels[6],
    )
    r.check(
        'landscape water gallery panels ship mobile gm reframes',
        html.count('maiora_20s_01gm-480.webp') >= 1
        and html.count('maiora_20s_03gm-480.webp') >= 1
        and html.count('maiora_20s_17gm-480.webp') >= 1
        and html.count('maiora_20s_19gm-480.webp') >= 1
        and html.count('maiora_20s_20gm-480.webp') >= 1
        and html.count('maiora_20s_04gm-480.webp') >= 1
        and html.count('maiora_20s_16gm-480.webp') >= 1
        and (
            'media="(max-width: 768px)" data-ly-srcset="images/mobile/maiora_20s_01gm-480.webp' in html
            or 'media="(max-width: 768px)" data-ly-srcset="/images/mobile/maiora_20s_01gm-480.webp' in html
        ),
    )
    for gm in (
        'maiora_20s_01gm', 'maiora_20s_03gm', 'maiora_20s_16gm', 'maiora_20s_17gm',
        'maiora_20s_19gm', 'maiora_20s_20gm', 'maiora_20s_04gm', 'life_flybridgegm',
    ):
        r.check(
            f'gallery mobile reframe assets exist ({gm})',
            os.path.isfile(os.path.join(ROOT, 'images', 'mobile', f'{gm}-480.webp'))
            and os.path.isfile(os.path.join(ROOT, 'images', 'mobile', f'{gm}-960.webp')),
        )
    r.check(
        'deck life_flybridge panel ships mobile gm reframe (hull not cropped)',
        'life_flybridgegm-480.webp' in html
        and (
            'media="(max-width: 768px)" data-ly-srcset="images/mobile/life_flybridgegm-480.webp' in html
            or 'media="(max-width: 768px)" data-ly-srcset="/images/mobile/life_flybridgegm-480.webp' in html
        ),
    )
    r.check(
        'gm gallery panels use matching gm-prev blur on mobile (smooth crossfade)',
        html.count('maiora_20s_01gm-prev.jpg') >= 1
        and html.count('life_flybridgegm-prev.jpg') >= 1
        and (
            'srcset="images/mobile/maiora_20s_01gm-prev.jpg" media="(max-width: 768px)"' in html
            or 'srcset="/images/mobile/maiora_20s_01gm-prev.jpg" media="(max-width: 768px)"' in html
        ),
    )
    r.check(
        'portals vells panorama ships mobile gm portrait crop (no letterbox)',
        'portals-vells-1gm-480.webp' in html
        and (
            'media="(max-width: 768px)" data-ly-srcset="images/mobile/dest/portals-vells-1gm-480.webp' in html
            or 'media="(max-width: 768px)" data-ly-srcset="/images/mobile/dest/portals-vells-1gm-480.webp' in html
        ),
    )
    reframe_dest_py = read_file('scripts/reframe_dest.py') or ''
    gm_jpg = os.path.join(ROOT, 'images', 'dest', 'portals-vells-1gm.jpg')
    r.check(
        'portals vells gm is portrait crop from panorama (compose_panorama_portrait)',
        'compose_panorama_portrait' in reframe_dest_py
        and 'compose_letterbox' not in reframe_dest_py
        and 'PANORAMA_FOCUS' in reframe_dest_py
        and os.path.isfile(gm_jpg)
        and os.path.getsize(gm_jpg) > 90 * 1024,
    )
    r.check(
        'portals vells gm uses matching gm-prev blur on mobile (smooth crossfade)',
        'portals-vells-1gm-prev.jpg' in html
        and (
            'srcset="images/mobile/dest/portals-vells-1gm-prev.jpg" media="(max-width: 768px)"' in html
            or 'srcset="/images/mobile/dest/portals-vells-1gm-prev.jpg" media="(max-width: 768px)"' in html
        ),
    )
    r.check(
        'portals vells mobile gm reframe assets exist',
        os.path.isfile(os.path.join(ROOT, 'images', 'mobile', 'dest', 'portals-vells-1gm-480.webp'))
        and os.path.isfile(os.path.join(ROOT, 'images', 'mobile', 'dest', 'portals-vells-1gm.webp'))
        and os.path.isfile(os.path.join(ROOT, 'images', 'mobile', 'dest', 'portals-vells-1gm-prev.jpg')),
    )
    gm_480 = os.path.join(ROOT, 'images', 'mobile', 'dest', 'portals-vells-1gm-480.webp')
    gm_master = os.path.join(ROOT, 'images', 'mobile', 'dest', 'portals-vells-1gm.webp')
    r.check(
        'portals vells gm mobile tiers stay sharp (dest_gm width tiers + full master)',
        'dest_gm' in (read_file('scripts/process_media.py') or '')
        and 'resize_width' in (read_file('scripts/process_media.py') or '')
        and os.path.getsize(gm_480) > 30 * 1024
        and os.path.getsize(gm_master) > 120 * 1024,
    )
    pv_card = html.split('data-dest-idx="0"')[1].split('data-dest-idx="1"')[0]
    r.check(
        'portals vells sharp img reserves landscape 16:9 (desktop reframe, gm mobile srcset)',
        'portals-vells-1gm.webp 842w' in pv_card
        and 'width="960" height="540"' in pv_card
        and 'width="842" height="1578"' not in pv_card,
    )
    r.check(
        'destinations is one continuous swipe carousel (single track tagged by tier)',
        html.count('class="dest-group') == 1
        and html.count('class="itinerary-grid"') == 1
        and html.count('data-dest-idx="') == 12
        and 'data-tier="half-day"' in html
        and 'data-tier="full-day"' in html
        and 'data-tier="multi-day"' in html,
    )
    r.check(
        'each immersive section has exactly one carousel nav',
        html.count('class="carousel-nav"') == 2,
    )
    r.check(
        'gallery images open a fullscreen lightbox',
        'id="lightbox"' in html
        and 'id="lightbox-img"' in html
        and 'openGalleryLb' in html
        and 'applyGalleryLbFrame' in html
        and 'function showImage(idx)' in html
        and html.count('class="gallery-item') == 28
        and html.split('window.LY_GALLERY_IMAGES = [', 1)[1].split('];', 1)[0].count('.webp') == 28,
    )
    r.check(
        'swipe-settle fires debounced, in-view-gated category view events',
        'ly_gallery_view_on_water' in html
        and 'ly_gallery_view_deck' in html
        and 'ly_gallery_view_interiors' in html
        and 'function tierEvent(t)' in html
        and 'function settle(cat)' in html
        and 'function inView()' in html,
    )
    r.check(
        'carousel tabs stay clickable and track active panel via aria-selected',
        'window.LY_wireCarousel = function' in html
        and "setAttribute('aria-selected'" in html
        and 'function goToCat(cat' in html
        and 'function setActive(cat)' in html
        and 'window._setDestTab = setDestTab' in html,
    )
    r.check(
        'lightbox navigation coalesces rapid clicks and shows loading state',
        'window.LY_formatLbCounter' in html
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
        and re.search(r'@layer\s+layout\s*,\s*site', read_file('css/layout.css') or '') is not None
        and '@layer site' in (read_file('css/main.css') or '')
        and '.ly-prog-wrap--hero' in html
        and 'ly-prog-wrap--hero{position:absolute;inset:0;overflow:hidden;background:transparent}' in re.sub(
            r'\s+', '', html[html.find('id="critical-css"'):html.find('</style>', html.find('id="critical-css"'))]
        )
        and '#hero.hero-bg:not(.ly-prog-sharp){opacity:0!important;visibility:hidden!important}' in re.sub(
            r'\s+', '', html[html.find('<style id="fouc-guard">'):html.find('</style>', html.find('id="fouc-guard"'))]
        )
        and 'object-position:50%46%' in re.sub(
            r'\s+', '', html[html.find('id="critical-css"'):html.find('</style>', html.find('id="critical-css"'))]
        )
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
        and 'maiora_20s_18-prev.jpg' in html
        and re.search(
            r'class="ly-prog-preview"[^>]*decoding="async"[^>]*loading="eager"',
            html,
        ) is not None
        and 'transform:scale(1.06)' in re.sub(
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
        # Gallery sharps: 28 panels (7 water + 13 deck + 8 interior) + non-gallery content
        # +7 deck-life narrative stills from 25 Jul 2026 charter day (Portals Vells run)
        and html.count('class="ly-prog-sharp" data-ly-src="') == 42
        and 'class="ly-prog-sharp" src=' not in html
        and html.count('data-ly-srcset="') >= 56
        # Hero stays eager (it is the LCP): its sharp keeps a real src.
        and 'class="hero-bg ly-prog-sharp" src="' in html,
    )
    r.check(
        'sharp promotion gated on preview-ready + viewport, held until meaningful paint',
        'window.LY_promoteSharp' in html
        and 'window.LY_onProgSharpLoad' in html
        and "wrap.querySelector('.ly-prog-sharp[data-ly-src]')" in html
        and "sharp.setAttribute('src', picked)" in html
        and 'urls[urls.length - 1]' in html
        and 'requestAnimationFrame(show)' in html
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
        'carousel arms progressive wraps for Safari IO display:none bug',
        # LY_wireCarousel must explicitly arm wraps in the group so that Safari's IO
        # (which doesn't re-fire after display:none -> block) still loads images
        'window.LY_armWrap' in html
        and "group.querySelectorAll('.ly-prog-wrap')" in html
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
        and 'id="calWaBtn"' in html
        and 'durOptMultiDay' not in html
        and 'value="multi-day">Multi-Day' not in html
        and 'selected.length === 1' in html
        and 'preferred_date_end_btn' not in html
        and 'class="form-field form-end-date"' not in html
        and 'data-selected=' in html
        and "node.closest('.cal-cell[data-date]')" in html,
    )
    r.check(
        'on-hold dates are selectable for enquiry (booked still blocked)',  # DECISION (see DECISIONS.md — do not weaken to pass)
        # isSelectable blocks past + booked only — tentative (on-hold) is allowed
        'if (booked.has(k) || tentative.has(k)) return false' not in html
        and 'if (booked.has(k)) return false; return true;' in html
        # on-hold cells get data-date so they are interactive
        and 'var onHold = tentative.has(k) && !isPast' in html
        # explanatory note + interactive on-hold cell styling
        and 'class="cal-hold-note"' in html
        and re.search(r'\.cal-cell\.tentative\{[^}]*cursor:pointer', read_file('css/main.css') or '') is not None,
    )
    r.check(
        'on-hold explanation shows only when a hold date is selected',
        'id="calHoldNote"' in html
        and 'function syncHoldNote' in html
        and 'holdNoteEl.hidden' in html
        and "tentative.has(selected[hi])" in html,
    )
    r.check(
        'form date picker and form-calendar events are gone',
        'class="form-date-apply-btn"' not in html
        and 'id="formDatePopoverDismiss"' not in html
        and 'function openFormDatePopover' not in html
        and 'ly_cal_form_open' not in html
        and 'ly_cal_form_date_select' not in html
        and 'ly_form_view' not in html
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
        and 'if (!lyHashLocked()) root.classList.remove' in html
        and "hash === 'gallery-land'" in html
        and "hash === 'itinerary-land'" in html
        and "destId === 'hero'" in html
        and "document.documentElement.classList.remove('ly-past-hero')" in html
        and "destId === 'itinerary-funnel' || destId === 'gallery-funnel'" in html,
    )
    r.check(
        'hero Check available dates jump on phone sets cinema offset before native scroll',
        'function lyPrepareCinemaHashNav' in html
        and "addEventListener('pointerdown'" in html
        and "destId === 'avail-cal' || destId === 'availability'" in html
        and 'window.innerWidth <= 640 && window.scrollY <= 56' in html
        and "keepHash === 'avail-cal'" in html
        and 'LY_hashLockUntil = Date.now() + 4000' in html
        and "if (href.slice(1) === 'hero') return" in html
        and "destId === 'hero'" in html
        and 'window.scrollTo(0, 0)' in html,
    )

    _hero_css = (read_file('css/layout.css') or '') + (read_file('css/main.css') or '')
    _hero_struct = (
        'id="heroPullQuote"' in html
        and html.count('hero-pull-slide') >= 4
        and 'hero-pull-slide is-active' in html
        and 'hero-pull-track' in html
        and '.hero-pull-slide' in _hero_css
        and ('grid-area:1 / 1' in _hero_css or 'grid-area:1/1' in re.sub(r'\s+', '', _hero_css))
    )
    _hero_en_quotes = (
        'chartered again the following week' in html
        and 'highlights of our stay in Mallorca' in html
    )
    r.check(
        'hero pull-quote is a fading review carousel (stacked slides)',
        _hero_struct and (_hero_en_quotes if meta.get('lang') == 'en' else True),
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
        and "'enquire-form'" not in html.split('SCROLL_HASH_SECTIONS')[1][:200]
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
        'desktop nav separates charters, availability, and dates CTA',
        'href="#charters-land"' in html
        and 'href="#availability" class="nav-cta nav-header-cta"' in html
        and 'Get Quote' not in html
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
        'mobile Get Quote and calendar share the availability anchor',
        mobile_nav_m is not None
        and re.search(
            r'href="#avail-cal"[^>]*class="mobile-nav-cta"',
            mobile_nav,
        )
        is not None
        and 'href="#enquire-form"' not in mobile_nav
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
    r.check('Netlify contact form attribute is gone', ' netlify>' not in html and ' netlify ' not in html.split('<footer>')[0])

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
        html.find('id="fouc-guard"') < html.find('id="ly-net-tier"')
        and html.find('id="ly-net-tier"') < html.find('id="critical-css"'),
    )
    net_tier = read_file('js/net-tier.js') or ''
    r.check(
        'inline net-tier matches the canonical js/net-tier.js source (no drift)',  # DECISION (see DECISIONS.md — do not weaken to pass)
        net_tier != ''
        and re.sub(r'\s+', '', net_tier) in re.sub(r'\s+', '', html),
    )
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
        # Tall phone ≥740px = 18pv vertical; short phone = 18ph horizontal; tablet = 18p.
        'maiora_20s_18p-480.webp 480w' in html
        and 'maiora_20s_18p-720.webp' in html
        and 'images/mobile/maiora_20s_18pv-480.webp 480w' in html
        and 'images/mobile/maiora_20s_18ph-480.webp 480w' in html
        and 'maiora_20s_18-640.webp 640w' in html
        and 'maiora_20s_18-960.webp 960w' in html
        and 'class="hero-bg ly-prog-sharp"' in html
        and 'fetchpriority="high"' in html,
    )
    r.check(
        'mobile hero caps at -960 tier (no full-res mobile master)',
        'images/mobile/maiora_20s_18p-960.webp 960w' in html
        and 'images/mobile/maiora_20s_18p.webp 2000w' not in html,
    )
    img_root = 'images' if rel == 'index.html' else '/images'
    r.check(
        'hero picture has responsive srcsets for both mobile and desktop',
        re.search(
            rf'<source[^>]*{re.escape(img_root)}/mobile/maiora_20s_18p-480\.webp 480w[^>]*'
            r'media="\(orientation: portrait\) and \(min-width: 768px\)"',
            html,
        )
        is not None
        and re.search(
            rf'<source[^>]*{re.escape(img_root)}/mobile/maiora_20s_18pv-480\.webp 480w[^>]*'
            r'media="\(max-width: 768px\) and \(min-height: 740px\)"',
            html,
        )
        is not None
        and re.search(
            rf'<source[^>]*{re.escape(img_root)}/mobile/maiora_20s_18ph-480\.webp 480w[^>]*'
            r'media="\(max-width: 768px\) and \(max-height: 739px\)"',
            html,
        )
        is not None
        and re.search(
            rf'<source[^>]*srcset="{re.escape(img_root)}/maiora_20s_18-640\.webp 640w',
            html,
        )
        is not None,
    )
    fouc_pos = html.find('id="fouc-guard"')
    style_pos = html.find('id="critical-css"')
    net_tier_pos = html.find('id="ly-net-tier"')
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
        # Budget covers the hero first-paint rules inlined to prevent the
        # mobile/desktop variant duplication + unstyled flash before
        # main.css loads (season labels, pill-styled rates panels).
        crit_tag > 0 and crit_end - crit_tag < 13500,
    )
    crit_css = html[crit_tag:crit_end] if crit_tag >= 0 and crit_end > crit_tag else ''
    crit_flat = re.sub(r'\s+', '', crit_css)
    r.check(
        'critical CSS prevents hero first-paint duplicates + styles the promo/rates inline',  # DECISION (see DECISIONS.md — do not weaken to pass)
        # Mobile variants hidden on desktop with a plain class list (NOT a
        # descendant `#hero :is(...)` — the minifier strips that space,
        # collapsing it to the compound `#hero:is(...)` which matches
        # nothing and brings the duplicates back). Minifier-safe form:
        '.hero-cta-link--mobile,.hero-rates-link--mobile,.hero-eyebrow-link--mobile{display:none!important}' in crit_flat
        and '#hero:is(.hero-cta-link--mobile' not in crit_flat
        # Season labels + pill-styled rates panel inlined for first paint
        # (promo pill removed 2 Jul 2026 — see DECISIONS.md Product decisions)
        and 'promo' not in crit_flat
        and '.season-rate-label{' in crit_flat
        and 'border-radius:999px' in crit_flat
        and 'background:rgba(10,22,40,.82)' in crit_flat,
    )
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
        and 'a.itinerary-meet-cta,a.mobile-nav-cta{color:#f5f0e8!important' in fouc_flat,
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
    net_flat = re.sub(r'\s+', '', net_tier)
    r.check(
        'main.css load adds ly-main-ready (single below-fold reveal after full styles)',
        (html.count("classList.add('ly-main-ready')") >= 1 or "classList.add('ly-main-ready')" in net_tier)
        and "l.rel='stylesheet'" in net_flat
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
        # Primary reveal is softFrame(function(){revealMain()...}) inside LY_loadMainCss finish
        and 'softFrame(function(){revealMain();' in net_flat
        and net_flat.find('softFrame(function(){revealMain();') > net_flat.rfind('g.LY_loadMainCss=function')
        # Must not reveal immediately when layout finishes (no softFrame(revealMain) at all)
        and 'softFrame(revealMain)' not in net_flat,
    )
    r.check(
        'reveal is rAF-independent (hidden-tab safe): softFrame falls back to setTimeout',
        'function softFrame(fn)' in net_tier
        and re.search(r'function softFrame\(fn\)[\s\S]{0,220}?setTimeout\(go', net_tier)
        is not None
        and 'softFrame(function' in net_tier
        and "classList.add('ly-main-ready')" in net_tier
        and 'revealMain()' in net_tier,
    )
    r.check(
        'hash funnel landing re-syncs after main.css (scroll-margin + ly-past-hero)',
        'window.LY_fixupHashLanding' in html
        and 'window.LY_initHash' in html
        and 'window.LY_hashScrollTarget' in html
        and 'itinerary-funnel' in html
        and 'ly-past-hero' in html
        and 'window.scrollTo({ top: Math.max(0, top), behavior: ' in html.split('LY_fixupHashLanding = function')[1][:1200],
    )
    r.check(
        'scroll hash sync does not strip intentional deep-link landings at hero',
        'LY_initHash' in html
        and '!window.LY_initHash' in html
        and re.search(
            r'if\s*\(\s*window\.scrollY\s*<\s*48\s*\)\s*\{[^}]*LY_initHash',
            html,
        )
        is not None,
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
        and (
            'text-shadow:01px2pxrgba(0,0,0,.9)' in crit_flat
            or 'text-shadow:01px2pxrgba(0,0,0,.95)' in crit_flat
        )
        and (
            '#hero.hero-actions.btn-ghost{background:rgba(10,22,40,.28)' in crit_flat
            or '#hero.hero-actions.btn-ghost,#hero.hero-avail-cta{background:rgba(10,22,40,.28)' in crit_flat
            or '#hero.hero-actions.btn-ghost{background:rgba(10,22,40,.52)' in crit_flat
            or '#hero.hero-actions.btn-ghost,#hero.hero-avail-cta{background:rgba(10,22,40,.52)' in crit_flat
            or '#hero.hero-actions.btn-ghost,#hero.hero-avail-cta{background:rgba(10,22,40,.55)' in crit_flat
            or '#hero.hero-actions.btn-ghost,#hero.hero-avail-cta{background:rgba(10,22,40,.82)' in crit_flat
        )
        and 'border:1pxsolidtransparent' in crit_flat.replace(' ', ''),
    )
    r.check(
        'critical CSS hides duplicate hero rates and eyebrow links before main.css',
        '.hero-rates-link{display:block;text-decoration:none' in crit_flat
        and '.hero-cta-link--desktop,.hero-rates-link--desktop,.hero-eyebrow-link--desktop{display:none!important}' in crit_flat
        # Plain class list (minifier-safe) — NOT the old `:is(...)` form whose
        # leading space the minifier stripped, reintroducing the duplicates.
        and '.hero-rates-link--mobile,.hero-eyebrow-link--mobile{display:none!important}' in crit_flat
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
        and (
            "font-family:'Montserrat','MontserratFallbackHero','MontserratFallback',sans-serif" in crit_flat.replace(' ', '')
            or "font-family:'MontserratFallbackHero','MontserratFallback',sans-serif" in crit_flat.replace(' ', '')
        )
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
        ('.hero-eyebrow{' in crit_flat or '#hero.hero-eyebrow' in crit_flat)
        and ('.hero-rates{' in crit_flat or '#hero.hero-rates' in crit_flat)
        and '.hero-actions{' in crit_flat
        and '.btn-primary{' in crit_flat
        and (
            '.hero-eyebrow,.hero-sub,.hero-rates' in crit_flat.replace(' ', '')
            or '#hero.hero-eyebrow' in crit_flat
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
        and 'portals-vells-1gm-720.webp' in html,
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
        'images/maiora_20s_21-640.webp 640w' in html
        and 'images/maiora_20s_21-960.webp 960w' in html
        and 'images/mobile/maiora_20s_21-960.webp 960w' in html
        and 'images/mobile/maiora_20s_21.webp 960w' not in html
        and 'maiora_20s_21.jpg' in html.split('<section id="about">')[1].split('<section id="itinerary"')[0],
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
            or '#hero.hero-actions.btn-primary,#hero.hero-actions.btn-ghost,#hero.hero-avail-cta{display:inline-flex' in crit_flat.replace(' ', '')
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

    # Structured data + social share (OG / WhatsApp / Twitter use same hero as #hero)
    r.check('schema.org JSON-LD present', 'application/ld+json' in html)
    r.check(
        'Product schema has offers (GSC snippet requirement)',
        '"@type": "AggregateOffer"' in html and '"priceCurrency": "EUR"' in html,
    )
    r.check(
        'Product schema has aggregateRating',
        '"@type": "AggregateRating"' in html and '"ratingValue":' in html,
    )
    if rel == 'index.html':
        r.check(
            'social share image matches live hero (maiora_20s_18)',
            'property="og:image" content="https://limitlessyachtcharter.com/images/maiora_20s_18.jpg"' in html
            and 'name="twitter:image" content="https://limitlessyachtcharter.com/images/maiora_20s_18.jpg"' in html
            and 'property="og:image:width" content="1920"' in html
            and 'property="og:image:height" content="1080"' in html
            and 'images/maiora_20s_18.jpg' in html.split('id="hero"')[1][:2500]
            and 'maiora_20s_02.jpg' not in html.split('<meta property="og:image"')[0]
            and html.count('maiora_20s_02.jpg') == 0,
        )
        r.check(
            'JSON-LD business image matches hero',
            '"image": "https://limitlessyachtcharter.com/images/maiora_20s_18.jpg"' in html,
        )

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
            and 'id="ly-net-tier"' in html
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



def check_hero_legibility_cascade(r: Runner) -> None:
    """Hero type is owned by inline #hero !important rules; main must not restyle it."""
    main = read_file('css/main.css') or ''
    index = read_file('index.html') or ''
    crit_m = re.search(r'<style id="critical-css">(.*?)</style>', index, re.S)
    crit = crit_m.group(1) if crit_m else ''
    crit_flat = re.sub(r'\s+', '', crit)
    main_flat = re.sub(r'\s+', '', main)
    r.check(
        'hero type locked in critical #hero rules (system font, main cannot restyle)',
        # Durable marker survives minify (comments are stripped on main)
        '--ly-hero-type-lock:1' in crit_flat
        and '#hero.hero-value{' in crit_flat
        and 'max-width:26rem!important' in crit_flat
        and 'min-height:3.3em!important' in crit_flat
        and "font-family:'MontserratFallback'" in crit_flat
        and '--ly-hero-type-lock:1' in main_flat
        and '#hero.hero-value{font-size:1rem!important' in main_flat
        and 'max-width:26rem!important' in main_flat
        # Real Montserrat face must not override hero title after font load
        and 'html.ly-font-ready .hero-title' not in main.replace(' ', '')
        # main @layer site must not re-size hero title with vw/vh (causes 3-step cascade jump)
        and 'font-size:clamp(3.5rem,9vw,8rem)' not in main_flat
        and 'font-size:clamp(2.85rem,7.2vh,5.75rem)' not in main_flat
        and 'font-size:var(--hero-cinema-title)' not in main_flat
        # critical lock uses rem, never vw
        and 'font-size:4.75rem!important' in crit_flat
        and 'font-size:clamp(3.5rem,9vw' not in crit_flat,
    )
    r.check(
        'critical CSS locks hero pull-quote contrast before sheets load',
        '#hero.hero-pull-quote{' in crit_flat
        and 'color:#f5f0e8' in crit_flat
        and 'font-weight:500' in crit_flat,
    )
    nt_js = read_file('js/net-tier.js') or ''
    r.check(
        'progressive hero waits for main.css (no mid-cascade crossfade)',
        'LY_kickProgressiveAfterReveal' in nt_js
        and nt_js.find('LY_kickProgressiveAfterReveal') > nt_js.rfind('g.LY_loadMainCss')
        # Primary kick is paired with revealMain in main.css finish, not layout finish
        and 'revealMain(); if (g.LY_kickProgressiveAfterReveal)' in nt_js.replace('\n', ' '),
    )

    r.check(
        'critical progressive hero wrap is unlayered (not trapped in @layer layout)',
        # @layer layout nav hide must close before .ly-prog-wrap--hero position:absolute
        re.search(
            r'@layer\s+layout\s*\{\s*@media\s*\(\s*min-width:\s*769px\s*\)\s*\{\s*nav\s*\{[^}]*opacity:\s*0[^}]*\}\s*\}\s*\}'
            r'\s*\.ly-prog-wrap--hero\s*\{[^}]*position:\s*absolute',
            crit_flat,
        ) is not None
        or (
            # minified may drop spaces differently — structure: layer closes then prog absolute
            '}}}.ly-prog-wrap--hero{position:absolute' in crit_flat
            or '}}}.ly-prog-wrap--hero{position:absolute' in re.sub(r'\s+', '', crit)
        ),
    )
    r.check(
        'critical progressive hero keeps skip-preview + sharp-visible opacity rules',
        'ly-prog-skip-preview' in crit
        and 'ly-prog-sharp-ready.ly-prog-sharp-visible' in crit_flat.replace(' ', '')
        and '.ly-prog-wrap--hero{position:absolute' in crit_flat,
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
    en_index = read_file('index.html')
    if en_index is not None:
        r.check(
            f'Product aggregateRating reviewCount matches reviews.json ({len(en_reviews)})',
            f'"reviewCount": "{len(en_reviews)}"' in en_index,
        )
        _ar = [float(x.get('rating', 0)) for x in en_reviews if x.get('rating') is not None]
        if _ar:
            _avg = f'{sum(_ar)/len(_ar):.1f}'
            r.check(
                f'Product aggregateRating ratingValue matches reviews avg ({_avg})',
                f'"ratingValue": "{_avg}"' in en_index,
            )

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
        if code == 'de':
            r.check(
                'i18n/locales/de.py defines DAY_CHARTER_PAIRS',
                hasattr(mod, 'DAY_CHARTER_PAIRS') and len(mod.DAY_CHARTER_PAIRS) > 10,
            )
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
    'Available year-round &nbsp;·&nbsp; Personal reply from captain &amp; crew',
    'VAT included',
)

LOCALE_PRICING_MARKERS = {
    'de': (
        'Halbtages-Charter (4h) ab 1.700 €',
        '6h ab 2.400 €',
        'Ganzjährig verfügbar &nbsp;·&nbsp; Persönliche Antwort von Kapitän &amp; Crew',
    ),
    'es': (
        'Medio día (4h) desde 1.700 €',
        '6h desde 2.400 €',
        'Disponible todo el año &nbsp;·&nbsp; Respuesta personal del capitán y la tripulación',
    ),
    'fr': (
        'Demi-journée (4h) à partir de 1 700 €',
        '6h à partir de 2 400 €',
        "Disponible toute l'année &nbsp;·&nbsp; Réponse personnelle du capitaine et de l'équipage",
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
            re.sub(r'\s*>\s*', '>', layout_css).find('.about-image-wrap>.ly-prog-wrap>picture') >= 0
            and '.about-image-wrap>.ly-prog-wrap .ly-prog-sharp' in re.sub(r'\s*>\s*', '>', layout_css)
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
            and '.hero-top,.hero-bottom{display:contents' not in re.sub(r'@media\(min-width:769px\)\{[^}]*\}', '', css_flat),
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
            'mobile funnel sections are viewport-fit (adaptive wrap + nav-measured landing)',  # DECISION (see DECISIONS.md — do not weaken to pass)
            # The carousels repeatedly regressed to overflowing the screen.
            # Scheme: JS sets --mobile-funnel-land-offset to the measured nav
            # height (+2px) so tabs skirt the nav edge on every device; the
            # wraps are 100svh minus that offset minus safe-area breathing, so
            # tabs + card + chevrons + bottom CTAs always fit and the bottom
            # buttons are never cut. Lightbox gives spare height to the IMAGE.
            "setProperty('--mobile-funnel-land-offset', (_navHeight + 2) + 'px')" in index_html
            and layout_css is not None
            and layout_css.count('height:calc(100svh - var(--mobile-funnel-land-offset,5.45rem) - var(--funnel-carousel-headroom,2.75rem) - max(.6rem,env(safe-area-inset-bottom,0px)))') == 2
            and '--funnel-carousel-headroom:2.75rem' in layout_css
            and re.search(r'@media \(max-width:640px\)\{\s*(?:/\*[^*]*\*/\s*)?\.dest-lb-img-wrap\{\s*flex:1 1 0%;\s*min-height:34vh', re.sub(r'  +', ' ', css or '')) is not None,
        )
        r.check(
            'blur preview -> sharp fade is universal, incl. the dest lightbox',  # DECISION (see DECISIONS.md — do not weaken to pass)
            # Owner directive (3 Jul 2026): the prev->sharp process must be in
            # place for EVERY image, ALL the time. The lightbox flick path once
            # bypassed it (HAR showed tier fetches with no -prev.jpg first).
            'id="dest-lb-prog"' in index_html
            and 'class="ly-prog-wrap" id="dest-lb-prog"' in index_html
            and 'class="ly-prog-preview" id="dest-lb-preview"' in index_html
            and 'id="dest-lb-img" class="ly-prog-sharp"' in index_html
            and "lbProg.classList.add('ly-prog-preview-ready')" in index_html
            and "lbProg.classList.add('ly-prog-sharp-ready', 'ly-prog-sharp-visible')" in index_html
            # hint/arrows anchored to the image; counter top-right of the
            # blue body, on the num/duration line (owner request)
            and 'class="dest-lb-head-row"' in index_html
            and index_html.index('id="dest-lb-counter"') > index_html.index('class="dest-lb-body"')
            and index_html.index('id="dest-lb-counter"') > index_html.index('id="dest-lb-num"')
            and index_html.index('id="dest-lb-counter"') < index_html.index('id="dest-lb-name"'),
        )
        r.check(
            'round nav buttons share the drawn ly-chev chevron (no font glyphs)',
            # One component for carousel, lightbox and calendar chevrons; the
            # ‹ › glyphs sat off-centre with the metric-adjusted fallback
            # faces (owner screenshots, 2 Jul 2026).
            index_html.count('ly-chev--prev') == 5
            and index_html.count('ly-chev--next') == 5
            and '.ly-chev::before{' in re.sub(r'\s+', '', css or '')
            and '&#8249;</button>' not in index_html
            and '‹</button>' not in index_html
            and '›</button>' not in index_html,
        )
        r.check(
            'every destination diesel figure is marked as an estimate',
            # Owner request 2 Jul 2026: ~ alone was not clear enough. The dest
            # lightbox clones .destination-meta, so card spans cover both.
            index_html.count('Diesel est. <strong>') == 12
            and 'Diesel <strong>' not in index_html,
        )
        r.check(
            'hero promo pill fully removed (campaign ended 1 Jul 2026); rates carry the pill design',
            # Removal must be total — a leftover phase span or JS block would
            # flash at page load, which is why the pill was removed.
            'hero-promo' not in index_html
            and 'promo-msg' not in index_html
            and 'data-promo-phase' not in index_html
            and 'ly_promo_click' not in index_html
            and 'promoEnd' not in index_html
            and 'hero-promo' not in (css or '')
            # The pill visual language now lives on the hero rates panel
            # (mirrored in critical CSS; keep both in sync).
            and 'border-radius:999px' in (css or '')
            and (css or '').count('rgba(201,168,76,.5)') >= 2,
        )
        r.check(
            'both low and high season rates shown with labels (no hide-by-season)',
            # High-season spans are no longer hidden by default — both seasons render
            'data-season-rate="high" hidden' not in index_html
            and index_html.count('class="season-rate-label">Low season') >= 3
            and index_html.count('class="season-rate-label">High season') >= 3
            # Script highlights current season instead of hiding the other
            and "classList.add('season-rate--current')" in index_html
            and 'spans[i].getAttribute(\'data-season-rate\') !== season' not in index_html
            and '.season-rate-label' in (css or '')
            and '.season-rate--current' in (css or ''),
        )
        r.check(
            'charters confirms seasonal rates with card pricing and Clarity events',
            'charter-rates-confirm' in index_html
            and 'charterRatesConfirm' in index_html
            and 'enquiry-price' in index_html
            and 'From €1,700 (4h) · €2,400 (6h)' in index_html
            and 'From €3,000' in index_html
            and 'Available year-round &nbsp;·&nbsp; Personal reply from captain &amp; crew' in index_html
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
            and 'object-fit:cover' in re.sub(r'\s+', '', css or '')
            and '--hero-object-position-portrait' in (css or '')
            and 'min-width:769px' in re.sub(r'\s+', '', css or ''),
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
        and '.cal-enquire-link.is-disabled' in css,
    )
    r.check(
        'bookable calendar days are styled unmistakably (not bare text)',
        css is not None
        and '.cal-cell.free' in css
        and 'box-shadow:inset0001.5pxrgba(201,168,76,.75)' in re.sub(r'\s+', '', css)
        and 'background:rgba(201,168,76,.22)' in re.sub(r'\s+', '', css)
        and 'repeating-linear-gradient' in css
        and '.cal-cell.tentative' in css,
    )
    r.check(
        'carousel position counter is readable on mobile',
        css is not None
        and '.carousel-pos' in css
        and 'aria-live="polite"' in index_html
        and index_html.count('class="carousel-pos"') >= 2,
    )
    r.check(
        'calendar opens on first month with free dates after availability loads',
        'function firstOpenMonthIndex' in index_html
        and 'function jumpViewToOpenMonth' in index_html
        and 'jumpViewToOpenMonth()' in index_html
        and 'userPagedCal' in index_html,
    )
    r.check(
        'sticky WhatsApp CTA surfaces when calendar dates are selected',
        'id="calStickyCta"' in index_html
        and 'function syncStickyCta' in index_html
        and 'data-label-one="Enquire on WhatsApp for {date}"' in index_html
        and 'ly_cal_sticky_whatsapp' in index_html
        and css is not None
        and '.cal-sticky-cta' in css
        and '--ly-cookie-h' in css,
    )
    r.check(
        'bottom chrome offsets keep cookie banner clear of calendar/sticky CTA',
        'LY_syncBottomChrome' in index_html
        and 'ly-cookie-open' in index_html
        and css is not None
        and 'html.ly-cookie-open #availability' in css
        and 'html.ly-cal-sticky-open #availability' in css,
    )
    r.check(
        'View Dates CTA has full locale pairs (no partial Dates→Daten)',
        "View Dates" in (read_file('i18n/locales/de.py') or '')
        and 'Termine ansehen' in (read_file('i18n/locales/de.py') or '')
        and 'Ver fechas' in (read_file('i18n/locales/es.py') or '')
        and 'Voir les dates' in (read_file('i18n/locales/fr.py') or ''),
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
            re.DOTALL,
        ) is not None
        and re.search(
            r'#availability\s*\.availability-actions\s*>\s*\.btn-primary[^}]*flex:\s*1\s*1\s*0\s*!important',
            css,
            re.DOTALL,
        ) is not None,
    )
    preview_yml = read_file('.github/workflows/preview.yml') or ''
    r.check(
        'GitHub Pages preview deploys develop and feature branches',
        "branches: [develop]" in preview_yml or 'develop' in preview_yml
        and 'feature/**' in preview_yml,
    )
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
    publish_gate = read_file('scripts/publish-gate.py') or ''
    r.check(
        'publish gate blocks screenshots/ on main',
        'check_no_screenshots' in publish_gate and 'git", "ls-files", "screenshots"' in publish_gate,
    )
    netlify_ignore = read_file('.netlifyignore') or ''
    r.check('.netlifyignore excludes screenshots/', 'screenshots/' in netlify_ignore)
    pre_commit = read_file('.githooks/pre-commit') or ''
    r.check(
        'main pre-commit strips screenshots/ before publish',
        'Stripping screenshots/' in pre_commit and 'git rm -rf --cached screenshots/' in pre_commit,
    )
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
        'timeout-minutes:' in publish_yml,
    )
    r.check(
        'publish gate skips UX and Lighthouse by default',
        'test-site.py' in publish_gate
        and 'verify-analytics.py' in publish_gate
        and '--with-ux' in publish_gate
        and '--with-lighthouse' in publish_gate
        and 'if args.with_ux:' in publish_gate
        and 'if args.with_lighthouse:' in publish_gate,
    )
    r.check(
        'publish CI workflow is site-tests only (no Playwright/Lighthouse install)',
        'playwright install' not in publish_yml
        and 'npm install --prefix scripts' not in publish_yml,
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
        and 'scenario_gallery_carousel' in ux_py
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
        'Montserrat loaded on idle, off the critical path (CSS uses fallback only)',  # DECISION (see DECISIONS.md — do not weaken to pass)
        # The real font is no longer fetched by any CSS @font-face — not in
        # main.css and not in the critical block. It's injected by LY_loadFont
        # and triggered on idle via LY_afterMeaningfulPaint, so it drops off
        # the critical request chain entirely.
        'montserrat-latin.woff2' not in (read_file('css/main.css') or '')
        and 'montserrat-latin.woff2' not in crit_block
        and 'LY_loadFont' in net_tier_src
        and 'font-display:optional' in net_tier_src.replace(' ', '')
        and 'fonts/montserrat-latin.woff2' in net_tier_src
        and "addEventListener('load',lyFontIdle)" in index_html.replace(' ', '')
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
        and (
            "font-family:'Montserrat','MontserratFallbackHero','MontserratFallback',sans-serif" in css_flat
            or "font-family:'MontserratFallbackHero','MontserratFallback',sans-serif" in css_flat
        )
        and ".nav-logo{flex:01auto" in crit_flat
        and (
            "font-family:'Montserrat','MontserratFallback',sans-serif" in crit_flat.split('.nav-logo')[1][:200]
            or "font-family:'MontserratFallback',sans-serif" in crit_flat.split('.nav-logo')[1][:200]
        )
        and 'MontserratFallback' in (read_file('css/layout.css') or '').split('.nav-logo')[1][:200].replace(' ', ''),
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
        and '#hero.hero-actions.btn-primary{border:1pxsolidrgba(245,240,232,.82)'
        in re.sub(r'\s+', '', css),
    )
    r.check(
        'enquiry form date fields are gone',
        'type="hidden" name="preferred_date_end"' not in index_html
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
        'availability calendar and new CTAs fire Clarity events',
        'LY_clarityEvent' in index_html
        and 'ly_cal_avail_month_next' in index_html
        and 'ly_cal_avail_date_select' in index_html
        and 'ly_cal_avail_whatsapp' in index_html
        and 'ly_cal_avail_call' in index_html
        and 'ly_form_view' not in index_html
        and 'ly_cal_form_open' not in index_html
        and 'ly_hero_rates_click' in index_html
        and 'ly_hero_avail_click' in index_html
        and 'ly_email_click' in index_html
        and 'ly_charters_rates_view' in index_html
        and 'ly_cal_entry' in index_html
        and "LY_setCalEntry('cta')" in index_html
        and "lySetCalEntry('scroll')" in index_html,
    )
    r.check(
        'hero fires section view on load and skips enquire section event',
        'function fireHeroSectionView()' in index_html
        and "lyTrackSectionHash('hero')" in index_html
        and "hash === 'enquire' || hash === 'enquire-form' || hash === 'enquire-land') return ''" in index_html,
    )
    r.check(
        'calendar WhatsApp CTA is primary with tel fallback',
        'id="calWaBtn"' in index_html
        and 'cal-wa-btn' in index_html
        and 'id="calCallBtn"' in index_html
        and re.search(r'tel:\+34\d{9}', index_html) is not None
        and 'cal-wa-label' in index_html
        and 'cal-form-fallback' in index_html
        and 'id="calMailtoLink"' in index_html
        and 'Prefer email? Write to us' in index_html
        and 'id="heroAvailCta"' in index_html
        and 'Check available dates' in index_html,
    )
    r.check(
        'calendar WhatsApp tracks new Clarity events and keeps historical event',
        'ly_cal_avail_whatsapp' in index_html
        and 'ly_cal_avail_call' in index_html
        and 'buildWaMsg' in index_html
        and 'Intl.DateTimeFormat' in index_html,
    )
    r.check(
        'desktop destination cards show click affordance',
        css is not None
        and '.destination-card-body::after' in css
        and re.search(r"content:\s*'View full details →'", css) is not None
        and '.destination-card:hover .destination-card-body::after' in css,
    )
    r.check(
        'destination lightbox CTA does not focus a removed form field',
        'function applyDestLbPrefill()' in index_html
        and "nameInput.focus({ preventScroll: true })" not in index_html
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
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.gallery-wrap[\s\S]*?height:\s*calc\(100svh\s*-\s*var\(--nav-scroll-offset\)\s*-\s*var\(--funnel-carousel-headroom',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#itinerary\s*\{[^}]*height:\s*calc\(100svh\s*-\s*var\(--nav-scroll-offset\)\s*-\s*var\(--funnel-carousel-headroom',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.carousel-nav,\s*\.dest-group\s+\.carousel-nav[\s\S]*?position:\s*static',
            css,
        )
        is not None
        and 'linear-gradient(to top,rgba(10,22,40,.78)' not in css.split('@media (min-width:769px)', 1)[-1].split('.carousel-btn', 1)[0]
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-grid[\s\S]*?flex:\s*1\s*1\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-item\s*\{[^}]*flex:\s*0\s*0\s*100vw',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.destination-card\s*\{[^}]*flex:\s*0\s*0\s*100vw',
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
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.carousel-nav,\s*\.dest-group\s+\.carousel-nav[\s\S]*?display:\s*flex',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-item\s+img[\s\S]*?object-fit:\s*cover',
            css,
        )
        is not None,
    )
    r.check(
        'lightboxes share unified navigation chrome classes',
        'class="lb-close"' in index_html
        and 'class="lb-nav lb-nav--prev ly-chev ly-chev--prev"' in index_html
        and 'class="lb-nav lb-nav--next ly-chev ly-chev--next"' in index_html
        and 'class="lb-counter lb-counter--inline"' in index_html
        and 'class="lb-hint"' in index_html
        and css is not None
        and css_rule_index(css, '.lb-close') >= 0
        and css_rule_index(css, '.lb-nav') >= 0
        and css_rule_index(css, '.lb-counter') >= 0
        and css_rule_index(css, '.lb-loader') >= 0
        and '.dest-lb-img-wrap.lb-loading #dest-lb-img' in css
        and css_rule_index(css, '.card-loader') < 0
        and '.destination-card.card-loading' not in css
        and css_rule_index(css, '.ly-prog-wrap') >= 0
        and '.ly-prog-wrap.ly-prog-skip-preview' in css
        and '.ly-prog-wrap.ly-prog-sharp-ready.ly-prog-sharp-visible .ly-prog-sharp' in css
        and '.gallery-item>.ly-prog-wrap .ly-prog-preview' in css
        and re.search(
            r'\.gallery-item>\.ly-prog-wrap \.ly-prog-preview[^{]*\{[^}]*transform:\s*none',
            re.sub(r'\s+', ' ', css),
        )
        and css_rule_index(css, '#dest-lb-close') < 0
        and css_rule_index(css, '#lightbox') >= 0
        and '#lightbox.lb-loading #lightbox-img' in css,
    )
    r.check(
        'destination lightbox shows same browse hint as gallery',
        'ly_dest_hinted' in index_html
        and 'ly_gallery_hinted' in index_html
        and 'id="dest-lb-hint"' in index_html
        and 'id="lightbox-hint"' in index_html
        and "matchMedia('(min-width: 1101px)')" in index_html
        and "matchMedia('(min-width: 769px)')" in index_html,
    )
    r.check(
        'gallery lightbox restored with shared chrome',
        'id="lightbox"' in index_html
        and 'id="lightbox-img"' in index_html
        and 'openGalleryLb' in index_html
        and 'class="lb-nav lb-nav--prev ly-chev ly-chev--prev"' in index_html
        and css is not None
        and css_rule_index(css, '#lightbox') >= 0
        and '#lightbox.open::after' in css
        and re.search(r'#lightbox-img[^{]*\{[^}]*object-fit:\s*cover', re.sub(r'\s+', ' ', css)) is not None,
    )
    r.check(
        'destination lightbox retained with shared chrome',
        'id="dest-lightbox"' in index_html
        and css is not None
        and css_rule_index(css, '.lb-close') >= 0
        and css_rule_index(css, '.lb-loader') >= 0
        and re.search(r'\.dest-lb-img-wrap\.lb-loading \.lb-loader\{\s*display:\s*block\s*;?\s*\}', css) is not None,
    )
    r.check(
        'destination cards show a prominent tap affordance hint',
        css is not None
        and re.search(r"\.destination-card-body::after\{\s*content:'Tap for full details[^}]*background:var\(--btn-fill\)", css) is not None
        and 'Details antippen' in css
        and 'Pulsa para' in css
        and 'Appuyer pour' in css,
    )
    r.check(
        'gallery and destinations share one carousel implementation',
        'window.LY_wireCarousel = function' in index_html
        and index_html.count('window.LY_wireCarousel({') == 2
        and 'window.lyCarouselStep = function' in index_html,
    )
    wire = index_html.split('window.LY_wireCarousel = function', 1)[1].split('}; (function(){ var group=document.querySelector(\'.dest-group\')', 1)[0]
    r.check(
        'carousel uses horizontal scroll on all viewports (no desktop scrollIntoView)',
        'grid.scrollTo({left:i*step()' in wire
        and 'scrollIntoView' not in wire
        and 'function isMobile()' not in wire,
    )
    r.check(
        'calendar email fallback is a mailto, not a sheet or form',
        'id="calMailtoLink"' in index_html
        and 'window.LY_openEnqSheet' not in index_html
        and 'id="emailSheet"' not in index_html
        and 'function isCalendarFormPaired()' not in index_html,
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
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#itinerary\s+\.itinerary-bottom-bar[\s\S]*?margin:\s*\.4rem\s+0\s+\.45rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.itinerary-bottom-bar[\s\S]*?margin:\s*\.5rem\s+0\s+\.75rem',
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
        'mobile gallery section fills viewport like itinerary',  # DECISION (see DECISIONS.md — do not weaken to pass)
        css is not None
        and re.search(
            r'#gallery,\s*#itinerary\s*\{[^}]*min-height:\s*100svh',
            css,
        ) is not None
        and re.search(
            # Wraps use flex layout with a definite svh-based height so
            # items can use height:100% to fill the remaining space.
            r'\.gallery-wrap\s*\{[^}]*height:\s*calc\(100svh\s*-\s*var\(--mobile-funnel-land-offset',
            css,
        ) is not None
        and re.search(
            r'\.gallery-group\s+\.gallery-item\s*\{[^}]*height:\s*100%',
            css,
        ) is not None
        and re.search(
            r'\.destination-card\s*\{[^}]*height:\s*100%',
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
        'immersive carousels share one nav chrome (below images, not overlaid)',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.carousel-nav,\s*\.dest-group\s+\.carousel-nav[\s\S]*?min-height:\s*3\.2rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.carousel-btn\s*\{[^}]*width:\s*2\.1rem',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.carousel-nav\s*\{[^}]*min-height:\s*3\.2rem',
            css,
        )
        is not None,
    )
    r.check(
        'immersive carousel images leave bottom breathing room (pad + object-position)',
        css is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-grid,\s*\.dest-group\s+\.itinerary-grid[\s\S]*?padding-bottom:\s*clamp\(',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-item\s+\.ly-prog-sharp[\s\S]*?object-position:\s*50%\s*46%',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.gallery-group\s+\.gallery-item\s+\.ly-prog-sharp[\s\S]*?object-position:\s*50%\s*46%',
            read_file('css/layout.css') or '',
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
            r'@media\s*\(\s*min-width:\s*1101px\s*\)[\s\S]*?\.dest-lb-img-wrap\s+\.lb-nav--next\s*\{[^}]*right:',
            css,
        )
        is not None
        and re.search(
            # Mobile body hugs its content; spare height goes to the image
            # (see DECISIONS.md 'Mobile funnel layout').
            r'@media\s*\(\s*max-width:\s*640px\s*\)[\s\S]*?\.dest-lb-body\s*\{[^}]*flex:\s*0\s*0\s*auto',
            css,
        )
        is not None,
    )
    r.check(
        'dest lightbox CTA and nav dates CTA land on the availability calendar',
        'id="dest-lb-cta"' in index_html
        and 'href="#avail-cal" class="btn-primary dest-lb-cta"' in index_html
        and 'href="#avail-cal" class="mobile-nav-cta"' in index_html
        and 'class="mobile-nav-cta" onclick="closeMobile()">Check dates</a>' in index_html
        and 'nav-header-cta" style="display:none">Check dates</a>' in index_html
        and 'function lyEnquireQuoteHref()' not in index_html
        and 'href="#enquire-form" class=' not in index_html,
    )
    r.check(
        'email fallback is muted text, not a button',
        css is not None
        and '.email-fallback{' in css
        and '.email-fallback-link{' in css
        and 'text-decoration:underline' in css
        and '.hero-avail-cta{' in css,
    )
    r.check(
        'hero check-available-dates CTA is a solid filled button, not a ghost chip',
        'class="btn-primary hero-avail-cta"' in index_html
        and 'class="btn-ghost hero-avail-cta"' not in index_html
        and css is not None
        and 'font-weight:700' in css
        and re.search(
            r'\.hero-avail-cta\{[^}]*background:var\(--btn-fill\)',
            css,
        )
        is not None
        and re.search(
            r'#hero \.hero-avail-cta\{[^}]*font-weight:700!important',
            css,
        )
        is not None
        and '#hero .hero-actions .btn-ghost,#hero .hero-avail-cta{background:rgba(10,22,40'
        not in re.sub(r'\s+', '', index_html),
    )
    r.check(
        'gold CTA labels use a medium fallback and 700 weight, not Thin',
        css is not None
        and "font-family:'Montserrat Fallback Button'" in css
        and 'HelveticaNeue-Medium' in css
        and '--btn-weight:700' in re.sub(r'\s+', '', index_html)
        and re.search(
            r'#hero \.hero-actions \.btn-primary,#hero \.hero-actions \.btn-ghost,#hero \.hero-avail-cta\{[^}]*font-weight:700!important',
            css,
        )
        is not None
        and 'font-synthesis:none!important}#hero .hero-actions .btn-primary' not in re.sub(r'\s+', '', css),
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
        and re.search(r'--btn-fill:\s*var\(--ocean\)', css) is not None
        and re.search(r'--btn-on-fill:\s*var\(--cream\)', css) is not None
        and '--btn-ghost-border:' in css
        and re.search(r'--btn-ghost-text:\s*var\(--cream\)', css) is not None
        and re.search(r'\.btn-primary\s*\{', css) is not None
        and re.search(r'background:\s*var\(--btn-fill\)', css) is not None
        and re.search(r'\.btn-ghost\s*\{', css) is not None
        and re.search(r'border:\s*1px solid var\(--btn-ghost-border\)', css) is not None
        and re.search(r'\.nav-cta\s*\{', css) is not None
        and re.search(r'color:\s*var\(--gold\)', css[re.search(r'\.nav-cta\s*\{', css).start():][:400]) is not None
        and re.search(r'\.mobile-nav-cta\s*\{', css) is not None
        and re.search(r'\.cookie-btn-ghost\s*\{', css) is not None
        and re.search(r'color:\s*var\(--btn-on-fill\)', css[re.search(r'\.mobile-nav-cta\s*\{', css).start():][:500]) is not None,
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
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s*\{[^}]*padding-bottom:\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#itinerary\s*\{[^}]*padding-bottom:\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media\s*\(\s*min-width:\s*769px\s*\)[\s\S]*?#gallery\s+\.section-title[\s\S]*?font-size:\s*clamp\(1\.1rem',
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
        'review snippet clamps to 4 lines with reserved height (Part 2 + CLS)',  # DECISION (see DECISIONS.md — do not weaken to pass)
        css is not None
        # 4-line snippet (was 2) with a reserved clamp height so cards are uniform
        and '-webkit-line-clamp:4' in css
        and re.search(r'\.review-text--clamped\{[^}]*min-height:4lh', css) is not None,
    )
    r.check(
        'reviews grid + loading reserve height so lazy-load does not shift (CLS)',  # DECISION (see DECISIONS.md — do not weaken to pass)
        css is not None
        # Placeholder and grid reserve the loaded height (mobile 115rem / desktop 51rem — 7 reviews)
        and re.search(r'\.reviews-loading\{[^}]*min-height:115rem', css) is not None
        and re.search(r'\.reviews-grid\{[^}]*min-height:115rem', css) is not None
        and 'min-height:51rem' in css,
    )
    r.check(
        'mobile carousel-nav reserves height so position indicator does not shift (CLS)',  # DECISION (see DECISIONS.md — do not weaken to pass)
        re.search(r'\.carousel-nav\{[^}]*min-height:3\.2rem', read_file('css/layout.css') or '') is not None,
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
        and "document.querySelector('.contact-info .whatsapp-btn')" in index_html
        and 'syncWaEnquiryLinks(msg)' in index_html
        and 'syncWaEnquiryLinks(null)' in index_html
        and 'function getDefaultWaMsg()' in index_html
        and '.footer-links a[href*="wa.me"]' in index_html,
    )
    r.check(
        'WhatsApp prefill prompts dates guests and charter type',
        'Charter: (half-day / full-day / multi-day)' in index_html
        and 'captain and crew confirm availability' in index_html,
    )
    r.check(
        'multi-day cards mention planning once in touch',
        "we'll map anchorages, mileage and running costs for your dates" in index_html
        and 'the captain and crew will sketch distances, fuel and mooring realistically in a personal reply' in index_html
        and 'a short message to the captain and crew is what really helps' in index_html,
    )
    r.check(
        'specs section explains APA and optional crew gratuity',
        'class="charter-faq ' in index_html
        and 'id="charter-faq-gratuity"' in index_html
        and 'Good to know' in index_html
        and 'What is APA?' in index_html
        and '<strong>10% of the charter fee</strong>' in index_html
        and 'running tally' in index_html
        and 'Is crew gratuity included?' in index_html
        and 'never required' in index_html
        and 'shared equally across the whole crew' in index_html
        and 'charter-faq-item+.charter-faq-item' in (css or '')
        and '.charter-faq{' in (css or ''),
    )
    r.check(
        'gratuity sprinkled lightly without hard sell',
        'about-crew-note' in index_html
        and 'Crew gratuity not included (optional, cash)' in index_html
        and 'gratuity optional' in index_html
        and 'gratuity never required' in index_html
        and 'charter-faq-gratuity' in index_html
        and '.about-crew-note{' in (css or ''),
    )
    r.check(
        'WhatsApp CTA copy uses enquire voice',
        'Ask on WhatsApp' not in index_html
        and 'Enquire on WhatsApp' in index_html
        and 'Enquire via WhatsApp' not in index_html,
    )
    r.check(
        'calendar WhatsApp label reflects selected dates',
        'data-wa-label-dates="WhatsApp these dates"' in index_html
        and 'function syncCalWaLabel(hasDates)' in index_html
        and 'syncCalWaLabel(true)' in index_html,
    )
    r.check(
        'request-a-quote column is gone; calendar is a standalone section',
        'enquire-section' not in index_html
        and 'Get a Quote' not in index_html
        and 'Request Your Quote' not in index_html
        and 'class="contact-cal-pair"' not in index_html
        and index_html.find('id="charters"') < index_html.find('id="availability"') < index_html.find('id="reviews"'),
    )
    r.check(
        'calendar entry path is first-touch only',
        'function lySetCalEntry' in index_html
        and "sessionStorage.getItem('ly_cal_entry')" in index_html
        and "tag('set', 'ly_cal_entry', value)" in index_html
        and 'enquire_click' not in index_html,
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
        'images/mobile/maiora_20s_18pv-480.webp',
        'images/mobile/maiora_20s_18pv-720.webp',
        'images/mobile/maiora_20s_18pv-960.webp',
        'images/mobile/maiora_20s_18ph-480.webp',
        'scripts/preview_hero_framing.py',
        'images/maiora_20s_02.webp',
        'images/maiora_20s_02-640.webp',
        'images/maiora_20s_02-960.webp',
        'images/maiora_20s_02-1280.webp',
        'images/dest/portals-vells-1.webp',
        'images/mobile/dest/portals-vells-1.webp',
        'images/dest/portals-vells-1gm.webp',
        'images/mobile/dest/portals-vells-1gm-480.webp',
        'images/mobile/dest/portals-vells-1gm-720.webp',
        'images/mobile/dest/portals-vells-1gm-prev.jpg',
        'images/dest/portals-vells-2.jpg',
        'images/dest/portals-vells-2.webp',
        'images/mobile/dest/portals-vells-2-960.webp',
        'images/dest/portals-vells-3.jpg',
        'images/dest/portals-vells-3.webp',
        'images/mobile/dest/portals-vells-3-960.webp',
        'images/dest/portals-vells-4.jpg',
        'images/dest/portals-vells-4.webp',
        'images/mobile/dest/portals-vells-4-960.webp',
        'images/dest/portals-vells-5.jpg',
        'images/dest/portals-vells-5.webp',
        'images/mobile/dest/portals-vells-5-960.webp',
        'images/dest/portals-vells-6.jpg',
        'images/dest/portals-vells-6.webp',
        'images/mobile/dest/portals-vells-6-960.webp',
        'images/maiora_20s_04-640.webp',
        'images/maiora_20s_04-960.webp',
        'images/maiora_20s_21.jpg',
        'images/maiora_20s_21-640.webp',
        'images/maiora_20s_21-960.webp',
        'images/mobile/maiora_20s_21-960.webp',
        'images/maiora_20s_21-prev.jpg',
        'images/mobile/dest/el-toro-malgrats-1-480.webp',
        'images/mobile/dest/el-toro-malgrats-1-720.webp',
        'images/mobile/_srcset-widths.json',
        'data/reviews.json',
        'netlify/functions/availability.mjs',
        'netlify/functions/reviews.mjs',
    ):
        r.check(f'{rel} exists', os.path.isfile(os.path.join(ROOT, rel)))

    availability_mjs = read_file('netlify/functions/availability.mjs') or ''
    ics_lib = read_file('netlify/functions/lib/ics.mjs') or ''
    r.check(
        'availability ICS parser handles dashed dates and tentative status',
        (
            'expandEvent' in availability_mjs
            or 'expandEvent' in ics_lib
        )
        and (
            'STATUS' in availability_mjs
            or 'STATUS' in ics_lib
        )
        and (
            'RRULE' in availability_mjs
            or 'RRULE' in ics_lib
        )
        and (
            r'(\d{4})-?(\d{2})-?(\d{2})' in availability_mjs
            or r'(\d{4})-?(\d{2})-?(\d{2})' in ics_lib
        )
        and 'siteCalendar' in availability_mjs
        and "from './lib/ics.mjs'" in availability_mjs.replace('"', "'"),
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


def check_day_charter_landing(r: Runner) -> None:
    """EN + DE day-charter landing (P1 of lean-into-real-markets-seo)."""
    en = read_file('day-charter-mallorca/index.html')
    de = read_file('de/day-charter-mallorca/index.html')
    sitemap = read_file('sitemap.xml') or ''
    index = read_file('index.html') or ''
    de_index = read_file('de/index.html') or ''
    main_css = read_file('css/main.css') or ''

    r.check('day-charter EN page exists', en is not None)
    r.check('day-charter DE page exists', de is not None)
    r.check(
        'day-charter has no ES or FR copies (not real charter audiences)',
        read_file('es/day-charter-mallorca/index.html') is None
        and read_file('fr/day-charter-mallorca/index.html') is None,
    )
    if not en or not de:
        return

    r.check(
        'EN day-charter title targets private day charter Mallorca',
        '<title>Private Day Charter Mallorca — Crewed Maiora from Palma</title>' in en,
    )
    r.check(
        'EN day-charter has a single commercial H1',
        en.count('<h1>') == 1
        and 'Private yacht charter in Mallorca' in en,
    )
    r.check(
        'EN day-charter has unique meta description',
        'name="description" content="Private day charter in Mallorca' in en,
    )
    r.check(
        'EN day-charter canonical is /day-charter-mallorca/',
        'rel="canonical" href="https://limitlessyachtcharter.com/day-charter-mallorca/"' in en,
    )
    for code, href in (
        ('en', 'https://limitlessyachtcharter.com/day-charter-mallorca/'),
        ('de', 'https://limitlessyachtcharter.com/de/day-charter-mallorca/'),
        ('x-default', 'https://limitlessyachtcharter.com/day-charter-mallorca/'),
    ):
        r.check(
            f'EN day-charter hreflang={code}',
            f'hreflang="{code}" href="{href}"' in en,
        )
    r.check(
        'EN day-charter has no ES/FR hreflang (page not generated)',
        'hreflang="es"' not in en and 'hreflang="fr"' not in en,
    )
    r.check(
        'EN day-charter Service JSON-LD with EUR AggregateOffer',
        '"@type":"Service"' in en
        and '"@type":"AggregateOffer"' in en
        and '"priceCurrency":"EUR"' in en
        and '"lowPrice":"1700"' in en
        and '"highPrice":"4000"' in en,
    )
    r.check(
        'EN day-charter self-filters the Lürssen name collision',
        'Lürssen' in en and 'charter yacht' in en.lower(),
    )
    r.check(
        'EN day-charter has WhatsApp + tel CTAs',
        'wa.me/34643678072' in en and 'tel:+34643678072' in en,
    )
    r.check(
        'EN day-charter uses inner-page shell (no cinema hero)',
        'class="ly-inner-page"' in en and 'id="hero"' not in en,
    )
    r.check(
        'homepage charters intro links to day-charter landing',
        'href="day-charter-mallorca/"' in index
        and 'private day charter in Mallorca' in index,
    )
    r.check(
        'homepage footer links to day-charter landing',
        'href="day-charter-mallorca/">Day charter</a>' in index,
    )
    r.check(
        'sitemap lists EN + DE day-charter with lastmod',
        '<loc>https://limitlessyachtcharter.com/day-charter-mallorca/</loc>' in sitemap
        and '<loc>https://limitlessyachtcharter.com/de/day-charter-mallorca/</loc>' in sitemap
        and sitemap.count('<lastmod>2026-08-17</lastmod>') >= 2,
    )
    r.check(
        'DE day-charter title uses Yachtcharter / Tagescharter',
        'Tagescharter Mallorca' in de and '<html' in de and 'lang="de"' in de,
    )
    r.check(
        'DE day-charter canonical is /de/day-charter-mallorca/',
        'rel="canonical" href="https://limitlessyachtcharter.com/de/day-charter-mallorca/"' in de,
    )
    r.check(
        'DE day-charter assets step up two folders',
        'href="../../css/layout.css' in de
        and 'href="../../css/main.css' in de
        and 'src="../../js/analytics-env.js"' in de
        and 'href="../../favicon.svg"' in de
        and 'href="../../#avail-cal"' in de,
    )
    r.check(
        'DE day-charter H1 is German commercial',
        'Yachtcharter Mallorca' in de and 'Private yacht charter in Mallorca — a crewed day' not in de,
    )
    r.check(
        'main.css defines inner-page layout',
        'html.ly-inner-page' in main_css and '.ly-page h1' in main_css,
    )
    r.check(
        'inner-page body links stay gold; buttons do not inherit gold text',
        'a:not([class*="btn-"]){color:var(--gold)}' in main_css.replace(' ', '')
        and '.ly-page-cta .btn-primary' in main_css,
    )
    en_main_v = re.search(r'main\.css\?v=(\d+)', index)
    if en_main_v:
        v = en_main_v.group(1)
        r.check(
            'day-charter pages share homepage main.css cache version',
            f'main.css?v={v}' in en and f'main.css?v={v}' in de,
        )
    r.check(
        'EN homepage title unchanged pending owner approval',
        '<title>Limitless Yacht Experience – Luxury Maiora Charter in Mallorca</title>' in index,
    )
    r.check(
        'EN homepage lead carries commercial phrase',
        'Private yacht charter in Mallorca' in index,
    )
    r.check(
        'DE homepage title leads with Yachtcharter / Yacht mieten',
        'Yachtcharter Mallorca' in de_index and 'Yacht mieten' in de_index,
    )

    try:
        sys.path.insert(0, os.path.join(ROOT, 'i18n'))
        build_mod = _load_build_locales()
        from locales import de as de_mod  # noqa: WPS433
    except Exception as exc:  # noqa: BLE001
        r.fail('day-charter locale build importable', str(exc))
        return
    expected = build_mod.build_landing(de_mod, 'day-charter-mallorca', 'DAY_CHARTER_PAIRS')
    if de.count('\n') < 8:
        import importlib.util

        minify_path = os.path.join(ROOT, 'scripts', 'minify_html.py')
        spec = importlib.util.spec_from_file_location('minify_html_landing', minify_path)
        minify_mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(minify_mod)
        expected = minify_mod.minify_html(expected)
    r.check(
        'de/day-charter-mallorca/index.html matches build-locales.py output',
        de == expected,
        'run: python3 i18n/build-locales.py',
    )


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
    check_hero_legibility_cascade(r)
    check_localized_reviews(r)

    print('\n[locale modules]')
    check_locale_modules(r)

    print('\n[locale translations]')
    check_locale_translations(r, pages)

    print('\n[day-charter landing]')
    check_day_charter_landing(r)

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