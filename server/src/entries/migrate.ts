/**
 * One-shot database bootstrap — applies schema.sql and seeds the demo
 * accounts, then exits. Used as the `migrate` Docker target and by the
 * monolith's boot sequence (src/index.ts) so both share identical logic.
 *
 * In docker-compose the services depend on this container finishing
 * successfully (`service_completed_successfully`), which guarantees the
 * schema exists before any API starts — only one container ever runs DDL.
 */
import 'dotenv/config';
import {ensureSchema} from '../db';
import {isSeeded, seedDatabase} from '../seed';

export async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // Local dev without a DB: throw a helpful error instead of crashing later.
    throw new Error(
      'DATABASE_URL is not set. Copy server/.env.example to server/.env and add a Postgres connection string (Neon/Supabase free tier).',
    );
  }
  await ensureSchema();
  if (process.env.SEED_ON_BOOT !== '0' && !(await isSeeded())) {
    await seedDatabase();
    console.log('[migrate] demo data seeded');
  }
  console.log('[migrate] schema ready');
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[migrate] failed:', err.message);
      process.exit(1);
    });
}
