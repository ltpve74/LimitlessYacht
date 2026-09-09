"""Render EN + DE landing pages from landingPages/ data. EN is source; DE overlays."""

from __future__ import annotations

import json
import re
from datetime import date
from html import escape
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://limitlessyachtcharter.com"
TODAY = date.today().isoformat()

DEST_IMAGES = {
    "portals-vells": "portals-vells-1",
    "el-toro-malgrats": "el-toro-malgrats-1",
    "cala-llamp": "cala-llamp-1",
    "sa-dragonera": "sa-dragonera-1",
    "cala-pi": "cala-pi-1",
    "es-trenc": "es-trenc-1",
    "cabrera": "cabrera-1",
    "calo-des-moro": "calo-des-moro-1",
    "west-coast-soller": "sa-calobra-1",
    "mallorca-circumnavigation": "circumnavigation-1",
    "ibiza-formentera": "formentera-1",
    "menorca-crossing": "menorca-1",
}

TRIP_LABEL = {"half-day": "Half-day", "full-day": "Full day", "multi-day": "Multi-day"}

UI_EN = {
    "check_dates": "Check dates",
    "whatsapp": "WhatsApp the crew",
    "call": "Call +34 643 678 072",
    "see_calendar": "See the calendar",
    "home": "Home",
    "dates": "Dates",
    "legal": "Legal",
    "destinations": "Destinations",
    "charters": "Charters",
    "the_yacht": "The Yacht",
    "prices": "Prices",
    "contact": "Contact",
    "private_charter": "Private charter",
    "day_charter": "Day charter",
    "sunset": "Half-day & sunset",
    "multi_day": "Multi-day",
    "club_de_mar": "Club de Mar, Palma",
    "whats_included": "What's included",
    "best_time": "Best time to charter",
    "footer_charters": "Charters",
    "footer_info": "Info",
    "note": "Captain and crew usually reply within the hour, and always within 24 hours. Crew and VAT included. Gratuity is never expected.",
    "facts": "At a glance",
    "from_marina": "From Club de Mar",
    "round_trip": "Round trip",
    "depth": "Depth",
    "diesel": "Diesel est.",
    "trip": "Trip",
    "half-day": "Half-day",
    "full-day": "Full day",
    "multi-day": "Multi-day",
    "nm": "nm",
    "more_routes": "More routes",
    "faq": "Questions",
}

PROVIDER = {
    "@type": "LocalBusiness",
    "@id": f"{SITE}/#business",
    "name": "Limitless Yacht Experience",
    "telephone": "+34643678072",
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "Carrer Castella 1",
        "addressLocality": "Calvià",
        "postalCode": "07180",
        "addressCountry": "ES",
    },
}


def _load():
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from landingPages.pages import PAGES
    from landingPages.pages_de import DEST as DEST_DE
    from landingPages.pages_de import PAGES as PAGES_DE
    from landingPages.pages_de import UI as UI_DE

    dests = json.loads((ROOT / "landingPages" / "destinations.json").read_text(encoding="utf-8"))[
        "destinations"
    ]
    return PAGES, dests, PAGES_DE, DEST_DE, UI_DE


def css_versions() -> tuple[str, str]:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    layout = re.search(r"layout\.css\?v=(\d+)", html)
    main = re.search(r"main\.css\?v=(\d+)", html)
    return (layout.group(1) if layout else "1", main.group(1) if main else "1")


def _root_prefix(depth: int) -> str:
    return "../" * depth


def _abs(path: str, lang: str) -> str:
    if lang == "de":
        return f"{SITE}/de/{path}"
    return f"{SITE}/{path}"


def _esc(text: str) -> str:
    return escape(text, quote=True)


def _breadcrumb(items: list[tuple[str, str]]) -> str:
    crumbs = []
    schema = []
    for i, (href, label) in enumerate(items, 1):
        crumbs.append(f'<a href="{href}">{_esc(label)}</a>' if href else f"<span>{_esc(label)}</span>")
        schema.append(
            {
                "@type": "ListItem",
                "position": i,
                "name": label,
                "item": href if href.startswith("http") else None,
            }
        )
    # fill abs later in caller
    return '<nav class="ly-crumbs" aria-label="Breadcrumb">' + " · ".join(crumbs) + "</nav>", schema


