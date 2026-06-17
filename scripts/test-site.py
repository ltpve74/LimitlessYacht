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


# ── HTML checks ────────────────────────────────────────────────────────────────

def check_html(r: Runner, rel: str, html: str) -> None:
    meta = LOCALE_META[rel]

    # Enquiry flow
    r.check('#enquire scroll anchor exists', 'id="enquire"' in html)
    r.check('enquiry CTAs link to #enquire', 'href="#enquire"' in html)
    r.check(
        'charters section groups options with includes panel',
        'class="charters-main"' in html
        and 'class="charter-includes reveal"' in html
        and 'class="charter-includes-list"' in html,
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
        and "lbCta.href = window.innerWidth <= 640 ? '#avail-cal' : '#enquire-form'" in html,
    )
    r.check(
        'gallery lightbox uses centralized images array',
        'const images = [' in html and 'function showImage(idx)' in html,
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
        'destination preload shares cache with carousel/lightbox',
        'window.LY_preloadDestAdjacent' in html and 'window.LY_destPreloaded' in html,
    )
    r.check(
        'itinerary carousel cards have data-dest-idx',
        html.count('data-dest-idx="') == 12,
    )
    r.check(
        'destination cards use responsive picture sources (no JS srcset overwrite)',
        'window.LY_syncDestCardImages' not in html
        and html.count('class="destination-card-bg"') == 12
        and html.count('sizes="78vw"') == 12
        and 'images/mobile/dest/el-toro-malgrats-1-480.webp 480w' in html,
    )
    r.check(
        'gallery pictures split mobile/desktop sources',
        'sizes="(max-width: 640px) 35vw, 22vw"' not in html
        and html.count('sizes="22vw"') >= 15,
    )
    r.check(
        'itinerary carousel prefetches on scroll',
        'window.LY_preloadDestAdjacent(gi)' in html,
    )
    r.check(
        'gallery idle drip-feed after LCP window',
        'function nextGallery()' in html and 'window.LY_afterLcp' in html,
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
        'itinerary lightbox whole-card half-tap navigates',
        "destLb.addEventListener('click'" in html
        and 'destLb.getBoundingClientRect()' in html
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
        'nav scroll section highlighting script',
        'updateNavSection' in html
        and "classList.toggle('is-active'" in html
        and 'navSectionLinks' in html
        and "addEventListener('hashchange'" in html
        and 'navMarkerTop' in html
        and 'scrollToLandAnchor' not in html
        and 'preventDefault' not in re.search(
            r'navSectionLinks\.forEach\(function\(a\)[\s\S]{0,400}',
            html,
        ).group(0),
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
    r.check(
        'mobile menu keeps section-top anchors',
        re.search(r'class="mobile-nav"[^>]*>[\s\S]*?href="#about"', html) is not None
        and 'mobile-nav' in html
        and re.search(
            r'class="mobile-nav"[\s\S]*?href="#about-land"',
            html,
        ) is None,
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
        'class="hero-bg"' in html and 'fetchpriority="high"' in html,
    )
    r.check(
        'responsive hero image preloads',
        'images/mobile/maiora_20s_02.webp' in html
        and 'maiora_20s_02.webp' in html
        and 'fetchpriority="high"' in html,
    )
    style_pos = html.find('<style')
    r.check(
        'critical hero CSS discovered before deferred head scripts',
        style_pos > 0 and style_pos < html.find('<script'),
    )
    r.check(
        'hero image preloads discovered before deferred head scripts',
        html.find('fetchpriority="high"')
        < style_pos
        < html.find('LY_afterLcp')
        < html.find('window.LY_DEST_IMAGES'),
    )
    r.check(
        'analytics and preload bootstrap deferred until after hero',
        html.find('id="hero"') > 0 and html.find('id="hero"') < html.find('LY_afterLcp'),
    )
    r.check(
        'navigation markup precedes hero in document order',
        html.find('id="navbar"') > 0 and html.find('id="navbar"') < html.find('id="hero"'),
    )
    r.check(
        'critical CSS is slim enough for fast head parse',
        style_pos > 0 and html.find('</style>', style_pos) - style_pos < 4200,
    )
    crit_end = html.find('</style>', style_pos)
    crit_css = html[style_pos:crit_end] if style_pos > 0 and crit_end > style_pos else ''
    crit_flat = re.sub(r'\s+', '', crit_css)
    r.check(
        'critical CSS fixes nav before main.css (prevents hero CLS)',
        'position:fixed' in crit_flat and 'nav{' in crit_flat,
    )
    r.check(
        'critical CSS matches mobile hero flex layout',
        'display:flex' in crit_flat
        and '.hero-cta-group{' in crit_flat and 'margin-top:auto' in crit_flat
        and 'flex:1' in crit_flat and 'min-height:100%' in crit_flat
        and 'safe-area-inset-bottom' in crit_css,
    )
    r.check(
        'critical CSS reserves hero child layout before main.css',
        '.hero-eyebrow{' in crit_flat
        and '.hero-actions{' in crit_flat
        and '.btn-primary{' in crit_flat,
    )
    r.check(
        'below-fold preloads deferred until after LCP window',
        'window.LY_afterLcp' in html and 'LY_destPreloadReady' in html,
    )
    r.check(
        'hero title uses heroTitleIn (visible for LCP)',
        'heroTitleIn' in html,
    )

    # Cookie consent — must not steal LCP
    r.check('cookie consent banner exists', 'id="cookie-consent"' in html)
    r.check('cookie accept + decline controls', 'id="cookie-accept"' in html and 'id="cookie-decline"' in html)
    r.check(
        'cookie banner delayed past LCP window (6000ms)',
        'setTimeout(show, 6000)' in html and 'setTimeout(show, 1400)' not in html,
    )

    # Conversion tracking
    r.check('gtag_report_conversion (WhatsApp) defined', 'function gtag_report_conversion' in html)
    r.check('gtag_report_conversion_form defined', 'function gtag_report_conversion_form' in html)
    r.check(
        'Google Ads conversion labels present',
        'AW-18209943491/CkJfCKPt7rgcEMPflutD' in html
        and 'AW-18209943491/Pd-9CKDt7rgcEMPflutD' in html,
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
            'href="../css/main.css' in html
            and 'href="../fonts/montserrat-latin.woff2"' in html
            and "url('../fonts/montserrat-latin.woff2')" in html
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
    css = read_file('css/main.css')
    r.check('css/main.css exists', css is not None)
    index_html = read_file('index.html') or ''
    en_v = re.search(r'main\.css\?v=(\d+)', index_html)
    r.check(
        'main.css cache-bust version is set on EN',
        en_v is not None,
    )
    if en_v:
        v = en_v.group(1)
        for loc in ('de', 'es', 'fr'):
            loc_html = read_file(f'{loc}/index.html') or ''
            r.check(
                f'{loc}/index.html uses same main.css cache version as EN',
                f'main.css?v={v}' in loc_html,
            )
    if css:
        r.check('main.css defines .hero-bg-wrap', '.hero-bg-wrap' in css)
        r.check('main.css defines heroTitleIn', 'heroTitleIn' in css)
        css_flat = re.sub(r'\s+', '', css)
        r.check(
            'hero entrance animations avoid translateY (CLS-safe)',
            '@keyframesheroFade' in css_flat and 'animation:heroFade' in css_flat,
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
    publish_yml = read_file('.github/workflows/publish.yml') or ''
    r.check(
        'publish gate workflow runs on main',
        'publish-gate.py' in publish_yml and 'branches: [main]' in publish_yml,
    )
    r.check('publish gate script exists', os.path.isfile(os.path.join(ROOT, 'scripts/publish-gate.py')))
    r.check('lighthouse check script exists', os.path.isfile(os.path.join(ROOT, 'scripts/lighthouse-check.py')))
    r.check('ux smoke test script exists', os.path.isfile(os.path.join(ROOT, 'scripts/ux-test.py')))
    r.check('lighthouse budgets file exists', os.path.isfile(os.path.join(ROOT, 'scripts/lighthouse-budgets.json')))
    index_html = read_file('index.html') or ''
    r.check(
        'font preload uses path relative to site root (GitHub Pages subpath safe)',
        'href="fonts/montserrat-latin.woff2"' in index_html
        and 'href="/fonts/montserrat-latin.woff2"' not in index_html,
    )
    r.check(
        'behavior-analytics loads via LY_BASE',
        "LY_BASE || '') + '/js/behavior-analytics.js'" in index_html
        and 'src="/js/behavior-analytics.js"' not in index_html,
    )
    r.check(
        'preview hosts suppress analytics before GA and Clarity load',
        'js/analytics-env.js' in index_html
        and 'LY_IS_PREVIEW' in (read_file('js/analytics-env.js') or '')
        and index_html.find('js/analytics-env.js') < index_html.find('googletagmanager.com/gtag/js')
        and 'if (window.LY_OWNER_MODE) return;' in index_html,
    )
    r.check(
        'hero phone button sizing scoped to hero only',
        css is not None
        and re.search(
            r'#hero \.hero-actions \.btn-primary[^}]*max-width:\s*170px',
            css,
        ) is not None
        and not re.search(
            r'@media \(min-width: 481px\)[^{]*\{[^}]*^\s*\.btn-primary\s*,',
            css,
            re.DOTALL | re.MULTILINE,
        ),
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
        'destination lightbox offers availability path on desktop',
        'id="dest-lb-cta-avail"' in index_html
        and 'dest-lb-cta-secondary' in index_html
        and 'function applyDestLbPrefill()' in index_html,
    )
    r.check(
        'desktop immersive sections use mobile-style funnel CTAs',
        'href="#gallery-land" class="itinerary-meet-cta itinerary-meet-cta--gallery-desktop"' in index_html
        and 'href="#gallery" class="itinerary-meet-cta itinerary-meet-cta--gallery"' in index_html
        and 'href="#availability" class="itinerary-meet-cta itinerary-meet-cta--desktop"' in index_html
        and css is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.gallery-wrap[\s\S]*?min-height:\s*calc\(100svh\s*-\s*var\(--nav-scroll-offset\)\s*-\s*14rem\)',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#gallery,\s*\n\s*#itinerary\s*\{[^}]*height:\s*auto',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.gallery-group\s+\.gallery-grid[\s\S]*?flex:\s*1\s*1\s*0',
            css,
        )
        is not None
        and 'immersive-chrome' not in css
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.itinerary-meet-cta\s*\{[^}]*display:\s*block',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#gallery\s+\.section-cta-desktop[\s\S]*?display:\s*none',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#gallery\s+\.carousel-nav[\s\S]*?display:\s*flex',
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
        and '.lb-close {' in css
        and '.lb-nav {' in css
        and '.lb-counter {' in css
        and '#dest-lb-close {' not in css
        and '#lightbox-prev, #lightbox-next' not in css,
    )
    r.check(
        'destination lightbox shows same browse hint as gallery',
        'ly_dest_hinted' in index_html
        and 'id="dest-lb-hint"' in index_html,
    )
    r.check(
        'calendar enquire scrolls on mobile, skips scroll on desktop when paired',
        'function isCalendarFormPaired()' in index_html
        and 'if (isCalendarFormPaired())' in index_html
        and 'scrollIntoView' in index_html,
    )
    r.check(
        'mobile gallery CTA routes to availability calendar',
        'CHECK AVAILABILITY →' in index_html
        and 'href="#avail-cal" class="itinerary-meet-cta itinerary-meet-cta--mobile"' in index_html,
    )
    r.check(
        'desktop funnel CTAs use nav-style landing anchors',
        'href="#availability" class="itinerary-meet-cta itinerary-meet-cta--desktop"' in index_html
        and 'href="#gallery-land" class="itinerary-meet-cta itinerary-meet-cta--gallery-desktop"' in index_html
        and css is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.itinerary-meet-cta--mobile[\s\S]*?display:\s*none\s*!important',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.itinerary-meet-cta--gallery[\s\S]*?display:\s*none\s*!important',
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
            r'\.gallery-group\s+\.gallery-item\s*\{[^}]*height:\s*calc\(100svh\s*-\s*15rem\)',
            css,
        ) is not None
        and re.search(
            r'\.destination-card\s*\{[^}]*height:\s*calc\(100svh\s*-\s*15rem\)',
            css,
        ) is not None,
    )
    r.check(
        'destination lightbox CTA labels swap on mobile',
        css is not None
        and '.dest-lb-cta-mobile' in css
        and '.dest-lb-cta-desktop' in css
        and re.search(r'@media\s*\(max-width:\s*640px\)[^{]*\{[^}]*\.dest-lb-cta-desktop\s*\{\s*display:\s*none', css) is not None,
    )
    r.check(
        'destination lightbox mobile CTA copy is trip-specific',
        'Check dates for this trip →' in index_html
        and 'dest-lb-cta-mobile' in index_html,
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
        'desktop date popover stacks below fixed nav',
        css is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.form-date-wrap\.is-open\s*\{[^}]*z-index:\s*50',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.form-date-popover(?:\.cal)?\s*\{[^}]*z-index:\s*50',
            css,
        )
        is not None,
    )
    r.check(
        'desktop nav keeps single row on narrow viewports',
        css is not None
        and re.search(
            r'@media \(min-width: 769px\) and \(max-width: 1100px\)[\s\S]*?nav\s*\{[^}]*display:\s*flex',
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
        and '.nav-links a.is-active' in css,
    )
    r.check(
        'desktop nav landing keeps labels and uses nav scroll offset',
        css is not None
        and '--nav-scroll-offset' in css
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?html\s*\{[^}]*scroll-padding-top:\s*var\(--nav-scroll-offset\)',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#charters-land[\s\S]*?scroll-margin-top:\s*0',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#availability\s*\{[^}]*scroll-margin-top:\s*1rem',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#enquire-land\s*\{[^}]*scroll-margin-top:\s*1\.5rem',
            css,
        )
        is not None
        and 'funnel below visible intros' in css
        and not re.search(
            r'funnel below visible intros\)[\s\S]*?#gallery\s*>\s*\.container[^}]*\bheight:\s*0\b',
            css,
        )
        and not re.search(
            r'funnel below visible intros\)[\s\S]*?#itinerary\s*>\s*\.container\s+\.section-label[\s\S]*?display:\s*none',
            css,
        ),
    )
    r.check(
        'desktop gallery and destinations show intro copy for natural scroll',
        css is not None
        and re.search(
            r'funnel below visible intros\)[\s\S]*?#gallery\s*>\s*\.container,\s*\n\s*#itinerary\s*>\s*\.container\s*\{[^}]*flex-shrink:\s*0',
            css,
        )
        is not None
        and 'itinerary-intro' in index_html
        and 'class="section-intro reveal reveal-delay-2">Explore life aboard Limitless' in index_html
        and 'class="section-title reveal reveal-delay-1">On<em>board Gallery</em>' in index_html
        and css is not None
        and re.search(
            r'funnel below visible intros\)[\s\S]*?#gallery,\s*\n\s*#itinerary\s*\{[^}]*padding-bottom:\s*5rem',
            css,
        )
        is not None,
    )
    r.check(
        'desktop availability pair compacts for viewport-height landing',
        css is not None
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?\.contact-cal-pair\s+#availability,\s*\n\s*\.contact-cal-pair\s+\.enquire-section\s*\{[^}]*padding-top:\s*3\.5rem',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\) and \(max-height: 920px\)[\s\S]*?\.contact-cal-pair',
            css,
        )
        is not None
        and 'padding-top: 7rem' not in css,
    )
    r.check(
        'charters section keeps includes visible on desktop viewports',
        css is not None
        and '.charters-main' in css
        and re.search(
            r'@media \(min-width: 769px\)[\s\S]*?#charters\s*\{[^}]*padding-top:\s*3\.5rem',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 1000px\)[\s\S]*?\.charters-main[\s\S]*?grid-template-columns',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 1000px\)[\s\S]*?\.charters-main\s+\.charter-includes[\s\S]*?position:\s*sticky',
            css,
        )
        is not None
        and re.search(
            r'@media \(min-width: 769px\) and \(max-height: 920px\)[\s\S]*?#charters',
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

    for rel in (
        'fonts/montserrat-latin.woff2',
        'images/mobile/maiora_20s_02.webp',
        'images/mobile/maiora_20s_02-480.webp',
        'images/mobile/dest/el-toro-malgrats-1-480.webp',
        'data/reviews.json',
        'netlify/functions/availability.mjs',
        'netlify/functions/reviews.mjs',
    ):
        r.check(f'{rel} exists', os.path.isfile(os.path.join(ROOT, rel)))

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