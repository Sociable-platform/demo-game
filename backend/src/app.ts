import path from 'node:path';
import fs from 'node:fs';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Db } from './db/connection.js';
import { createRequireAuth } from './auth/middleware.js';
import { createAuthRouter } from './auth/routes.js';
import { createGameService } from './game/service.js';
import { createGameRouter } from './game/routes.js';
import { createDevRouter } from './dev/routes.js';
import { createClanRouter } from './clan/routes.js';
import { AppError, errorHandler, notFoundHandler } from './http/errors.js';

export interface AppDeps {
  config: Config;
  db: Db;
  now?: () => number;
}

/**
 * Module layout (so a future SDK integration can be added as a sibling module without touching these):
 *   auth/  - registration, login, sessions, requireAuth       (knows nothing about the game)
 *   game/  - farm rules + endpoints                           (knows nothing about how auth works)
 * They meet only here: auth calls game.initPlayer when a user is created, game routes take requireAuth.
 */
export function createApp({ config, db, now = Date.now }: AppDeps): Express {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // upgrade-insecure-requests is disabled so the production build also runs on plain http://localhost.
  // Behind real TLS every request is already https.
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'upgrade-insecure-requests': null,
    'script-src': ["'self'", ...(config.clanSdkOrigin ? [config.clanSdkOrigin] : [])],
    'connect-src': ["'self'", ...config.clanConnectOrigins],
  } } }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  // CSRF defence-in-depth on top of SameSite=Lax: browsers always send Origin on cross-site POSTs.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !config.appOrigins.includes(origin)) {
      return next(new AppError(403, 'forbidden_origin', 'Requests from this origin are not allowed.'));
    }
    next();
  });

  const game = createGameService(db, now);
  const requireAuth = createRequireAuth(db, config, now);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ devMode: config.enableDevRoutes }));
  app.use('/api/auth', createAuthRouter({ db, config, now, requireAuth, onUserCreated: game.initPlayer }));
  app.use('/api/game', createGameRouter(game, requireAuth));
  app.use('/api/clan', createClanRouter(config, requireAuth));
  if (config.enableDevRoutes) app.use('/api/dev', createDevRouter(db, now, game.initPlayer));
  app.use('/api', notFoundHandler);

  // In production the built frontend is served by this same server (same origin => cookies just work).
  if (config.frontendDist && fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(config.frontendDist!, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
