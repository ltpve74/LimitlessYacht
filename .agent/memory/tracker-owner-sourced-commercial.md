# Owner’s days → Owner-sourced commercial

**2026-09-06:** Boat is commercial. Former **owner’s days** alias to **ownersourced**.

## Rules

- `constrainLeadSource("owner"|"owner-days"|private|…)` → `ownersourced`
- Notional = public list **− 20%**
- **Recognized** (Commissions fairness) = Issued/Paid dep+fin+apa **only**
- **Paid** (Finance business to date) = **Paid** invoice lines only via `ownerSourcedPaidIncome` / `leadListMoney`
- Hypothetical list−20% **never** enters Finance Gross/Net so far
- Provider commission is Commissions-only (`ownerSourcedCommissionParts`); Finance white-net commission rate for OS = **0**
- **Possible lost income** = commercial **supposition**; we do **not** track owner pocket
- Commissions UI has **no** “Owner pocket cash · income not on the boat” section

## Migrate

`TRACKER_PASSCODE=… node scripts/tracker-migrate-owner-sourced.mjs` then `--apply` after review.
