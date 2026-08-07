# Stews ghost: “henry - stew Vicky” 14–15 Aug next to Guido 13–14

**Reported:** 2026-08-08

## What you see

- Correct: **Guido 13–14 Aug** (commercial lead, multi 2 days).
- Wrong: **14–15 “henry - stew Vicky”** as a second Stews card.

## Data

- Real lead: `lead-ics-635BAD32-…-2026-08-13` · calendar `uid:635BAD32-…` · Guido · 13–14.
- Ghost assign (no leadId): `uid:A2B1E01C-…` · summary `henry - stew Vicky` · start 14 · end 15 · crew Toni · by Toni · notes “Josy”.
- Same ghost was in `tracker/stew-calendar-seed.json` (from ICS snapshot). Manager calendar had two overlapping all-day blocks; only Guido was imported as a lead.

## Why it showed in Stews

Team (and any path with empty `stewEventsFromLeads`) **injected crew-orphan** `stewAssign` rows that were not on the curated feed.  
Dedupe only blocked **same start day** as a lead — Guido starts **13**, orphan starts **14**, so the ghost passed.

Captain with leads SOT already skipped inject; team still painted the orphan.

## Fix

1. UI: never inject non-cancel assign-crew-orphans when a curated feed exists (leads or team blob). Overlap any covered multi-day day.
2. Seed: remove `uid:A2B1E01C` ghost; Guido days = 13+14.
3. Blob orphan may still exist until captain deletes it or a one-shot DB cleanup — UI no longer shows it.

## Not a local-on-load overwrite

This was roster **display inject + leftover ICS uid assign**, not load heal writing the blob.
