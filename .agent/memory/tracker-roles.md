# Tracker roles (simple user system)

**Roles:** `captain` | `manager` | `team`

| Role | Login | Access |
|------|--------|--------|
| Captain | Role Captain + pass | Full (ops, expenses, stews pay, APA…) |
| Manager | Role Manager + pass | Charges + Leads + Security |
| Team | Role Team + **name** + pass | Roster only (charters assign + team list view) |

**Passcodes (Netlify env):**
- `TRACKER_PASSCODE` — captain (required)
- `TRACKER_MANAGER_PASSCODE` — optional; falls back to captain pass
- `TRACKER_TEAM_PASSCODE` — optional; falls back to captain pass

Set separate team/manager codes when ready so stews don’t share the captain code.

**Server:** `netlify/functions/tracker.mjs` — `roleOf`, `passOk`, load/save gated by role.
**Client:** `session.role` + `canRoster` / `canCommercial` / `canOps`.

Team can tick who is on a charter; cannot mark day pay Paid or edit expenses.

**Calendar source of truth**
- Captain: **Refresh calendar** hits live ICS, then saves `stewCalendar` snapshot to Netlify Blobs.
- Team: loads roster list from blob `stewCalendar` only; **Reload roster** re-fetches blob (no live ICS).
- Assignments still live in `stewAssign` (both roles can save).
