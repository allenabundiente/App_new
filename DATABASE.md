# HulogTrack Database Guide

This is the lesson. Read it top to bottom and you'll understand *how* and *why*
the database in this app is built — and you'll be able to extend it yourself.

---

## 1. The big picture: how data flows

There are exactly **four layers**, and data only ever moves between neighbours:

```
┌─────────────────────────────────────────────────────────┐
│  SCREENS (React components)                              │
│  They call repository functions:  listPlans(), ...       │
└───────────────────────────┬─────────────────────────────┘
                            │  async calls
┌───────────────────────────▼─────────────────────────────┐
│  REPOSITORY  (src/db/repository.ts)                     │
│  The ONLY file that writes SQL. Mappers convert          │
│  snake_case rows → camelCase TypeScript contracts.       │
└───────────────────────────┬─────────────────────────────┘
                            │  executeAsync()
┌───────────────────────────▼─────────────────────────────┐
│  SCHEMA + MIGRATIONS (src/db/schema.ts)                 │
│  CREATE TABLE statements, indexes, seed data             │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  SQLite file on the device (react-native-quick-sqlite)  │
└─────────────────────────────────────────────────────────┘
```

**Golden rule:** the UI never writes SQL, and the repository never touches
React state. If you follow that, you can swap SQLite for a server API later
by rewriting only the repository.

The repository is async (every method returns a `Promise`). SQLite work runs
off the JavaScript thread, so the UI never freezes — that's why you see
`await` everywhere in screens.

---

## 2. Schema design decisions (read this before the SQL)

Every choice in `schema.ts` exists for a reason. These are the rules I want
you to internalize:

### a) TEXT primary keys, generated on the device

```sql
id TEXT PRIMARY KEY NOT NULL
```

No `INTEGER PRIMARY KEY AUTOINCREMENT`. Why? **Offline-first**: if the app
must mint a new id it shouldn't need to ask the database (or a server) for
one. `generateId('pl-')` in `src/utils/id.ts` produces things like
`pl-m1x2y3z4abc` from the current timestamp + random suffix. This also means
ids are unguessable and can be created *before* the row exists — handy when
you assemble a whole record (plan + schedule) before inserting.

### b) Dates are TEXT, timestamps are TEXT, booleans are INTEGER

```sql
dueDate  TEXT NOT NULL   -- 'YYYY-MM-DD'
createdAt TEXT NOT NULL  -- ISO-8601 '2026-08-06T09:30:00.000Z'
isRead   INTEGER NOT NULL DEFAULT 0
```

- **`YYYY-MM-DD` sorts correctly as a string** (`'2026-02-01' < '2026-02-10'`),
  which makes "next due" queries trivial: `ORDER BY dueDate LIMIT 1`.
- Calendar math (add a month, count days late) happens in
  `src/utils/date.ts` — pure functions that never touch `Date` timezones
  sloppily. `addMonths('2026-01-31', 1)` correctly returns `'2026-02-28'`.
- Booleans as `0/1` integers is the SQLite convention; the mapper converts
  them back with `toBool()`.

### c) Money is REAL, but only ever rounded to cents in one place

Floats can't represent `0.1` exactly. The fix is not "use TEXT" — it's
**always round with `round2()` from `src/utils/money.ts` before storing, and
sum in the repository**. `formatMoney()` handles display. Never do
`a + 0.1` arithmetic in a screen and display the raw result.

### d) The schedule is its own table

A plan isn't "a price and a term" — it's a **timeline of installments**:

```sql
CREATE TABLE plan_schedule (
  id TEXT PRIMARY KEY NOT NULL,
  planId TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  dueDate TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'paid' | 'skipped'
  ...
);
```

Because each installment is a row, "which payment is next?", "how many are
paid?", "what's overdue?" become plain indexed SQL instead of logic in JS.
`ON DELETE CASCADE` means deleting a plan cleans up its schedule automatically.

### e) Indexes mirror the hot queries

```sql
CREATE INDEX idx_schedule_plan ON plan_schedule(planId, status);
```

`plan_schedule(planId, status)` serves "give me the unpaid installments of
this plan" in one index scan. There's one index per frequent query pattern;
don't index everything.

---

## 3. Reading the schema file

