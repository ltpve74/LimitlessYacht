# Tracker: stewAssign concurrent full-replace race (Laura self-assign)

**Date:** 2026-08-08 (symptom reported)

## What happened

Laura assigned herself to a September charter → push notification fired (“Stew assigned”) → captain congratulated her → captain used **Sync calendar dates** (update leads from calendar) → Laura no longer on the charter.

## Was it local data overwriting the blob on load?

**No.** On boot:

- `applyData(..., {fromBoot:true})` loads **server** collections as SOT.
- `runPostLoadMaintenance` only paints — **no** stewAssign heal/restore/save.
- Local backup (`ly_tracker_stewAssign_backup_v1`) is **explicit Restore crew only**.
- Background poll is **session-only** (no collection rewrite).

Local storage is **not** used to push stewAssign onto the blob on open.

## Real cause

`stewAssign` saves were **full-array replace** on the server (unlike leads/charters, which merge-preserve missing rows).

Race:

1. Captain (or another tab) has an older in-memory `stewAssign` **without** Laura.
2. Laura saves → blob has Laura → notification fires.
3. Any later `save stewAssign` from the stale client **replaces the whole array** → Laura gone.
4. Sync calendar then returns whatever is on the server (already wiped). Sync itself does **not** clear `stewIds`; it only reads assigns for times and rebuilds `stewCalendar`.

So the wipe is usually a **stale concurrent stewAssign save**, not “local on load” and not ICS sync rewriting crew.

## Fix (code)

In `netlify/functions/tracker.mjs`:

- `mergeStewAssignCollection`: preserve server-only rows; per-eventKey last-write-wins by `updatedAt`; refuse equal-ts crew wipe unless `noStewNeeded`.
- Save response echoes `rows` for `stewAssign`; client adopts merged rows.

Also: `ensureStewAssignFromCalendar` no longer sets `stewIds` to title-only tokens when crew already exists (match rebuild — never wipe).

## Re-assign Laura

Captain or Laura: open the September charter in Stews → tick Laura → Save. With the merge fix, a later captain save should not drop her again.
