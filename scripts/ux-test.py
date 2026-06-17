#!/usr/bin/env python3
"""
Browser UX smoke tests — catch user-facing JavaScript errors and broken flows.

Exercises navigation anchors, booking-funnel links, the enquiry date picker, and
locale pages against a local static server. Fails on unexpected page errors or
console errors.

Usage:
  python3 scripts/ux-test.py
  python3 scripts/ux-test.py --quick   # home flows only (still includes mobile)
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
RESET = "\033[0m"

MOBILE_VIEWPORT = {"width": 390, "height": 844}
TABLET_VIEWPORT = {"width": 768, "height": 1024}
DESKTOP_VIEWPORT = {"width": 1280, "height": 900}

# Mobile menu links must keep section-top / calendar anchors (not -land variants).
MOBILE_NAV_HREFS = (
    ("a.mobile-nav-cta", "#enquire-form"),
    ('a[href="#about"]', "#about"),
    ('a[href="#itinerary"]', "#itinerary"),
    ('a[href="#gallery"]', "#gallery"),
    ('a[href="#charters"]', "#charters"),
    ('a[href="#avail-cal"]', "#avail-cal"),
    ('a[href="#reviews"]', "#reviews"),
    ('a[href="#amenities"]', "#amenities"),
    ('a[href="#specs"]', "#specs"),
)

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

    def add(self, message: str) -> None:
        self.issues.append(message)

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


def wait_for_hash(page, hash_fragment: str, timeout: float = 8000) -> None:
    page.wait_for_function(
        "(expected) => location.hash === expected",
        arg=hash_fragment,
        timeout=timeout,
    )


def open_mobile_menu(page) -> None:
    page.locator("#hamburger").click()
    page.wait_for_function(
        "() => {"
        "  const n = document.getElementById('mobileNav');"
        "  return n && !n.hidden && n.classList.contains('open');"
        "}"
    )


def expect_mobile_menu_closed(page) -> None:
    page.wait_for_function(
        "() => {"
        "  const n = document.getElementById('mobileNav');"
        "  return n && n.hidden && !n.classList.contains('open');"
        "}"
    )


def assert_mobile_nav_hrefs(page, scenario: str, issues: IssueCollector) -> None:
    open_mobile_menu(page)
    for selector, expected in MOBILE_NAV_HREFS:
        loc = page.locator(f"#mobileNav {selector}")
        if loc.count() == 0:
            issues.add(f"{scenario}: missing mobile nav link {selector}")
            continue
        actual = loc.first.get_attribute("href")
        if actual != expected:
            issues.add(
                f"{scenario}: mobile nav {selector} href is {actual!r}, expected {expected!r}"
            )
    page.locator("#mobileNav .mobile-nav-close").click()
    expect_mobile_menu_closed(page)


def click_mobile_nav_link(page, href: str) -> None:
    open_mobile_menu(page)
    page.locator(f'#mobileNav a[href="{href}"]').click()
    wait_for_hash(page, href)
    expect_mobile_menu_closed(page)


def assert_single_visible_primary_cta(page, section_id: str, scenario: str, issues: IssueCollector) -> None:
    page.locator(f"#{section_id}").scroll_into_view_if_needed()
    count = page.locator(
        f"#{section_id} .section-cta-btns a.btn-primary:visible"
    ).count()
    if count != 1:
        issues.add(
            f"{scenario}: expected 1 visible availability CTA in #{section_id}, found {count}"
        )


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
    name = "home desktop"
    issues.attach(page, name)
    page.set_viewport_size(DESKTOP_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1200)

    # Desktop header uses -land anchors for section labels.
    page.locator('.nav-links a[href="#charters-land"]').click()
    wait_for_hash(page, "#charters-land")

    page.locator("#itinerary").scroll_into_view_if_needed()
    page.locator(".destination-card").first.click()
    page.wait_for_selector("#dest-lightbox.open", timeout=10000)
    if page.locator("#dest-lb-cta-avail").count():
        issues.add(f"{name}: destination lightbox should not show a second CTA on desktop")
    page.locator("#dest-lb-cta").click()
    page.wait_for_function(
        "() => {"
        "  const el = document.getElementById('contactForm');"
        "  if (!el) return false;"
        "  const t = el.getBoundingClientRect().top;"
        "  return location.hash === '#enquire-land' && t >= 0 && t <= 420;"
        "}",
        timeout=8000,
    )
    form_top = page.locator("#contactForm").evaluate(
        "el => el.getBoundingClientRect().top"
    )
    if form_top < 0 or form_top > 420:
        issues.add(f"{name}: enquire CTA landed with form top at {form_top:.0f}px")
    focused = page.evaluate("document.activeElement && document.activeElement.id")
    if focused != "name":
        issues.add(f"{name}: enquire CTA should focus the name field on desktop")

    page.locator("#availability").scroll_into_view_if_needed()
    wait_for_calendar(page)

    # Cross-nav ghost buttons stay on one row and route into the booking flow.
    page.locator("#charters").scroll_into_view_if_needed()
    cross_avail = page.locator(
        '#charters .section-cross-cta--desktop a[href="#availability"]'
    )
    if not cross_avail.is_visible():
        issues.add(f"{name}: charters cross-nav availability link not visible on desktop")
    else:
        cross_avail.click()
        wait_for_hash(page, "#availability")
        if page.locator("#availCal").count() == 0:
            issues.add(f"{name}: availability cross-nav did not reach calendar section")

    page.locator("#preferred_date_btn").scroll_into_view_if_needed()
    page.locator("#preferred_date_btn").click()
    popover = page.locator("#formDatePopover")
    popover.wait_for(state="visible", timeout=5000)

    page.locator("#formDatePopover .form-date-next").click()
    page.locator("#formDatePopover .form-date-prev").click()
    if click_first_free_day(page, "#formDatePopover"):
        page.wait_for_timeout(600)
        visible = page.locator("#formDurWrap").evaluate("el => !el.hidden")
        if not visible:
            issues.add(
                f"{name}: duration field did not appear after single-day pick"
            )

    page.locator("#formDatePopoverDismiss").click()
    page.wait_for_function(
        "() => document.getElementById('formDatePopover').hidden",
        timeout=5000,
    )

    # Desktop cross-nav must stay hidden on wide viewports (mobile-only cluster).
    if page.locator("#about .section-forward-cta:visible").count():
        issues.add(f"{name}: about forward CTA should be hidden on desktop")


def scenario_home_tablet(page, base: str, issues: IssueCollector) -> None:
    name = "home tablet"
    issues.attach(page, name)
    page.set_viewport_size(TABLET_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(800)

    page.locator("#itinerary").scroll_into_view_if_needed()
    page.locator(".destination-card").first.click()
    page.wait_for_selector("#dest-lightbox.open", timeout=10000)

    layout = page.evaluate(
        "() => {"
        "  const lb = document.getElementById('dest-lightbox');"
        "  if (!lb) return null;"
        "  const style = getComputedStyle(lb);"
        "  const img = lb.querySelector('.dest-lb-img-wrap');"
        "  const body = lb.querySelector('.dest-lb-body');"
        "  if (!img || !body) return null;"
        "  const imgRect = img.getBoundingClientRect();"
        "  const bodyRect = body.getBoundingClientRect();"
        "  return {"
        "    flexDirection: style.flexDirection,"
        "    stacked: bodyRect.top >= imgRect.bottom - 2,"
        "  };"
        "}"
    )
    if not layout or layout.get("flexDirection") != "column":
        issues.add(f"{name}: destination lightbox should use stacked layout on tablet")
    elif not layout.get("stacked"):
        issues.add(f"{name}: destination lightbox body should sit below image on tablet")

    space = page.evaluate(
        "() => {"
        "  const img = document.querySelector('.dest-lb-img-wrap');"
        "  const body = document.querySelector('.dest-lb-body');"
        "  if (!img || !body) return null;"
        "  const imgH = img.getBoundingClientRect().height;"
        "  const bodyH = body.getBoundingClientRect().height;"
        "  const pad = parseFloat(getComputedStyle(body).paddingTop)"
        "    + parseFloat(getComputedStyle(body).paddingBottom);"
        "  let contentH = 0;"
        "  body.querySelectorAll('.dest-lb-num,.dest-lb-name,.dest-lb-tagline,.dest-lb-desc,.dest-lb-meta,.dest-lb-actions')"
        "    .forEach((el) => { contentH += el.getBoundingClientRect().height; });"
        "  return { imgShare: imgH / window.innerHeight, bodySlack: bodyH - contentH - pad };"
        "}"
    )
    if not space:
        issues.add(f"{name}: could not measure destination lightbox space usage")
    elif space.get("imgShare", 0) < 0.58:
        issues.add(
            f"{name}: destination image should dominate tablet lightbox "
            f"(share={space.get('imgShare', 0):.2f})"
        )
    elif space.get("bodySlack", 0) > 72:
        issues.add(
            f"{name}: destination body panel has too much empty space "
            f"(slack={space.get('bodySlack', 0):.0f}px)"
        )

    href = page.locator("#dest-lb-cta").get_attribute("href")
    if href != "#avail-cal":
        issues.add(f"{name}: destination lightbox CTA should target calendar on tablet")
    page.locator("#dest-lb-cta").click()
    page.wait_for_timeout(800)
    page.wait_for_function("() => location.hash === '#avail-cal'", timeout=8000)
    cal_top = page.locator("#availCal").evaluate("el => el.getBoundingClientRect().top")
    if cal_top < 55 or cal_top > 260:
        issues.add(f"{name}: calendar CTA landed with cal top at {cal_top:.0f}px")


def scenario_home_mobile(page, base: str, issues: IssueCollector) -> None:
    name = "home mobile"
    issues.attach(page, name)
    page.set_viewport_size(MOBILE_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(800)

    assert_mobile_nav_hrefs(page, name, issues)

    for href in ("#enquire-form", "#avail-cal", "#charters"):
        click_mobile_nav_link(page, href)

    # Mobile-only forward links between sections.
    page.locator("#about").scroll_into_view_if_needed()
    forward = page.locator('#about .section-forward-cta a[href="#charters"]')
    if not forward.is_visible():
        issues.add(f"{name}: about forward link to charters not visible on mobile")
    else:
        forward.click()
        wait_for_hash(page, "#charters")

    page.locator("#amenities").scroll_into_view_if_needed()
    forward_avail = page.locator('#amenities .section-forward-cta a[href="#avail-cal"]')
    if not forward_avail.is_visible():
        issues.add(f"{name}: amenities forward link to calendar not visible on mobile")
    else:
        forward_avail.click()
        wait_for_hash(page, "#avail-cal")

    # Regression guard: only one availability CTA in reviews/specs on mobile.
    assert_single_visible_primary_cta(page, "reviews", name, issues)
    assert_single_visible_primary_cta(page, "specs", name, issues)

    # Desktop-only cross-nav and duplicate desktop availability buttons stay hidden.
    if page.locator(".section-cross-cta--desktop:visible").count():
        issues.add(f"{name}: desktop cross-nav should be hidden on mobile")
    if page.locator(".section-cta-avail--desktop:visible").count():
        issues.add(f"{name}: desktop availability CTA should be hidden on mobile")

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
    name = "locale de"
    issues.attach(page, name)
    page.set_viewport_size(DESKTOP_VIEWPORT)
    page.goto(base + "/de/", wait_until="domcontentloaded", timeout=60000)
    page.locator("#preferred_date_btn").wait_for(timeout=10000)
    page.locator("#availability").scroll_into_view_if_needed()
    wait_for_calendar(page)

    page.set_viewport_size(MOBILE_VIEWPORT)
    page.reload(wait_until="domcontentloaded", timeout=60000)
    assert_mobile_nav_hrefs(page, f"{name} mobile", issues)
    click_mobile_nav_link(page, "#avail-cal")


def scenario_legal(page, base: str, issues: IssueCollector) -> None:
    name = "legal en"
    issues.attach(page, name)
    page.set_viewport_size(DESKTOP_VIEWPORT)
    page.goto(base + "/legal.html", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("a[href]", timeout=10000)


def run_scenarios(base_url: str, quick: bool = False) -> list[str]:
    sync_playwright = require_playwright()
    issues = IssueCollector()
    scenarios = [
        scenario_home_desktop,
        scenario_home_tablet,
        scenario_home_mobile,
    ]
    if not quick:
        scenarios.extend([scenario_locale_de, scenario_legal])

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        for fn in scenarios:
            page = context.new_page()
            label = fn.__name__.replace("scenario_", "").replace("_", " ")
            try:
                fn(page, base_url, issues)
                print(f"  {GREEN}✓{RESET}  {label}")
            except Exception as exc:  # noqa: BLE001
                issues.add(f"{label}: scenario failed — {exc}")
                print(f"  {RED}✗{RESET}  {label} — {exc}")
            finally:
                page.close()
        browser.close()

    return issues.issues


def main() -> int:
    parser = argparse.ArgumentParser(description="UX / JS error smoke tests")
    parser.add_argument("--url", help="Existing site URL (skip local server)")
    parser.add_argument("--root", default=ROOT, help="Site root to serve")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Home desktop + mobile only (skip locale and legal)",
    )
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