def _facts(dest: dict, ui: dict) -> str:
    rows = [
        (ui["trip"], ui.get(dest["trip_type"], dest["trip_type"])),
        (ui["from_marina"], dest.get("from_club_de_mar") or "—"),
        (ui["round_trip"], f"{dest['round_trip_nm']} {ui['nm']}" if dest.get("round_trip_nm") else "—"),
        (ui["depth"], f"{dest['depth_m']} m" if dest.get("depth_m") else "—"),
        (ui["diesel"], f"{dest['diesel_l_est']} L" if dest.get("diesel_l_est") else "—"),
    ]
    if dest.get("notes"):
        rows.append(("", dest["notes"]))
    cells = "".join(
        f"<div><dt>{_esc(k)}</dt><dd>{_esc(v)}</dd></div>" if k else f"<div><dd>{_esc(v)}</dd></div>"
        for k, v in rows
    )
    return f'<h2>{_esc(ui["facts"])}</h2><dl class="ly-facts">{cells}</dl>'


def _faq_html(faq: list[tuple[str, str]], heading: str) -> str:
    if not faq:
        return ""
    bits = [f"<h2>{_esc(heading)}</h2>"]
    for q, a in faq:
        bits.append(f"<h3>{_esc(q)}</h3><p>{_esc(a)}</p>")
    return "\n".join(bits)


def _faq_schema(faq: list[tuple[str, str]]) -> dict | None:
    if not faq:
        return None
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in faq
        ],
    }


def _service_schema(page: dict, url: str, image: str) -> dict:
    block: dict = {
        "@context": "https://schema.org",
        "@type": page.get("schema") or "Service",
        "name": page.get("service_name") or page["h1"],
        "provider": PROVIDER,
        "areaServed": {"@type": "Place", "name": "Mallorca, Balearic Islands, Spain"},
        "url": url,
        "image": image,
    }
    if page.get("schema") == "Product":
        block["brand"] = "Maiora"
        block["description"] = page["description"]
    else:
        block["serviceType"] = "Yacht charter"
    if page.get("low") and page.get("high"):
        block["offers"] = {
            "@type": "AggregateOffer",
            "priceCurrency": "EUR",
            "lowPrice": page["low"],
            "highPrice": page["high"],
            "availability": "https://schema.org/InStock",
        }
    return block


def _dest_schema(dest: dict, url: str, image: str) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "TouristAttraction",
        "name": dest["name"],
        "description": dest["meta_description"],
        "url": url,
        "image": image,
        "touristType": dest["trip_type"],
        "isAccessibleForFree": False,
        "containedInPlace": {"@type": "Place", "name": dest["coast"]},
    }


def _jsonld(*blocks: dict | None) -> str:
    real = [b for b in blocks if b]
    if not real:
        return ""
    payload = real[0] if len(real) == 1 else real
    return (
        '<script type="application/ld+json">\n'
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + "\n</script>"
    )


def _hub_cards(dests: list[dict], prefix: str, ui: dict) -> str:
    groups = [("half-day", []), ("full-day", []), ("multi-day", [])]
    by = {k: v for k, v in groups}
    for d in dests:
        by.setdefault(d["trip_type"], []).append(d)
    bits = []
    for key, label_key in (("half-day", "half-day"), ("full-day", "full-day"), ("multi-day", "multi-day")):
        items = by.get(key) or []
        if not items:
            continue
        bits.append(f'<h2>{_esc(ui[label_key])}</h2><ul class="ly-dest-list">')
        for d in items:
            img = DEST_IMAGES.get(d["slug"], "")
            thumb = f"{prefix}images/dest/{img}-prev.jpg" if img else ""
            href = f"{d['slug']}/"
            pic = f'<img src="{thumb}" alt="" width="160" height="90" loading="lazy">' if thumb else ""
            bits.append(
                f'<li><a href="{href}">{pic}<span><strong>{_esc(d["name"])}</strong>'
                f"<em>{_esc(d.get('tagline') or '')}</em></span></a></li>"
            )
        bits.append("</ul>")
    return "\n".join(bits)


