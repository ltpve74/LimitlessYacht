#!/usr/bin/env python3
"""Generate localized index.html and legal.html from English sources."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from locales import de, es, fr  # noqa: E402

LOCALES = {"de": de, "fr": fr, "es": es}

# Separate Netlify form names per locale (avoids merged German field labels on EN emails).
NETLIFY_FORM = {
    "de": "contact-de",
    "fr": "contact-fr",
    "es": "contact-es",
}

# Relative hrefs from each locale folder — works on Netlify (/) and GitHub Pages (/Repo/).
LANG_LINKS = {
    "en": [("en", "./", "EN"), ("de", "de/", "DE"), ("fr", "fr/", "FR"), ("es", "es/", "ES")],
    "de": [("en", "../", "EN"), ("de", "./", "DE"), ("fr", "../fr/", "FR"), ("es", "../es/", "ES")],
    "fr": [("en", "../", "EN"), ("de", "../de/", "DE"), ("fr", "./", "FR"), ("es", "../es/", "ES")],
    "es": [("en", "../", "EN"), ("de", "../de/", "DE"), ("fr", "../fr/", "FR"), ("es", "./", "ES")],
}

ARIA = {
    "en": "Language",
    "de": "Sprache",
    "fr": "Langue",
    "es": "Idioma",
}


def root_paths(html: str) -> str:
    """Use root-relative asset URLs so pages work from locale subfolders."""
    html = html.replace("url('images/", "url('/images/")
    html = html.replace('url("images/', 'url("/images/')
    for attr in ("href", "src", "srcset"):
        html = html.replace(f'{attr}="images/', f'{attr}="/images/')
    html = html.replace('href="favicon.svg"', 'href="/favicon.svg"')
    html = html.replace('"images/', '"/images/')
    # Single-quoted JS strings (idle preload + destImages arrays)
    html = html.replace("'images/", "'/images/")
    # Extra srcset candidates after the first URL (e.g. mobile webp)
    html = html.replace(', images/', ', /images/')
    return html


def lang_switcher_nav(active: str) -> tuple[str, str]:
    links = LANG_LINKS[active]
    active_label = next(label for code, _href, label in links if code == active)
    popover_items = []
    for code, href, label in links:
        cls = ' class="active"' if code == active else ""
        popover_items.append(
            f'        <a href="{href}" hreflang="{code}"{cls} lang="{code}" role="menuitem">{label}</a>'
        )
    nav = (
        f'    <div class="nav-lang-wrap" id="navLangWrap">\n'
        f'      <button type="button" class="nav-lang-trigger" id="navLangTrigger" '
        f'aria-haspopup="menu" aria-expanded="false" aria-controls="navLangPopover" '
        f'aria-label="{ARIA[active]}">\n'
        f'        <span class="nav-lang-current" lang="{active}">{active_label}</span>\n'
        f'        <span class="nav-lang-caret" aria-hidden="true">▾</span>\n'
        f'      </button>\n'
        f'      <div class="nav-lang-popover" id="navLangPopover" role="menu" hidden>\n'
        + "\n".join(popover_items)
        + "\n      </div>\n"
        f"    </div>"
    )
    mobile = []
    for code, href, label in links:
        cls = ' class="active"' if code == active else ""
        mobile.append(f'    <a href="{href}" hreflang="{code}"{cls} lang="{code}">{label}</a>')
    return nav, "\n".join(mobile)


def patch_subfolder_assets(html: str) -> str:
    """Step up to site root for shared assets (locale pages live in /<code>/)."""
    html = re.sub(
        r"LY_LAYOUT_CSS_HREF='css/layout\.css([^']*)'",
        r"LY_LAYOUT_CSS_HREF='../css/layout.css\1'",
        html,
    )
    html = re.sub(r"LY_MAIN_CSS_HREF='css/main\.css([^']*)'", r"LY_MAIN_CSS_HREF='../css/main.css\1'", html)
    html = re.sub(r"\|\| 'css/layout\.css([^']*)'", r"|| '../css/layout.css\1'", html)
    html = re.sub(r"\|\| 'css/main\.css([^']*)'", r"|| '../css/main.css\1'", html)
    html = re.sub(r'href="css/layout\.css([^"]*)"', r'href="../css/layout.css\1"', html)
    html = re.sub(r'href="css/main\.css([^"]*)"', r'href="../css/main.css\1"', html)
    html = html.replace('href="fonts/', 'href="../fonts/')
    html = html.replace("url('fonts/", "url('../fonts/")
    # root_paths() runs before this and may already have promoted favicon to /favicon.svg
    html = html.replace('href="/favicon.svg"', 'href="../favicon.svg"')
    html = re.sub(r'src="js/net-tier\.js([^"]*)"', r'src="../js/net-tier.js\1"', html)
    html = html.replace('src="js/analytics-env.js"', 'src="../js/analytics-env.js"')
    return html


def apply_pairs(html: str, pairs: list[tuple[str, str]]) -> str:
    for src, dst in sorted(pairs, key=lambda x: len(x[0]), reverse=True):
        html = html.replace(src, dst)
    return html


def patch_html_lang(html: str, lang: str) -> str:
    return re.sub(r"<html lang=\"[^\"]+\">", f'<html lang="{lang}">', html, count=1)


def patch_netlify_form(html: str, code: str) -> str:
    form_name = NETLIFY_FORM.get(code)
    if not form_name:
        return html
    html = html.replace('name="contact-en"', f'name="{form_name}"')
    html = html.replace('value="contact-en"', f'value="{form_name}"')
    return html


def load_en_reviews() -> list[dict]:
    path = ROOT / "data" / "reviews.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    reviews = data.get("reviews", [])
    if not reviews:
        raise SystemExit("data/reviews.json has no reviews")
    return reviews


def validate_locale_reviews(code: str, locale_reviews: list[dict], en_reviews: list[dict]) -> None:
    if len(locale_reviews) != len(en_reviews):
        raise SystemExit(
            f"{code}: REVIEWS length {len(locale_reviews)} != English {len(en_reviews)} "
            f"— update i18n/locales/{code}.py"
        )
    for i, (en, loc) in enumerate(zip(en_reviews, locale_reviews)):
        for key in ("author", "rating"):
            if en.get(key) != loc.get(key):
                raise SystemExit(
                    f"{code}: review[{i}] {key} mismatch "
                    f"(EN {en.get(key)!r} vs {loc.get(key)!r})"
                )
        if not (loc.get("text") or "").strip():
            raise SystemExit(f"{code}: review[{i}] missing translated text")


def write_locale_reviews(code: str, reviews: list[dict]) -> None:
    path = ROOT / "data" / f"reviews-{code}.json"
    path.write_text(
        json.dumps({"reviews": reviews}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def patch_reviews_fetch(html: str, code: str) -> str:
    return html.replace(
        "fetch((window.LY_BASE || '') + '/data/reviews.json')",
        f"fetch((window.LY_BASE || '') + '/data/reviews-{code}.json')",
    )


def patch_reviews_ui(html: str, ui: dict) -> str:
    html = html.replace("r.author || 'Guest'", f"r.author || '{ui['guest']}'")
    html = html.replace("' out of 5 stars'", f"'{ui['stars_suffix']}'")
    return html


def patch_reviews_fallback(html: str, review: dict) -> str:
    """Replace the English fallback review text in the catch block."""
    text = review["text"].replace("\\", "\\\\").replace('"', '\\"')
    return re.sub(
        r'text: "Our group of six had a fantastic day on Limitless[^"]*"',
        f'text: "{text}"',
        html,
        count=1,
    )


def patch_calendar(html: str, months: list[str], dow: list[str]) -> str:
    html = re.sub(
        r"var MONTHS = \[[^\]]+\];",
        "var MONTHS = " + json.dumps(months, ensure_ascii=False) + ";",
        html,
        count=1,
    )
    html = re.sub(
        r"var DOW = \[[^\]]+\];",
        "var DOW = " + json.dumps(dow, ensure_ascii=False) + ";",
        html,
        count=1,
    )
    return html


def build_index(locale_mod) -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = root_paths(html)
    html = patch_html_lang(html, locale_mod.LANG)
    html = patch_subfolder_assets(html)

    nav_lang, mobile_lang = lang_switcher_nav(locale_mod.CODE)
    html = re.sub(
        r'<div class="nav-lang-wrap" id="navLangWrap">[\s\S]*?</div>\s*(?:</div>\s*)?',
        nav_lang,
        html,
        count=1,
    )
    html = re.sub(
        r'<div class="mobile-lang" aria-label="[^"]*">.*?</div>',
        f'<div class="mobile-lang" aria-label="{ARIA[locale_mod.CODE]}">\n{mobile_lang}\n  </div>',
        html,
        count=1,
        flags=re.DOTALL,
    )

    html = apply_pairs(html, locale_mod.PAIRS)
    html = patch_netlify_form(html, locale_mod.CODE)
    html = patch_calendar(html, locale_mod.MONTHS, locale_mod.DOW)
    html = patch_reviews_fetch(html, locale_mod.CODE)
    html = patch_reviews_ui(html, locale_mod.REVIEWS_UI)
    html = patch_reviews_fallback(html, locale_mod.REVIEWS[0])
    return html


def build_legal(locale_mod) -> str:
    html = (ROOT / "legal.html").read_text(encoding="utf-8")
    html = html.replace('href="/favicon.svg"', 'href="../favicon.svg"')
    html = html.replace('href="favicon.svg"', 'href="../favicon.svg"')
    html = patch_html_lang(html, locale_mod.LANG)
    html = apply_pairs(html, locale_mod.LEGAL_PAIRS)
    html = html.replace('href="index.html"', 'href="../"')
    html = html.replace('href="css/main.css"', 'href="../css/main.css"')
    html = html.replace('src="js/analytics-env.js"', 'src="../js/analytics-env.js"')
    return html


def main() -> None:
    en_reviews = load_en_reviews()
    for code, mod in LOCALES.items():
        validate_locale_reviews(code, mod.REVIEWS, en_reviews)
        write_locale_reviews(code, mod.REVIEWS)
        out_dir = ROOT / code
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(build_index(mod), encoding="utf-8")
        (out_dir / "legal.html").write_text(build_legal(mod), encoding="utf-8")
        print(f"Wrote {code}/index.html, {code}/legal.html, data/reviews-{code}.json")


if __name__ == "__main__":
    main()