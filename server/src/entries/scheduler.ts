/**
 * The reminder scheduler that runs inside the server process. It keeps
 * checking for due and overdue plans while the instance is awake.
 * Set DISABLE_REMINDER_SCHEDULE=1 to turn it off and only use the cron
 * endpoint instead.
 *
 * The main app (src/index.ts) and the engagement service both start it. The
 * tests never do, they just build the app with createApp.
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
    if (running) {       return; // one scan is already running
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
  setTimeout(() => void run(), 30_000); // first scan a little after startup
  setInterval(() => void run(), minutes * 60_000);
  console.log(`[boot] due-reminder scheduler active every ${minutes} min`);
}