FOOTER_DESTS = (
    ("destinations/cabrera/", "Cabrera"),
    ("destinations/es-trenc/", "Es Trenc"),
    ("destinations/sa-dragonera/", "Sa Dragonera"),
    ("destinations/portals-vells/", "Portals Vells"),
    ("destinations/ibiza-formentera/", "Ibiza & Formentera"),
)


def _rich(text: str) -> str:
    """Allow intentional <a> tags in landing copy; escape everything else."""
    if "<a " in text:
        return text
    return _esc(text)


def site_nav(home: str, ui: dict) -> str:
    return (
        f'<div class="nav-end ly-inner-links" data-site-nav="1">\n'
        f'<a href="{home}">{_esc(ui["home"])}</a>\n'
        f'<a href="{home}yacht-charter-mallorca/">{_esc(ui["charters"])}</a>\n'
        f'<a href="{home}destinations/">{_esc(ui["destinations"])}</a>\n'
        f'<a href="{home}maiora-yacht-charter/">{_esc(ui["the_yacht"])}</a>\n'
        f'<a href="{home}yacht-charter-mallorca-prices/">{_esc(ui["prices"])}</a>\n'
        f'<a href="{home}#avail-cal">{_esc(ui["contact"])}</a>\n'
        f'<a href="{home}#avail-cal" class="nav-cta nav-header-cta">{_esc(ui["check_dates"])}</a>\n'
        f"</div>"
    )


def site_footer(home: str, ui: dict) -> str:
    def a(path: str, label: str) -> str:
        return f'<a href="{home}{path}">{_esc(label)}</a>'

    dests = "\n".join(a(p, lab) for p, lab in FOOTER_DESTS)
    return f"""<footer>
<p class="footer-logo">Limitless Yacht</p>
<p class="footer-tagline">Club de Mar · Palma de Mallorca</p>
<div class="footer-sitemap">
<div class="footer-col"><span class="footer-heading">{_esc(ui["footer_charters"])}</span>
{a("yacht-charter-mallorca/", ui["private_charter"])}
{a("day-charter-mallorca/", ui["day_charter"])}
{a("sunset-charter-mallorca/", ui["sunset"])}
{a("multi-day-charter-balearics/", ui["multi_day"])}
{a("maiora-yacht-charter/", ui["the_yacht"])}
{a("yacht-charter-palma-club-de-mar/", ui["club_de_mar"])}
</div>
<div class="footer-col"><span class="footer-heading">{_esc(ui["destinations"])}</span>
{a("destinations/", ui["destinations"])}
{dests}
</div>
<div class="footer-col"><span class="footer-heading">{_esc(ui["footer_info"])}</span>
{a("yacht-charter-mallorca-prices/", ui["prices"])}
{a("what-is-included/", ui["whats_included"])}
{a("best-time-yacht-charter-mallorca/", ui["best_time"])}
<a href="{home}legal.html">{_esc(ui["legal"])}</a>
</div>
</div>
<p class="footer-copy">Limitless Opportunities S.L. · VAT B21726427</p>
</footer>"""


