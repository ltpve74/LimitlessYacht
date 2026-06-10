#!/usr/bin/env python3
"""
Minify HTML for production.
Strips HTML/CSS/JS comments, collapses whitespace, shrinks inline style and script blocks.
Run from repo root:  python3 scripts/minify_html.py
"""

import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGETS = [
    'index.html',  'legal.html',
    'de/index.html', 'de/legal.html',
    'fr/index.html', 'fr/legal.html',
    'es/index.html', 'es/legal.html',
]


def minify_css(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    css = re.sub(r'\s+', ' ', css)
    css = re.sub(r'\s*([{}:;,>~+])\s*', r'\1', css)
    css = re.sub(r';\s*}', '}', css)
    css = re.sub(r'\s*!\s*important', '!important', css)
    return css.strip()


def minify_js(js):
    js = re.sub(r'/\*.*?\*/', '', js, flags=re.DOTALL)
    js = re.sub(r'\s+', ' ', js)
    return js.strip()


def minify_html(html):
    # Strip HTML comments (preserve IE conditionals <!--[if ...)
    html = re.sub(r'<!--(?!\[).*?-->', '', html, flags=re.DOTALL)

    # Minify inline <style> blocks
    def _style(m):
        return '<style>' + minify_css(m.group(1)) + '</style>'
    html = re.sub(r'<style[^>]*>(.*?)</style>', _style, html, flags=re.DOTALL)

    # Minify inline <script> blocks (skip non-JS types: json, ld+json, template …)
    def _script(m):
        attrs, body = m.group(1), m.group(2)
        if re.search(r'type=["\'][^"\']*(?:json|template|text/html)', attrs, re.I):
            return m.group(0)
        return '<script' + attrs + '>' + minify_js(body) + '</script>'
    html = re.sub(r'<script([^>]*)>(.*?)</script>', _script, html, flags=re.DOTALL)

    # Collapse whitespace between tags
    html = re.sub(r'>\s+<', '><', html)
    # Collapse remaining runs of whitespace to a single space
    html = re.sub(r' {2,}', ' ', html)
    # Strip leading/trailing whitespace on each line then join
    lines = [l.strip() for l in html.splitlines()]
    html = ' '.join(l for l in lines if l)

    return html


def main():
    total_before = total_after = 0
    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print(f'  skip  {rel}')
            continue
        with open(path, encoding='utf-8') as f:
            src = f.read()
        out = minify_html(src)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        before = len(src.encode())
        after  = len(out.encode())
        total_before += before
        total_after  += after
        pct = (before - after) / before * 100
        print(f'  {rel}: {before:,} → {after:,} B  ({pct:.0f}% saved)')
    saved = total_before - total_after
    print(f'\nTotal: {total_before:,} → {total_after:,} B  ({saved:,} B saved)')


if __name__ == '__main__':
    main()
