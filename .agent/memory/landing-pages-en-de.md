# Landing pages (EN + DE only)

First extra indexable page: `/day-charter-mallorca/` and `/de/day-charter-mallorca/`.

- **Edit** `day-charter-mallorca/index.html` (EN) + `i18n/locales/de.py` `DAY_CHARTER_PAIRS`.
- **Generate** with `python3 i18n/build-locales.py` (`build_landing` + `../../` path rewrite).
- **Do not** generate `es/` or `fr/` copies — ES Search Console impressions are the 96 m Lürssen
  *Limitless* name collision; FR is near-zero. Homepage locales stay at parity.
- Inner pages use `.ly-inner-page` + blocking `../css/` (no cinema hero, no inlined net-tier).
- Copy is draft — owner finalises before `main`. EN homepage `<title>` is unchanged until approved.
- Next (not built): Cabrera/Es Trenc destination page, Maiora yacht page.

See `DECISIONS.md` § SEO / extra indexable pages and `.agent/briefs/lean-into-real-markets-seo.md`.
