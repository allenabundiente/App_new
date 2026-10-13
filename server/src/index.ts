/**
 * The entry point for the API as a single process. This is what runs on
 * Render, with `npm start` and for local dev.
 *
 * What it does on boot:
 *   1. load the .env file (DATABASE_URL, PORT, TOKEN_SECRET, SEED_ON_BOOT)
 *   2. run schema.sql and seed the demo data, using the same code as the
 *      migrate entry in src/entries/migrate.ts
 *   3. start listening with all three routers mounted
 *   4. start the reminder scheduler
 *
 * The microservice version (src/entries/auth.ts, core.ts, engagement.ts)
 * mounts the same routers separately behind a gateway, see the Dockerfile
 * and docker-compose.yml.
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
