# Tracker examples (private — not public)

Sample files for building the captain ops tools (monthly expenses spreadsheet, invoice PDF, APA workbook).

**Never deploy to production.**

| Guard | What it does |
|--------|----------------|
| `.netlifyignore` | Excludes `tracker/examples/` from Netlify |
| main pre-commit | Strips `tracker/examples/` on publish commits |
| GitHub Pages prepare | Skips any path segment named `examples` |

Keep samples here on `develop` for agents/reference only.
