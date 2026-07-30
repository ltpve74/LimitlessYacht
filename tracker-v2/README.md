# Yacht Ops Tracker v2

**Commercial multi-vessel charter operations platform** (Limitless-first, SaaS-shaped).

| | |
|--|--|
| **Live business tool (v1)** | `../tracker/` — keep using; surgical fixes only |
| **This app (v2)** | Parallel product; not wired to production Netlify site publish |
| **Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

---

## Locked stack

- **Next.js 15** (App Router) + **TypeScript**
- **Neon Postgres** + **Prisma**
- **Vitest** for domain tests
- Domain services under `src/domain/*` (no React imports)

---

## Setup

### 1. Install deps (from this folder)

```bash
cd tracker-v2
npm install
npm install -D typescript @types/node @types/react @types/react-dom \
  tailwindcss @tailwindcss/postcss postcss eslint eslint-config-next \
  prisma vitest @vitejs/plugin-react
npm install @prisma/client
npx prisma generate
```

### 2. Neon database (you create this)

1. Go to [https://console.neon.tech](https://console.neon.tech) → **New project**  
   - Name e.g. `yacht-ops-v2`  
   - Region: prefer **EU** (or closest to you)  
2. Copy the connection string (**pooled** is fine for the app).  
3. Create `tracker-v2/.env` (gitignored):

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
# Optional later:
# DIRECT_URL="postgresql://..."   # for migrations if Neon suggests it
```

4. Push schema:

```bash
npx prisma db push
# or when ready for migrations:
# npx prisma migrate dev --name init
```

### 3. Run locally

```bash
npm run dev
# http://localhost:3001
```

---

## Folder map

```
tracker-v2/
  docs/ARCHITECTURE.md     ← decisions (read first)
  prisma/schema.prisma     ← multi-tenant schema skeleton
  src/
    app/                   ← Views (Next routes)
    domain/                ← Models / pure services (port from v1 models)
      util/
      leads/
      charges/
      expenses/
      diesel/
      stews/
      cash-ledger/
      tenancy/
    server/                ← Controllers (actions / loaders)
    lib/                   ← prisma client, env
  tests/                   ← Vitest domain tests
```

---

## Rules (non-negotiable)

1. **Do not change** live `tracker/` for v2 experiments.  
2. **Do not** put money rules in React components.  
3. **Do not** cross-import domains (see ARCHITECTURE.md table).  
4. **Never commit** `.env` or real `DATABASE_URL`.  
5. Production Netlify site continues to serve v1 only until cutover is explicit.

---

## Porting pure rules from v1

v1 pure JS lives in `../tracker/js/models/`. Port domain-by-domain into TypeScript under `src/domain/` with Vitest cases, then wire UI.

Suggested first ports: `util` → `expenses`/`cash-ledger` → `leads` commission/cash → charges → stews → diesel.
