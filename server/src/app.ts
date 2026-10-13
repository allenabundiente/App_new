/**
 * Builds the Express app for the API.
 *
 * The routes are split into three files: routes/auth.ts, routes/core.ts and
 * routes/engagement.ts. The same three files are also used by the separate
 * microservices in src/entries/. Here we just mount all three on one app so
 * the single process deployment still works exactly the same.
 *
 * The shapes the routes return match the types in the mobile app's
 * src/types.ts.
 */
import express, {type NextFunction, type Request, type Response} from 'express';
import cors from 'cors';
import path from 'path';
import {nowIso} from './services/date';
import {createAuthRouter} from './routes/auth';
import {createCoreRouter} from './routes/core';
import {createEngagementRouter} from './routes/engagement';
import {createPinRouter} from './routes/pin';

export function createApp() {
  const app = express();
  app.use(cors({origin: true, credentials: true}));
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({service: 'HulogTrack API', version: '0.1.0', status: 'ok'});
  });

  app.get('/api/health', (_req, res) => {
    res.json({ok: true, service: 'hulogtrack-api', time: nowIso()});
  });

  app.use('/api', createAuthRouter());
  app.use('/api', createCoreRouter());
  app.use('/api', createEngagementRouter());
  app.use('/api', createPinRouter());

  // The admin dashboard is a plain html page served from /admin.
  app.use('/admin', express.static(path.join(__dirname, 'admin')));

  // One error handler for every route.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api error]', err);
    res.status(500).json({error: err.message ?? 'Internal server error.'});
  });

  return app;
}
