# Tracker: Owner money edit rewrote date + desktop split → all-owner

**Symptom (2026-09):** Editing Laura’s late-Aug day pay to Owner money moved the
expense date to today. Desktop boss+petty split saved as full Owner money.

**Causes:**

1. Expenses `applyCrewPayFlags` had a bare `Owner money` branch *before* the
   Guest/Owner split branch — always full owner, forced `e.date = today`.
2. Stews re-open inferred Owner money from expenses but only restored
   `guestPaidAmt` / `topUpFrom` for Guest (not Owner).
3. Model `planStewDayPayExpenseLines` stamped Own/Owner/Guest marks to pay day
   even when an Aug expense already existed.
4. Owner+Petty top-up only set `_floatPayMark` on first Unpaid→Paid, so editing
   an already-Paid charter into a split never hit petty.

**Fix:** split Owner/Guest together (no bare Owner wipe); never stamp today on
edit; keep charter/prior date unless first floatPay petty mark; restore Owner
split on Stews re-open; allow petty top-up mark when float missing.
