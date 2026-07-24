# Tracker examples (private — not public)

Sample files for building the captain ops tools (monthly expenses spreadsheet, invoice PDF, APA workbook, charter agreement).

**Never deploy to production.**

| Guard | What it does |
|--------|----------------|
| `.netlifyignore` | Excludes `tracker/examples/` from Netlify |
| main pre-commit | Strips `tracker/examples/` on publish commits |
| GitHub Pages prepare | Skips any path segment named `examples` |

Keep samples here on `develop` for agents/reference only.

## Charter agreement

`Limitless charter agreement - Andrew.pdf` is the **reference layout + legal terms** used by the tracker’s **Agreement** button on Leads.

The live app does **not** load this PDF (examples never ship). It **regenerates** an equivalent multi-page PDF from lead data (guest, dates, **formal white fees only**, ports, special terms) via `pdf-lib` in `tracker/index.html` (`buildCharterAgreementPdf`). Cash/black is never written into the agreement.

If you change the real-world template, drop a new sample here and update the generator to match.
