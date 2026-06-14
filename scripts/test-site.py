#!/usr/bin/env python3
"""
Pre-commit site test suite for limitlessyachtcharter.com

Checks conversion-critical elements across all locale pages and validates
inline JavaScript syntax. Runs automatically from .githooks/pre-commit after
locale rebuild + minification. Exit 0 = all pass; non-zero blocks the commit.

Usage (manual):
  python3 scripts/test-site.py          # full suite
  python3 scripts/test-site.py --quick  # HTML checks only, skip JS syntax
"""

import sys, os, re, subprocess, tempfile, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LOCALE_FILES = [
    'index.html',
    'de/index.html',
    'fr/index.html',
    'es/index.html',
]

# ── Output helpers ─────────────────────────────────────────────────────────────

GREEN  = '\033[92m'
RED    = '\033[91m'
YELLOW = '\033[93m'
RESET  = '\033[0m'

class Runner:
    def __init__(self):
        self.failures = []
        self.passes   = 0

    def ok(self, label):
        self.passes += 1
        print(f'  {GREEN}✓{RESET}  {label}')

    def fail(self, label, detail=''):
        msg = label + (f' — {detail}' if detail else '')
        self.failures.append(msg)
        print(f'  {RED}✗{RESET}  {msg}')

    def warn(self, label):
        print(f'  {YELLOW}⚠{RESET}  {label}')

    def check(self, label, cond, detail=''):
        (self.ok if cond else lambda l: self.fail(l, detail))(label)

    def summary(self):
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


# ── HTML checks ────────────────────────────────────────────────────────────────

def check_html(r, rel, html):
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
            'bare links (user lands on blank chat): ' + ', '.join(bare) if bare else ''
        )
    else:
        r.fail('WhatsApp link(s) present', 'no wa.me links found in page')

    r.check('.form-col-wa WhatsApp button inside form column', 'form-col-wa' in html)

    # Contact form
    form_tag_m = re.search(r'<form\b[^>]*id="contactForm"[^>]*>', html)
    form_tag   = form_tag_m.group(0) if form_tag_m else ''
    r.check('id="contactForm" exists', bool(form_tag))
    if form_tag:
        r.check('form has no novalidate (browser validation on)', 'novalidate' not in form_tag)

    r.check('name field is required',
            any('name="name"' in t and 'required' in t
                for t in re.findall(r'<input\b[^>]*>', html)))
    r.check('email field is required',
            any('name="email"' in t and 'required' in t
                for t in re.findall(r'<input\b[^>]*>', html)))

    # Destination lightbox
    r.check('id="dest-lb-cta" lightbox CTA exists', 'id="dest-lb-cta"' in html)

    # Availability calendar
    r.check('id="availCal" calendar widget exists', 'id="availCal"' in html)

    # Nav
    r.check('id="navbar" navigation exists', 'id="navbar"' in html)

    # Netlify form detection
    r.check('Netlify form attribute present', ' netlify ' in html or ' netlify>' in html)


# ── JS syntax check ────────────────────────────────────────────────────────────

def check_js(r):
    path = os.path.join(ROOT, 'index.html')
    try:
        with open(path, encoding='utf-8') as f:
            html = f.read()
    except FileNotFoundError:
        r.fail('index.html readable for JS check', 'file not found')
        return

    # Extract inline scripts only (skip src= externals and JSON-LD / template types)
    blocks = re.findall(
        r'<script(?![^>]*\bsrc\b)(?![^>]*type=["\'][^"\']*(?:json|template|text/html))[^>]*>'
        r'(.*?)</script>',
        html, re.DOTALL | re.IGNORECASE
    )
    if not blocks:
        r.warn('No inline script blocks found in index.html')
        return

    # Join with semicolons so each block is syntactically separate
    combined = ';\n'.join(b.strip() for b in blocks if b.strip())
    char_count = len(combined)
    tmp_path = None

    try:
        with tempfile.NamedTemporaryFile(suffix='.js', mode='w', encoding='utf-8',
                                         delete=False) as tf:
            tf.write(combined)
            tmp_path = tf.name

        result = subprocess.run(
            ['node', '--check', tmp_path],
            capture_output=True, text=True, timeout=15
        )

        if result.returncode == 0:
            r.ok(f'Inline JS syntax valid ({len(blocks)} blocks, {char_count:,} chars)')
        else:
            # Surface only the first error line to keep output readable
            first_err = (result.stderr.strip().split('\n')[0]
                         .replace(tmp_path, 'inline-script'))
            r.fail('Inline JS syntax', first_err)

    except FileNotFoundError:
        r.warn('node not installed — skipping JS syntax check')
    except subprocess.TimeoutExpired:
        r.warn('node --check timed out (>15 s) — skipping')
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Limitless site test suite')
    parser.add_argument('--quick', action='store_true',
                        help='HTML checks only — skip JS syntax (faster)')
    args = parser.parse_args()

    print('━' * 58)
    print('  Limitless site tests')
    print('━' * 58)

    r = Runner()

    for rel in LOCALE_FILES:
        print(f'\n[{rel}]')
        fpath = os.path.join(ROOT, rel)
        try:
            with open(fpath, encoding='utf-8') as f:
                html = f.read()
            check_html(r, rel, html)
        except FileNotFoundError:
            r.fail(f'{rel}', 'file not found')

    if not args.quick:
        print('\n[JS syntax — index.html]')
        check_js(r)

    passed = r.summary()
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()
