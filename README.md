# HulogTrack

A **full-stack** installment-management platform: a React Native + TypeScript
app **plus** a free-tier cloud API (`server/`, Express + Postgres). The app
always talks to the hosted API — there is no local/cloud switch to get wrong.

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
- Pay online through **PayPal Sandbox**: monthly fee, two months in advance,
  or settle the remaining balance early
- Request adjustments: payment holiday, reschedule, extra grace, settle early
- Digital receipts (styled like paper) for every payment

**Admin**
- Verification queue (new accounts are `pending` until approved)
- User management: filter by role/status, activate, suspend
- Reports: monthly collections bar chart, plan-status breakdown,
  top products by revenue, per-seller totals
- Audit log of everything (logins, payments, adjustments)

**Platform**
- **Device notifications**: payment, chat, and reminder alerts appear in the
  phone’s notification tray; tapping one opens the related plan. Buyers also
  get a scheduled local reminder before their next due date, even when the app
  is closed. Enable or test them from **Profile → Notifications**.
- **Always-on cloud backend**: the app talks to the hosted API and retries
  automatically after a dropped connection, with a non-blocking banner. The
  local SQLite repository is still in the codebase but is not selectable.
- **PayPal beyond the button**: the server computes the amount from the plan
  schedule, creates the order, and captures it idempotently; the client secret
  never reaches the app bundle
- Free-tier cloud: Neon Postgres (0.5 GB) + Render free web service — see
  [`DEPLOY.md`](./DEPLOY.md)
- The local SQLite repository (`react-native-quick-sqlite`, WAL, foreign
  keys, migrations) stays in the codebase for offline work; the shipped app
  always uses the API
- Atomic transactions for every multi-table write (`recordPayment`,
  `createPlan`, `settlePlan`, `resolveAdjustment`) on the API and the local
  repository
- **Server-side due reminders** (deduped, idempotent scans on an interval +
  cron endpoint) — see [`DEPLOY.md`](./DEPLOY.md) §7
- **Keep-alive**: GitHub Actions pings `/api/health` every 10 min so the free
  Render instance never sleeps — [`DEPLOY.md`](./DEPLOY.md) §6
- **CI-built APK**: `.github/workflows/build-apk.yml` signs and uploads the
  release APK to GitHub Releases on every push/tag
- Pure, unit-tested business services (86 tests: 56 app + 30 API integration) —
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

Requires a configured React Native environment (Android Studio / Xcode) and a
running API (`cd server && npm run dev`). The first API boot applies
`schema.sql` and seeds the demo accounts. The app's server address is on the
login screen and defaults to the hosted API in `src/api/client.ts`.

---

## PayPal Sandbox setup

Buyers pay from the plan detail page. **The server creates and captures every
order**; the app only receives an order id and the approval URL, and the amount
is computed from the plan schedule — never from the phone.