def render_page(
    *,
    lang: str,
    depth: int,
    path: str,  # url path without leading slash, with trailing slash
    title: str,
    description: str,
    kicker: str,
    h1: str,
    lead: str,
    sections: list[tuple[str, str]],
    cta: str,
    wa: str,
    faq: list[tuple[str, str]],
    related: list[tuple[str, str]],
    ui: dict,
    image_rel: str,
    schema_blocks: list[dict | None],
    extra_html: str = "",
    crumbs: list[tuple[str, str]] | None = None,
) -> str:
    prefix = _root_prefix(depth)
    nav_home = _root_prefix(depth - (1 if lang == "de" else 0)) or "./"
    layout_v, main_v = css_versions()
    en_url = f"{SITE}/{path}"
    de_url = f"{SITE}/de/{path}"
    canon = de_url if lang == "de" else en_url
    og_locale = "de_DE" if lang == "de" else "en_GB"
    image = f"{SITE}/images/{image_rel}"
    wa_href = "https://wa.me/34643678072?text=" + quote(wa)
    crumb_html = ""
    if crumbs:
        parts = []
        for href, label in crumbs:
            parts.append(f'<a href="{href}">{_esc(label)}</a>' if href else f"<span>{_esc(label)}</span>")
        crumb_html = '<nav class="ly-crumbs" aria-label="Breadcrumb">' + " · ".join(parts) + "</nav>"
    section_html = "".join(f"<h2>{_esc(h)}</h2>\n<p>{_rich(p)}</p>\n" for h, p in sections)
    related_html = ""
    if related:
        links = " · ".join(f'<a href="{href}">{_esc(label)}</a>' for href, label in related)
        related_html = f'<p class="ly-related">{links}</p>'
    return f"""<!DOCTYPE html>
<html lang="{lang}" class="ly-inner-page">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script src="{prefix}js/analytics-env.js"></script>
<title>{_esc(title)}</title>
<meta name="description" content="{_esc(description)}" />
<link rel="canonical" href="{canon}" />
<link rel="alternate" hreflang="en" href="{en_url}" />
<link rel="alternate" hreflang="de" href="{de_url}" />
<link rel="alternate" hreflang="x-default" href="{en_url}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="{_esc(title)}" />
<meta property="og:description" content="{_esc(description)}" />
<meta property="og:url" content="{canon}" />
<meta property="og:image" content="{image}" />
<meta property="og:locale" content="{og_locale}" />
<link rel="icon" type="image/svg+xml" href="{prefix}favicon.svg" />
<meta name="theme-color" content="#0a1628" />
<link rel="stylesheet" href="{prefix}css/layout.css?v={layout_v}" />
<link rel="stylesheet" href="{prefix}css/main.css?v={main_v}" />
</head>
<body>
<nav id="navbar">
<a href="{nav_home}" class="nav-logo">Limitless <span>Yacht</span></a>
{site_nav(nav_home, ui)}
</nav>
<main class="ly-page">
{crumb_html}
<p class="ly-page-kicker">{_esc(kicker)}</p>
<h1>{_esc(h1)}</h1>
<p class="ly-page-lead">{_esc(lead)}</p>
<div class="ly-page-cta">
<a href="{nav_home}#avail-cal" class="btn-primary">{_esc(ui["check_dates"])}</a>
<a href="{wa_href}" class="btn-ghost" target="_blank" rel="noopener">{_esc(ui["whatsapp"])}</a>
<a href="tel:+34643678072" class="btn-ghost">{_esc(ui["call"])}</a>
</div>
<p class="ly-page-note">{_esc(ui["note"])}</p>
{section_html}{extra_html}{_faq_html(faq, ui["faq"])}
<div class="ly-page-cta">
<a href="{nav_home}#avail-cal" class="btn-primary">{_esc(ui["see_calendar"])}</a>
</div>
<p class="ly-page-note">{_rich(cta)}</p>
{related_html}
</main>
{site_footer(nav_home, ui)}
{_jsonld(*schema_blocks, _faq_schema(faq))}
</body>
</html>
"""


def _apply_de_page(en: dict, de: dict) -> dict:
    out = dict(en)
    out.update({k: de[k] for k in (
        "kicker", "title", "description", "h1", "lead", "cta", "wa", "service_name"
    ) if k in de})
    if de.get("sections"):
        out["sections"] = de["sections"]
    if "faq" in de:
        out["faq"] = de["faq"]
    if de.get("related_labels") and en.get("related"):
        out["related"] = [
            (href, de["related_labels"][i] if i < len(de["related_labels"]) else label)
            for i, (href, label) in enumerate(en["related"])
        ]
    return out


def _apply_de_dest(en: dict, de: dict) -> dict:
    out = dict(en)
    out.update(de)
    return out


