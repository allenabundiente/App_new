/**
 * HulogTrack API — entry point.
 *
 * Boot sequence:
 *   1. load .env (DATABASE_URL, PORT, TOKEN_SECRET, SEED_ON_BOOT)
 *   2. apply schema.sql (idempotent)
 *   3. seed demo data on first boot
 *   4. start listening
 */
import 'dotenv/config';
import {createApp} from './app';
import {ensureSchema} from './db';
import {isSeeded, seedDatabase} from './seed';
import {runDueReminders} from './services/reminders';

const PORT = Number(process.env.PORT ?? 4000);

export async function boot(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // Local dev without a DB: throw a helpful error instead of crashing later.
    throw new Error(
      'DATABASE_URL is not set. Copy server/.env.example to server/.env and add a Postgres connection string (Neon/Supabase free tier).',
    );
  }
  await ensureSchema();
  if (process.env.SEED_ON_BOOT !== '0' && !(await isSeeded())) {
    await seedDatabase();
    console.log('[boot] demo data seeded');
  }
}

if (require.main === module) {
  boot()
    .then(() => {
      createApp().listen(PORT, () => {
        console.log(`HulogTrack API listening on http://0.0.0.0:${PORT}`);
      });
      startReminderScheduler();
    })
    .catch(err => {
      console.error('[boot] failed:', err.message);
      process.exit(1);
    });
}

/**
 * In-process due-reminder scheduler. Runs while the instance is awake, which
 * covers most of the day once the keep-alive workflow keeps it warm. Disable
 * with DISABLE_REMINDER_SCHEDULE=1 and drive scans purely from the cron
 * endpoint if you prefer. Never runs inside tests (createApp is used there).
 */
function startReminderScheduler(): void {
  if (process.env.DISABLE_REMINDER_SCHEDULE === '1') {
    console.log('[boot] in-process reminder scheduler disabled');
    return;
  }
  const minutes = Math.max(1, Number(process.env.REMINDER_INTERVAL_MIN ?? 15));
  let running = false;
  const run = async (): Promise<void> => {
    if (running) {
      return; // don't overlap runs
    }
    running = true;
    try {
      const r = await runDueReminders();
      console.log(`[reminders] scanned ${r.scanned} plans, generated ${r.generated} notifications`);
    } catch (err) {
      console.error('[reminders] scan failed:', (err as Error).message);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), 30_000); // first scan shortly after boot
  setInterval(() => void run(), minutes * 60_000);
  console.log(`[boot] due-reminder scheduler active every ${minutes} min`);
}
