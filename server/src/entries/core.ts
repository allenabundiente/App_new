/**
 * The core service. It handles customers, products, plans, payments,
 * adjustments and settings.
 *
 * To run it on its own: PORT=4002 npm run start:core
 * The Caddy gateway in front sends everything under /api/customers*,
 * /api/products*, /api/plans*, /api/payments*, /api/adjustments* and
 * /api/settings to it.
 * It needs the shared Postgres and the schema, so run the migrate container
 * (or npm run dev) first.
 */
import 'dotenv/config';
import {Router} from 'express';
import {createService, listen} from '../service';
import {createCoreRouter} from '../routes/core';
import {createPaypalRouter} from '../routes/paypal';

// PayPal lives under /api/payments as well, so this service owns both.
const router = Router();
router.use(createCoreRouter());
router.use(createPaypalRouter());

const app = createService('hulogtrack-core', router);
listen(app, 'core', 4002);
