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
- Status (2026-09-11): Phase 0+1 shipped (snapshot action + Utilities panel + push-after-save).
  Phase 2 split-blob code shipped: dual-mode load gated on `sys/migration` marker, change-aware
  saves (fingerprint per key), meta tombstone union-merge, captain-only migrateSplit /
  splitRollback / splitStatus actions, Utilities "Storage engine" card, CLI
  `scripts/tracker-db-split-migrate.mjs`. Monolith race stays a documented xfail; split mode
  passes the same interleave as a hard assert (14 server tests green).
  **Next: captain presses Ops → Utilities → Run split migration** (take an archive backup
  first via the button above it). After he confirms split active + normal app behavior,
  the hardening is complete. Rollback = splitRollback (CLI) — loses split-mode saves.