def write_html(rel: str, html: str) -> Path:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html.rstrip() + "\n", encoding="utf-8")
    return path


def commercial_specs(lang: str) -> list[dict]:
    pages, dests, pages_de, _dest_de, ui_de = _load()
    ui = ui_de if lang == "de" else UI_EN
    out = []
    for raw in pages:
        page = _apply_de_page(raw, pages_de[raw["slug"]]) if lang == "de" else raw
        path = f"{page['slug']}/"
        depth = 2 if lang == "de" else 1
        prefix = _root_prefix(depth)
        related = []
        for href, label in page.get("related") or []:
            related.append(("../" + href, label))
        extra = ""
        if page.get("hub"):
            dest_view = dests
            if lang == "de":
                from landingPages.pages_de import DEST as DEST_DE

                dest_view = [_apply_de_dest(d, DEST_DE.get(d["slug"], {})) for d in dests]
            extra = _hub_cards(dest_view, prefix, ui)
        url = _abs(path, lang)
        image = "maiora_20s_18.jpg"
        schema = []
        if page.get("schema") in ("Service", "Product"):
            schema.append(_service_schema(page, url, f"{SITE}/images/{image}"))
        if page.get("hub"):
            schema.append(
                {
                    "@context": "https://schema.org",
                    "@type": "ItemList",
                    "name": page["h1"],
                    "url": url,
                    "numberOfItems": len(dests),
                    "itemListElement": [
                        {
                            "@type": "ListItem",
                            "position": i + 1,
                            "url": _abs(f"destinations/{d['slug']}/", lang),
                            "name": d["name"],
                        }
                        for i, d in enumerate(dests)
                    ],
                }
            )
        crumbs = [
            (_root_prefix(depth - (1 if lang == "de" else 0)) or "./", ui["home"]),
            ("", page["h1"]),
        ]
        out.append(
            {
                "rel": (("de/" if lang == "de" else "") + f"{page['slug']}/index.html"),
                "path": path,
                "lang": lang,
                "html": render_page(
                    lang=lang,
                    depth=depth,
                    path=path,
                    title=page["title"],
                    description=page["description"],
                    kicker=page["kicker"],
                    h1=page["h1"],
                    lead=page["lead"],
                    sections=page["sections"],
                    cta=page["cta"],
                    wa=page["wa"],
                    faq=page.get("faq") or [],
                    related=related,
                    ui=ui,
                    image_rel=image,
                    schema_blocks=schema,
                    extra_html=extra,
                    crumbs=crumbs,
                ),
            }
        )
    return out