Open `src/db/schema.ts`. Structure:

1. `SCHEMA` — one big string of `CREATE TABLE IF NOT EXISTS` statements and
   indexes. `IF NOT EXISTS` makes boot idempotent: run it every launch.
2. `SCHEMA_VERSION` — an integer stored in `PRAGMA user_version`.
3. `MIGRATIONS` — guarded upgrade steps (next section).
4. `seedUsers`, `seedCustomers`, `seedProducts`, `DEFAULT_SETTINGS` — first-run
   demo data.

**The boot sequence** (`initDatabase()` in `repository.ts`):

```
1. open the db file           → open({ name: 'hulogtrack.db' })
2. PRAGMA journal_mode = WAL  → faster reads/writes, crash-safe
3. PRAGMA foreign_keys = ON   → enforce REFERENCES
4. execute SCHEMA             → create tables (no-op if they exist)
5. run MIGRATIONS             → bring old DBs up to date
6. seed on first launch       → only when settings.seeded ≠ '1'
```

Run it once in `AppStore.tsx` before rendering anything (that's the
`splash → app` gate you see on launch).

---

## 4. Migrations — how you change the schema later

Here's the problem: your app is already installed on a phone with a v1
database. The `CREATE TABLE IF NOT EXISTS` won't add a new column to the
existing table. That's what migrations are for.

```ts
export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    apply: async db => {
      // 1. Look at the real table
      const info = await db.executeAsync('PRAGMA table_info(plans)');
      const hasNotes = info.rows._array.some(c => c.name === 'notes');
      // 2. Only ALTER if the column is missing — this makes the step safe
      //    on BOTH fresh installs (SCHEMA already has it) and old installs.
      if (!hasNotes) {
        await db.executeAsync("ALTER TABLE plans ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
      }
    },
  },
];
```

The framework part (`runMigrations` in `repository.ts`):

```
for each migration with version > PRAGMA user_version:
    BEGIN
    run migration.apply(db)
    PRAGMA user_version = version      ← remember what we did
    COMMIT
```

So when you ship schema v3: bump `SCHEMA_VERSION` to 3, append a guarded
migration object. Old phones run step 2 (the ALTER); fresh phones skip it
because SCHEMA already built the column.

> **The 3 rules of a good migration:** (1) idempotent — guard every ALTER,
> (2) transactional — the framework wraps it, (3) forward-only — never edit
> an existing migration, always append a new one.

---

## 5. The repository: the only place SQL lives

`src/db/repository.ts` has three responsibilities:

### a) Row mappers

