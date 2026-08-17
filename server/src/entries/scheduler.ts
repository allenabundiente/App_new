/**
 * In-process due-reminder scheduler. Runs while the instance is awake, which
 * covers most of the day once the keep-alive workflow keeps it warm. Disable
 * with DISABLE_REMINDER_SCHEDULE=1 and drive scans purely from the cron
 * endpoint if you prefer.
 *
 * Started by the monolith (src/index.ts) and by the engagement microservice
 * (src/entries/engagement.ts) — never inside tests (they use createApp).
 */
import {runDueReminders} from '../services/reminders';

export function startReminderScheduler(): void {
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
