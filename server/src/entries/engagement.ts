/**
 * Engagement microservice — chat, notifications, audit, and the due-reminder
 * scheduler.
 *
 * Run standalone:  PORT=4003 npm run start:engagement   (or the `engagement`
 * Docker target). Mounted behind the Caddy gateway at /api/messages*,
 * /api/notifications*, /api/audit*, /api/cron*.
 *
 * This service also runs the in-process reminder scheduler (the cron job
 * every REMINDER_INTERVAL_MIN minutes) — it owns the notifications table the
 * scheduler writes to. Requires the shared Postgres (DATABASE_URL) and the
 * schema to exist — run the `migrate` container (or `npm run dev`) first.
 */
import 'dotenv/config';
import {createService, listen} from '../service';
import {createEngagementRouter} from '../routes/engagement';
import {startReminderScheduler} from './scheduler';

const app = createService('hulogtrack-engagement', createEngagementRouter());
listen(app, 'engagement', 4003);
startReminderScheduler();
