# Tracker: charter identity (leads ↔ calendar ↔ stews)

**Status:** implementing (2026-07-29). Owner: calendar date/name matching is flaky (Alvaro moved on-hold → Toni still owed).

## Problem

Stews and cancel logic used **guest name + date**. When the ICS event moves or is put on hold, or the title omits the guest, links break. The calendar is a **schedule view**, not the commercial identity.

## Source of truth

| Layer | Stable id | Dates / status |
|-------|-----------|----------------|
| **Lead** (deal) | `lead.id` (UUID at create) | `start`/`end` commercial; `bookingStatus` active\|cancelled; invoice statuses |
| **Calendar event** (ICS) | `key` = `uid:{ICS_UID}` (already from availability feed) | `start`/`end`/times/status (booked\|tentative) can change freely |
| **Stew assign** | `eventKey` = calendar key | pay, stews, tips; `leadId` reverse link; `cancelled` flag |

**Link:** `lead.calendarEventKey` ↔ `stewAssign.eventKey` (+ `stewAssign.leadId`).

Same charter after a reschedule = **same ICS UID** → same `eventKey` → same stew assign + lead link. Date is an attribute, not the id.

## Rules

1. Never use name+date as the only join once a link exists.
2. Creating a lead: always get `lead.id`; optionally pick calendar event immediately.
3. Creating/seeing a calendar day: stews key by ICS uid; optional “Link lead”.
4. Date change on calendar: refresh assign `start`/`end` from live event; do not create a new assign.
5. Cancel: set `lead.bookingStatus=cancelled` (and deposit refunded when captain weather); clear pay via `calendarEventKey` / `leadId`, not title match.
6. Soft match by name/date only to **suggest** a link once; never re-match over an existing key.

## Fallback soft match (unlink only)

Used once to propose links or for legacy rows without `calendarEventKey`. Prefer exact ICS link after.

## Out of scope here

Writing a new UID into Google Calendar from the tracker (would need Calendar API). Until then ICS uid is the calendar-side id.
