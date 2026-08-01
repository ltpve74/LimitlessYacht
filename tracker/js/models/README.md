# Tracker domain models (`LY_MODELS`)

Pure money / roster rules — **no DOM**.  
This is the **Keepafloat prototype foundation**: commercial product domain lives here first, then ports to Keepafloat (`src/domain/*`).

| File | Owns |
|------|------|
| `util.js` | `num`, `round2`, `moneyFromBase` |
| `leads.js` | Sources, free cash, commission, projected net, charter rates |
| `charges.js` | Bill type, captain upsell commission |
| `expenses.js` | Petty cash, reimbursement, crew day-pay, **pocket liabilities**, month settlement |
| `diesel.js` | Bunker buy + sticky guest sell |
| `stews.js` | Roster assigned / unassigned / cancelled |
| `index.js` | Merges → `window.LY_MODELS` / `module.exports` |

## Expenses / pocket (Keepafloat cash foundation)

| Function | Responsibility |
|----------|----------------|
| `summarizePettyCash` | Physical envelope ≥ 0; short separate |
| `isOwnMoneySpend` / `ownMoneyRepaidAmt` / `ownMoneyIsRepaid` | Pocket spend + cross-month repay (linked + FIFO) |
| `collectOpenPocketOuts` | Still-owed pocket through focus month |
| `summarizePocketBalances` | putIn + paidOut − reimbursed |
| `buildCrewDayPaySettledSets` / `collectOpenCrewDayPay` | Open day-pay liabilities (dedupe + expense Paid) |
| `collectOpenTipPayouts` | On-bill tips still owed to crew |
| `summarizeMonthSettlement` | Full Expenses DTO (petty + pocket + open people) |

**UI rule:** `tracker/index.html` may format and wire DOM only. It must call these functions — not re-derive repay/FIFO/petty.

## Rules

1. Edit only the domain you are changing + tests.
2. **No sideways imports** (expenses ↛ diesel). Shared helpers → `util.js` only.
3. Charges may read `leads.CAPTAIN_COMMISSION_PCT`.
4. Browser script order is fixed in `tracker/index.html`.
5. Node: `require("tracker/js/models.js")`.
6. New permanent money rules → model + `scripts/test-tracker-models.mjs` **before** UI polish.

Petty / own-money / settlement work belongs in **`expenses.js` only**.
