/**
 * Microservice app builder — the shared shell for the auth / core /
 * engagement services. Each service is a small Express app with the same
 * middleware and error handling as the monolith, but only its own router.
 * The Caddy gateway (docker/Caddyfile) routes /api/* paths to the right
 * service, so the mobile client never needs to know services exist.
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

/** Start listening. Port comes from PORT env, defaulting per service. */
export function listen(app: express.Express, name: string, defaultPort = 4000): void {
  const PORT = Number(process.env.PORT ?? defaultPort);
  app.listen(PORT, () => {
    console.log(`[${name}] listening on http://0.0.0.0:${PORT}`);
  });
}
