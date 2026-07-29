# App-owned site calendar (website availability)

**Status:** MVP shipped (seed + activate). Leads-as-gate is next slice.

## Behaviour

| Mode | Public `/api/availability` |
|------|----------------------------|
| Default | Live manager ICS (`AVAILABILITY_ICS_URL`) |
| After captain **Activate** | Netlify Blobs `data.siteCalendar` |
| Env override | `AVAILABILITY_SOURCE=blob` forces blob even if inactive |

Tracker **Stews → Refresh calendar** still uses live ICS (`?fresh=1`). Ops roster is separate from the public site store.

## Captain UI

**Ops → Site calendar**

1. **Seed from manager ICS** — full snapshot into blob (`active` stays false unless already true).
2. Check trip counts / sample dates.
3. **Activate on website** when ready (live guests switch).
4. **Deactivate** to fall back to ICS anytime.

## Files

- `netlify/functions/lib/ics.mjs` — parse + expand + public payload
- `netlify/functions/availability.mjs` — dual source
- `netlify/functions/tracker.mjs` — `seedSiteCalendar`, `getSiteCalendar`, `setSiteCalendarActive`
- `tracker/index.html` — Ops tile + sheet

## Charter book sources (leads)

| Source | Meaning | Captain commission |
|--------|---------|-------------------|
| `captain` | Website or direct contact | Yes 15% |
| `clickboat` | Paul / Click&Boat | No |
| `owner` | Owner-sourced | No |
| `other` | Legacy / unknown | No |

**Import ICS** (`importIcsLeads`): existing leads → captain (unless already clickboat/owner); new calendar events → clickboat + seasonal list price (4h/6h/8h/multi × low/high). Editable on each lead.

## Next

- Rebuild site calendar from active leads only (continuous gate).
- Optional: tag-based source override from ICS title `[CB]` / `[WEB]`.
