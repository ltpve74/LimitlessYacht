#!/usr/bin/env python3
"""Merge Click&Boat listing reviews into data/reviews.json.

Fetches both default listings (same URLs as netlify/functions/reviews.mjs),
keeps manually curated entries (authors listed in MANUAL_AUTHORS), and writes
sorted newest-first JSON for the static site.

Usage:
  python3 scripts/sync_reviews.py          # dry-run summary
  python3 scripts/sync_reviews.py --write  # update data/reviews.json
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVIEWS_PATH = ROOT / "data" / "reviews.json"

DEFAULT_LISTINGS = [
    "https://www.clickandboat.com/en/activities/mallorca/half-day-mallorca-yacht-cruise-with-swim-stops-sea-toys-18390",
    "https://www.clickandboat.com/en/activities/mallorca/mallorca-yacht-experience-full-day-coastal-escape-with-water-toys-18387",
]
UA = "LimitlessYacht/1.0 (+https://limitlessyachtcharter.com)"

# Guest reviews added/edited on-site — never dropped on sync.
MANUAL_AUTHORS = frozenset({"Sebastien", "Maurice"})

MONTHS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
MONTH_INDEX = {m: i for i, m in enumerate(MONTHS)}


def fetch_listing(url: str) -> list[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as res:
        page = res.read().decode("utf-8", errors="replace")
    return parse_review_items(page)


def decode_html(text: str) -> str:
    text = html_lib.unescape(text)
    return (
        text.replace("\xa0", " ")
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )


def format_review_date(raw: str) -> str:
    cleaned = re.sub(r"\s+", " ", raw).strip()
    if not cleaned:
        return ""
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", cleaned)
    if not m:
        return cleaned
    month = MONTHS[int(m.group(1)) - 1] if 1 <= int(m.group(1)) <= 12 else m.group(1)
    year = m.group(3)
    if len(year) == 2:
        year = f"20{year}"
    return f"{month} {year}"


def parse_review_items(page: str) -> list[dict]:
    reviews: list[dict] = []
    block_re = re.compile(r'aria-label="Review #(\d+)"[\s\S]*?</li>')
    text_re = re.compile(r"line-clamp-4[^>]*>\s*([\s\S]*?)\s*</div>")
    author_re = re.compile(r'font-medium text-neutral-800">\s*([^<]+?)\s*</div>')
    date_re = re.compile(r"Date of the review\s*([^<]+)")

    for block in block_re.finditer(page):
        chunk = block.group(0)
        author_m = author_re.search(chunk)
        date_m = date_re.search(chunk)
        text_m = text_re.search(chunk)
        if not text_m:
            continue
        text = re.sub(r"<[^>]+>", "", text_m.group(1))
        text = decode_html(re.sub(r"\s+", " ", text).strip())
        if len(text) < 80:
            continue
        reviews.append(
            {
                "author": author_m.group(1).strip() if author_m else "Guest",
                "date": format_review_date(date_m.group(1) if date_m else ""),
                "rating": 5,
                "text": text,
            }
        )
    return reviews


def review_key(review: dict) -> str:
    return review["text"][:80]


def sort_key(review: dict) -> float:
    m = re.match(r"([A-Za-z]+)\s+(\d{4})", review.get("date", ""))
    if not m:
        return 0.0
    month = MONTH_INDEX.get(m.group(1), 0)
    return datetime(int(m.group(2)), month + 1, 1).timestamp()


def load_current() -> list[dict]:
    if not REVIEWS_PATH.exists():
        return []
    data = json.loads(REVIEWS_PATH.read_text(encoding="utf-8"))
    return data.get("reviews", [])


def merge_reviews(cnb_reviews: list[dict], current: list[dict]) -> list[dict]:
    manual = [r for r in current if r.get("author") in MANUAL_AUTHORS]
    manual_keys = {review_key(r) for r in manual}

    merged: list[dict] = []
    seen: set[str] = set()

    for review in manual:
        key = review_key(review)
        if key in seen:
            continue
        seen.add(key)
        merged.append(review)

    for review in cnb_reviews:
        if review.get("author") in MANUAL_AUTHORS:
            continue
        key = review_key(review)
        if key in seen or key in manual_keys:
            continue
        seen.add(key)
        merged.append(review)

    merged.sort(key=sort_key, reverse=True)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Write data/reviews.json")
    args = parser.parse_args()

    cnb: list[dict] = []
    seen_cnb: set[str] = set()
    for url in DEFAULT_LISTINGS:
        for review in fetch_listing(url):
            key = review_key(review)
            if key in seen_cnb:
                continue
            seen_cnb.add(key)
            cnb.append(review)

    current = load_current()
    merged = merge_reviews(cnb, current)

    print(f"Click&Boat: {len(cnb)} unique review(s)")
    for r in cnb:
        print(f"  · {r['author']} ({r['date']})")
    print(f"Manual keep: {sorted(MANUAL_AUTHORS)}")
    print(f"Merged total: {len(merged)} review(s)")
    for r in merged:
        print(f"  · {r['author']} ({r['date']})")

    if args.write:
        REVIEWS_PATH.write_text(
            json.dumps({"reviews": merged}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {REVIEWS_PATH.relative_to(ROOT)}")
    else:
        print("Dry run — pass --write to update data/reviews.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())