# Tracker v2 — commercial-ready architecture (parallel to live v1)

**Status:** scaffold started (2026-07-30). **v1 stays live** (`tracker/`).  
**App path:** `tracker-v2/` · **ADR:** `tracker-v2/docs/ARCHITECTURE.md`

## Locked decisions (owner-confirmed)

| Decision | Choice |
|----------|--------|
| Location | `tracker-v2/` in this monorepo |
| Framework | Next.js App Router + TypeScript |
| Database | **Neon Postgres** |
| ORM | Prisma |
| Auth phase 1 | Dev / single-org later — not blocking scaffold |
| v1 | Keep until domain parity + explicit cutover |

## Why v1 stays

One HTML file + Blobs is fine as the captain’s live tool. It is **not** multi-tenant SaaS. Fixes on v1 remain surgical (`tracker/js/models/*` + tests).

## Goal for v2

1. Domain modules with explicit APIs (no shared mutable bag).  
2. Money rules pure in `src/domain/*` (port from `tracker/js/models/*`).  
3. Real database with audit.  
4. Roles / multi-tenant ready (Organisation → Vessel).

## MVC

```
View (React) → Controller (Server Actions / routes) → Domain services → Postgres
```

## Domain map

See `tracker-v2/docs/ARCHITECTURE.md` — leads, charges, APA, diesel, cash-ledger, expenses, stews, commissions, tenancy.

## Migration path

| Phase | What | Live risk |
|-------|------|-----------|
| 0 | Architecture + scaffold | Zero |
| 1 | You create Neon; `prisma db push` | Zero |
| 2 | Port domain TS + Vitest | Zero |
| 3 | Read-only Blobs → PG import | Zero |
| 4 | Write path domain-by-domain | Low |
| 5 | Cutover when you approve | Planned |

## What you do next

1. Neon project → `DATABASE_URL` in `tracker-v2/.env`  
2. `cd tracker-v2 && npm install && npx prisma db push && npm run dev`  
3. Build features only inside `tracker-v2/`  

## Success criteria

- Second vessel = data, not fork  
- Every € has source + actor + time  
- Domain tests gate merges  
- Roles: steward / captain / manager / owner  
