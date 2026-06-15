#!/usr/bin/env python3
"""
Gap analysis: find English strings that survive untranslated in locale pages.

Approach:
1. Extract all visible user-facing strings from English index.html
2. For each locale (de/fr/es), check which English strings are still present
3. Group findings by page section
"""

from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ─── Proper nouns / brand names to skip ─────────────────────────────────────
SKIP_TERMS = {
    "Limitless", "Mallorca", "Palma", "Ibiza", "Formentera", "Menorca",
    "Sa Calobra", "Click&Boat", "Seabob", "Maiora", "Club de Mar", "Netlify",
    "Cabrera", "Portals Vells", "El Toro", "Malgrats", "Cala Llamp",
    "Cala Pi", "Calo des Moro", "Caló des Moro", "Sa Dragonera", "Es Trenc",
    "Mediterranean", "WhatsApp", "Google", "GTM", "EN", "DE", "FR", "ES",
    "Palma de Mallorca", "Balearic", "Calvià",
    # Single-character or numeric-only
}

# Short strings below this length are often noise (icons, separators)
MIN_LEN = 3

LOCALES = ["de", "fr", "es"]


def clean_text(t: str) -> str:
    return " ".join(t.split())


def is_skippable(text: str) -> bool:
    t = text.strip()
    if len(t) < MIN_LEN:
        return True
    # Skip if purely numeric / punctuation / symbols
    if re.fullmatch(r'[\d\s\.\,\:\;\-\–\—\+\/\\\*\&\%\€\$\|\·\~\^\@\!\?\(\)\[\]]+', t):
        return True
    # Skip if it IS one of the proper nouns (exact match)
    if t in SKIP_TERMS:
        return True
    # Skip obvious CSS / HTML fragments
    if re.search(r'[{}<>]|^\s*\.|^\s*#', t):
        return True
    return False


