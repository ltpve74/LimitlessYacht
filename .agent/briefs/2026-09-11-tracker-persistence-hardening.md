# Tracker persistence hardening plan — split-blob + push ordering

**Date:** 2026-09-11 · **Status:** Phase 0+1 shipped ✅ · Phase 2 code shipped ✅ — **awaiting captain to run the migration** (Ops → Utilities → Run split migration) · **Author:** agent (code review follow-up)

**Goal:** eliminate the last data-loss paths in the tracker server without losing a single row of
live data. The captain relies on this daily — every phase is backup-first, reversible, and
independently shippable.

**Problems addressed** (from the 2026-09-11 code review):

- **P1 — cross-collection write race.** Every save does a whole-blob read-modify-write:
  `loadData` reads the single `data` key (`netlify/functions/tracker.mjs:513`), the save action
  mutates one collection (`tracker.mjs:2698-2843`), `saveData` writes the whole blob back
  (`tracker.mjs:1657-1668`). Same-collection races are already handled by the merge functions;
  **two concurrent saves of *different* collections can still silently discard each other**
  (captain saves `expenses` while a stew saves `stewAssign` — the later write restores the other
  collection to its pre-request state).
- **P3 — push before persist.** `sendPushes` runs *before* `saveData` (`tracker.mjs:2872-2875`),
  so a failed blob write still tells other devices "Updated on another device", and any
  dead-subscription cleanup `sendPushes` did to `data.pushSubs` is lost.

**Scope confirmed by inspection:** only `netlify/functions/tracker.mjs` reads/writes the private
blob (`getStore("limitless-tracker")`, line 2569). `availability.mjs` reads only the separate
`public-availability` key and never the private blob, so the public site calendar is unaffected
by this work. The save API is already single-collection (`{action:"save", collection, rows}`),
which is what makes the split clean.

---

## Design: one key per collection

Replace the single `data` blob with per-collection keys in the same `limitless-tracker` store:

| New key | Contents | Written by |
|---|---|---|
| `coll/charters` `coll/leads` `coll/apa` `coll/diesel` `coll/stews` `coll/stewAssign` `coll/stewCalendar` `coll/expenses` `coll/expPetty` | the 9 captain-writable collections | save action for that collection only |
| `sys/siteCalendar` | derived public calendar object | leads saves + site-calendar actions |
| `sys/meta` | `meta` object (tombstones, ICS known-keys, stewCalendar stamps) | saves that touch meta |
| `sys/devices` | device list (cap 200) | any authed request (`touchDevice`) |
| `sys/log` | security/op log (cap 500) | any action (`addLog`) |
| `sys/pushSubs` | push subscriptions (cap 40) | push actions + sendPushes cleanup |
| `sys/migration` | marker `{ migratedAt, from, counts }` — flips the function into split mode | migration script only |
| `archive/data-<stamp>` | frozen copy of the monolith, kept forever | snapshot action / migration |

**Why this kills the race:** a save now reads and writes *only the keys it touches*. Captain's
`expenses` save and a stew's `stewAssign` save no longer share a blob, so they cannot clobber
each other. Same-collection concurrency keeps using the existing merge functions unchanged
(`mergeCollectionPreserveMissing`, `mergeExpPettyCollection`, `mergeStewAssignCollection`, APA
tombstones) — they operate on `prev` rows read from that collection's own key.

**Derived writes stay correct:** a leads save currently also rewrites `siteCalendar`,
`stewCalendar`, and `meta` (`tracker.mjs:2844-2852`). In split mode it writes `coll/leads` +
`sys/siteCalendar` + `coll/stewCalendar` + `sys/meta` — all derived from the same request, so
concurrent leads saves converge via the existing merge. Non-atomic multi-key writes can at worst
leave a derived key stale until the next save; the public availability payload is rebuilt from
`coll/leads` on every save, so guest-facing state self-heals.

**The one shared key that still matters: `sys/meta`.** It carries the APA tombstones
(`apaDeletedIds`) and ICS known-keys — losing those resurrects deleted pots/leads, the exact
bugs they were added for. So `sys/meta` writes get a **union-merge**: set-valued fields
(`apaDeletedIds`, `icsLeadKnownKeys`) are unioned with the freshly re-read value; scalar
timestamps are last-write-wins. `sys/log`, `sys/devices`, `sys/pushSubs` races are cosmetic
(lost log line, stale `lastSeen`, delayed sub cleanup) and acceptable.

**Dual-mode load for zero-downtime switchover:** `loadData` first checks `sys/migration`.
Marker present → assemble the blob shape from split keys (parallel reads). Marker absent →
read the monolith exactly as today. The monolith is **never deleted**, so rollback = delete the
marker key.

