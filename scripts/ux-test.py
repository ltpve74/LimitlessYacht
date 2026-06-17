#!/usr/bin/env python3
"""
Browser UX smoke tests — catch user-facing JavaScript errors and broken flows.

Exercises the enquiry form date picker, availability calendar, and locale pages
against a local static server. Fails on unexpected page errors or console errors.

Usage:
  python3 scripts/ux-test.py
  python3 scripts/ux-test.py --quick   # home page only
"""

from __future__ import annotations

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
sys.path.insert(0, SCRIPTS)

from site_server import serve_site  # noqa: E402

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

ALLOWED_CONSOLE = [
    re.compile(r"failed to load resource", re.I),
    re.compile(r"the server responded with a status of 404", re.I),
    re.compile(r"/api/availability", re.I),
    re.compile(r"net::err_", re.I),
    re.compile(r"fetch.*availability", re.I),
]


class IssueCollector:
    def __init__(self) -> None:
        self.issues: list[str] = []

    def attach(self, page, scenario: str) -> None:
        def on_page_error(exc: Exception) -> None:
            self.issues.append(f"{scenario}: page error — {exc}")

        def on_console(msg) -> None:
            if msg.type != "error":
                return
            text = msg.text
            if any(pat.search(text) for pat in ALLOWED_CONSOLE):
                return
            self.issues.append(f"{scenario}: console error — {text}")

        page.on("pageerror", on_page_error)
        page.on("console", on_console)


def require_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright is required. Run:\n"
            "  python3 -m venv .venv\n"
            "  .venv/bin/pip install -r scripts/dev-requirements.txt\n"
            "  .venv/bin/python -m playwright install chromium"
        ) from exc
    return sync_playwright


def wait_for_calendar(page) -> None:
    page.wait_for_selector("#availCal .cal-days .cal-cell", timeout=15000)


def click_first_free_day(page, scope: str) -> bool:
    cell = page.locator(f"{scope} .cal-cell.free[data-date]").first
    if cell.count() == 0:
        return False
    cell.click()
    return True


def scenario_home_desktop(page, base: str, issues: IssueCollector) -> None:
    name = "home / desktop / enquiry date picker"
    issues.attach(page, name)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)

    page.locator("#availability").scroll_into_view_if_needed()
    wait_for_calendar(page)

    page.locator("#preferred_date_btn").scroll_into_view_if_needed()
    page.locator("#preferred_date_btn").click()
    popover = page.locator("#formDatePopover")
    popover.wait_for(state="visible", timeout=5000)

    page.locator("#formDatePopover .form-date-next").click()
    page.locator("#formDatePopover .form-date-prev").click()
    if click_first_free_day(page, "#formDatePopover"):
        # pickFormDate sets formDatePickGuard for ~450ms before dismiss works
        page.wait_for_timeout(600)
        visible = page.locator("#formDurWrap").evaluate("el => !el.hidden")
        if not visible:
            issues.issues.append(
                f"{name}: duration field did not appear after single-day pick"
            )

    page.locator("#formDatePopoverDismiss").click()
    page.wait_for_function(
        "() => document.getElementById('formDatePopover').hidden",
        timeout=5000,
    )


def scenario_home_mobile(page, base: str, issues: IssueCollector) -> None:
    name = "home / mobile / date picker"
    issues.attach(page, name)
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.locator("#preferred_date_btn").scroll_into_view_if_needed()
    page.locator("#preferred_date_btn").click()
    page.locator("#formDatePopover").wait_for(state="visible", timeout=5000)
    click_first_free_day(page, "#formDatePopover")
    page.wait_for_timeout(600)
    page.locator("#formDatePopoverDismiss").click()
    page.wait_for_function(
        "() => document.getElementById('formDatePopover').hidden",
        timeout=5000,
    )


def scenario_locale_de(page, base: str, issues: IssueCollector) -> None:
    name = "de / desktop"
    issues.attach(page, name)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(base + "/de/", wait_until="domcontentloaded", timeout=60000)
    page.locator("#preferred_date_btn").wait_for(timeout=10000)
    page.locator("#availability").scroll_into_view_if_needed()
    wait_for_calendar(page)


def scenario_legal(page, base: str, issues: IssueCollector) -> None:
    name = "legal / en"
    issues.attach(page, name)
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(base + "/legal.html", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("a[href]", timeout=10000)


def run_scenarios(base_url: str, quick: bool = False) -> list[str]:
    sync_playwright = require_playwright()
    issues = IssueCollector()
    scenarios = [
        scenario_home_desktop,
        scenario_home_mobile,
    ]
    if not quick:
        scenarios.extend([scenario_locale_de, scenario_legal])

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        for fn in scenarios:
            page = context.new_page()
            try:
                fn(page, base_url, issues)
                print(f"  {GREEN}✓{RESET}  {fn.__name__.replace('scenario_', '').replace('_', ' ')}")
            except Exception as exc:  # noqa: BLE001
                issues.issues.append(f"{fn.__name__}: scenario failed — {exc}")
                print(f"  {RED}✗{RESET}  {fn.__name__} — {exc}")
            finally:
                page.close()
        browser.close()

    return issues.issues


def main() -> int:
    parser = argparse.ArgumentParser(description="UX / JS error smoke tests")
    parser.add_argument("--url", help="Existing site URL (skip local server)")
    parser.add_argument("--root", default=ROOT, help="Site root to serve")
    parser.add_argument("--quick", action="store_true", help="Run only core flows")
    args = parser.parse_args()

    print(f"{GREEN}UX smoke tests{RESET}")
    if args.url:
        failures = run_scenarios(args.url.rstrip("/"), quick=args.quick)
    else:
        with serve_site(args.root) as base_url:
            failures = run_scenarios(base_url, quick=args.quick)

    if failures:
        print(f"\n{RED}FAILED  {len(failures)} UX issue(s):{RESET}")
        for item in failures:
            print(f"  • {item}")
        return 1

    print(f"\n{GREEN}PASSED  UX smoke tests{RESET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())