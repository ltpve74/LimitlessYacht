# Duplicate expenses for one month

On the Expenses month bar, next to Card Excel and Card receipts: **Find duplicates**.

The check covers every expense in the selected month, card and cash. It does not delete anything by itself.

## What counts as a likely copy

- Amounts within €0.05, dates within 5 days, and shop names that match after case, accents, and punctuation are stripped. One name containing the other counts when the shorter name is at least 4 characters. The first word alone does not match, so tender fuel and tender service stay apart.
- The same APA line on two expenses is a duplicate even when the shop text differs.
- Two crew day-pay lines for different charters are not duplicates. The same charter entered twice still is.
- A group is high confidence when the shops are the same, the shared name is long, one side is an APA copy, or both rows are the same APA line. A short shared name is medium.
- The suggested keep prefers a receipt photo, then an APA-linked row, then the more complete line. The boxes start unticked.

## What Luigi can do

- Tick the copies to remove. Delete selected asks first, names each row, and warns when an APA pot or a crew day-pay line is involved. It then calls `expDeleteExpenseById` (tombstone, APA line, stew skip).
- Not a duplicate stores `dupDismiss` on that month’s petty row. Phone and desktop merge keeps every dismiss key. A later extra copy of a dismissed pair shows again.
- Download CSV uses the same report. It does not include the receipt file.

Build stamp on this develop commit: `TRACKER_BUILD` `2026-10-08.8`. Not published. Live stays on `2026-10-08.6` until Luigi asks to go live.
