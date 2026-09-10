# Tracker persistence hardening plan (2026-09-11)

Plan lives at [.agent/briefs/2026-09-11-tracker-persistence-hardening.md](../briefs/2026-09-11-tracker-persistence-hardening.md).

- Code review found the last real data-loss risk: whole-blob read-modify-write in
  `netlify/functions/tracker.mjs` — concurrent saves of *different* collections can clobber
  each other (same-collection races already fixed by merge functions). Also: `sendPushes`
  runs before `saveData` (notify-then-maybe-fail).
- Approved direction: split the monolith `data` blob into one key per collection
  (`coll/*`, `sys/*`), dual-mode load gated on a `sys/migration` marker, monolith kept
  forever as archive. Rollback = delete the marker.
- Backup-first: server-side `action:"snapshot"` → `archive/data-<stamp>` + existing local
  `tracker-db-backup.mjs`; migration is idempotent and only writes new keys.
- Status: plan drafted, awaiting captain go-ahead. Phase 0+1 (snapshot action, server
  concurrency test harness, push-after-save reorder) ship together; Phase 2 is the split.