SQLite hands back **snake_case** rows (because that's the SQL column names);
the rest of the app wants **camelCase** TypeScript types. Every table has a
mapper:

```ts
function mapPlan(r: Record<string, unknown>): Plan {
  return {
    id: toStr(r.id),
    planNo: toStr(r.planNo),
    financed: toNum(r.financed),
    ...
  };
}
```

The little helpers `toStr / toNum / toBool` exist because quick-sqlite can
hand back `number | string | null` depending on how a value was stored — the
mappers normalize everything.

### b) Read functions — always parameterized

```ts
export async function listPlans(opts?: {sellerId?: string; buyerId?: string}) {
  let sql = 'SELECT * FROM plans';
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.sellerId) { where.push('sellerId = ?'); params.push(opts.sellerId); }
  ...
  return rowsOf<Record<string, unknown>>(res).map(mapPlan);
}
```

Notice the `?` placeholders — **never** string-concatenate user input into
SQL. `executeAsync('... WHERE x = ?', [value])` prevents SQL injection by
construction.

### c) Write functions — wrapped in transactions when multi-step

This is the heart of the lesson. Look at `recordPayment` — it must:

1. find the next unpaid installment,
2. mark it paid,
3. insert a payment row,
4. complete the plan if nothing remains,
5. notify the buyer.

If the app crashes after step 2 but before step 3, the database would be
inconsistent. So the whole thing runs inside a transaction:

```ts
await database.executeAsync('BEGIN;');
try {
  // ... all the writes ...
  await database.executeAsync('COMMIT;');
} catch (e) {
  await database.executeAsync('ROLLBACK;');   // undo EVERYTHING
  throw e;
}
```

`BEGIN` / `COMMIT` / `ROLLBACK` guarantee **atomicity**: either all five
steps happen, or none of them do. `createPlan` (plan + schedule + down
payment), `settlePlan`, and `resolveAdjustment` follow the same pattern.

> **How to decide if a write needs a transaction:** if it writes to more
> than one table — or writes one table then *reads it back to decide what to
> write next* — it belongs in a transaction.

---

## 6. How a feature is born (walkthrough)

Say you want to add a **discount** to plans. Trace what you'd touch:

1. **`types.ts`** — add `discount: number` to `Plan`.
2. **`schema.ts`** — add the column to `SCHEMA`'s `CREATE TABLE plans`,
   bump `SCHEMA_VERSION` to 3, and append a guarded migration that
   `ALTER TABLE plans ADD COLUMN discount REAL NOT NULL DEFAULT 0`.
3. **`repository.ts`** — add `discount: toNum(r.discount)` to `mapPlan`,
   include it in the `INSERT` in `createPlan`, and add a small function
   like `updatePlanDiscount(id, value)`.
4. **Screen** — call `updatePlanDiscount(...)`, then `refresh()`.
   (Optional but nice: a pure service `discountedInstallment(...)` with a
   test in `__tests__/`.)

That's the whole loop: **type → schema+migration → mapper+repo → UI → test**.
Business rules like penalties never live in the repository — they live in
`src/services/` (pure functions) and the repository *calls* them. That's why
the penalty engine has 25 passing tests with zero database involved.

---

## 7. Seed data — demo accounts & plans

On first launch the app creates demo users so you can log in instantly:

| Role   | Email             | Password    |
|--------|-------------------|-------------|
| Admin  | admin@hulog.ph    | admin123    |
| Seller | seller@hulog.ph   | seller123   |
| Buyer  | buyer@hulog.ph    | buyer123    |

Plus five realistic plans (one overdue with a live penalty, one completed,
one with a pending adjustment request) — see `seedDatabase()` in
`repository.ts`. The `settings.seeded` key makes sure seeding happens
exactly once.

---

## 8. Where's the file, and how do I poke at it?

- **Android:** `/data/data/com.hulogtrack/databases/hulogtrack.db`
- **iOS:** the app's Documents directory (visible in the iOS simulator).
- While developing you can't easily attach a SQLite shell to a device, so
  the workflow is: write a test against the pure services, or add a
  temporary `console.log(JSON.stringify(await listPlans()))` in a screen.
- Want a real query tool? Install `react-native-quick-sqlite`'s dev helper
  or use Android Studio's *App Inspection → Database Inspector*, which lets
  you browse and run SQL live against the running app.

---

## 9. Session vs database: why MMKV exists

`src/storage/kv.ts` stores exactly one thing: the logged-in user id. It's a
tiny synchronous key-value store (react-native-mmkv). We keep it *outside*
SQLite because:

- it must be readable **synchronously at boot**, before the async DB opens,
- logging out is a single `.remove()` call,
- it's the standard pattern: business data in SQL, session in MMKV.

---

## 10. Testing the data layer

The **business rules** (penalty math, amortization, reminders, settlement)
are pure functions in `src/services/` — test them with plain Jest:

```bash
npm test          # 25 tests, no device, no database needed
npm run typecheck # tsc --noEmit over the whole app
```

The **repository itself** isn't unit-tested because it talks to a native
module — in a real project you'd test it with an in-memory SQLite
(`react-native-quick-sqlite` supports `location: ':memory:'`) or
`jest.mock` the native module. The important thing is the *rules* are tested,
and the repository is a thin, mechanical translation layer on top of them.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Migration** | A guarded, versioned SQL step that upgrades an existing database |
| **PRAGMA user_version** | SQLite's built-in version counter we reuse for migration tracking |
| **WAL** | Write-Ahead Logging — journal mode that makes concurrent reads/writes fast and crash-safe |
| **Mapper** | Function converting a snake_case DB row into a camelCase TS object |
| **Parameterized query** | SQL with `?` placeholders + a params array — injection-safe |
| **Transaction** | `BEGIN` … `COMMIT`/`ROLLBACK` block — all-or-nothing multi-write |
| **Offline-first** | Data works without a network; ids minted on-device |
