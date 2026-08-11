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
3. **Backup before any write** (mandatory):
   - `TRACKER_PASSCODE=… node scripts/tracker-db-backup.mjs [label]`
   - or any apply path that calls `backupLive()` in `scripts/lib/tracker-db-io.mjs`
   - Snapshots land in **`.tracker-backups/<stamp>-<label>/`** (gitignored; override with `TRACKER_BACKUP_DIR`)
   - Files: `expenses.json`, `expPetty.json`, `full-money.json`, `manifest.json`
4. **Apply once on the database** — e.g. `--apply-july-aug-2026` or `saveCollection()` — **not** via app load hooks.  
   Dry-run apply already backups first. Ad-hoc agent scripts **must** call `backupLive` then `saveCollection({ backupDir })`.
5. **Rules in models/controllers** — carry / pocket / floatPay math never re-invented in `index.html` paint.
6. **Fix the root code path** that created the bad write so it cannot recur (e.g. re-mark Paid must not re-set `floatPay` and re-hit the envelope).

## Save API shape (wipe guard)

- Correct: `{ action: "save", collection: "expenses"|"expPetty"|…, rows: [...] }`
- Wrong: `coll` / `data` → server treats rows as missing → **full-replaces with `[]`**
- `saveCollection()` refuses `expenses=[]` unless `allowEmptyRows: true`
- `writeBackup()` refuses empty expenses snapshot (looks wiped)

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
