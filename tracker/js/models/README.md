# Tracker domain models (`LY_MODELS`)

Pure money / roster rules — **no DOM**.  
**MVC blueprint:** models (here) → `tracker/js/controllers/*` → view (`index.html`).  
See [`.agent/briefs/tracker-v1-mvc-blueprint.md`](../../../.agent/briefs/tracker-v1-mvc-blueprint.md).

| File | Owns |
|------|------|
| `util.js` | `num`, `round2`, `moneyFromBase`, `invoiceSplitGross` |
| `leads.js` | Sources, free cash, commission, projected net, realised glimpse helpers |
| `charges.js` | Bill type, cash-to-boat, VAT parts, captain upsell commission, charges CSV export |
| `expenses.js` | Petty cash, reimbursement, crew day-pay, pocket liabilities, month settlement |
| `apa.js` | Guest pot totals / overage (diesel costs injected) |
| `diesel.js` | Bunker buy + sticky guest sell |
| `stews.js` | Roster, tip on-bill, day-pay amounts |
| `index.js` | Merges → `window.LY_MODELS` / `module.exports` |
| *controllers/* | Application services (`LY_CONTROLLERS`) — no formulas |

## Expenses / pocket (Keepafloat cash foundation)

| Function | Responsibility |
|----------|----------------|
| `summarizePettyCash` | Physical envelope ≥ 0; short separate |
| `resolvePettyMonthOpen` / `resolvePettyMonthClose` | **Month-to-month carry** (pure; no writes) |
| `planPettyCarryMaterialize` | Explicit store patches for ops/DB only |
| `planClearCrewFloatPayOnEmptyEnvelope` | Dry-run floatPay clear plan (no mutate) |
| `summarizeCaptainPocketMonthBridge` | Captain pocket prior short → repay → open |
| `summarizeCrewPayMonth` | Month crew day-pay by fund (pot / captain / books) |
| `summarizePettyCashOutBuckets` | Pot cash-out buckets (crew = floatPay only) |
| `crewDayPayFundSource` | pot \| captain \| owner \| books \| unpaid |
| `isOwnMoneySpend` / `ownMoneyRepaidAmt` / `ownMoneyIsRepaid` | Pocket spend + cross-month repay (linked + FIFO) |
| `collectOpenPocketOuts` | Still-owed pocket through focus month |
| `summarizePocketBalances` | putIn + paidOut − reimbursed |
| `buildCrewDayPaySettledSets` / `collectOpenCrewDayPay` | Open day-pay liabilities (dedupe + expense Paid) |
| `collectOpenTipPayouts` | On-bill tips still owed to crew |
| `summarizeMonthSettlement` | Full Expenses DTO (petty + pocket + open people) |

**UI rule:** `tracker/index.html` may format and wire DOM only. It must call these functions — not re-derive repay/FIFO/petty.

**No load heals:** never rewrite `expenses` / `expPetty` on open. Data fixes =
`scripts/tracker-db-dryrun.mjs` (dry-run → captain review → `--apply-…`).

## Rules

1. Edit only the domain you are changing + tests.
2. **No sideways imports** (expenses ↛ diesel). Shared helpers → `util.js` only.
3. Charges may read `leads.CAPTAIN_COMMISSION_PCT`.
4. Browser script order is fixed in `tracker/index.html`.
5. Node: `require("tracker/js/models.js")`.
6. New permanent money rules → model + `scripts/test-tracker-models.mjs` **before** UI polish.

Petty / own-money / settlement work belongs in **`expenses.js` only**.
