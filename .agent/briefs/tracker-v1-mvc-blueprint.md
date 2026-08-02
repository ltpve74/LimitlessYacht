# Tracker v1 — MVC blueprint (Keepafloat port map)

**Status:** active foundation (2026-08)  
**Live tool:** `tracker/` on Netlify — **do not big-bang rewrite**  
**Commercial product:** Keepafloat (separate repo) — port **contracts**, not HTML  
**Safe restore:** tags `backup/tracker-safe-2026-08-02-*`, branches `backup/pre-full-mvc-*`

---

## 1. Layers (locked)

```
┌──────────────────────────────────────────────────────────────┐
│  VIEW         tracker/index.html                             │
│               DOM, forms, format money(), call controllers   │
│       ↓                                                      │
│  CONTROLLER   tracker/js/controllers/*  → LY_CONTROLLERS     │
│               Snapshot in → LY_MODELS → DTO out              │
│               No € formulas. No document.                    │
│       ↓                                                      │
│  MODEL        tracker/js/models/*       → LY_MODELS          │
│               Pure money / roster rules. No DOM / state.     │
│       ↓                                                      │
│  STORE        Netlify Blobs (tracker API)                    │
└──────────────────────────────────────────────────────────────┘
```

| Layer | May | Must not |
|-------|-----|----------|
| **Model** | Pure functions, DTOs, tests | DOM, `state`, `fetch`, side effects |
| **Controller** | Assemble inputs, call models, return DTOs | Invent commission/FIFO/petty math |
| **View** | Paint DTOs, collect forms, save blobs | Parallel ledger formulas |
| **Store** | Load/save | Business rules |

---

## 2. Browser load order

```
models/util → leads → charges → expenses → diesel → stews → apa → index
controllers/expenses → charges → leads → apa → stews → index
inline view (index.html)
```

**Node:** `require("tracker/js/models.js")` then `require("tracker/js/controllers/index.js")`  
**Tests:** `node scripts/test-tracker-models.mjs`

---

## 3. Domain map (port these modules 1:1)

| Domain | Model file | Controller | Owns |
|--------|------------|------------|------|
| **util** | `util.js` | — | `num`, `round2`, `moneyFromBase`, `invoiceSplitGross` |
| **leads** | `leads.js` | `controllers/leads.js` | source, free cash, commission, projected net, **realised glimpse** |
| **charges** | `charges.js` | `controllers/charges.js` | bill type, cash-to-boat, VAT parts, upsell commission |
| **expenses** | `expenses.js` | `controllers/expenses.js` | petty, pocket repay, open day-pay/tips, month settlement |
| **apa** | `apa.js` | `controllers/apa.js` | pot totals, overage (diesel costs injected) |
| **diesel** | `diesel.js` | — (thin wrappers) | bunker + sticky sell |
| **stews** | `stews.js` | `controllers/stews.js` | roster status, tip on-bill, day-pay amounts |

### Forbidden cross-wires

- Diesel must not mutate APA pots  
- APA must not invent petty lines (charges cash-in is separate)  
- UI must not re-derive FIFO / petty short / commission %  
- Controllers must not re-implement model math  

---

## 4. Controller contracts (Keepafloat Server Action shape)

### Expenses

```js
LY_CONTROLLERS.expenses.monthSettlement({
  models, month, allExpenses, monthExpenses?, petty,
  stewAssign, today, personName, dayPayAmt, isSkipped,
  tipRows, cashInIsTip, cashInIsOwnMoney, isTipExpense
})
// → summarizeMonthSettlement DTO + open liabilities

LY_CONTROLLERS.expenses.openPocketOuts({ expenses, month, personName })
LY_CONTROLLERS.expenses.ownMoneyRepaid({ expense, expenses })
```

### Charges

```js
LY_CONTROLLERS.charges.cashToBoat({ charge })
LY_CONTROLLERS.charges.vatParts({ charge })
LY_CONTROLLERS.charges.summarizeCashToBoat({ charters })
LY_CONTROLLERS.charges.captainUpsellCommissions({ charters })
```

### Leads

```js
LY_CONTROLLERS.leads.realisedGlimpse({
  leads, today, whiteEx, whiteComm
})
// → { whiteNet, cashBoat, cashOwner, doneNet, cashItems, ... }
// Rule: doneNet = whiteNet + boat free cash only (owner pocket shown, not in net)
```

### APA

```js
LY_CONTROLLERS.apa.tripTotals({
  trip, paidCovered, cashSettled,
  dieselLines? | dieselCalc(trip, row)
})
// → { spent, available, bal, overage, cashSettled, ... }
```

### Stews

```js
LY_CONTROLLERS.stews.dayPayForStew({ assign, stewId })
LY_CONTROLLERS.stews.tipLiabilityRows({ assigns })
// Tip share split (equal among captain+crews) may stay view-adjacent until modelized
```

---

## 5. Locked money rules (do not “simplify”)

1. Free cash black = user amount; never auto-suggested ex-VAT  
2. Commission VAT-included: base = total ÷ 1.21  
3. Split commission: 15% white-before-VAT + 15% cash black  
4. Charge commission only if `captainComm === true`  
5. Petty physical ≥ 0; short is separate  
6. Own-money repay: linked id **or** FIFO unlinked; **any month**  
7. Charge cash-to-boat: Paid + cash/mix slice only; invoice → €0  
8. Leads big net: white net + **boat** free cash; owner pocket not in big net  
9. APA cash-settled pot: residual ledger pennies → overage 0  
10. Tips on card/bill = boat liability; guest cash tips = not  

---

## 6. Migration status

| Area | Model | Controller | View thin |
|------|-------|------------|-----------|
| Expenses settlement / pocket | ✅ | ✅ | ✅ |
| Charges cash/VAT | ✅ | ✅ | ✅ |
| Leads realised glimpse | ✅ | ✅ | ✅ |
| APA pot totals | ✅ | ✅ | ✅ |
| Stews tip/day-pay amounts | ✅ | ✅ | ✅ (partial) |
| Diesel | ✅ | — | wrappers |
| Stews tip *share* math | ⏳ optional | — | still UI |
| APA diesel *rate* calc | diesel model | inject | UI adapter |
| Write paths (sync charge, seed expenses) | — | later | orchestration in view |

---

## 7. How to add a rule

1. **Model** pure function + test in `test-tracker-models.mjs`  
2. **Controller** one-liner that calls model (no new arithmetic)  
3. **View** replace local formula with controller/model call  
4. Update this checklist  

---

## 8. Keepafloat mapping

| v1 | Keepafloat |
|----|------------|
| `LY_MODELS.*` | `src/domain/*` TypeScript |
| `LY_CONTROLLERS.*` | Server Actions / route handlers |
| `index.html` paint | React components (DTO props only) |
| Blobs | Prisma / Neon |
| Single vessel | `organisationId` + `vesselId` on every money row |

**Never** port `index.html` paint loops. Port models + controller contracts + tests.

---

## 9. Success criteria

- [x] Layered folder structure + load order  
- [x] Expenses / charges / leads glimpse / APA / stews money via models  
- [x] Controllers for each ops domain  
- [x] Domain + controller tests green  
- [ ] No trusted ledger € computed only in HTML (remaining: tip share, diesel line burn UI, some APA link orchestration)  
- [ ] Keepafloat can implement Server Action from controller signatures alone  
