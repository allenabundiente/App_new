# HulogTrack

A **full-stack** installment-management platform: a React Native + TypeScript
app (offline-first SQLite) **plus** a free-tier cloud API (`server/`, Express +
Postgres) — flip a switch on the login screen to move all data to the cloud.

Sellers create installment plans, record payments (with automatic penalty
computation), and approve buyer adjustment requests. Buyers track balances,
due dates, payment history, and digital receipts. Admins verify accounts and
read the numbers.

**Start here:**
- [`DATABASE.md`](./DATABASE.md) — the database lesson (schema, migrations,
  transactions, how to extend it).
- [`DEPLOY.md`](./DEPLOY.md) — ship it: free Postgres (Neon), free hosting
  (Render), **downloadable APK from GitHub Releases**, keep-alive, and
  server-side due reminders.
- [`server/README.md`](./server/README.md) — the API.
- [`assets/ASSETS.md`](./assets/ASSETS.md) — brand assets checklist (icons, logos, formats).

**Download the app:** every push to `main` builds a signed APK and attaches
it to the **latest** GitHub Release —
`https://github.com/<you>/App_new/releases/latest/download/HulogTrack-latest.apk`
(cut a `v*` tag for a versioned release). Details in [`DEPLOY.md`](./DEPLOY.md).

---

## Features

**Seller**
- Customer management (add customers → they get buyer accounts)
- Product catalog + installment plan creation with **live amortization preview**
- Payment recording with **auto-computed penalties** (prorated daily, capped)
- Early settlement quoting (incentive + fee)
- Overdue follow-up list & adjustment-request approval queue
- Per-plan chat with the buyer

**Buyer**
- Balance inquiry & next-due countdown on the home screen
- Payment schedule with progress, due-soon and overdue alerts
- Request adjustments: payment holiday, reschedule, extra grace, settle early
- Digital receipts (styled like paper) for every payment

**Admin**
- Verification queue (new accounts are `pending` until approved)
- User management: filter by role/status, activate, suspend
- Reports: monthly collections bar chart, plan-status breakdown,
  top products by revenue, per-seller totals
- Audit log of everything (logins, payments, adjustments)

**Platform**
- **Dual backend**: offline-first SQLite on the device, OR the hosted API
  (`server/`, Express + Postgres) — switch on the login screen, persisted in
  MMKV; every screen is backend-agnostic via `src/db/dataAccess.ts`
- Free-tier cloud: Neon Postgres (0.5 GB) + Render free web service — see
  [`DEPLOY.md`](./DEPLOY.md)
- Real SQLite via `react-native-quick-sqlite` (WAL, foreign keys, migrations)
- Atomic transactions for every multi-table write (`recordPayment`,
  `createPlan`, `settlePlan`, `resolveAdjustment`) on BOTH backends
- **Server-side due reminders** (deduped, idempotent scans on an interval +
  cron endpoint) — see [`DEPLOY.md`](./DEPLOY.md) §7
- **Keep-alive**: GitHub Actions pings `/api/health` every 10 min so the free
  Render instance never sleeps — [`DEPLOY.md`](./DEPLOY.md) §6
- **CI-built APK**: `.github/workflows/build-apk.yml` signs and uploads the
  release APK to GitHub Releases on every push/tag
- Pure, unit-tested business services (38 tests: 25 app + 13 API integration) —
  penalty engine, amortization, early settlement, reminder scanner
- Brand assets: generated icon set + checklist in [`assets/`](./assets/ASSETS.md)

---

## Demo accounts

| Role   | Email             | Password    |
|--------|-------------------|-------------|
| Admin  | `admin@hulog.ph`  | `admin123`  |
| Seller | `seller@hulog.ph` | `seller123` |
| Buyer  | `buyer@hulog.ph`  | `buyer123`  |

Buyers created via *Add customer* sign in with `buyer123`.
New self-registrations start as `pending` until an admin verifies them.

---

## Run it

```bash
npm install
npm run android     # or: npm run ios
npm start           # Metro bundler

npm test            # unit tests (pure business logic)
npm run typecheck   # tsc --noEmit
```

Requires a configured React Native environment (Android Studio / Xcode).
First launch creates the SQLite file and seeds the demo data.

---

## Architecture

```
src/
├── db/
│   ├── schema.ts        # CREATE TABLEs, indexes, migrations, seed data
│   ├── repository.ts    # local backend — the only file that writes SQLite
│   └── dataAccess.ts    # facade: local (repository) OR cloud (api/client)
├── api/client.ts        # cloud backend — typed REST client for server/
├── services/            # pure business logic — penalty, amortization,
│                        # early settlement, reminders (all unit tested)
├── store/AppStore.tsx   # session, role-scoped data, tiny nav stack
├── storage/kv.ts        # MMKV session persistence + backend mode
├── hooks/usePlans.ts    # hydrates plans with schedule/penalty summaries
├── components/ui.tsx    # dark-navy UI kit (cards, buttons, sheets, toasts)
├── navigation/AppShell.tsx  # role-based tabs + push/pop detail stack
├── screens/             # Seller / Buyer / Admin portals
├── theme/               # design tokens
├── types.ts             # DB contracts (camelCase mirrors of the schema)
└── utils/               # id, money, date helpers (pure)

server/                  # the cloud API (Express + Postgres)
├── src/app.ts           # all REST routes (+ /api/health, /api/cron/reminders)
├── src/db.ts            # pool + mappers + settings
├── src/services/        # same pure domain rules as the app (+ reminders.ts)
├── src/seed.ts          # first-boot demo data (one transaction)
├── src/api.test.ts      # 13 pg-mem integration tests
├── schema.sql           # Postgres schema (+ notification dedup index)
└── render.yaml          # free-tier deploy blueprint

.github/workflows/       # CI: build-apk (Releases), keep-alive, deploy-render
android/                 # native Android project (applicationId com.hulogtrack)
```

**Layering rule:** Screens → Data access facade → (SQLite | REST API). Screens
never write SQL or construct URLs; the backends never render UI.
`DATABASE.md` explains why.

---

## Tests

```bash
npm test
```

Covers the rules that would be expensive to get wrong in production:
`pmt`/schedule math, penalty proration & cap, status derivation, settlement
quotes, and reminder dedup keys.