def dest_specs(lang: str) -> list[dict]:
    _pages, dests, _pages_de, dest_de, ui_de = _load()
    ui = ui_de if lang == "de" else UI_EN
    out = []
    for raw in dests:
        dest = _apply_de_dest(raw, dest_de.get(raw["slug"], {})) if lang == "de" else raw
        path = f"destinations/{dest['slug']}/"
        depth = 3 if lang == "de" else 2
        prefix = _root_prefix(depth)
        img_key = DEST_IMAGES.get(dest["slug"], "maiora_20s_18")
        image_rel = f"dest/{img_key}.jpg" if dest["slug"] in DEST_IMAGES else "maiora_20s_18.jpg"
        extra = (
            f"<p>{_esc(dest['intro'])}</p>\n<p>{_esc(dest['body'])}</p>\n"
            + _facts(dest, ui)
        )
        if dest.get("highlights"):
            extra += '<ul class="ly-highlights">' + "".join(
                f"<li>{_esc(h)}</li>" for h in dest["highlights"]
            ) + "</ul>"
        extra += (
            f'<p><img class="ly-dest-hero" src="{prefix}images/{image_rel}" '
            f'alt="{_esc(dest["name"])}" width="960" height="540" loading="lazy"></p>'
        )
        siblings = [
            (f"../{d['slug']}/", d["name"])
            for d in dests
            if d["slug"] != dest["slug"]
        ][:4]
        related = [
            ("../", ui["destinations"]),
            ("../../day-charter-mallorca/", "Day charter" if lang == "en" else "Tagescharter"),
            *siblings,
        ]
        url = _abs(path, lang)
        image = f"{SITE}/images/{image_rel}"
        page_like = {
            "schema": "Service",
            "service_name": dest["h1"],
            "description": dest["meta_description"],
            "h1": dest["h1"],
            "low": "1700",
            "high": "4000",
        }
        crumbs = [
            (_root_prefix(depth - (1 if lang == "de" else 0)) or "./", ui["home"]),
            ("../", ui["destinations"]),
            ("", dest["name"]),
        ]
        out.append(
            {
                "rel": (("de/" if lang == "de" else "") + f"destinations/{dest['slug']}/index.html"),
                "path": path,
                "lang": lang,
                "html": render_page(
                    lang=lang,
                    depth=depth,
                    path=path,
                    title=dest["meta_title"],
                    description=dest["meta_description"],
                    kicker=f"{ui.get(dest['trip_type'], dest['trip_type'])} · {dest.get('coast', '')}",
                    h1=dest["h1"],
                    lead=dest.get("tagline") or dest["intro"],
                    sections=[],
                    cta=ui["note"],
                    wa=(
                        f"Hi, I'd like to enquire about a charter to {raw['name']} on Limitless."
                        if lang == "en"
                        else f"Hallo, ich interessiere mich für einen Charter nach {raw['name']} auf der Limitless."
                    ),
                    faq=[],
                    related=related,
                    ui=ui,
                    image_rel=image_rel,
                    schema_blocks=[
                        _dest_schema(dest, url, image),
                        _service_schema(page_like, url, image),
                    ],
                    extra_html=extra,
                    crumbs=crumbs,
                ),
            }
        )
    return out


def all_specs() -> list[dict]:
    specs = []
    for lang in ("en", "de"):
        specs.extend(commercial_specs(lang))
        specs.extend(dest_specs(lang))
    return specs


def write_sitemap(specs: list[dict]) -> None:
    homes = [
        ("/", 1.0, True),
        ("/de/", 0.9, True),
        ("/fr/", 0.9, True),
        ("/es/", 0.9, True),
    ]
    chunks = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ]

    def url_block(loc: str, priority: str, alts: list[tuple[str, str]]) -> None:
        chunks.append("  <url>")
        chunks.append(f"    <loc>{loc}</loc>")
        chunks.append(f"    <lastmod>{TODAY}</lastmod>")
        chunks.append("    <changefreq>monthly</changefreq>")
        chunks.append(f"    <priority>{priority}</priority>")
        for hl, href in alts:
            chunks.append(f'    <xhtml:link rel="alternate" hreflang="{hl}" href="{href}" />')
        chunks.append("  </url>")

    for path, pri, full in homes:
        loc = SITE + path
        alts = [
            ("en", f"{SITE}/"),
            ("de", f"{SITE}/de/"),
            ("fr", f"{SITE}/fr/"),
            ("es", f"{SITE}/es/"),
            ("x-default", f"{SITE}/"),
        ]
        url_block(loc, f"{pri:.1f}", alts)

    # pair EN/DE landings
    by_path: dict[str, dict[str, str]] = {}
    for spec in specs:
        by_path.setdefault(spec["path"], {})[spec["lang"]] = _abs(spec["path"], spec["lang"])
    for path, langs in by_path.items():
        alts = [("en", langs["en"]), ("de", langs["de"]), ("x-default", langs["en"])]
        url_block(langs["en"], "0.8", alts)
        url_block(langs["de"], "0.7", alts)

    chunks.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(chunks) + "\n", encoding="utf-8")


def landing_relpaths() -> list[str]:
    return [s["rel"] for s in all_specs()]


def render_all() -> list[str]:
    # so `from landingPages...` works when run as a script
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    specs = all_specs()
    written = []
    for spec in specs:
        write_html(spec["rel"], spec["html"])
        written.append(spec["rel"])
    write_sitemap(specs)
    return written


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(ROOT))
    files = render_all()
    print(f"Wrote {len(files)} landing pages + sitemap.xml")
