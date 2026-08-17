/**
 * HulogTrack REST API — monolith assembler.
 *
 * The mobile app's cloud client (src/api/client.ts) mirrors these endpoints
 * 1:1. Every route returns the same camelCase shapes the app's types define.
 *
 * The route handlers now live in three domain routers — routes/auth.ts,
 * routes/core.ts, routes/engagement.ts — which are also mounted individually
 * by the auth/core/engagement microservices (src/entries/*.ts, see
 * Dockerfile). This file keeps the original single-process deployment
 * (Render, `npm start`, and the integration tests) working exactly as before:
 * mounting all three routers in one app changes nothing about the API.
 */
import express, {type NextFunction, type Request, type Response} from 'express';
import cors from 'cors';
import {nowIso} from './services/date';
import {createAuthRouter} from './routes/auth';
import {createCoreRouter} from './routes/core';
import {createEngagementRouter} from './routes/engagement';

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

  // Central error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api error]', err);
    res.status(500).json({error: err.message ?? 'Internal server error.'});
  });

  return app;
}
