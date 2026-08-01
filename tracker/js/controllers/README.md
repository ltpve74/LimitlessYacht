# Tracker controllers (`LY_CONTROLLERS`)

Application services between the view (`tracker/index.html`) and pure domain (`LY_MODELS`).

| File | Domain |
|------|--------|
| `expenses.js` | Month settlement, pocket, open day-pay / tips wiring |
| `index.js` | Merges → `window.LY_CONTROLLERS` |

## Rules

1. **No money formulas** — call `LY_MODELS.*` only.
2. **No DOM** — no `document`, no `el()`, no paint.
3. **Inputs are plain objects** so Node tests and a future Server Action can call the same API.
4. **Side effects** (save roster, write expense rows) stay in the view or a later write-controller; this layer is read-model first.

## Blueprint

See [`.agent/briefs/tracker-v1-mvc-blueprint.md`](../../../.agent/briefs/tracker-v1-mvc-blueprint.md).
