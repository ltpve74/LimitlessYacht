# Tracker expenses: preserve-merge (no phone/desktop wipe)

**Symptom (2026-08):** Captain salary €2500 added on desktop disappeared after
refresh / switching device.

**Cause:** `expenses` was still a **full-array replace** on save. Another open
client with a slightly older list could save and wipe rows it never loaded.
(Leads/charters/APA already used preserve-merge.)

**Fix:**

1. Server `mergeCollectionPreserveMissing` for `expenses` (explicit `deletedIds` only).
2. Client tombstones + `deletedIds` on expense delete; adopt echoed merged rows.
3. Manual `source:"manual"` Crew Salaries are **not** stew day-pay ghosts; Paid /
   Unpaid controls whether Cash+Petty hits the envelope.
