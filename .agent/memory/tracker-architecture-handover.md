# Tracker architecture handover (2026-09-11)

Map lives at [.agent/briefs/2026-09-11-tracker-architecture-handover.md](../briefs/2026-09-11-tracker-architecture-handover.md).

- Split-blob storage is LIVE (`coll/*` + `sys/*`, gated on `sys/migration`; monolith `data`
  key is a frozen archive — never write it).
- Deletes only stick via `deletedIds` tombstones — the server preserve-merge resurrects
  anything else. Stew day-pay lines are tombstoned on drop; Expenses tab open self-heals
  pre-fix ghosts.
- Notifications: persist → then push; silent wakes share tag `tracker-sync` and carry
  `describeSaveFallback` diffs ("Pay → Unpaid: …", "Removed €200 Crew Salaries").
  Generic "Updated on another device" means prev==next after merge — a missing tombstone smell.
- Sync fingerprint hashes stewAssign/expenses/expPetty CONTENTS; `applyData` reports
  `skippedFresh` and soft-refresh must not mark the fingerprint current over a skipped merge.
- `TRACKER_BUILD` shows in Ops → Security; bump it + the sw.js v-comment on every client
  change. PWAs update only after a full close + reopen.
