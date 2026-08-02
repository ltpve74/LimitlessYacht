# Tracker domain models (locked money rules)

**Owner level:** commercial foundation for Keepafloat. Prototype in this repo; port **models + controller contracts**, not HTML. **Do not edit Keepafloat** from tracker tasks.

**Source of truth:** `tracker/js/models/*` → `window.LY_MODELS` / `require("tracker/js/models.js")`  
**Controllers:** `tracker/js/controllers/*` → `window.LY_CONTROLLERS`  
**Tests:** `node scripts/test-tracker-models.mjs` (must stay green when changing money logic)  
**Blueprint:** `.agent/briefs/tracker-v1-mvc-blueprint.md`

---

## AGENT RULE — non-negotiable (this is for the coding agent)

The owner is **not** an amateur. Stop “vibe” patches in the view. Every relapse into view-layer money hacks costs real trust and reintroduces bugs (ghost diesel, shortfall as APA received, Paid cash looking unpaid).

| Layer | May | Must not |
|-------|-----|----------|
| **Model** | Pure money / domain rules, write-plan pure functions, DTOs | DOM, `state`, `fetch`, side effects |
| **Controller** | Snapshot in → models → write plan / DTO out | Invent € formulas; re-implement model math |
| **View (`index.html`)** | Snapshot state, **apply** plans, paint, save blobs | Parallel ledger math; “heal on render”; orphan/settlement `if` trees |

### Forbidden (agents keep doing these — do not)

1. **Money `if` trees in `tracker/index.html`** for settlement, overage, pot seed, charge pick, delete side-effects.
2. **“Heal” / repair on paint or open** that invents rules instead of applying a named controller write plan.
3. **Copy-paste** FIFO, petty, commission, APA totals, cash settlement into paint helpers.
4. **“Just fix the UI”** so the number looks right while the blob still holds the wrong fact.
5. **Touch Keepafloat** unless the user explicitly asks for Keepafloat work.

### Required workflow for any money / APA / charges / expenses change

1. **Model first** — pure function or pure write-plan shape in `tracker/js/models/<domain>.js`.
2. **Test** — add/adjust case in `scripts/test-tracker-models.mjs` (lock the rule).
3. **Controller** — assemble snapshot, call model, return plan/DTO (`tracker/js/controllers/<domain>.js`).
4. **View** — only: build snapshot from `state`, call controller, **apply** plan (mutate + save), re-render.
5. If the fix is “on open/list it looks wrong” → fix **seed / delete / pick / shortfall plan** in model+controller, not a display branch that hides bad data forever.

### Cross-model needs (proper route only)

Models stay **pure and mostly single-domain**. They do **not** reach into another domain’s module for live state, mutate foreign collections, or import sideways (exception already locked: `charges` may read `leads.CAPTAIN_COMMISSION_PCT` / shared constants via util—not DOM/`state`).

| Need | Proper route | Wrong |
|------|----------------|--------|
| Domain A **reads** facts that “belong” to B | **Controller** loads B snapshot (or DTO from B’s model pure fn), passes **plain inputs** into A’s pure function | A imports B and digs into global state; view computes B then pastes into A paint path |
| Domain A **changes** data owned by B (e.g. APA delete clears `lead.apa`) | **Controller write plan** returns multi-collection patches (`tripPatch`, `leadPatch`, `dropChargeIds`, …); view applies each to the right store | A mutates leads inside `apa.js`; view “also zeros the lead” as a one-off |
| Shared primitive (num, VAT base) | `models/util.js` or a **shared pure helper** both call | Duplicate `round2` / commission base in each module |
| Orchestration spanning domains | **Controller** (or a named multi-domain controller plan), still calling pure models | `index.html` sequences five domains with business rules |

Example locked: APA pot delete → model pure `planApaLeadAfterPotDelete({ leadApa, leadApas, … })` returns `leadPatch`; **controller** includes it in the delete plan; **view** applies `leadPatch` to `state.leads` and saves `leads`. APA model never touches the leads array.

### APA lessons locked (2026-08)

- **Delete pot** must durable-delete (client tombstone + server `meta.apaDeletedIds`); no resurrect diesel/spend.
- **apaSent** only from **Issued/Paid** lead prepaid — never shortfall-to-invoice on `lead.apa`.
- **Start-ledger list amount** only Issued/Paid prepaid; never residual shortfall € on dashed cards.
- **Cash settlement** = Paid + (`billType` cash **or** `payMethod` Cash **or** cash deal rules) even if shortfall was created as invoice billType.
- Charge pick / guest collapse / pot delete / start seed → `LY_MODELS` + `LY_CONTROLLERS.apa` write plans.

---

## Locked money rules (do not “simplify” without updating tests)

1. **Free cash black** — user amount (e.g. €1800); never auto-replace with suggested ex-VAT (~€1653).
2. **Commission VAT included** — base = total ÷ 1.21 (missing/0 vatPct still 21%).
3. **Commission split** — 15% × white before VAT + 15% × cash black.
4. **Charge commission** — only when `captainComm === true` (checkbox); no notes inference.
5. **Bill types** — `cash` | `invoice` | `mix` only (`constrainBillType`).
6. **Petty physical ≥ 0** — `summarizePettyCash`; short is separate (`cashShort` / `shortLines`).
7. **Own-money repay** — linked `reimbursesExpenseId` or FIFO unlinked pool; **any month**.
8. **Open day-pay** — assign Unpaid + no Paid expense fingerprint; never resurrect paid crew.
9. **Captain commission outstanding** — `summarizeCaptainCommissionBalance` (earned − petty draws).

## Module map

| Module | Owns |
|--------|------|
| `leads.js` | sources, free cash, commission, projected net |
| `charges.js` | bill type, upsell commission, cash-to-boat |
| `expenses.js` | petty, reimbursement, day-pay, pocket, month settlement |
| `apa.js` | pot totals, diesel line freeze, charge pick, shortfall/delete/start write plans |
| `cash.js` | DTO only: shape Expenses petty numbers for Leads paint (no second formula) |
| `diesel.js` | bunker + sticky sell |
| `stews.js` | roster status, tips |
| `util.js` | `num` / `round2` only |

**Leads boat cash = Expenses petty (locked):** `LY_CONTROLLERS.leads.boatCashLedger` calls **`summarizePettyCash`** with the same month, start, cash-ins (tips excluded), and expenses Expenses uses. `cash.js` only maps those fields to a paint DTO. **Never** re-add free cash + charges + top-ups as a parallel total (that drifted vs Expenses). Free cash boat/owner stays on the income/glimpse panel only.

## Settlement entry points (Expenses UI)

| UI helper | Model |
|-----------|--------|
| `expSettlementFigures` | `summarizeMonthSettlement` |
| `expOwnMoneyRepaidAmt` | `ownMoneyRepaidAmt` |
| `expCollectOpenPocketOuts` | `collectOpenPocketOuts` |
| `expCollectOpenCrewDayPay` | `collectOpenCrewDayPay` |
| `expPocketBalances` | `summarizePocketBalances` |
| petty onboard / short | `summarizePettyCash` |
