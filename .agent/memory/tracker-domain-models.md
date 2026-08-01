# Tracker domain models (locked money rules)

**Source of truth:** `tracker/js/models/*` → `window.LY_MODELS` / `require("tracker/js/models.js")`

**Tests:** `node scripts/test-tracker-models.mjs` (must stay green when changing money logic)

**UI:** `tracker/index.html` loads models first and **wraps** them — do not re-implement commission, petty, own-money repay, or settlement math in the HTML.

**Product note:** This v1 prototype is the working example for **Keepafloat** later. Keep domain pure and tested here; do **not** edit the separate Keepafloat repo from tracker tasks.

## Locked rules (do not “simplify” without updating tests)

1. **Free cash black** — user amount (e.g. €1800); never auto-replace with suggested ex-VAT (~€1653).
2. **Commission VAT included** — base = total ÷ 1.21 (missing/0 vatPct still 21%).
3. **Commission split** — 15% × white before VAT + 15% × cash black.
4. **Charge commission** — only when `captainComm === true` (checkbox); no notes inference.
5. **Bill types** — `cash` | `invoice` | `mix` only (`constrainBillType`).
6. **Petty physical ≥ 0** — `summarizePettyCash`; short is separate (`cashShort` / `shortLines`).
7. **Own-money repay** — linked `reimbursesExpenseId` or FIFO unlinked pool; **any month** (July spend / August repay).
8. **Open day-pay** — assign Unpaid + no Paid expense fingerprint; never resurrect paid Toni/Laura.
9. **Captain commission outstanding** — `summarizeCaptainCommissionBalance` (earned − petty draws).

## Module map

| Module | Owns |
|--------|------|
| `leads.js` | sources, free cash, commission, projected net |
| `charges.js` | bill type, upsell commission |
| `expenses.js` | petty, reimbursement, crew day-pay, **pocket liabilities**, **month settlement** |
| `diesel.js` | bunker + sticky sell |
| `stews.js` | roster status |
| `util.js` | `num` / `round2` only |

## When adding features

- Prefer calling `LY_MODELS.*` or a single wrapper in `index.html`.
- If a new money rule is permanent: add to `models/expenses.js` (or the right module) + a test case.
- Avoid copy-pasting FIFO repay, petty balance, or commission math into paint functions.

## Settlement entry points (Expenses UI)

| UI helper | Model |
|-----------|--------|
| `expSettlementFigures` | `summarizeMonthSettlement` |
| `expOwnMoneyRepaidAmt` | `ownMoneyRepaidAmt(e, expenses)` |
| `expCollectOpenPocketOuts` | `collectOpenPocketOuts` |
| `expCollectOpenCrewDayPay` | `collectOpenCrewDayPay` |
| `expPocketBalances` | `summarizePocketBalances` |
| petty onboard / short | `summarizePettyCash` |
