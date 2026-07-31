# Tracker v2 — Architecture Decision Record

**Status:** locked for scaffold (2026-07-30)  
**Live tool:** `tracker/` (v1 prototype) — **do not rewrite in place**  
**Commercial path:** `tracker-v2/` (this app)

---

## 1. Why a parallel v2

v1 is a captain-grade ops tool that runs production money for Limitless today:

- One large HTML surface + Netlify Blobs
- Pure domain rules partially extracted (`tracker/js/models/*`)
- Fast iteration, but not multi-tenant / auditable SaaS shape

v2 is the **product you can commercialise** (multi-vessel, roles, audit, real DB).  
v1 stays live until domain-by-domain parity and explicit cutover.

---

## 2. Locked decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | **`tracker-v2/` in this monorepo** | Port domain rules easily; zero risk to `/tracker` deploy |
| Framework | **Next.js 15 App Router + TypeScript** | Views = React; controllers = Server Actions / route handlers; one language |
| Database | **Neon Postgres** | Transactions, constraints, audit; Blobs are not long-term money store |
| ORM | **Prisma** | Clear schema, migrations, Neon docs; good commercial default |
| Auth (phase 1) | **None / dev bypass** | Single-tenant Limitless first; add Auth (Clerk/Supabase) before multi-tenant sales |
| Styling | **Tailwind** | Fast UI; not a product differentiator |
| Tests | **Vitest** (domain) + later Playwright | Same discipline as `test-tracker-models.mjs` |
| Deploy | **Separate** from marketing site Netlify publish | v1 Netlify continues; v2 later on Vercel or Netlify app site |
| v1 | **Surgical fixes only** | Models + tests; no new cross-domain auto-writes |

---

## 3. MVC mapping

```
┌─────────────────────────────────────────────────────────────┐
│  View          React Server/Client Components (src/app)     │
│       ↓                                                     │
│  Controller    Server Actions + Route Handlers (src/server) │
│       ↓                                                     │
│  Model         Domain services (src/domain/*)               │
│       ↓                                                     │
│  Persistence   Prisma → Neon Postgres                       │
└─────────────────────────────────────────────────────────────┘
```

**Hard rule:** Views never invent money rules. Controllers only: authz → call domain → return DTO.  
**Hard rule:** Domain services do not import React or `next/*`.

---

## 4. Domain boundaries (do not cross-wire)

| Module | Owns | May call |
|--------|------|----------|
| **tenancy** | Organisation, vessel, membership, roles | — |
| **leads** | Quote, source, free cash, deal closed, refunds | cash-ledger |
| **charges** | Billable rows, settlement, upsell commission flag | cash-ledger; diesel **rate lookup only** |
| **apa** | Pot, spend lines | diesel rate lookup; charges for shortfall |
| **diesel** | Bunkers, vessel fuel log, guest sell formula | **nothing mutates APA** |
| **cash-ledger** | Petty envelope truth, cash in/out events | — |
| **expenses** | Categorised spend projections over ledger | cash-ledger |
| **stews** | Roster, day pay, tips | cash-ledger for payouts |
| **commissions** | Source % rollups | leads + charges (read) |

### Forbidden

- Diesel bulk-updating trip prices  
- APA inventing petty cash lines  
- Shared mutable global `state` bag  
- UI computing commission “because the form is open”

---

## 5. Multi-tenant commercial model

```
Organisation  1──*  Vessel
     │                 │
     └──* Membership   └──* all ops data (leads, charges, …)
              │
           User (later)
```

- **Limitless production** = one Organisation, one Vessel initially  
- **Second customer** = new Organisation (+ vessels), not a fork of the app  
- Every money row has `organisationId` + `vesselId` + audit fields  

---

## 6. Money & audit (commercial bar)

Every euro movement is a **ledger event** (append-friendly):

| Field | Purpose |
|-------|---------|
| `id` | Stable id |
| `organisationId` / `vesselId` | Tenant |
| `kind` | `cash_in` \| `cash_out` \| `adjustment` |
| `amount` | Decimal (store as cents integer in DB) |
| `envelope` | `petty` \| `own_pocket` \| `card` \| … |
| `sourceType` / `sourceId` | e.g. `crew_day_pay` / expense id |
| `actorId` | Who recorded it |
| `occurredAt` / `createdAt` | When |

**Petty on board** = Σ start + cash_in(petty) − cash_out(petty) for period.  
Same rule as v1 `summarizePettyCash`, but enforced by table design + domain code.

---

## 7. Porting from v1 (no big bang)

| Phase | Work | Risk to live tool |
|-------|------|-------------------|
| **0** | Architecture + scaffold (this doc + folder) | Zero |
| **1** | Neon project + Prisma schema migrate | Zero |
| **2** | Port pure TS domain from `tracker/js/models/*` into `src/domain` + Vitest | Zero |
| **3** | Read-only import Blobs → Postgres snapshot; compare reports | Zero |
| **4** | Write path one domain (Leads first) on preview URL | Low |
| **5** | Domain-by-domain cutover; retire v1 when you say so | Planned |

**Never** point production Netlify `publish = "."` at `tracker-v2` without an explicit decision.

---

## 8. What you set up (human)

1. **Neon** — create free project (eu region preferred), copy connection string.  
2. Put it in `tracker-v2/.env` as `DATABASE_URL` (never commit).  
3. Optional later: Auth provider when multi-user sales start.

See root [README.md](../README.md) for exact commands.

---

## 9. Success criteria (“commercially viable”)

- [ ] Second vessel = data row, not HTML fork  
- [ ] Every € has source + actor + timestamp  
- [ ] Domain tests block broken cash rules  
- [ ] Roles: steward / captain / manager / owner  
- [ ] v1 remains usable until parity sign-off  
