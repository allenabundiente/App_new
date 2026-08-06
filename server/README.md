# HulogTrack API

The backend for the HulogTrack mobile app — a small **Express + Postgres**
REST API that mirrors the app's local SQLite repository 1:1, so the app can
flip between offline (device database) and cloud (this API) without changing
a single screen.

- 30+ typed endpoints under `/api` (auth, plans, payments, adjustments,
  notifications, chat, audit, reports)
- **scrypt** password hashing (Node built-in, no auth library)
- opaque token sessions (no JWT dependency)
- real Postgres transactions for every multi-table write (the same
  discipline as the app's repository)
- same pure business services as the app (penalty, amortization, early
  settlement) — the rules are identical on device and server

## Run locally

```bash
cp .env.example .env     # set DATABASE_URL (Neon/Supabase free tier)
npm install
npm run dev              # http://localhost:4000
```

First boot applies `schema.sql` and seeds the demo accounts:

| Role   | Email            | Password    |
|--------|------------------|-------------|
| Admin  | admin@hulog.ph   | admin123    |
| Seller | seller@hulog.ph  | seller123   |
| Buyer  | buyer@hulog.ph   | buyer123    |

## Test

The integration suite runs the **real Express app** against an in-memory
Postgres emulator ([pg-mem](https://github.com/oguimbal/pg-mem)) — no
database server needed:

```bash
npm test          # 10 tests: auth → create plan → record payment → adjustments → admin
npm run typecheck
```

## Deploy (free)

Full step-by-step (Neon Postgres + Render) is in
[`../DEPLOY.md`](../DEPLOY.md). In short:

1. Create a free Neon project, copy the connection string.
2. Push to GitHub → Render **New → Blueprint** (`render.yaml` is included).
3. Set `DATABASE_URL`, deploy, then flip "Cloud server" ON in the app.

## Layout

```
server/
├── schema.sql          # Postgres schema (mirrors the app's SQLite schema)
├── render.yaml         # one-click Render blueprint (free tier)
├── src/
│   ├── index.ts        # boot: env → schema → seed → listen
│   ├── app.ts          # all REST routes
│   ├── auth.ts         # scrypt hashing + token sessions + middleware
│   ├── db.ts           # pool, query helper, mappers, settings
│   ├── seed.ts         # first-boot demo data (one transaction)
│   ├── services/       # pure domain logic (shared with the app)
│   └── api.test.ts     # pg-mem integration tests
└── .env.example
```
