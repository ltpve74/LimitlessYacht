# Tracker v2 — commercial-ready architecture (parallel to live v1)

**Status:** plan only (2026-07). **v1 stays live** (`tracker/index.html`) and is fixed surgically. **v2 is a second product path**, not a rewrite-in-place.

## Why v1 hurts

One HTML file + shared `state` + save-on-side-effect means:

- Opening APA rewrote diesel prices (and other auto-posts touched petty cash).
- A “small” diesel rule change could change every trip’s fuel total.
- No real **Model / Controller / View** boundary: UI, rules, and persistence are mixed.

Daily use is fine as a captain tool; **selling multi-vessel SaaS** is not.

## Goal for v2

Same product surface (leads, charges, APA, diesel, expenses/petty, stews, commissions), but:

1. **Domain modules** that cannot mutate each other except through explicit APIs.
2. **Money rules in pure models** (already started: `tracker/js/models.js` + tests).
3. **Real database** (not JSON blobs as the long-term store).
4. **Roles / multi-tenant** ready (owner, captain, manager, steward).

## Recommended stack (MVC-shaped, commercial)

| Layer | Choice | Why |
|-------|--------|-----|
| **App framework** | **Next.js (App Router)** | Views = React pages/components; “controllers” = Server Actions + Route Handlers; deployable on Netlify/Vercel; huge hiring pool. |
| **Domain / services** | TypeScript modules per domain | True **Model** layer: `LeadService`, `ApaService`, `CashLedger`, `DieselService` — no shared global mutable bag. |
| **Database** | **Postgres** (Neon or Supabase) | Transactions, constraints, audit; Blobs are wrong for money at scale. |
| **Auth** | Supabase Auth or Clerk (later) | Passcode → email + roles when you leave single-boat private use. |
| **PDF / export** | Server-side (same as today logic, isolated) | One place that builds invoices; UI only requests download. |
| **Tests** | Vitest/Jest on pure domain + Playwright smoke | Same discipline as `test-tracker-models.mjs`, expanded. |

### Why not classic Rails/Laravel?

They are excellent true MVC. Cost: new language + host story. Next.js keeps one language (TS) and fits your current Netlify habits. If you prefer backend-first MVC, **NestJS + React SPA** is the other strong option (controllers as Nest modules).

### What “MVC” means here

```
View (React)  →  Controller (Server Action / API route)  →  Model/Service (domain)
                      ↓
                 Postgres (facts only)
```

**Rules live only in Models/Services.** Views never invent “free cash posts to petty when X”. Controllers only: auth → call service → return DTO.

## Domain map (do not cross-wire)

Same five envelopes as [tracker-cash-foundation.md](tracker-cash-foundation.md):

| Module | Owns | May call |
|--------|------|----------|
| **Leads** | quote, white/free cash, deposit/final | CashLedger (post free cash when boat received) |
| **Charges** | billable rows, settlement | CashLedger (cash part only); never invent APA lines |
| **APA** | pot + expenses/provisions/diesel lines | Diesel (rate lookup only); Charges (shortfall) |
| **Diesel** | bunkers, vessel log, guest rate formula | **Read-only rate for APA** — never bulk-update trips |
| **CashLedger / Expenses** | envelope truth | nothing invents money without a ledger event |
| **Stews / Commissions** | roster, tips, % | CashLedger for tip hold/payout only |

**Hard rule:** no module reaches into another’s tables except via published functions. Diesel never `UPDATE apa SET diesel_price`. APA asks `Diesel.guestRateForDate(d)`.

## Migration path (no big-bang)

| Phase | What | Risk to daily use |
|-------|------|-------------------|
| **0 (now)** | Harden v1: stop cross-domain auto-writes; models + tests | Low — surgical |
| **1** | Extract more pure functions into `models/` (cash ledger, diesel rate) shared by v1 | Low |
| **2** | Scaffold `tracker-v2/` (or separate repo) Next.js + Postgres schema for one boat | Zero (parallel) |
| **3** | Import read-only snapshot from Blobs → Postgres; dual-run compare reports | Zero |
| **4** | Write path for one domain (e.g. Leads only) in v2; captain can trial | Low |
| **5** | Cut over domain by domain; retire v1 HTML when parity + trust | Planned |

**Never** replace live Netlify `tracker/` until you say so. Parallel URL e.g. `ops.limitless…` or `/tracker-v2` is fine.

## v1 freeze rules (while v2 is built)

1. Money behaviour changes only via `tracker/js/models.js` + tests when possible.
2. No new “on every load, rewrite all trips/charges” helpers.
3. APA open path: ensure arrays / ids only — **no rate or cash side effects**.
4. Diesel guest rate: **read-time** formula; pin only when captain edits the field.
5. Publish tracker fixes to live as today (see memory).

## Success criteria for “commercial”

- Second vessel = new tenant row, not a fork of HTML.
- Audit: every euro movement has `source_kind` + `source_id` + actor + timestamp.
- Regression suite blocks merges that break cash or APA balances.
- Roles: steward sees stews/tips; captain sees ops; owner sees all.

## Immediate v1 work (this cycle)

- [x] Remove diesel bulk rewrite on `apaEnsureArrays` / bunker sync of all trips  
- [ ] Smoke daily: APA totals, new trip diesel prefill (bunker+10c), lead free cash → petty  
- [ ] Keep fixing APA/cash bugs as reported without expanding architecture inside HTML  

## Decision log

| Decision | Choice |
|----------|--------|
| Framework | Next.js App Router (NestJS+SPA acceptable alternative) |
| DB | Postgres, not Blobs long-term |
| v1 | Keep until v2 parity |
| MVC | Service layer = Model; Server Actions = Controller; React = View |
