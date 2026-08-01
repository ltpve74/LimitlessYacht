# Tracker v1 — MVC blueprint (option A)

**Status:** locked pattern for the live prototype (2026-08)  
**Goal:** Cheap, clear separation so Keepafloat / a real framework can port **domain + controller contracts**, not HTML soup.  
**Out of scope:** Rewriting UI in React/Next inside this repo; editing Keepafloat.

---

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  VIEW        tracker/index.html  (DOM, paint, forms only)   │
│       ↓                                                     │
│  CONTROLLER  tracker/js/controllers/*  (wire data → model)  │
│       ↓                                                     │
│  MODEL       tracker/js/models/*  (pure money rules)        │
│       ↓                                                     │
│  STORE       Netlify Blobs via tracker API  (persistence)   │
└─────────────────────────────────────────────────────────────┘
```

| Layer | May | Must not |
|-------|-----|----------|
| **Model** | Pure functions; money; DTOs | DOM, `state`, `fetch`, side effects |
| **Controller** | Read snapshot → call model → return DTO; orchestrate multi-model; prepare save payloads | Invent € formulas; touch DOM |
| **View** | Event handlers, HTML, format `money()`, call controller | Re-implement balances / repay / commission |
| **Store** | Load/save blobs | Business rules |

---

## Naming & entry points

| Browser global | Node | Role |
|----------------|------|------|
| `window.LY_MODELS` | `require("tracker/js/models.js")` | Domain |
| `window.LY_CONTROLLERS` | `require("tracker/js/controllers")` (optional) | Application services |

**Script order in `tracker/index.html`:**

1. `models/{util,leads,charges,expenses,diesel,stews,index}.js`  
2. `controllers/{expenses,index}.js`  
3. Inline view code  

---

## Controller contract (port target)

Controllers accept a **plain input object** (no globals required in Node tests):

```js
LY_CONTROLLERS.expenses.monthSettlement({
  models: LY_MODELS,           // optional if global present
  month: "2026-07",
  expenses: [...],             // full or month-scoped as documented
  allExpenses: [...],          // full ledger for cross-month repay
  petty: { pettyStart, cashIns, startMode, startManual },
  stewAssign: [...],
  stews: [...],
  today: "2026-08-02",
  // adapters (view supplies; controller does not invent stew pay math if injected)
  personName: (id) => "...",
  dayPayAmt: (asg, sid) => number,
  isSkipped: (eventKey, sid) => boolean,
  tipRows: [...],              // pre-normalized tip liability rows OR built inside with adapters
  cashInIsTip / cashInIsOwnMoney / isTipExpense
});
// → settlement DTO from LY_MODELS.summarizeMonthSettlement + open liabilities
```

When Keepafloat (or Next) lands:

- **Model** → `src/domain/*` (same pure functions)  
- **Controller** → Server Action / route handler (authz + load + call domain + save)  
- **View** → React that only receives DTOs  

Do **not** port `index.html` paint loops; port **these contracts**.

---

## Reference domain: Expenses (done first)

| View helper (thin) | Controller | Model |
|--------------------|------------|--------|
| `expSettlementFigures` | `expenses.monthSettlement` | `summarizeMonthSettlement` + open day pay / tips |
| `expCollectOpenPocketOuts` | `expenses.openPocketOuts` | `collectOpenPocketOuts` |
| `expOwnMoneyRepaidAmt` | `expenses.ownMoneyRepaid` | `ownMoneyRepaidAmt` |
| `expPocketBalances` | `expenses.pocketBalances` | `summarizePocketBalances` |

**Rule:** If paint needs a number, it asks the controller (or a one-line wrapper that only calls the controller). No FIFO / petty / open-day-pay loops in the view.

---

## Migration checklist (remaining domains)

Move next, in this order (each: model tests → controller → thin view):

1. ~~Expenses settlement / pocket~~ (blueprint path)  
2. **Charges** — `chargeCashToBoat`, cash-in sync amounts  
3. **Leads glimpse** — realised net + boat cash only (filter upcoming in controller)  
4. **APA** — pot balance / still owed  
5. **Stews** — day-pay expense sync (side-effect orchestration in controller; amounts from model)  
6. **Diesel** — already mostly model; controller only if multi-step  

---

## Tests

| Suite | Command |
|-------|---------|
| Domain | `node scripts/test-tracker-models.mjs` |
| Controllers | included in same suite under `[Controllers]` |

Adding a money rule:

1. Model + domain test  
2. Controller calls model (no new formula)  
3. View paints DTO only  

---

## Forbidden shortcuts

- New `apaNum` business loops inside `paint*` / `render*`  
- Copy-paste commission % or FIFO into a form handler  
- Controller that re-implements model math “just this once”  
- Big-bang React rewrite before models + controllers are green for money tabs  

---

## Success criteria for “good blueprint”

- [x] Documented MVC layers and script order  
- [x] `LY_CONTROLLERS.expenses` for settlement / pocket  
- [ ] Charges + leads glimpse behind controllers  
- [ ] No trusted ledger number computed only in HTML  
- [ ] Keepafloat port = domain + controller ports, not HTML archaeology  
