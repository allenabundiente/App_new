# Deploying HulogTrack — free tier, step by step

This takes the app from "runs on my machine" to "a live API any phone can
hit" for **$0/month**:

- **Database:** [Neon](https://neon.tech) (serverless Postgres, free tier:
  0.5 GB storage, scales to zero when idle).
- **Hosting:** [Render](https://render.com) (free web service: 750
  hours/month, sleeps after 15 min idle).

> Alternatives that also cost $0: **Supabase** (Postgres + built-in auth +
> REST — a great all-in-one), **Vercel** (serverless Express, 1M
> invocations/month). The API is just `DATABASE_URL` + Express, so it runs
> on any of them. See the "Alternatives" section.

---

## 1. Get a free Postgres database (Neon) — 5 minutes

1. Sign up at https://neon.tech (GitHub login works).
2. **Create a project** → name it `hulogtrack`, pick a region near you.
3. On the project dashboard, copy the **connection string** — it looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-xxx-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Keep it secret — it's the password to your database.

**Optional sanity check** (after step 2 below): the API creates all tables
and seeds the demo data automatically on first boot — no SQL to run by hand.

## 2. Run the API locally against that database

```bash
cd hulogtrack-mobile/server
cp .env.example .env
# edit .env → set DATABASE_URL to your Neon connection string
npm install
npm run dev        # http://localhost:4000
```

Verify it works:

```bash
curl http://localhost:4000/
# {"service":"HulogTrack API","version":"0.1.0","status":"ok"}

curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hulog.ph","password":"admin123"}'
# {"ok":true,"token":"<token>","user":{...}}
```

You should also see `[boot] demo data seeded` in the server log the first
time — that created the demo accounts, plans, and an overdue plan with a
live penalty in your cloud database.

## 3. Deploy the API for free (Render)

1. Push this repo to GitHub.
2. Go to https://render.com → **New → Blueprint**.
3. Pick the repo — Render finds `server/render.yaml` and pre-fills the
   service. It also auto-generates `TOKEN_SECRET`.
4. Set the **`DATABASE_URL`** environment variable to your Neon connection
   string (click the "edit" icon next to it).
5. **Apply** → Render builds (`npm run build`) and starts
   (`npm start`). First deploy takes a few minutes.
6. Your API is now at `https://hulogtrack-api.onrender.com` (Render picks
   the name from `render.yaml` — or use **Manual Deploy** instead and point
   it at the `server/` subdirectory).

Test the deployed URL with the same two `curl` commands, replacing
`http://localhost:4000`.

## 4. Point the app at the cloud

1. Open the app → **Login screen**.
2. Flip **"☁️ Cloud server" ON**.

That's it — the app's default API URL is already
`https://hulogtrack-api.onrender.com` (the service name in `render.yaml`),
so a fresh install connects to the deployed API with zero typing. If you
renamed the service, or you're testing against a local server, just edit the
**API base URL** field that appears when cloud mode is on.

3. Sign in with `admin@hulog.ph / admin123` (or any demo account) — all
   data now comes from the cloud Postgres, shared across every device.

> **Physical phone on the same Wi-Fi (no deploy yet):** use your computer's
> LAN IP — `http://192.168.x.x:4000` — and start the server with
> `npm run dev`. The phone and laptop must be on the same network, and the
> computer's firewall must allow port 4000.

---

## 5. Ship the Android app — downloadable APK via GitHub Releases

The repo ships `.github/workflows/build-apk.yml`, which builds the **signed
release APK on GitHub's servers** (no Android Studio, no SDK, no signing
secrets) and attaches it to this repo's **Releases** page.

1. Make sure the code is on GitHub (branch `main`).
2. **Cut a versioned release** (recommended for updates):
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   → Actions runs **Build & publish APK**, then a release named `v0.1.0`
   appears under **Releases** with `HulogTrack-v0.1.0-<sha>.apk` attached.
3. **Or just push to `main`** — the workflow publishes a rolling **latest**
   release with a stable URL you can share anywhere:
   ```
   https://github.com/<you>/App_new/releases/latest/download/HulogTrack-latest.apk
   ```
4. **Install on a phone:** open that link on the phone → download → open the
   APK → allow **Install from unknown sources** (Android asks once).
   Subsequent builds upgrade in place because every APK is signed with the
   same committed key (`android/app/hulogtrack-release.keystore`).

> Want your own icon first? Drop it into `android/app/src/main/res/mipmap-*`
> (exact sizes in `assets/ASSETS.md`) and the next build ships it.
>
> **Production note:** the demo keystore is committed so CI works with zero
> secrets. For a store release, generate a private keystore and pass it via
> the `ANDROID_STORE_FILE/PASSWORD/KEY_ALIAS/KEY_PASSWORD` env vars instead
> (see `android/app/build.gradle`).

