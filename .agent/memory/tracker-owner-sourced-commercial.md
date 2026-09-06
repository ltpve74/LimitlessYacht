# Owner’s days → Owner-sourced commercial

**2026-09-06 (approved plan + review):** Boat is commercial. Former **owner’s days** alias to **ownersourced**.

## Rules

- `constrainLeadSource("owner"|"owner-days"|private|…)` → `ownersourced`
- Notional commercial price = public `CHARTER_RATES` list **− 20%** (`OWNER_SOURCED_LIST_DISCOUNT`)
- **Recognized income** = Issued/Paid dep+fin+apa **only** (no free-cash / owner-pocket guesses)
- **Possible lost income** = max(0, notional − recognized) — commercial **supposition**; we do **not** track owner pocket
- **Provider commission** (fairness for the **owner** as a business provider — **not** captain petty): book **10%**, preview toggle **15%** (`OS_PREVIEW_LS_KEY`). Forgone = 10%/15% of loss base (ex-VAT)
- Commissions UI has **no** “Owner pocket cash · income not on the boat” section

## Code

- Model: `tracker/js/models/leads.js` — `ownerSourced*` helpers, rates, alias
- UI: Commissions OS section + toggle; Leads cards; source picker (no Owner’s days)
- Migrate: `TRACKER_PASSCODE=… node scripts/tracker-migrate-owner-sourced.mjs` (dry-run); `--apply` after review

## Note

Captain pay-from-petty still uses captain book rates only. OS provider commission is display / fairness only.