def extract_text_nodes(html: str) -> list[str]:
    """Extract text nodes from HTML, excluding script/style/noscript blocks."""
    # Remove script blocks
    html_clean = re.sub(r'<script\b[^>]*>.*?</script>', ' ', html, flags=re.DOTALL | re.IGNORECASE)
    # Remove style blocks
    html_clean = re.sub(r'<style\b[^>]*>.*?</style>', ' ', html_clean, flags=re.DOTALL | re.IGNORECASE)
    # Remove noscript blocks
    html_clean = re.sub(r'<noscript\b[^>]*>.*?</noscript>', ' ', html_clean, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML comments
    html_clean = re.sub(r'<!--.*?-->', ' ', html_clean, flags=re.DOTALL)
    # Extract text between tags
    texts = re.findall(r'>([^<]+)<', html_clean)
    # Decode HTML entities
    results = []
    for t in texts:
        t = t.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
        t = clean_text(t)
        if t:
            results.append(t)
    return results


def extract_attr_values(html: str) -> list[tuple[str, str]]:
    """Extract relevant attribute values: placeholder, aria-label, title, alt (non-empty meaningful ones)."""
    html_clean = re.sub(r'<script\b[^>]*>.*?</script>', ' ', html, flags=re.DOTALL | re.IGNORECASE)
    html_clean = re.sub(r'<style\b[^>]*>.*?</style>', ' ', html_clean, flags=re.DOTALL | re.IGNORECASE)
    attrs_of_interest = ['placeholder', 'aria-label', 'title', 'value']
    results = []
    for attr in attrs_of_interest:
        pattern = rf'{attr}="([^"]+)"'
        for m in re.finditer(pattern, html_clean, re.IGNORECASE):
            v = clean_text(m.group(1))
            results.append((attr, v))
    return results


def find_section(line_num: int, section_map: list[tuple[int, str]]) -> str:
    """Given a line number, return the section name."""
    section = "Header/Meta"
    for start, name in section_map:
        if line_num >= start:
            section = name
        else:
            break
    return section


def build_section_map(en_html: str) -> list[tuple[int, str]]:
    """Build a map of (line_number, section_name) from HTML comments/ids."""
    lines = en_html.split('\n')
    section_map = []
    section_patterns = [
        (r'<!--\s*NAV\s*-->', "NAV"),
        (r'<!--\s*MOBILE NAV\s*-->', "MOBILE NAV"),
        (r'<!--\s*HERO\s*-->', "HERO"),
        (r'<!--\s*INTRO STRIP\s*-->', "INTRO STRIP"),
        (r'<!--\s*ABOUT\s*-->', "ABOUT"),
        (r'<!--\s*ITINERARY', "DESTINATIONS/ITINERARY"),
        (r'<!--\s*SPECS\s*-->', "SPECS/DETAILS"),
        (r'<!--\s*GALLERY\s*-->', "GALLERY"),
        (r'<!--\s*AMENITIES\s*-->', "AMENITIES"),
        (r'<!--\s*ENQUIR', "ENQUIRY CARDS"),
        (r'<!--\s*AVAILABILITY\s*-->', "AVAILABILITY"),
        (r'<!--\s*CONTACT\s*-->', "CONTACT/FORM"),
        (r'<!--\s*REVIEWS\s*-->', "REVIEWS"),
        (r'<!--\s*FOOTER\s*-->', "FOOTER"),
        (r'<!--\s*COOKIE\s*-->', "COOKIE BANNER"),
        (r'id="navbar"', "NAV"),
        (r'id="hero"', "HERO"),
        (r'id="intro"', "INTRO STRIP"),
        (r'id="about"', "ABOUT"),
        (r'id="itinerary"', "DESTINATIONS/ITINERARY"),
        (r'id="specs"', "SPECS/DETAILS"),
        (r'id="gallery"', "GALLERY"),
        (r'id="amenities"', "AMENITIES"),
        (r'id="enquire"', "ENQUIRY CARDS"),
        (r'id="availability"', "AVAILABILITY"),
        (r'id="contact"', "CONTACT/FORM"),
        (r'id="reviews"', "REVIEWS"),
        (r'<footer', "FOOTER"),
        (r'cookie', "COOKIE BANNER"),
    ]
    for i, line in enumerate(lines):
        for pat, name in section_patterns:
            if re.search(pat, line, re.IGNORECASE):
                section_map.append((i + 1, name))
                break
    section_map.sort(key=lambda x: x[0])
    return section_map


def find_string_in_html_with_section(text: str, html: str, section_map: list[tuple[int, str]]) -> str | None:
    """Find which section of the English HTML a string belongs to."""
    lines = html.split('\n')
    for i, line in enumerate(lines):
        if text in line:
            return find_section(i + 1, section_map)
    return None


def extract_js_strings(html: str) -> list[str]:
    """Extract user-visible strings from <script> blocks (success/error messages, UI strings)."""
    results = []
    scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', html, flags=re.DOTALL | re.IGNORECASE)
    for script in scripts:
        # Look for quoted strings that look like user messages (longer than 10 chars, contain spaces)
        for m in re.finditer(r"['\"]([A-Z][a-z][\w\s,!\.'\-]{10,})['\"]", script):
            t = m.group(1)
            if ' ' in t:
                results.append(t)
    return results


def extract_select_options(html: str) -> list[str]:
    """Extract option text from select elements."""
    html_clean = re.sub(r'<script\b[^>]*>.*?</script>', ' ', html, flags=re.DOTALL | re.IGNORECASE)
    options = re.findall(r'<option[^>]*>([^<]+)</option>', html_clean, re.IGNORECASE)
    return [clean_text(o) for o in options if clean_text(o)]


def main():
    en_path = ROOT / "index.html"
    en_html = en_path.read_text(encoding="utf-8")

    locale_htmls = {}
    for loc in LOCALES:
        p = ROOT / loc / "index.html"
        locale_htmls[loc] = p.read_text(encoding="utf-8")

    section_map = build_section_map(en_html)

    # Extract all text nodes from English
    en_texts = extract_text_nodes(en_html)
    en_attr_values = extract_attr_values(en_html)
    en_options = extract_select_options(en_html)
    en_js_strings = extract_js_strings(en_html)

    # Deduplicate while preserving order
    seen = set()
    all_en_strings = []
    for t in en_texts + en_options + en_js_strings:
        if t not in seen and not is_skippable(t):
            seen.add(t)
            all_en_strings.append(('text', t))

    for attr, v in en_attr_values:
        if v not in seen and not is_skippable(v):
            seen.add(v)
            all_en_strings.append((f'attr:{attr}', v))

    # For each English string, check which locales still contain it
    gaps = {}  # section -> list of (type, string, [locales_with_gap])

    for kind, en_str in all_en_strings:
        missing_in = []
        for loc in LOCALES:
            loc_html = locale_htmls[loc]
            # For attributes, check the raw HTML; for text, also check raw HTML
            if en_str in loc_html:
                missing_in.append(loc)

        if missing_in:
            section = find_string_in_html_with_section(en_str, en_html, section_map) or "UNKNOWN"
            if section not in gaps:
                gaps[section] = []
            gaps[section].append((kind, en_str, missing_in))

    # Print report
    print("=" * 80)
    print("GAP ANALYSIS: English strings surviving untranslated in locale pages")
    print("=" * 80)
    print(f"\nTotal unique English user-facing strings checked: {len(all_en_strings)}")

    total_gaps = sum(len(v) for v in gaps.values())
    print(f"Total strings with at least one locale gap: {total_gaps}")
    print()

    # Preferred section order
    section_order = [
        "NAV", "MOBILE NAV", "HERO", "INTRO STRIP", "ABOUT",
        "DESTINATIONS/ITINERARY", "SPECS/DETAILS", "GALLERY", "AMENITIES",
        "ENQUIRY CARDS", "AVAILABILITY", "CONTACT/FORM", "REVIEWS",
        "FOOTER", "COOKIE BANNER", "UNKNOWN", "Header/Meta"
    ]

    printed_sections = set()
    for sec in section_order:
        if sec in gaps:
            printed_sections.add(sec)
            items = gaps[sec]
            print(f"{'─' * 80}")
            print(f"SECTION: {sec}  ({len(items)} gap(s))")
            print(f"{'─' * 80}")
            for kind, text, locs in items:
                loc_str = "/".join(locs)
                prefix = f"[{kind}]" if kind.startswith("attr:") else "[text]"
                # Truncate very long strings for readability
                display = text if len(text) <= 120 else text[:117] + "..."
                print(f"  {prefix} [{loc_str}]  {repr(display)}")
            print()

    # Catch any sections not in the ordered list
    for sec, items in gaps.items():
        if sec not in printed_sections:
            print(f"{'─' * 80}")
            print(f"SECTION: {sec}  ({len(items)} gap(s))")
            print(f"{'─' * 80}")
            for kind, text, locs in items:
                loc_str = "/".join(locs)
                prefix = f"[{kind}]" if kind.startswith("attr:") else "[text]"
                display = text if len(text) <= 120 else text[:117] + "..."
                print(f"  {prefix} [{loc_str}]  {repr(display)}")
            print()

    print("=" * 80)
    print("END OF REPORT")
    print("=" * 80)


if __name__ == "__main__":
    main()