---

## 6. Keep the free server awake (no cold starts)

Render's free tier sleeps after ~15 min idle. `.github/workflows/keep-alive.yml`
pings `GET /api/health` **every 10 minutes** — well inside the sleep window,
and 10-min cadence still fits the 750 free hours/month. Each ping also runs
the due-reminder scan (below).

**Set it up (2 minutes):**

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `RENDER_URL` = your deployed URL, e.g. `https://hulogtrack-api.onrender.com`
     (no trailing slash)
   - `CRON_SECRET` = the server's `CRON_SECRET` env value — Render generates
     one; copy it from **Render → your service → Environment**.
2. Run the workflow once by hand to verify: **Actions → Keep server awake →
   Run workflow**. You should see `health → 200` and `reminders → 200`.

**More robust alternative (5-min pings, independent of GitHub):**
[UptimeRobot](https://uptimerobot.com) free plan → **New monitor** → HTTP(s),
URL = `https://hulogtrack-api.onrender.com/api/health`, interval **5 min**.
It can't send the cron secret, so pair it with the in-process reminder
scheduler (default `REMINDER_INTERVAL_MIN=15`), which scans while awake.

> ⚠️ GitHub pauses **scheduled** workflows in *private* repos after ~60 days
> without repo activity. If the keep-alive stops pinging, push a commit or
> switch to UptimeRobot.

---

## 7. Server-side due reminders

The server scans every active plan for due/overdue payments and creates
notifications for the buyer (due-soon ⏰, overdue 🚨) and the seller (overdue
alert 🚨). Every reminder carries a deterministic **dedup key**, so the same
reminder is emitted exactly once — even though the scan runs every 10 minutes.
Reminders show up in the app's notification bell exactly like manual ones.

- **In-process:** runs automatically every 15 min while the server is awake
  (`REMINDER_INTERVAL_MIN`).
- **On-demand cron:** `POST /api/cron/reminders` with header
  `x-cron-secret: <CRON_SECRET>` — the keep-alive workflow calls this on
  every ping, so a scan happens every 10 minutes regardless.
- **Rules** come from Settings (grace days, penalty rate/cap, reminder lead)
  and are computed by the same pure engine the app uses
  (`server/src/services/reminders.ts`).

---

## Free-tier reality check (read this)

| Platform | Free limits | Gotcha |
|---|---|---|
| **Neon** | 0.5 GB storage, 100 compute-hours/mo | DB scales to zero after ~5 min idle; first query after idle takes ~1–2 s (imperceptible in a mobile app) |
| **Render** | 750 web-service hours/mo, 512 MB RAM | **Sleeps after 15 min idle** → first request after a nap takes ~30–50 s (cold start). Fine for demos; for always-hot, a paid hobby instance is ~$7/mo |
| **Supabase** (alt) | 500 MB Postgres, auth up to 50k MAU | Free projects **pause after 1 week of inactivity** — log in to unpause |
| **Vercel** (alt) | 1M function invocations/mo | Serverless — no long-lived connections; the API uses a new pool per function warm instance (fine at this scale) |

**Zero cold starts are handled for you** — `.github/workflows/keep-alive.yml`
pings the health endpoint every 10 minutes (see §6). If you'd rather not use
your GitHub Actions minutes, point UptimeRobot at `/api/health` instead.

---

## Alternatives

**Supabase (recommended if you want auth built-in)**
- Sign up at https://supabase.com → New project → copy the **Database
  connection string** (Project Settings → Database → "Connection string" →
  `postgresql://postgres.[ref]:[password]@aws-0-...pooler.supabase.com:5432/postgres`).
- Paste it as `DATABASE_URL`, deploy the API anywhere, done.
- Bonus: Supabase also hosts static sites and gives you realtime + storage
  for free — a path to push-notifications later.

**Vercel (serverless)**
- Install the Vercel CLI; from `server/`: `vercel` — add `DATABASE_URL` as
  an env var. The Express app runs as a serverless function as-is.

---

## Common issues

| Symptom | Fix |
|---|---|
| `DATABASE_URL is not set` | Copy `.env.example` → `.env` and fill it in. |
| `password authentication failed` | Wrong connection string — regenerate it in Neon. |
| App says "Cannot reach the server" | Wrong API URL (no `https://`), server sleeping (wait 60 s and retry), or firewall blocking port 4000 on LAN testing. |
| `Session expired. Please sign in again.` | Token was revoked or the DB was reset (sessions live in Postgres, so a normal server restart does NOT log anyone out). Just sign in again — tokens are cheap. |
| Demo data missing in cloud | `SEED_ON_BOOT` was `0`, or the DB was already seeded from an earlier run. Delete the `settings` row `key='seeded'` and restart, or set `SEED_ON_BOOT=1` on a fresh DB. |
