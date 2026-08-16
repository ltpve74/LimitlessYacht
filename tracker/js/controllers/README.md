# Tracker controllers (`LY_CONTROLLERS`)

Application services between the view (`tracker/index.html`) and pure domain (`LY_MODELS`).

| File | Domain |
|------|--------|
| `expenses.js` | Month settlement, pocket, open day-pay / tips |
| `charges.js` | Cash-to-boat, VAT parts, upsell commission sums, CSV export rows |
| `leads.js` | Realised net glimpse (white + boat free cash) |
| `apa.js` | Pot totals / overage |
| `stews.js` | Day-pay / tip liability row builders |
| `index.js` | → `window.LY_CONTROLLERS` |

## Rules

1. **No money formulas** — call `LY_MODELS.*` only.
2. **No DOM**.
3. **Plain input objects** (portable to Keepafloat Server Actions).
4. **Write/side effects** stay in the view until a write-controller is added.

Blueprint: [`.agent/briefs/tracker-v1-mvc-blueprint.md`](../../../.agent/briefs/tracker-v1-mvc-blueprint.md).
