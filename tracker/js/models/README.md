# Tracker domain models (`LY_MODELS`)

Pure money / roster rules — **no DOM**.

| File | Owns |
|------|------|
| `util.js` | `num`, `round2`, `moneyFromBase` |
| `leads.js` | Sources, free cash, commission, projected net, charter rates |
| `charges.js` | Bill type, captain upsell commission |
| `expenses.js` | Petty cash, reimbursement, crew day-pay |
| `diesel.js` | Bunker buy + sticky guest sell |
| `stews.js` | Roster assigned / unassigned / cancelled |
| `index.js` | Merges → `window.LY_MODELS` / `module.exports` |

## Rules

1. Edit only the domain you are changing + tests.
2. **No sideways imports** (expenses ↛ diesel). Shared helpers → `util.js` only.
3. Charges may read `leads.CAPTAIN_COMMISSION_PCT`.
4. Browser script order is fixed in `tracker/index.html`.
5. Node: `require("tracker/js/models.js")`.

Petty / own-money work belongs in **`expenses.js` only**.