1. Open [developer.paypal.com](https://developer.paypal.com) → **Apps &
   Credentials** → **Sandbox** → **Create App**.
2. Copy the **Client ID** and **Secret**.
3. In the repo root: `cp .env.example .env`, paste both values, and leave
   `PAYPAL_MODE=sandbox`.
4. Set `APP_BASE_URL` to the public URL of `server/` (or leave the local
   default while testing on the same machine). On Render,
   `RENDER_EXTERNAL_URL` is used automatically when this is blank.
   `PAYPAL_RETURN_URL` and `PAYPAL_CANCEL_URL` default to
   `${APP_BASE_URL}/paypal/return` and `/paypal/cancel`.
5. Start the API (`cd server && npm run dev`). The quote endpoint returns
   `"enabled": false` until the keys load; the app shows a setup notice
   instead of a pay button that would fail.
6. In the PayPal dashboard → **Sandbox Accounts**, use the **Personal** buyer
   account to approve the payment.
7. On the phone, approve in the browser. The return page opens
   `hulogtrack://paypal/return`; the app captures on that deep link or when it
   becomes active again, and has an “I’ve approved — check payment” fallback.
8. Add a webhook in the PayPal app:
   - URL: `https://<your-api>/api/payments/paypal/webhook`
   - Events: `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`,
     `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`,
     `PAYMENT.CAPTURE.DENIED`
   - Paste its **Webhook ID** into `PAYPAL_WEBHOOK_ID` and restart the API.
   The server verifies every signature and deduplicates event ids, so a
   duplicated delivery cannot double-record a payment. If the app never
   returns from PayPal, the webhook still finishes the capture from PayPal's
   authoritative state.

Endpoints (all require a buyer session except the browser pages and webhook):

- `GET /api/payments/paypal/quote?planId=…&type=monthly|advance|settle`
- `POST /api/payments/paypal/create-order` with `{planId, type}`
- `POST /api/payments/paypal/capture` with `{orderId}` — safe to retry
- `POST /api/payments/paypal/webhook` — PayPal-signed events; signature
  verified, event ids deduplicated, missing captures reconciled

`paypal_orders` stores the order id, capture id, amount, type, status and
timestamps. A successful capture writes the normal `payments` row and updates
the schedule, so the seller sees it in the plan history and receipt. For real
payments, set `PAYPAL_MODE=live` and use live credentials. Never put keys in
the app — only the root `.env` (git-ignored) is read.

---

## Device notifications

The app has an in-app notification feed (the bell) and now mirrors those
updates into the phone’s notification tray. Buyers also get a local due-date
reminder at 9:00 AM, `reminderLead` days before the next unpaid installment.
Tapping a notification opens its plan, or the plan’s chat for a chat alert.

- On Android 13+, the first sign-in asks for notification permission. If it
  was declined, enable it from **Profile → Notifications**; the same card can
  send a test notification and open the system settings.
- iOS requests permission through `UNUserNotificationCenter` after sign-in.
- The Android tray icon is generated from the logo by `npm run branding`
  into `android/app/src/main/res/drawable/ic_notification.png`.

These are **local notifications**. New server notifications are mirrored while
the app is running, and the next due date is scheduled with the OS so it can
fire while the app is closed. Delivering arbitrary notifications while the app
is killed requires a remote provider (Firebase Cloud Messaging on Android and
APNs on iOS) and its project credentials; those are not checked into the repo.

---

## App logo

The single logo file is **`assets/hulog.png`**. The login screen, splash and
`BrandLogo` component read it directly; the launcher/store icons are rebuilt
from it with `npm run branding` (Android mipmaps and the iOS AppIcon set). If
you replace the artwork, rerun that command; if the file is missing, the app
falls back to the previous master icon instead of crashing.

---

## Architecture

```
src/
├── db/
│   ├── schema.ts        # CREATE TABLEs, indexes, migrations, seed data
│   ├── repository.ts    # local backend — the only file that writes SQLite
│   └── dataAccess.ts    # facade: always cloud today (local kept for offline)
├── api/client.ts        # cloud backend — typed REST client for server/
├── services/            # pure business logic — penalty, amortization,
│                        # early settlement, reminders (all unit tested)
├── store/AppStore.tsx   # session, role-scoped data, tiny nav stack
├── storage/kv.ts        # MMKV session persistence + API address
├── hooks/usePlans.ts    # hydrates plans with schedule/penalty summaries
├── components/ui.tsx    # dark-navy UI kit (cards, buttons, sheets, toasts)
├── navigation/AppShell.tsx  # role-based tabs + push/pop detail stack
├── screens/             # Seller / Buyer / Admin portals
├── theme/               # design tokens
├── types.ts             # DB contracts (camelCase mirrors of the schema)
└── utils/               # id, money, date helpers (pure)

server/                  # the cloud API (Express + Postgres)
├── src/app.ts           # all REST routes (+ /api/health, /api/cron/reminders)
├── src/config.ts        # one place for env + PayPal credentials
├── src/db.ts            # pool + mappers + settings
├── src/services/        # domain rules + PayPal Orders v2 client/capture
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
