# Landing pages (EN + DE only)

Generated from `landingPages/` (copy + destinations.json) via `i18n/render_landings.py`.

- **Edit data, not HTML:** `landingPages/pages.py`, `pages_de.py`, `destinations.json`.
- **Build:** `python3 i18n/build-locales.py` writes EN + DE pages and `sitemap.xml`.
- **Do not** generate ES/FR landing copies (spotter noise / near-zero).
- Inner pages: `.ly-inner-page`, no cinema hero. Copy in `landing-pages-copy.md` is publish-ready.
- EN homepage `<title>` still needs owner OK.

See `DECISIONS.md` § SEO / extra indexable pages.
