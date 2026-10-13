/**
 * The engagement service. It handles chat, notifications, the audit log and
 * the due-reminder scheduler.
 *
 * To run it on its own: PORT=4003 npm run start:engagement
 * The Caddy gateway in front sends /api/messages*, /api/notifications*,
 * /api/audit* and /api/cron* to it.
 *
 * This one also runs the reminder scheduler, a job that wakes up every
 * REMINDER_INTERVAL_MIN minutes. It needs the shared Postgres and the
 * schema, so run the migrate container (or npm run dev) first.
 */
import 'dotenv/config';
import {createService, listen} from '../service';
import {createEngagementRouter} from '../routes/engagement';
import {startReminderScheduler} from './scheduler';

const app = createService('hulogtrack-engagement', createEngagementRouter());
listen(app, 'engagement', 4003);
startReminderScheduler();
