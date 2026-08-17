/**
 * Core microservice — the installment-tracking domain (customers, products,
 * plans, payments, adjustments, settings).
 *
 * Run standalone:  PORT=4002 npm run start:core   (or the `core` Docker target)
 * Mounted behind the Caddy gateway at /api/customers*, /api/products*,
 * /api/plans*, /api/payments*, /api/adjustments*, /api/settings.
 * Requires the shared Postgres (DATABASE_URL) and the schema to exist — run
 * the `migrate` container (or `npm run dev`) first.
 */
import 'dotenv/config';
import {createService, listen} from '../service';
import {createCoreRouter} from '../routes/core';

const app = createService('hulogtrack-core', createCoreRouter());
listen(app, 'core', 4002);
