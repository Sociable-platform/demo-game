import type { RequestHandler } from 'express';
import type { Db } from '../db/connection.js';
import type { Config } from '../config.js';
import { unauthorized } from '../http/errors.js';
import { findSessionUser, type SessionUser } from './sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. The ONLY source of player identity for protected routes. */
      auth?: SessionUser;
    }
  }
}

export function createRequireAuth(db: Db, config: Config, now: () => number): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[config.cookieName];
    if (typeof token !== 'string' || token.length === 0) return next(unauthorized());
    const user = findSessionUser(db, token, now());
    if (!user) return next(unauthorized());
    req.auth = user;
    next();
  };
}
