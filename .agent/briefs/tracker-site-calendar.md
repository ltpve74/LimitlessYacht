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

## Next

- Import ICS trips missing from leads as Click&Boat (manual re-tag owner/website).
- Rebuild site calendar from active leads only (continuous gate).
