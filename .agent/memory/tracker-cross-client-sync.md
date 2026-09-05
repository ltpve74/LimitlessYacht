# Tracker cross-client sync (phone ↔ desktop)

**Problem:** Editing cash-in / expenses on mobile did not update an open desktop
tab. Human push notices only cover leads/charges/crew — `expPetty` saved with
**zero** notices, so nothing woke other devices. Background `applyData` polling
had been removed earlier because it fought local edits.

**Fix (2026-08):**

1. **Silent sync push** on every save that has no human banner (cash-in,
   expenses, APA, diesel, …) → `to: "commercial"`, `silent: true`.
2. **SW v3:** silent pushes refresh open tracker tabs with no banner; banner
   only if that device has no open `/tracker` window.
3. **Visible soft-refresh** every ~15s while the tab is focused, plus on
   `visibilitychange` / `focus` (fingerprint skip when unchanged; respects
   `localSaveIsFresh`).
4. **BroadcastChannel** `ly-tracker-sync` so other tabs on the same browser
   refresh immediately after a local save.

Merges (`mergeExpPetty` / `amountManual` / `fromPoll`) keep mid-edit devices safe.

**2026-09:** Server also preserve-merges `expPetty` by month + cashIn id (was
full-replace). Soft fingerprint hashes expense/cash-in ids+amounts so desktop
cannot stay stale when totals collide. Soft poll ~8s. See
`tracker-phone-desktop-cash-diverge.md`.
