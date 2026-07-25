# Tracker domain models (locked money rules)

**Source of truth:** `tracker/js/models.js` (`window.LY_MODELS`)

**Tests:** `node scripts/test-tracker-models.mjs` (must stay green when changing money logic)

**UI:** `tracker/index.html` loads models first and **wraps** them — do not re-implement commission, cash-suggested detection, or bill-type split in the HTML.

## Locked rules (do not “simplify” without updating tests)

1. **Free cash black** — user amount (e.g. €1800); never auto-replace with suggested ex-VAT (~€1653).
2. **Commission VAT included** — base = total ÷ 1.21 (missing/0 vatPct still 21%).
3. **Commission split** — 15% × white before VAT + 15% × cash black.
4. **Charge commission** — only when `captainComm === true` (checkbox); no notes inference.
5. **Bill types** — `cash` | `invoice` | `mix` only (`constrainBillType`).

## When adding features

- Prefer calling `LY_MODELS.*` or a single wrapper.
- If a new money rule is permanent: add to `models.js` + a test case.
- Avoid copy-pasting `gross/(1+pct/100)` or commission math into new UI code.
