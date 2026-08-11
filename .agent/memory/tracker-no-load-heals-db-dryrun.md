# Tracker: no load heals — DB dry-run for money fixes

**Owner rule (2026-08-03, reconfirmed after floatPay / petty mess):**

## Do not

- **No on-load / open-tab data heals** that rewrite `expenses`, `expPetty`, or `stewAssign` and save to the shared blob.
- No “restore from proof”, bulk unpark of past Paid, bulk floatPay wipe/restore, or other massaging when the app opens.
- No fixing money by hoping the UI re-save will invent the right books.

## Do instead

1. **Dry-run first** — `TRACKER_PASSCODE=… node scripts/tracker-db-dryrun.mjs`  
   (pull live blob, list exact field changes, July/Aug settlement, pure carry plan).
2. **Captain reviews** the dry-run.
3. **Apply once on the database** — e.g. `--apply-july-aug-2026` or a one-shot API save of only the collections needed — **not** via app load hooks.
4. **Rules in models/controllers** — carry / pocket / floatPay math never re-invented in `index.html` paint.
5. **Fix the root code path** that created the bad write so it cannot recur (e.g. re-mark Paid must not re-set `floatPay` and re-hit the envelope).

## Known-good petty snapshot (captain)

- **August brought forward was −€110** (boat short €110) and that was **right**.
- **July open money (before the mess):** only  
  - **€200 day pay → Laura** (Diego charter), and  
  - **€100 tips → Laura, paid by card, outstanding**  
  (captain was about to mark paid; record already showed Paid = ghost — that is what we were carefully fixing).
- **Toni 12 Jul (click and boat) is Paid** — not open. Live blob may still show Unpaid; DB fix sets Paid with **no** `floatPay` re-hit.

## Symptom of the mess to avoid

Re-marking crew “Paid” (or load heals) sets `floatPay=true` again → **petty subtracted again** for days already settled. Looks like duplicate charges even when there is only one expense row per stew|date.

## Related

- [tracker-floatpay-wipe-bug.md](tracker-floatpay-wipe-bug.md) — floatPay wipe history
- [tracker-always-push-live.md](tracker-always-push-live.md) — tracker still publishes to main for **code** fixes; **data** fixes are dry-run → DB only
