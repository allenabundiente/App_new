/**
 * Builds the small Express app each microservice uses. It has the same
 * middleware and error handling as the main app, but only mounts its own
 * router. The Caddy gateway in front decides which service each /api path
 * goes to, so the app itself doesn't need to know they are separate.
 */
import express, {type NextFunction, type Request, type Response, type Router} from 'express';
import cors from 'cors';
import {nowIso} from './services/date';

export function createService(name: string, router: Router): express.Express {
  const app = express();
  app.use(cors({origin: true, credentials: true}));
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({service: name, status: 'ok'});
  });

  app.get('/api/health', (_req, res) => {
    res.json({ok: true, service: name, time: nowIso()});
  });

  app.use('/api', router);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[${name} error]`, err);
    res.status(500).json({error: err.message ?? 'Internal server error.'});
  });

  return app;
}

/** Starts listening. The port comes from the PORT env var. */
export function listen(app: express.Express, name: string, defaultPort = 4000): void {
  const PORT = Number(process.env.PORT ?? defaultPort);
  app.listen(PORT, () => {
    console.log(`[${name}] listening on http://0.0.0.0:${PORT}`);
  });
}
