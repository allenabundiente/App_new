/**
 * The auth service. It handles users and sessions.
 *
 * To run it on its own: PORT=4001 npm run start:auth
 * The Caddy gateway in front sends /api/auth*, /api/me and /api/users* here.
 * It needs the shared Postgres to be up and the schema to exist, so run the
 * migrate container (or npm run dev) first.
 */
import 'dotenv/config';
import {createService, listen} from '../service';
import {createAuthRouter} from '../routes/auth';

const app = createService('hulogtrack-auth', createAuthRouter());
listen(app, 'auth', 4001);
