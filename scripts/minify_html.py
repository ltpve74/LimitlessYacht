#!/usr/bin/env python3
"""
Full HTML + inline CSS/JS minifier for the Limitless Yacht site.

- Strips all HTML comments (<!-- ... -->)
- Minifies content inside <style> (removes /* */ comments + compacts)
- Minifies content inside inline <script> (removes // and /* */ comments + compacts)
- Aggressively collapses HTML whitespace
- Safe for this site's markup (no <pre> with significant ws, etc.)

Intended to be run (automatically via git hook) before committing to `main`
so the production files are small and clean.

Usage:
    python3 scripts/minify_html.py
"""

import re
import sys
from pathlib import Path

# All HTML files that should be minified for production
HTML_FILES = [
    "index.html",
    "legal.html",
    "de/index.html",
    "de/legal.html",
    "es/index.html",
    "es/legal.html",
    "fr/index.html",
    "fr/legal.html",
]


def minify_css(css: str) -> str:
    """Basic but effective CSS minifier."""
    # Remove comments
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    # Collapse whitespace
    css = re.sub(r'\s+', ' ', css)
    # Compact punctuation
    css = re.sub(r'\s*([{};:,>+~])\s*', r'\1', css)
    css = re.sub(r';}', '}', css)
    css = css.strip()
    return css


def minify_js(js: str) -> str:
    """Basic JS minifier (comment stripping + whitespace compression).
    Safe enough for the kind of code used in this project.
    """
    # Remove block comments /* */
    js = re.sub(r'/\*.*?\*/', '', js, flags=re.DOTALL)
    # Remove line comments //
    js = re.sub(r'//.*', '', js)
    # Collapse whitespace
    js = re.sub(r'\s+', ' ', js)
    # Remove unnecessary spaces around operators/punctuation
    js = re.sub(r'\s*([{}();,=+\-*/<>!&|^%?:])\s*', r'\1', js)
    js = re.sub(r'\s*\[\s*', '[', js)
    js = re.sub(r'\s*\]\s*', ']', js)
    js = js.strip()
    return js


def minify_html(html: str) -> str:
    # 1. Remove HTML comments (<!-- ... -->)
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)

    # 2. Minify content of <style> blocks
    html = re.sub(
        r'(<style[^>]*>)(.*?)(</style>)',
        lambda m: m.group(1) + minify_css(m.group(2)) + m.group(3),
        html,
        flags=re.DOTALL | re.IGNORECASE
    )

    # 3. Minify content of inline <script> blocks (skip those with src)
    def _minify_script(match):
        opening = match.group(1)
        content = match.group(2)
        closing = match.group(3)
        if re.search(r'\bsrc\s*=', opening, re.IGNORECASE):
            return match.group(0)  # external script, leave as-is
        return opening + minify_js(content) + closing

    html = re.sub(
        r'(<script[^>]*>)(.*?)(</script>)',
        _minify_script,
        html,
        flags=re.DOTALL | re.IGNORECASE
    )

    # 4. Structural HTML minification (whitespace between tags, etc.)
    html = re.sub(r'>\s+<', '><', html)
    html = re.sub(r'\s+', ' ', html)
    html = re.sub(r'\s+/>', '/>', html)
    html = re.sub(r'<\s+', '<', html)
    html = re.sub(r'\s+>', '>', html)

    # 5. Final trim
    html = html.strip()

    return html


def main() -> None:
    root = Path(__file__).resolve().parent.parent

    total_original = 0
    total_minified = 0
    files_changed = 0

    for rel_path in HTML_FILES:
        path = root / rel_path
        if not path.exists():
            print(f"⚠️  Skipping (not found): {rel_path}")
            continue

        original = path.read_text(encoding="utf-8")
        minified = minify_html(original)

        original_size = len(original.encode("utf-8"))
        minified_size = len(minified.encode("utf-8"))

        total_original += original_size
        total_minified += minified_size

        if minified != original:
            path.write_text(minified, encoding="utf-8")
            savings = original_size - minified_size
            pct = (savings / original_size) * 100 if original_size else 0
            print(f"✓ Minified {rel_path:20}  {original_size:6} → {minified_size:6} bytes  (-{savings} / {pct:.1f}%)")
            files_changed += 1
        else:
            print(f"  No change        {rel_path:20}")

    if files_changed:
        total_savings = total_original - total_minified
        total_pct = (total_savings / total_original) * 100 if total_original else 0
        print(f"\n✅ {files_changed} file(s) minified.")
        print(f"   Total size: {total_original:,} → {total_minified:,} bytes "
              f"(-{total_savings:,} / {total_pct:.1f}%)")
    else:
        print("\nAll HTML files were already minified.")


if __name__ == "__main__":
    main()
