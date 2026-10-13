/**
 * A dev server for running the API locally without Docker or Postgres.
 * It runs the same Express app with all the routes, but against an
 * in-memory database (pg-mem), then listens on :4000 so you can open the
 * admin dashboard at /admin in a browser.
 *
 *   npm run dev:memory
 *
 * Add DISABLE_REMINDER_SCHEDULE=1 to turn off the reminder scheduler.
 *
 * Demo accounts once it has seeded:
 *   admin@hulog.ph / admin123
 *   seller@hulog.ph / seller123
 *   buyer@hulog.ph / buyer123
 *
 * The data is only in memory, so restarting gives you the demo data again.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {newDb} from 'pg-mem';
import {setPool, getPool} from '../db';
import {createApp} from '../app';
import {seedDatabase} from '../seed';
import {startReminderScheduler} from './scheduler';

const PORT = Number(process.env.PORT) || 4000;

async function main(): Promise<void> {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  setPool(new Pool());

  const schema = readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf8');
  await getPool().query(schema);
  await seedDatabase();

  console.log('[dev-memory] schema applied + demo data seeded (in-memory)');

  createApp().listen(PORT, () => {
    console.log(`HulogTrack API (in-memory) listening on http://0.0.0.0:${PORT}`);
    console.log(`Admin dashboard:            http://localhost:${PORT}/admin  (admin@hulog.ph / admin123)`);
  });

  startReminderScheduler();
}

main().catch(err => {
  console.error('[dev-memory] failed:', err.message);
  process.exit(1);
});
