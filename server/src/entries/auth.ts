/**
 * Auth microservice — identity & directory (users, sessions).
 *
 * Run standalone:  PORT=4001 npm run start:auth   (or the `auth` Docker target)
 * Mounted behind the Caddy gateway at /api/auth*, /api/me, /api/users*.
 * Requires the shared Postgres (DATABASE_URL) and the schema to exist — run
 * the `migrate` container (or `npm run dev`) first.
 */
import 'dotenv/config';
import {createService, listen} from '../service';
import {createAuthRouter} from '../routes/auth';

const app = createService('hulogtrack-auth', createAuthRouter());
listen(app, 'auth', 4001);
