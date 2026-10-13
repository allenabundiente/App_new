/**
 * Runs the schema and the demo seed once, then exits. This is the
 * `migrate` Docker target, and the main app (src/index.ts) uses the same
 * code at boot so there is only one version of it.
 *
 * In docker-compose the other services wait for this container to finish,
 * which means the tables exist before any API starts.
 */
import 'dotenv/config';
import {ensureSchema} from '../db';
import {isSeeded, seedDatabase} from '../seed';

export async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // If there is no database set up, say so now instead of failing later.
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
