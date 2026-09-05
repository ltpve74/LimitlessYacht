# Tracker: phone vs desktop cash numbers disagree

**Symptom (2026-09):** Cash expenses / petty totals entered on one device
did not match the other (app vs desktop).

**Causes:**

1. **`expPetty` full-replace on server** — desktop with an older month bag
   could overwrite phone cash-ins / starts. Expenses already used
   preserve-merge; petty did not.
2. **Weak sync fingerprint** — only row counts + amount sums. Two different
   ledgers with the same total looked “unchanged,” so soft-refresh skipped.
3. Soft poll was 15s; open tabs could stay stale longer than they felt.

**Fix:**

- Server `mergeExpPettyCollection` (by month + cashIn id); echo `rows` on save.
- Client adopts merged `expPetty` after save; always merge on poll.
- Fingerprint includes id/amount/paidFrom/updatedAt hashes.
- Soft poll ~8s; heal re-pushes local-only expense/cash-in ids missing remotely.
