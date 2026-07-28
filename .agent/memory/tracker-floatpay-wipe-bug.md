# Tracker: petty cash “reverted” after crew pays (floatPay wipe)

**Symptom:** Expenses petty cash jumps back up (e.g. ~€50 → ~€1,740) after the captain paid crew/pocket from the envelope. Looks like a “website update overwrote tracker.”

**Not a website overwrite.** Tracker data is Netlify Blobs (`expPetty` + `expenses`), separate from gallery publishes. `main`/`develop` tracker source matched; site commits did not wipe money fields.

**Root cause:** `expResetInventedCrewFloatPay` (introduced with float-books split) cleared **every** `floatPay===true` on first open of a browser missing `localStorage ly_exp_floatpay_v2`, then **saved to the shared server**. Crew still showed **Paid**, but cash no longer left the envelope → petty cash inflated; “Paid crew not from this pot” rose.

**Fix (feature/tracker):** destructive wipe removed. Replaced with `expRestoreCrewFloatPayAfterWipe` — restores `floatPay` for intentional Paid-via-petty lines (`payStatusManual` on expense or stew assign). Seed/sync also keep floatPay from manual pays.

**If balance still wrong after deploy:** check Expenses cash movement — if “Paid crew not from this pot” is large, re-save those Stews as Paid once (or ensure lines have `payStatusManual`). Reimbursements (pocket) use Cash + Petty, not floatPay.
