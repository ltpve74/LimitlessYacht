# Tracker architecture handover — post-hardening (2026-09-11)

**Purpose:** map of the tracker as it stands after the 2026-09-11 hardening (all phases of
`2026-09-11-tracker-persistence-hardening.md` shipped). Read this before touching
`netlify/functions/tracker.mjs`, `tracker/index.html`, or `tracker/sw.js`.

## Storage: split-blob (LIVE since 2026-09-11)

Store `limitless-tracker` (Netlify Blobs). Mode is gated on the `sys/migration` marker key.

| Key | Contents | Written by |
|---|---|---|
| `coll/<name>` | 9 collections: charters, leads, apa, diesel, stews, stewAssign, stewCalendar, expenses, expPetty | only that collection's save |
| `sys/siteCalendar` | derived public website calendar | rebuilt from leads on every persist (empty leads = empty calendar — no guard) |
| `sys/meta` | tombstones (`apaDeletedIds`, `icsLeadKnownKeys`), stewCalendar stamps, stewLoginNames | saves touching meta; **union-merge** for set fields |
| `sys/devices`, `sys/log`, `sys/pushSubs` | security + push state | any authed request / push actions |
| `sys/migration` | marker flipping split mode on | migration only; delete = rollback to monolith |
| `data` | **frozen monolith archive — never write** | pre-migration legacy |
| `archive/data-<stamp>` | frozen snapshots (snapshot action / Utilities panel) | captain only |

`loadData` dual-reads: marker present → assemble blob shape from split keys; absent → monolith.
`saveData` writes only fingerprint-changed keys. A save of one collection cannot clobber another
(the old P1 whole-blob race — regression-tested in both modes).

## Delete rules — tombstones are load-bearing

Server merges preserve rows a client simply didn't send (`mergeCollectionPreserveMissing`).
**A row is only truly deleted when its id arrives in `deletedIds`.** Client side:

- `voidDeletedId(coll, id)` queues + durably tombstones (localStorage `ly_tracker_tombstones_v1`).
- `save()` re-sends all tombstones (cap 80) with every save of leads/charters/apa/expenses.
- `syncStewDayPayExpenses` tombstones day-pay line ids the plan does not re-create — without
  this the server resurrected ghost Crew Salaries rows and the sync wake went generic.
- `expStripUnpaidStewDayPayExpenses` (runs on Expenses tab open, captain only) self-heals
  pre-fix ghosts: Unpaid crew day-pay lines must not exist in the ledger.

## Notifications (server → push → SW → open clients)

1. Save persists FIRST, then `sendPushes` (push-before-persist was Phase 1's fix).
2. `buildNotices` produces human banners for lead lifecycle events; pay-only flips skip it.
3. Anything else gets a **silent fallback wake** whose body is `describeSaveFallback(coll, prev,
   next) + " (by who)"` — diffs by row key, leads with status flips ("Pay → Unpaid: …",
   "Removed €200 Crew Salaries"), generic "Updated on another device" only when prev==next
   after merge (a smell — means the client didn't tombstone a delete).
4. All silent wakes share collapse tag `tracker-sync` → platforms replace, not stack.
5. Sender's own endpoint is excluded (`excludeEndpoint`).
6. `tracker/sw.js`: silent push + open tracker client → postMessage only (no banner); no open
   client → system banner. Always postMessages `tracker-data-changed`.
7. Client `wirePushRefreshListener` → `softRefreshFromServer` → fingerprint gate → `applyData`.

Role "other" (captain passcode, unrecognised name) gets NO devices/log/VAPID key on load.

## Sync fingerprint (client, `dataSyncFingerprint`)

Hashes row CONTENTS of expenses/expPetty/stewAssign (incl. payStatus) + counts + max updatedAt.
A pay flip changes the hash even though counts/totals don't move.

**Invariant:** `lastSoftSyncFp` must only be set when the merge actually ran. `applyData`
returns `{skippedFresh:true}` when a collection was kept local (save in flight,
`localSaveIsFresh` windows: leads/charters/apa 120s, expenses/expPetty 25s, else 15s);
`softRefreshFromServer` then leaves the fingerprint stale so the next poll re-merges.
Marking it current over a skipped merge froze views until the next edit.

`mergeExpensesById(local, remote)`: by id, newer `updatedAt` wins, tie → remote.

## Version verification

`TRACKER_BUILD` in `tracker/index.html` — shown in Ops → Security ("App build …"). Bump it on
every tracker client change; bump the `tracker/sw.js` v-comment too (byte-diff triggers SW
update). PWAs only pick up new code after a FULL close + reopen. js file cache-busting:
`?v=YYYYMMDD-name` tags on all 18 `<script src>` in index.html — bump together.

## Testing

- `node scripts/test-tracker-server.mjs` — real handler, in-memory store
  (`globalThis.__TRACKER_TEST_STORE__`), webpush stub records `{type:"push",…}` in `events`.
  Helpers: `api(body,{role,pass,who,deviceId})`, `seedData(patch)` (monolith),
  `seedSplitData(patch)`, `liveData()`. Expect "N passed, 0 failed, 1 known-fail" (the
  pre-split monolith race xfail — keep it).
- `node scripts/test-tracker-models.mjs` — domain model suite (runs in pre-commit too).
- Boot smoke: `python3 scripts/dev-server.py` + headless Chrome `--remote-debugging-port=9333`
  + `node .agent/briefs/tracker-smoke-cdp.js`; kill both after, `rm -rf /tmp/tracker-smoke-profile`.

## Release flow (unchanged rules)

Work on `develop`; publish = checkout main → `git merge --no-ff --no-commit develop` → commit
`"Publish: …"` (hook minifies + gate) → push → clean `.agent` leftovers → back to develop.
**Tracker changes always publish to main immediately** (owner rule). `.agent/` never ships.
Watch which branch you're on before every commit.
