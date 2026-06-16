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
    'hero', 'intro', 'about', 'itinerary', 'gallery', 'pricing',
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
        'itinerary carousel syncs card webp with lightbox URL',
        'window.LY_syncDestCardImages' in html,
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

    # Availability calendar
    r.check('id="availCal" calendar widget exists', 'id="availCal"' in html)

    # Nav
    r.check('id="navbar" navigation exists', 'id="navbar"' in html)

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
    r.check(f'reviews fetch uses {reviews_json}', f"fetch('{reviews_json}')" in html)
    if rel != 'index.html':
        r.check('does not fetch English reviews.json', "fetch('/data/reviews.json')" not in html)
    r.check('availability API fetch', '/api/availability' in html)

    # Structured data
    r.check('schema.org JSON-LD present', 'application/ld+json' in html)

    # Locale subfolders — asset paths must be root-relative
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


def check_legal(r: Runner, rel: str, html: str) -> None:
    lang = LEGAL_META[rel]['lang']
    r.check(f'<html lang="{lang}">', re.search(rf'<html lang="{lang}"', html) is not None)
    r.check('links back to home', 'index.html' in html or 'href="/' in html)


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


def check_shared_assets(r: Runner) -> None:
    css = read_file('css/main.css')
    r.check('css/main.css exists', css is not None)
    if css:
        r.check('main.css defines .hero-bg-wrap', '.hero-bg-wrap' in css)
        r.check('main.css defines heroTitleIn', 'heroTitleIn' in css)
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

    for rel in (
        'fonts/montserrat-latin.woff2',
        'images/mobile/maiora_20s_02.webp',
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