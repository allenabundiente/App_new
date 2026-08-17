/**
 * HulogTrack API — monolith entry point (Render, `npm start`, local dev).
 *
 * Boot sequence:
 *   1. load .env (DATABASE_URL, PORT, TOKEN_SECRET, SEED_ON_BOOT)
 *   2. apply schema.sql + seed demo data (same one-shot logic as the
 *      `migrate` Docker entry, src/entries/migrate.ts)
 *   3. start listening with ALL routes (auth + core + engagement mounted)
 *   4. start the in-process due-reminder scheduler
 *
 * The microservice deployment (src/entries/auth.ts, core.ts, engagement.ts)
 * mounts the same routers individually behind a gateway — see Dockerfile and
 * docker-compose.yml.
 */
import 'dotenv/config';
import {createApp} from './app';
import {migrate} from './entries/migrate';
import {startReminderScheduler} from './entries/scheduler';

const PORT = Number(process.env.PORT ?? 4000);

if (require.main === module) {
  migrate()
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
