# Tracker foundation: money & cash envelope

**Status:** living strategy (2026-07) — owner-confirmed pain: petty cash, lead free cash, tips, APA shortfalls, invoices mixed in one HTML app.

## Why this exists

The prototype grew feature-by-feature (leads → APA → charges → commissions → petty cash → tips on Stews). Each piece works in isolation; **cash on the boat** is the hard part because it must reconcile:

- What guests paid in cash vs card  
- What left the envelope (expenses, crew day pay)  
- What is still owed to people  
- What belongs on a formal invoice (never free cash)

Without a single **cash ledger model**, auto-posts (lead free cash, charge cash, stews) double-count or hide money.

## Five domains (do not merge)

| Domain | What it is | Cash envelope? |
|--------|------------|----------------|
| **Leads** | Commercial deal (quote, split white + free cash, deposit/final status) | Free cash **in** only when “on boat” |
| **Charges** | Billable / cash settlement rows (APA shortfall, extensions, ad-hoc) | Cash/mix **in** when Paid |
| **APA** | Prepaid pot + spend ledger | Not free cash; shortfall → Charge |
| **Expenses** | Monthly boat float (petty start, cash-ins, cash-outs) | **Source of truth for envelope** |
| **Stews** | Roster, day pay, tips (private) | Tips **not** auto in float until held/paid out |

**Rule:** Petty cash on board = `start + Σ cash-ins − Σ cash-outs`. Every automatic post must create a **named cash-in or cash-out line** with stable id and source kind.

## Cash-in kinds (canonical)

| Kind | Source id pattern | When |
|------|-------------------|------|
| Lead free cash | `lead-cash:{leadId}` | Split free cash received on boat |
| Charge cash | `charge-cash:{chargeId}` | Paid charge billType cash/mix cash part only |
| Guest tips held | manual or future `tip-hold:{eventKey}` | Tips in envelope before split to crew |
| Own money | manual | Captain tops up float |
| Owner float / ATM / Other | manual | As labelled |

**Never:** post full invoice/card amount as cash-in. **Never:** post free cash because deposit alone is Paid (final Paid or explicit checkbox only).

## Cash-out kinds

| Kind | When |
|------|------|
| Expense Paid from Petty cash | Shop / ops spend from envelope |
| Crew day pay via Petty cash | `floatPay === true` |
| Tip pay-out from float | When tips leave envelope to crew |
| Reimbursement | Boat pays back pocket spends |

## What is *not* petty cash

- Card / bank payments (invoice)  
- Free cash still “on the lead” but not yet on boat  
- Tips that never entered the envelope (guest → crew direct)  
- APA pot accounting (virtual until shortfall charge)

## Near-term product rules (implement in prototype)

1. **Cash-in list is the audit trail** — every auto line labelled (Lead free cash / Charge cash / Manual / Tips). Captain can delete wrong lines.  
2. **Invoice bill type → €0 cash to boat** even if Payment method says Cash.  
3. **Same-bill extension on invoice** → stays on PDF; does not create charge cash-in.  
4. **Tips:** optional cash-in “Guest tips held”; pay-out via Stews/expense later (auto tip ledger = phase 2).  
5. **All money rules** that are permanent → `tracker/js/models.js` + `scripts/test-tracker-models.mjs`.

## Medium-term architecture (when HTML pain exceeds velocity)

Do **not** big-bang rewrite. Slice:

1. **Cash ledger module** (pure functions + tests):  
   `postLeadCash`, `postChargeCash`, `postTipHold`, `removeBySource`, `balance(month)`.  
2. **Read model** for Expenses UI from ledger events (event list in Blobs or Postgres).  
3. Keep UI in HTML until ledger is trusted, then optional Next.js + Postgres (Netlify) as already planned for scale.

## Owner checklist when numbers look wrong

1. Expenses → **Cash in lines** — sum must equal “cash in total”.  
2. Delete extra auto lines (e.g. €500 charge-cash if that €500 was on the card).  
3. Lead → free cash amount + **Cash received on the boat**.  
4. Charge → Settlement **Invoice** vs **Cash/Mix** (only cash/mix hits the envelope).  
5. Tips: if cash tips sat in the envelope, **Add cash in → Guest tips held**.

## Out of scope for this brief

- Commission rules (already locked in models)  
- Invoice PDF layout  
- Full Stews tip automation  

Update this file when a cash rule is locked with a test.
