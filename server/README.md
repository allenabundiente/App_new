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
- runs as **one monolith** (Render free tier) **or** as **three
  microservices** behind a gateway (Docker)

## Architecture

The API is split by domain into three services that share one Postgres
database. The code is a single package — each service is just its own router
plus a tiny entry point — so the services never drift apart and the monolith
stays one `npm start` away.

```
                    ┌──────────────┐
  mobile app ─────▶ │ Caddy gateway│  :8080  (docker-compose only)
                    └──────┬───────┘
            ┌──────────────┼──────────────────┐
            ▼              ▼                  ▼
   ┌────────────────┐ ┌───────────┐ ┌──────────────────┐
   │ auth   :4001   │ │ core:4002 │ │ engagement :4003 │
   │ users, sessions│ │ customers │ │ messages,        │
   │ login, roles,  │ │ products  │ │ notifications,   │
   │ assignment     │ │ plans     │ │ audit,           │
   │                │ │ payments  │ │ due-reminder     │
   │                │ │ adjustm.  │ │ scheduler (cron) │
   └────────┬───────┘ └─────┬─────┘ └────────┬─────────┘
            └───────────────┼────────────────┘
                            ▼
                   ┌──────────────┐
                   │   Postgres   │  shared database
                   └──────────────┘
```

| Service     | Port | Routes (under `/api`)                              | Owns tables                              |
|-------------|------|-----------------------------------------------------|------------------------------------------|
| **auth**    | 4001 | `auth/*`, `me`, `users*`                            | `users`, `sessions`                      |
| **core**    | 4002 | `customers*`, `products*`, `plans*`, `payments*`, `adjustments*`, `settings` | `customers`, `products`, `plans`, `plan_schedule`, `payments`, `adjustments`, `settings` |
| **engagement** | 4003 | `messages*`, `notifications*`, `audit*`, `cron/reminders` | `messages`, `notifications`, `audit_log` |

### Request flow

The mobile app never talks to the services directly — it calls **one URL**
(the gateway, e.g. `http://localhost:8080`), and the gateway routes each
request to the right service **by path prefix**. A concrete example, step by
step, for `POST /api/plans` (a seller publishing a new installment plan):

```
 1. app ──POST /api/plans──────────────▶ gateway :8080
 2.                                    gateway matches "/api/plans*" → core
 3.                                        │
 4.                                        ▼
 5.                                   core :4002
 6.                                        │  INSERT INTO plans ...
 7.                                        ▼
 8.                                   Postgres (shared DB)
 9.                                        │
10.    ◀── 201 {plan, schedule} ─────────┘  response flows back the same way
```

Every request follows the same pattern — only the target service differs by
prefix. Examples:

```
POST /api/auth/login      → auth        (checks password, writes session)
GET  /api/plans           → core        (reads plans for the logged-in user)
POST /api/messages        → engagement  (stores chat message + notification)
POST /api/cron/reminders  → engagement  (scheduler, guarded by x-cron-secret)
```

The routing map lives in the [`Caddyfile`](Caddyfile); the services share the
database, so a request never needs to call another service over HTTP —
cross-service data (e.g. a payment writing a notification) is plain SQL
against the shared Postgres.

**Shared database by design.** This is a small app, so the pragmatic
microservice pattern here is a shared Postgres with clear per-service table
ownership rather than per-service databases plus event queues. A few
cross-service writes exist intentionally and are plain SQL against the shared
DB (e.g. core records a payment and also writes the buyer's `notifications`;
auth writes an `audit_log` entry on login). If the app ever outgrows this,
the natural next step is splitting the DB per service and replacing those
writes with events. The `migrate` entry (schema + seed) runs once before any
service starts, so only one container ever runs DDL.

## Run with Docker (microservices)

```bash
docker compose up --build
```

This starts Postgres → migrate (schema + seed) → the three services → the
**Caddy gateway on http://localhost:8080**. The gateway exposes the exact
same `/api/*` paths as the old single API, so point the app's cloud client
at `http://localhost:8080` and it works unchanged.

**No docker-compose plugin?** (e.g. the Ubuntu `docker.io` package doesn't
ship it) — use the plain-`docker` runner instead:

```bash
./run.sh        # same stack: postgres + migrate + 3 services + gateway :8080
./run.sh stop   # tear everything down
```

- `docker compose up` again later is fast — the images are cached and
  `migrate` only seeds an empty database.
- `docker compose down` stops the stack; `docker compose down -v` also
  wipes the Postgres data volume (fresh reseed next time).
- Build a single image by target: `docker build --target auth -t hulog-auth .`
- Demo logins after seeding: `admin@hulog.ph / admin123`, `seller@hulog.ph /
  seller123`, `buyer@hulog.ph / buyer123`.

## Run locally (monolith)

```bash
cp .env.example .env     # set DATABASE_URL (Neon/Supabase free tier)
npm install
npm run dev              # http://localhost:4000 — all routes, one process
```

First boot applies `schema.sql` and seeds the demo accounts.

Run a single service locally (after `npm run dev:migrate` once):

```bash
npm run dev:migrate      # schema + seed, then exit
npm run dev:auth         # :4001  (auth routes only)
npm run dev:core         # :4002  (core routes only)
npm run dev:engagement   # :4003  (engagement routes + reminder scheduler)
```

## Test

The integration suite runs the **real Express app** against an in-memory
Postgres emulator ([pg-mem](https://github.com/oguimbal/pg-mem)) — no
database server needed. It mounts the monolith (`createApp`), which exercises
all three routers:

```bash
npm test          # 23 tests: auth → create plan → record payment → adjustments → admin
npm run typecheck
```

## Deploy (free)

Full step-by-step (Neon Postgres + Render) is in
[`../DEPLOY.md`](../DEPLOY.md). In short:

1. Create a free Neon project, copy the connection string.
2. Push to GitHub → Render **New → Blueprint** (`render.yaml` is included —
   it deploys the monolith entry, which still works unchanged).
3. Set `DATABASE_URL`, deploy, then flip "Cloud server" ON in the app.

For a container deploy, push the repo to any Docker host and run the
`docker-compose.yml` (or wire the three Dockerfile targets to your favorite
orchestrator and put a load balancer in front that routes by path prefix, as
the bundled Caddyfile does).

## Layout

```
server/
├── schema.sql          # Postgres schema (mirrors the app's SQLite schema)
├── render.yaml         # one-click Render blueprint (free tier, monolith)
├── Dockerfile          # multi-target: migrate / auth / core / engagement
├── docker-compose.yml  # full microservice stack + Postgres + Caddy gateway
├── Caddyfile           # gateway route map (path → service)
├── src/
│   ├── index.ts        # monolith entry: migrate → listen (all routes)
│   ├── app.ts          # monolith assembler (mounts the three routers)
│   ├── service.ts      # microservice shell (middleware + error handling)
│   ├── entries/        # service entry points + one-shot migrate + scheduler
│   │   ├── migrate.ts
│   │   ├── scheduler.ts
│   │   ├── auth.ts     # :4001
│   │   ├── core.ts     # :4002
│   │   └── engagement.ts  # :4003
│   ├── routes/         # domain routers (shared by monolith + services)
│   │   ├── helpers.ts
│   │   ├── auth.ts
│   │   ├── core.ts
│   │   └── engagement.ts
│   ├── auth.ts         # scrypt hashing + token sessions + middleware
│   ├── db.ts           # pool, query helper, mappers, settings
│   ├── seed.ts         # first-boot demo data (one transaction)
│   ├── services/       # pure domain logic (shared with the app)
│   └── api.test.ts     # pg-mem integration tests
└── .env.example
```
