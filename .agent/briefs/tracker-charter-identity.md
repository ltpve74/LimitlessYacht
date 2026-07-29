# Tracker: charter identity (leads ↔ calendar ↔ stews)

**Status:** fixed flaky path (2026-07-30). Alvaro cancel survives ICS delete via `leadcancel:{leadId}` ghost.

## Problem (original)

Stews and cancel logic used **guest name + date**. When the ICS event moves or is put on hold, or the title omits the guest, links break. The calendar is a **schedule view**, not the commercial identity.

## Incident + fix (Oliver / Alvaro)

### What went wrong
1. Alvaro cancelled commercially; **ICS event deleted by mistake**.
2. Soft cancel / same-day fallback cancelled **Oliver** (`Cancelled with lead Alvaro — no stew pay`).
3. Bad pin could move dates (Alvaro → 14th) when following the wrong ICS uid.
4. `purgeOrphanStewAssigns` wiped stew rows when ICS uid vanished → looked like “lost data”.

### Fix (tracker/index.html)
- **No soft cancel** on cancel path (no name/date steal, no nearest-day).
- Cancelled lead always gets a stew row:
  - safe ICS key only if title matches guest, else **`leadcancel:{lead.id}` ghost**.
- **Purge never drops** cancelled / `cancelGhost` / `leadcancel:*` assigns.
- **Roster re-injects** cancelled ghosts so Alvaro stays visible after ICS delete.
- Date sync skips cancelled/ghost rows (won’t follow wrong uid to the 14th).
- Manual uncancel still uses `cancelOverride`.

### Commercial data (not lost)
- **Leads** (deal, invoices, cancel status) live in blob `leads` — independent of ICS.
- **Stew pay** for cancelled charters is forced Unpaid + expense day-pay lines removed.
- If Oliver is missing from the **roster list**, check **Google Calendar / ICS first** — live feed is authority for active charters.

### Owner checklist after deploy / hard-refresh
1. Captain login → **Stews** once (creates Alvaro cancel ghost if lead is cancelled).
2. **Leads** tab: confirm Alvaro is still **Cancelled** (if Active, set Cancelled again).
3. Google Calendar: restore **Oliver** if you deleted him by mistake; remove any wrong **Alvaro** event if he should not appear as active.
4. Captain **Refresh calendar** after ICS is correct → snapshot for team.
5. If Alvaro’s lead **date** shows the 14th wrongly, edit the lead start date (commercial) — cancel ghost uses lead dates.

## Source of truth

| Layer | Stable id | Dates / status |
|-------|-----------|----------------|
| **Lead** (deal) | `lead.id` | commercial start/end; bookingStatus active\|cancelled |
| **Calendar event** (ICS) | `uid:…` | schedule only |
| **Stew assign** | `eventKey` (= ICS key or `leadcancel:{id}`) | pay; leadId; cancelled; cancelOverride |

## Rules

1. Never use name+date as the only join once a link exists.
2. Cancel: hard id only, else durable ghost — **never** nearest same-day assign.
3. Deleting from ICS must not cancel another charter and must not erase cancelled-lead stew rows.
4. Soft match only for suggesting links (display), not for cancel.
