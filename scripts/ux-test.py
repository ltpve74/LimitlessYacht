#!/usr/bin/env python3
"""
Browser UX smoke tests — catch user-facing JavaScript errors and broken flows.

Exercises navigation anchors, booking-funnel links, cookie consent, gallery
lightbox, reviews load, calendar selection, full-page scroll journeys, and
locale pages against a local static server. Fails on unexpected page errors or
console errors.

Usage:
  python3 scripts/ux-test.py
  python3 scripts/ux-test.py --quick      # skip locale/legal-only scenarios
  python3 scripts/ux-test.py --thorough   # repeat key journeys for extra coverage
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
LARGE_PHONE_VIEWPORT = {"width": 412, "height": 915}
LARGE_PHONE_TALL_VIEWPORT = {"width": 430, "height": 932}
TABLET_VIEWPORT = {"width": 768, "height": 1024}
IPAD_AIR_VIEWPORT = {"width": 820, "height": 1180}
IPAD_PRO_VIEWPORT = {"width": 834, "height": 1194}
DESKTOP_VIEWPORT = {"width": 1280, "height": 900}

COOKIE_TEST_VIEWPORTS = (
    ("mobile 390", MOBILE_VIEWPORT),
    ("large phone 412", LARGE_PHONE_VIEWPORT),
    ("iphone 14 pro max", LARGE_PHONE_TALL_VIEWPORT),
    ("tablet 768", TABLET_VIEWPORT),
    ("ipad air", IPAD_AIR_VIEWPORT),
    ("ipad pro 11", IPAD_PRO_VIEWPORT),
    ("desktop 1280", DESKTOP_VIEWPORT),
)

# Mobile menu links must keep section-top / calendar anchors (not -land variants).
MOBILE_NAV_HREFS = (
    ('a[href="#about"]', "#about"),
    ('a[href="#itinerary-funnel"]', "#itinerary-funnel"),
    ('a[href="#gallery-funnel"]', "#gallery-funnel"),
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
    re.compile(r"\[Limitless\]", re.I),
    re.compile(r"clarity\.ms", re.I),
    re.compile(r"googletagmanager", re.I),
    re.compile(r"CORS policy", re.I),
]

BOOKING_SECTION_IDS = (
    "#about",
    "#itinerary",
    "#gallery",
    "#charters",
    "#availability",
    "#reviews",
    "#amenities",
    "#specs",
    ".enquire-section",
)

CONSENT_CLEAR_INIT = (
    "try { localStorage.removeItem('ly_consent'); } catch (e) {}"
)


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


def reveal_mobile_nav_if_needed(page) -> None:
    """Cinema hero hides nav until the user scrolls past the hero on mobile."""
    hamburger = page.locator("#hamburger")
    if hamburger.is_visible():
        return
    page.evaluate(
        "() => window.scrollTo({ top: window.innerHeight + 8, behavior: 'instant' })"
    )
    page.wait_for_function(
        "() => {"
        "  const h = document.getElementById('hamburger');"
        "  if (!h) return false;"
        "  const s = getComputedStyle(h);"
        "  return s.visibility !== 'hidden' && s.display !== 'none' && h.offsetParent !== null;"
        "}",
        timeout=8000,
    )


def open_mobile_menu(page) -> None:
    reveal_mobile_nav_if_needed(page)
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


def expected_mobile_quote_href(page) -> str:
    return page.evaluate(
        "() => (window.LY_enquireQuoteHref ? window.LY_enquireQuoteHref() : '#enquire-form')"
    )


def assert_mobile_nav_hrefs(page, scenario: str, issues: IssueCollector) -> None:
    open_mobile_menu(page)
    quote = page.locator("#mobileNav a.mobile-nav-cta")
    if quote.count() == 0:
        issues.add(f"{scenario}: missing mobile nav link a.mobile-nav-cta")
    else:
        expected = expected_mobile_quote_href(page)
        actual = quote.first.get_attribute("href")
        if actual != expected:
            issues.add(
                f"{scenario}: mobile nav a.mobile-nav-cta href is {actual!r}, expected {expected!r}"
            )
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


def scroll_through_page(page, steps: int = 14, pause_ms: int = 120) -> None:
    page.evaluate(
        "({ steps, pause }) => new Promise((resolve) => {"
        "  let i = 0;"
        "  function tick() {"
        "    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);"
        "    window.scrollTo({ top: Math.round(max * (i / steps)), behavior: 'instant' });"
        "    i += 1;"
        "    if (i > steps) { resolve(); return; }"
        "    setTimeout(tick, pause);"
        "  }"
        "  tick();"
        "})",
        {"steps": steps, "pause": pause_ms},
    )


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
    desktop_lb = page.evaluate(
        "() => {"
        "  const lb = document.getElementById('dest-lightbox');"
        "  const main = lb && lb.querySelector('.dest-lb-main');"
        "  const img = lb && lb.querySelector('.dest-lb-img-wrap');"
        "  const body = lb && lb.querySelector('.dest-lb-body');"
        "  const close = document.getElementById('dest-lb-close');"
        "  const prev = document.getElementById('dest-lb-prev');"
        "  const next = document.getElementById('dest-lb-next');"
        "  const title = document.querySelector('.dest-lb-name');"
        "  if (!lb || !main || !img || !body || !close || !prev || !next) return null;"
        "  const lbRect = lb.getBoundingClientRect();"
        "  const imgRect = img.getBoundingClientRect();"
        "  const bodyRect = body.getBoundingClientRect();"
        "  const prevRect = prev.getBoundingClientRect();"
        "  const nextRect = next.getBoundingClientRect();"
        "  const titleRect = title ? title.getBoundingClientRect() : null;"
        "  const prevMid = prevRect.top + prevRect.height / 2;"
        "  const lbMid = lbRect.top + lbRect.height / 2;"
        "  return {"
        "    flexDirection: getComputedStyle(main).flexDirection,"
        "    sideBySide: bodyRect.left >= imgRect.right - 2,"
        "    chromeOnCard: lb.contains(close) && !img.contains(close),"
        "    navFullHeight: Math.abs(prevMid - lbMid) < 48,"
        "    nextOnCardEdge: nextRect.right >= lbRect.right - 72,"
        "    copyClearsNext: titleRect ? titleRect.right <= nextRect.left - 8 : false,"
        "  };"
        "}"
    )
    if not desktop_lb or desktop_lb.get("flexDirection") != "row":
        issues.add(f"{name}: destination lightbox should use two-column layout on desktop")
    elif not desktop_lb.get("sideBySide"):
        issues.add(f"{name}: destination lightbox card should sit beside image on desktop")
    elif not desktop_lb.get("chromeOnCard"):
        issues.add(f"{name}: destination lightbox chrome should span the full card")
    elif not desktop_lb.get("navFullHeight"):
        issues.add(f"{name}: destination prev/next should sit on full card height on desktop")
    elif not desktop_lb.get("copyClearsNext"):
        issues.add(f"{name}: destination copy should clear the next control on desktop")
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

    page.locator("#availability").scroll_into_view_if_needed()
    title_visible = page.locator("#availability .section-title").evaluate(
        "el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0"
    )
    intro_visible = page.locator(".availability-intro").evaluate(
        "el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0"
    )
    if not title_visible or not intro_visible:
        issues.add(f"{name}: availability title and intro should be visible on tablet")

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
        "  const close = document.getElementById('dest-lb-close');"
        "  if (!img || !body || !close) return null;"
        "  const imgRect = img.getBoundingClientRect();"
        "  const bodyRect = body.getBoundingClientRect();"
        "  const content = body.querySelector('.dest-lb-content');"
        "  const contentRect = content ? content.getBoundingClientRect() : null;"
        "  const pad = content ? parseFloat(getComputedStyle(content).paddingTop)"
        "    + parseFloat(getComputedStyle(content).paddingBottom) : 0;"
        "  let contentH = 0;"
        "  if (content) {"
        "    content.querySelectorAll('.dest-lb-num,.dest-lb-name,.dest-lb-tagline,.dest-lb-desc,.dest-lb-meta,.dest-lb-actions')"
        "      .forEach((el) => { contentH += el.getBoundingClientRect().height; });"
        "  }"
        "  const prev = document.getElementById('dest-lb-prev');"
        "  const prevMid = prev ? prev.getBoundingClientRect().top + prev.getBoundingClientRect().height / 2 : 0;"
        "  return {"
        "    flexDirection: style.flexDirection,"
        "    stacked: bodyRect.top >= imgRect.bottom - 2,"
        "    chromeOnLightbox: lb.contains(close) && !img.contains(close),"
        "    navOverImage: prevMid < bodyRect.top - 8,"
        "    imgShare: imgRect.height / window.innerHeight,"
        "    bodySlack: contentRect ? contentRect.height - contentH - pad : 0,"
        "  };"
        "}"
    )
    if not layout or layout.get("flexDirection") != "column":
        issues.add(f"{name}: destination lightbox should use stacked layout on tablet")
    elif not layout.get("stacked"):
        issues.add(f"{name}: destination lightbox card should sit below image on tablet")
    elif not layout.get("chromeOnLightbox"):
        issues.add(f"{name}: destination lightbox chrome should use the shared chrome layer")
    elif not layout.get("navOverImage"):
        issues.add(f"{name}: destination prev/next should align to the image band on tablet")
    elif layout.get("imgShare", 0) < 0.38:
        issues.add(
            f"{name}: destination image should dominate stacked tablet lightbox "
            f"(share={layout.get('imgShare', 0):.2f})"
        )
    elif layout.get("bodySlack", 0) > 96:
        issues.add(
            f"{name}: destination card panel has too much empty space "
            f"(slack={layout.get('bodySlack', 0):.0f}px)"
        )

    href = page.locator("#dest-lb-cta").get_attribute("href")
    if href != "#availability-land":
        issues.add(f"{name}: destination lightbox CTA should target availability section on tablet")
    page.locator("#dest-lb-cta").click()
    page.wait_for_timeout(800)
    page.wait_for_function("() => location.hash === '#availability-land'", timeout=8000)
    landing = page.evaluate(
        "() => {"
        "  const intro = document.querySelector('.availability-intro');"
        "  const title = document.querySelector('#availability .section-title');"
        "  const nav = document.querySelector('nav');"
        "  if (!title || !intro || !nav) return null;"
        "  const titleRect = title.getBoundingClientRect();"
        "  const introRect = intro.getBoundingClientRect();"
        "  const navBottom = nav.getBoundingClientRect().bottom;"
        "  return {"
        "    titleTop: titleRect.top,"
        "    introTop: introRect.top,"
        "    introBottom: introRect.bottom,"
        "    navBottom,"
        "  };"
        "}"
    )
    if not landing:
        issues.add(f"{name}: could not measure availability landing position")
    elif landing["titleTop"] < landing["navBottom"]:
        issues.add(
            f"{name}: availability title should clear nav after lightbox CTA "
            f"(top={landing['titleTop']:.0f}px)"
        )
    elif landing["introBottom"] <= landing["navBottom"] + 4:
        issues.add(
            f"{name}: availability intro should be visible after lightbox CTA "
            f"(bottom={landing['introBottom']:.0f}px)"
        )

    page.locator("#itinerary").scroll_into_view_if_needed()
    page.locator('#itinerary a[href="#avail-cal"]').click()
    page.wait_for_timeout(800)
    page.wait_for_function("() => location.hash === '#availability-land'", timeout=8000)
    meet_land = page.evaluate(
        "() => {"
        "  const title = document.querySelector('#availability .section-title');"
        "  const intro = document.querySelector('.availability-intro');"
        "  const nav = document.querySelector('nav');"
        "  if (!title || !intro || !nav) return null;"
        "  const navBottom = nav.getBoundingClientRect().bottom;"
        "  const titleTop = title.getBoundingClientRect().top;"
        "  const introBottom = intro.getBoundingClientRect().bottom;"
        "  return { titleTop, introBottom, navBottom };"
        "}"
    )
    if not meet_land:
        issues.add(f"{name}: could not measure meet CTA availability landing")
    elif meet_land["titleTop"] < meet_land["navBottom"]:
        issues.add(f"{name}: meet CTA should land with availability title visible")
    elif meet_land["introBottom"] <= meet_land["navBottom"] + 4:
        issues.add(f"{name}: meet CTA should land with availability intro visible")


def _assert_availability_landing(page, name: str, issues: IssueCollector) -> None:
    landing = page.evaluate(
        "() => {"
        "  const intro = document.querySelector('.availability-intro');"
        "  const title = document.querySelector('#availability .section-title');"
        "  const nav = document.querySelector('nav');"
        "  if (!title || !intro || !nav) return null;"
        "  const titleRect = title.getBoundingClientRect();"
        "  const introRect = intro.getBoundingClientRect();"
        "  const navBottom = nav.getBoundingClientRect().bottom;"
        "  return {"
        "    titleTop: titleRect.top,"
        "    introBottom: introRect.bottom,"
        "    navBottom,"
        "  };"
        "}"
    )
    if not landing:
        issues.add(f"{name}: could not measure availability landing position")
    elif landing["titleTop"] < landing["navBottom"]:
        issues.add(
            f"{name}: availability title should clear nav "
            f"(top={landing['titleTop']:.0f}px)"
        )
    elif landing["introBottom"] <= landing["navBottom"] + 4:
        issues.add(
            f"{name}: availability intro should be visible "
            f"(bottom={landing['introBottom']:.0f}px)"
        )


def scenario_home_ipad_wide(page, base: str, issues: IssueCollector) -> None:
    for label, viewport in (
        ("home ipad air", IPAD_AIR_VIEWPORT),
        ("home ipad pro 11", IPAD_PRO_VIEWPORT),
    ):
        issues.attach(page, label)
        page.set_viewport_size(viewport)
        page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(800)

        page.locator("#itinerary").scroll_into_view_if_needed()
        page.locator('#itinerary a[href="#availability"]').click()
        page.wait_for_timeout(800)
        page.wait_for_function("() => location.hash === '#availability-land'", timeout=8000)
        _assert_availability_landing(page, label, issues)

        page.locator("#reviews").scroll_into_view_if_needed()
        page.locator("#reviews .section-cta-avail--desktop").click()
        page.wait_for_timeout(800)
        page.wait_for_function("() => location.hash === '#availability-land'", timeout=8000)
        _assert_availability_landing(page, f"{label} availability redirect", issues)

        page.locator("#itinerary").scroll_into_view_if_needed()
        page.locator(".destination-card").first.click()
        page.wait_for_selector("#dest-lightbox.open", timeout=10000)
        lb_panel = page.evaluate(
            "() => {"
            "  const lb = document.getElementById('dest-lightbox');"
            "  const body = document.querySelector('.dest-lb-body');"
            "  const img = document.querySelector('.dest-lb-img-wrap');"
            "  const close = document.getElementById('dest-lb-close');"
            "  if (!lb || !body || !img || !close) return null;"
            "  const imgRect = img.getBoundingClientRect();"
            "  const bodyRect = body.getBoundingClientRect();"
            "  const prev = document.getElementById('dest-lb-prev');"
            "  const prevMid = prev ? prev.getBoundingClientRect().top + prev.getBoundingClientRect().height / 2 : 0;"
            "  return {"
            "    flexDirection: getComputedStyle(lb).flexDirection,"
            "    stacked: bodyRect.top >= imgRect.bottom - 2,"
            "    chromeOnLightbox: lb.contains(close) && !img.contains(close),"
            "    navOverImage: prevMid < bodyRect.top - 8,"
            "  };"
            "}"
        )
        if not lb_panel:
            issues.add(f"{label}: could not measure destination lightbox layout")
        elif lb_panel.get("flexDirection") != "column":
            issues.add(f"{label}: destination lightbox should stay stacked on tablet widths")
        elif not lb_panel.get("stacked"):
            issues.add(f"{label}: destination lightbox card should sit below image on tablet widths")
        elif not lb_panel.get("chromeOnLightbox"):
            issues.add(f"{label}: destination lightbox chrome should use the shared chrome layer")
        elif not lb_panel.get("navOverImage"):
            issues.add(f"{label}: destination prev/next should align to the image band on tablet widths")


def assert_enquire_quote_landing(page, scenario: str, issues: IssueCollector) -> None:
    href = page.evaluate(
        "() => (window.LY_enquireQuoteHref ? window.LY_enquireQuoteHref() : '#enquire-form')"
    )
    open_mobile_menu(page)
    quote = page.locator("#mobileNav a.mobile-nav-cta")
    if quote.count() == 0:
        issues.add(f"{scenario}: missing mobile Get Quote link")
        return
    if quote.first.get_attribute("href") != href:
        issues.add(f"{scenario}: mobile Get Quote href out of sync with LY_enquireQuoteHref")
        return
    quote.first.click()
    page.wait_for_function(
        f"() => location.hash === {href!r}",
        timeout=8000,
    )
    page.wait_for_function(
        "() => {"
        "  const label = document.querySelector('.enquire-section .section-label');"
        "  const submit = document.getElementById('submitBtn');"
        "  if (!label || !submit) return false;"
        "  const vh = window.visualViewport ? visualViewport.height : innerHeight;"
        "  const lr = label.getBoundingClientRect();"
        "  const sr = submit.getBoundingClientRect();"
        "  if (window.LY_enquireSectionFitsViewport && window.LY_enquireSectionFitsViewport()) {"
        "    return lr.top >= 36 && sr.bottom <= vh + 2;"
        "  }"
        "  const title = document.querySelector('.enquire-section .section-title');"
        "  if (!title) return false;"
        "  const tt = title.getBoundingClientRect().top;"
        "  return lr.top >= 36 && lr.top <= 130 && tt > lr.top;"
        "}",
        timeout=8000,
    )
    expect_mobile_menu_closed(page)


def scenario_home_large_phone(page, base: str, issues: IssueCollector) -> None:
    name = "home large phone"
    issues.attach(page, name)
    page.set_viewport_size(LARGE_PHONE_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(800)

    assert_mobile_nav_hrefs(page, name, issues)
    assert_enquire_quote_landing(page, name, issues)


def scenario_home_large_phone_tall(page, base: str, issues: IssueCollector) -> None:
    name = "home iphone 14 pro max"
    issues.attach(page, name)
    page.set_viewport_size(LARGE_PHONE_TALL_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(800)

    fits = page.evaluate(
        "() => !!(window.LY_enquireSectionFitsViewport && window.LY_enquireSectionFitsViewport())"
    )
    if not fits:
        issues.add(f"{name}: expected enquire section to fit tall large-phone viewport")
    href = page.evaluate(
        "() => (window.LY_enquireQuoteHref ? window.LY_enquireQuoteHref() : '')"
    )
    if href != "#enquire":
        issues.add(f"{name}: expected #enquire landing when section fits, got {href!r}")
    assert_enquire_quote_landing(page, name, issues)


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
    page.goto(base + "/de/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1000)
    assert_mobile_nav_hrefs(page, f"{name} mobile", issues)
    click_mobile_nav_link(page, "#avail-cal")


def _cookie_consent_url(base: str) -> str:
    return base + "/?ly_test_consent=1"


def _wait_cookie_banner_visible(page, scenario: str, issues: IssueCollector) -> bool:
    page.wait_for_timeout(6200)
    hidden = page.locator("#cookie-consent").evaluate("el => el.hidden")
    if hidden:
        issues.add(f"{scenario}: banner should appear after 6s delay with no prior consent")
        return False
    return True


def _assert_cookie_auto_accepted(page, scenario: str, issues: IssueCollector) -> None:
    try:
        page.wait_for_function(
            "() => {"
            "  const b = document.getElementById('cookie-consent');"
            "  return localStorage.getItem('ly_consent') === 'granted' && b && b.hidden;"
            "}",
            timeout=5000,
        )
    except Exception as exc:  # noqa: BLE001
        state = page.evaluate(
            "() => ({"
            "  consent: localStorage.getItem('ly_consent'),"
            "  hidden: document.getElementById('cookie-consent')?.hidden"
            "})"
        )
        issues.add(
            f"{scenario}: auto-accept failed (consent={state.get('consent')!r}, "
            f"banner_hidden={state.get('hidden')!r}) — {exc}"
        )


def assert_cookie_scroll_auto_accept(
    page,
    base: str,
    label: str,
    viewport: dict[str, int],
    issues: IssueCollector,
) -> None:
    scenario = f"cookie scroll auto-accept ({label})"
    page.set_viewport_size(viewport)
    page.goto(_cookie_consent_url(base), wait_until="domcontentloaded", timeout=60000)
    if not _wait_cookie_banner_visible(page, scenario, issues):
        return
    scroll_through_page(page, steps=4, pause_ms=80)
    _assert_cookie_auto_accepted(page, scenario, issues)


def assert_cookie_touch_auto_accept(
    page,
    base: str,
    label: str,
    viewport: dict[str, int],
    issues: IssueCollector,
) -> None:
    scenario = f"cookie touch auto-accept ({label})"
    page.set_viewport_size(viewport)
    page.goto(_cookie_consent_url(base), wait_until="domcontentloaded", timeout=60000)
    if not _wait_cookie_banner_visible(page, scenario, issues):
        return
    page.evaluate(
        "() => {"
        "  const t = new Touch({ identifier: 1, target: document.body,"
        "    clientX: 24, clientY: 24, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 });"
        "  document.dispatchEvent(new TouchEvent('touchstart', {"
        "    bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t]"
        "  }));"
        "}"
    )
    _assert_cookie_auto_accepted(page, scenario, issues)


def assert_cookie_cta_auto_accept(
    page,
    base: str,
    label: str,
    viewport: dict[str, int],
    issues: IssueCollector,
) -> None:
    scenario = f"cookie CTA auto-accept ({label})"
    page.set_viewport_size(viewport)
    page.goto(_cookie_consent_url(base), wait_until="domcontentloaded", timeout=60000)
    if not _wait_cookie_banner_visible(page, scenario, issues):
        return
    cta = None
    for selector in (
        ".nav-header-cta:visible",
        "#hero .btn-primary:visible",
        ".btn-primary:visible",
    ):
        loc = page.locator(selector).first
        if loc.count() > 0 and loc.is_visible():
            cta = loc
            break
    if cta is None:
        issues.add(f"{scenario}: no visible engagement CTA (.nav-header-cta / .btn-primary)")
        return
    try:
        cta.click()
    except Exception as exc:  # noqa: BLE001
        issues.add(f"{scenario}: CTA click failed — {exc}")
        return
    _assert_cookie_auto_accepted(page, scenario, issues)


def scenario_cookie_consent_all_viewports(page, base: str, issues: IssueCollector) -> None:
    name = "cookie consent all viewports"
    issues.attach(page, name)
    page.add_init_script(CONSENT_CLEAR_INIT)

    for label, viewport in COOKIE_TEST_VIEWPORTS:
        assert_cookie_scroll_auto_accept(page, base, label, viewport, issues)

    for label, viewport in (
        ("mobile 390", MOBILE_VIEWPORT),
        ("large phone 412", LARGE_PHONE_VIEWPORT),
        ("iphone 14 pro max", LARGE_PHONE_TALL_VIEWPORT),
    ):
        assert_cookie_touch_auto_accept(page, base, label, viewport, issues)

    for label, viewport in (
        ("ipad air", IPAD_AIR_VIEWPORT),
        ("desktop 1280", DESKTOP_VIEWPORT),
    ):
        assert_cookie_cta_auto_accept(page, base, label, viewport, issues)


def scenario_full_page_scroll(page, base: str, issues: IssueCollector) -> None:
    name = "full page scroll journey"
    issues.attach(page, name)
    page.set_viewport_size(MOBILE_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(500)
    scroll_through_page(page, steps=16, pause_ms=100)
    for section_id in BOOKING_SECTION_IDS:
        page.locator(section_id).scroll_into_view_if_needed()
        page.wait_for_timeout(150)
    page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' });")


def scenario_gallery_lightbox(page, base: str, issues: IssueCollector) -> None:
    name = "gallery tabs and lightbox"
    issues.attach(page, name)
    page.set_viewport_size(DESKTOP_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.locator("#gallery").scroll_into_view_if_needed()
    page.wait_for_timeout(400)

    deck_tab = page.locator('.gallery-tab[data-gtab="deck"]')
    if deck_tab.count():
        deck_tab.click()
        page.wait_for_timeout(300)

    item = page.locator(".gallery-group.tab-active .gallery-item").first
    if item.count() == 0:
        issues.add(f"{name}: no gallery items found")
        return
    item.click()
    page.wait_for_selector("#lightbox.open", timeout=10000)

    next_btn = page.locator("#lightbox-next")
    if next_btn.count():
        next_btn.click()
        page.wait_for_timeout(400)
    close_btn = page.locator("#lightbox-close")
    if close_btn.count():
        close_btn.click()
        page.wait_for_function(
            "() => !document.getElementById('lightbox').classList.contains('open')",
            timeout=5000,
        )


def scenario_reviews_load(page, base: str, issues: IssueCollector) -> None:
    name = "reviews load"
    issues.attach(page, name)
    page.set_viewport_size(DESKTOP_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.locator("#reviews").scroll_into_view_if_needed()
    page.wait_for_function(
        "() => {"
        "  const grid = document.getElementById('reviewsGrid');"
        "  return grid && !grid.hidden && grid.querySelector('.review-card');"
        "}",
        timeout=15000,
    )


def scenario_calendar_booking(page, base: str, issues: IssueCollector) -> None:
    name = "calendar booking selection"
    issues.attach(page, name)
    page.set_viewport_size(MOBILE_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)
    page.locator("#availability").scroll_into_view_if_needed()
    wait_for_calendar(page)
    if not click_first_free_day(page, "#availCal"):
        issues.add(f"{name}: no free calendar day to select")
        return
    page.wait_for_timeout(500)
    selection = page.locator("#calSelection")
    if selection.count() and selection.evaluate("el => el.hidden"):
        issues.add(f"{name}: calendar selection panel did not open after date pick")


def scenario_booking_funnel_mobile(page, base: str, issues: IssueCollector) -> None:
    name = "booking funnel mobile"
    issues.attach(page, name)
    page.route("**/wa.me/**", lambda route: route.abort())
    page.set_viewport_size(MOBILE_VIEWPORT)
    page.goto(base + "/", wait_until="domcontentloaded", timeout=60000)

    hero_cta = page.locator("#hero a.btn-primary.hero-cta-link--mobile").first
    if hero_cta.count():
        hero_cta.click()
        page.wait_for_function(
            "() => ['#itinerary-funnel', '#itinerary'].includes(location.hash)",
            timeout=8000,
        )
    else:
        issues.add(f"{name}: hero primary CTA missing on mobile")

    page.locator(".enquire-section").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    # Mobile CSS hides column WhatsApp buttons — dispatch still exercises click handlers.
    page.locator(".enquire-section .contact-info .whatsapp-btn").first.dispatch_event("click")
    page.wait_for_timeout(400)

    page.locator("#contactForm").scroll_into_view_if_needed()
    page.locator("#name").fill("Test Guest")
    page.locator("#email").fill("test@example.com")


def scenario_locales_mobile(page, base: str, issues: IssueCollector) -> None:
    for code in ("es", "fr"):
        name = f"locale {code} mobile"
        issues.attach(page, name)
        page.set_viewport_size(MOBILE_VIEWPORT)
        page.goto(base + f"/{code}/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(600)
        assert_mobile_nav_hrefs(page, name, issues)
        scroll_through_page(page, steps=8, pause_ms=80)
        page.locator("#availability").scroll_into_view_if_needed()
        wait_for_calendar(page)


def scenario_legal(page, base: str, issues: IssueCollector) -> None:
    name = "legal en"
    issues.attach(page, name)
    page.set_viewport_size(DESKTOP_VIEWPORT)
    page.goto(base + "/legal.html", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("a[href]", timeout=10000)


def run_scenarios(base_url: str, quick: bool = False, thorough: bool = False) -> list[str]:
    sync_playwright = require_playwright()
    issues = IssueCollector()
    scenarios = [
        scenario_home_desktop,
        scenario_home_tablet,
        scenario_home_ipad_wide,
        scenario_home_large_phone_tall,
        scenario_home_large_phone,
        scenario_home_mobile,
        scenario_cookie_consent_all_viewports,
        scenario_full_page_scroll,
        scenario_gallery_lightbox,
        scenario_reviews_load,
        scenario_calendar_booking,
        scenario_booking_funnel_mobile,
    ]
    if not quick:
        scenarios.extend([
            scenario_locale_de,
            scenario_locales_mobile,
            scenario_legal,
        ])
    if thorough:
        scenarios.extend([
            scenario_home_desktop,
            scenario_full_page_scroll,
        ])

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
        help="Skip locale/legal-only scenarios (core booking flows still run)",
    )
    parser.add_argument(
        "--thorough",
        action="store_true",
        help="Repeat key desktop + scroll journeys for extra coverage",
    )
    args = parser.parse_args()

    print(f"{GREEN}UX smoke tests{RESET}")
    if args.url:
        failures = run_scenarios(
            args.url.rstrip("/"), quick=args.quick, thorough=args.thorough
        )
    else:
        with serve_site(args.root) as base_url:
            failures = run_scenarios(
                base_url, quick=args.quick, thorough=args.thorough
            )

    if failures:
        print(f"\n{RED}FAILED  {len(failures)} UX issue(s):{RESET}")
        for item in failures:
            print(f"  • {item}")
        return 1

    print(f"\n{GREEN}PASSED  UX smoke tests{RESET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())