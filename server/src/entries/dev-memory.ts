/**
 * Local dev server — runs the REAL Express app (all routes) against an
 * in-memory Postgres (pg-mem), exactly like the integration test, then
 * listens on :4000 so the admin dashboard at /admin can be opened in a
 * browser. No Docker or Postgres server needed.
 *
 *   npm run dev:memory
 *
 * (Disable the in-process reminder scheduler with DISABLE_REMINDER_SCHEDULE=1.)
 *
 * Demo accounts after seeding:
 *   admin@hulog.ph / admin123   (admin — full dashboard access)
 *   seller@hulog.ph / seller123
 *   buyer@hulog.ph / buyer123
 *
 * Data lives in RAM only: restarting resets to the pristine demo dataset.
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
