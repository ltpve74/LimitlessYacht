# Tracker: captain salary saved then disappeared

**Symptom (2026-09):** Captain logged Crew Salaries €2000 Owner money + €2500
Petty cash via Expenses +. UI showed saved; later both lines were gone
(refresh / other device).

**Causes (stacked):**

1. **Save-echo full replace** — `save()` adopted `j.rows` with
   `state.expenses = adopted`. A second salary added while the first save was
   in flight vanished when the older response landed.
2. **softRefresh fingerprint before apply** — poll set `lastSoftSyncFp` then
   skipped expenses merge under `localSaveIsFresh`. Later polls saw `!changed`
   and never merged; hard load could then show a server without the lines.
3. **Bare `Crew Salaries` as day-pay** — `isCrewDayPayExpense` treated category
   alone (missing `source:"manual"`) as stew day-pay → orphan/strip paths could
   delete blank-description unpaid lines.

**Fix:**

- Adopt save echoes via `mergeExpensesById` (also leads/charters/apa/stewAssign).
- Always `mergeExpensesById` on `fromPoll` for expenses (no fresh skip).
- Set `lastSoftSyncFp` **after** `applyData`.
- Day-pay only with stew markers; bare/manual Crew Salaries stay ledger lines.
- Orphan cleaner must not delete non-day-pay Crew Salaries.