---

## Phase 0 — backups and safety net (no behavior change)

1. **Local backup now:** `TRACKER_PASSCODE=… node scripts/tracker-db-backup.mjs pre-hardening`
   → timestamped snapshot under `.tracker-backups/` (refuses to snapshot an empty money blob).
2. **Add a server-side snapshot action** to `tracker.mjs` (captain-only):
   `{action:"snapshot"}` copies the current `data` blob to `archive/data-<isostamp>` inside the
   same store and returns the key. Rationale: local backups die with a laptop; the archive lives
   next to the data. Add `scripts/tracker-snapshot.mjs` calling it. ~30 lines, additive only.
3. **Add a server test harness** `scripts/test-tracker-server.mjs` with an in-memory fake blob
   store (`get`/`setJSON`/`delete` over a Map) that imports `tracker.mjs`'s handler and drives
   it with fake requests. First test is the **P1 regression test, expected RED on current code**:
   interleave an `expenses` save and a `stewAssign` save (both load before either writes) and
   assert both collections survive. Also assert push-after-save ordering with a spy (RED today).
4. Run the full existing suite — must stay green: `node scripts/test-tracker-models.mjs`.

**Publish:** phases 0+1 together → `main` (tracker rule: tracker work always goes live).

## Phase 1 — push ordering fix (small, ships with Phase 0)

In the save action (`tracker.mjs:2872-2875`) and the ICS import path (`tracker.mjs:3031`):
move `sendPushes` to **after** `saveData`. `sendPushes` already returns which endpoints died;
collect those and prune `pushSubs` in the same pre-push save so cleanup persists. Result:
devices are only notified about state that actually persisted. Same change in both places,
covered by the Phase 0 spy test turning green.

## Phase 2 — split-blob migration (the P1 fix)

1. **Implement split mode in `tracker.mjs`:**
   - `loadData(store)` → dual-mode as above; `saveData` replaced by
     `saveKeys(store, { coll, rows, metaPatch, derived })` writing only touched keys with the
     `sys/meta` union-merge.
   - All actions keep their current semantics; only the persistence layer changes.
2. **Migration script** `scripts/tracker-db-split-migrate.mjs` (idempotent, re-runnable):
   1. `backupLive("pre-split-migration")` (local) + `action:"snapshot"` (server archive).
   2. Load monolith; write every split key from it; deep-compare each key against the source
      collection (counts + JSON equality); only then write `sys/migration`.
   3. Re-load through the API (`action:"load"`) and diff against the monolith snapshot —
      must be identical except `log`/`devices` timestamps.
3. **Deploy in a short quiet window** (no charter ops, ~10 min, evening):
   deploy function (still monolith mode — zero change) → run migration → marker flips mode →
   smoke-test one save per role (captain expenses, team stewAssign, manager leads) → verify
   public site calendar unchanged.
4. **Rollback:** delete `sys/migration` (script flag `--rollback`) → function reads the
   untouched monolith again. Any saves made during split mode would need re-entry — hence the
   short window and immediate smoke test.
5. **Keep `archive/data-*` and the monolith `data` key indefinitely.** Storage cost is trivial;
   deletion is a separate, explicitly approved task months later, if ever.

**Tests that must pass before deploy:** P1 regression test green in split mode; all merge tests
re-run against split keys; meta union-merge concurrency test; migration dry-run against a
fixture blob; `test-tracker-models.mjs` green; publish gate (site tests → UX smoke →
Lighthouse) via the normal `main` pre-commit hook.

## Phase 3 — follow-ups (separate task, not blocking)

- P4: minimize the `role === "other"` load payload (drop `devices`/`log`/`pushEnabled`).
- P4: rebuild `siteCalendar` even when `leads` is empty (currently guarded by
  `data.leads.length`, `tracker.mjs:1659`).
- P5: bump stale script query-versions in `tracker/index.html:1594-1611`; fix the
  `summarizePettyCash` comment in `tracker/js/models/expenses.js`.

---

## Data-safety invariants (apply to every phase)

1. No write path ships without a green server test proving both concurrent saves survive.
2. Every migration/apply step runs `backupLive` first and refuses empty money collections
   (existing `tracker-db-io.mjs` guards).
3. The monolith and `archive/*` keys are never modified after creation — only new keys are
   written, so every step is reversible by deleting keys, never by restoring over live data.
4. Each phase ends published to `main` (tracker rule) only after the captain confirms the live
   smoke test.
5. If anything smells wrong mid-migration: stop, delete `sys/migration`, verify load, and the
   system is exactly as before.
