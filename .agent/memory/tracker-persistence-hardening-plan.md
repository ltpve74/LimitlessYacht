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
- Status (2026-09-11): **SPLIT MODE IS LIVE.** The captain ran Ops → Utilities → Run split
  migration on 2026-09-11 and it succeeded. The live store now uses per-collection keys
  (`coll/*`, `sys/*`); the monolith `data` key is frozen as an archive — never write to it.
  Any future DB script/work must assume split mode (the function dual-reads via the
  `sys/migration` marker). Rollback = `tracker-db-split-migrate.mjs --rollback` (loses
  split-mode saves — deliberate only). Remaining: Phase 3 follow-ups (P4 role-"other"
  payload minimization, empty-leads siteCalendar rebuild; P5 script version bumps +
  summarizePettyCash comment), then the long-term P2 view extraction.
