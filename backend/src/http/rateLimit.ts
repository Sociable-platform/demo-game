import type { Request, RequestHandler } from 'express';
import { AppError } from './errors.js';

interface Options {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  enabled: boolean;
}

/** Tiny in-memory fixed-window limiter. Fine for a single-process app; swap for Redis if you scale out. */
export function rateLimit({ windowMs, max, key, enabled }: Options): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    if (!enabled) return next();
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    const k = key(req);
    const entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      hits.set(k, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new AppError(429, 'rate_limited', 'Too many attempts. Please wait a minute and try again.'));
    }
    next();
  };
}
