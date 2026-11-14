import { Router, type RequestHandler } from 'express';
import type { Config } from '../config.js';
import { AppError } from '../http/errors.js';

const unavailable = () => new AppError(503, 'clan_not_configured', 'Clan authentication is not configured.');
const upstreamError = () => new AppError(502, 'clan_upstream_error', 'Clan authentication is temporarily unavailable.');

// Platform contract: services/platform/internal/handler/players.go in clan-backend.
// No game or player identity is accepted from the browser.
export function createClanRouter(config: Config, requireAuth: RequestHandler) {
  const router = Router();
  router.post('/token', requireAuth, async (req, res) => {
    if (!config.clanPlatformUrl || !config.clanGameApiKey || /[\r\n]/.test(config.clanGameApiKey)) {
      throw unavailable();
    }
    let endpoint: URL;
    try {
      const base = new URL(config.clanPlatformUrl);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error('Invalid Platform base URL');
      }
      endpoint = new URL(`${base.href.replace(/\/$/, '')}/api/v1/players/auth`);
    } catch {
      throw unavailable();
    }

    // Deadline covers both response headers and the JSON body. Never follow a redirect with a key.
    const issuedAfter = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': config.clanGameApiKey },
        body: JSON.stringify({ externalPlayerId: req.auth!.userId, displayName: req.auth!.username }),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw upstreamError();
      }
      const data: unknown = await upstream.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw upstreamError();
      const { token, expiresIn } = data as Record<string, unknown>;
      if (typeof token !== 'string' || !token || /\s/.test(token)
        || typeof expiresIn !== 'number' || !Number.isInteger(expiresIn) || expiresIn <= 0) {
        throw upstreamError();
      }
      // No server token cache: normal and forced calls both exchange with Platform.
      res.json({ token, expiresIn, expiresAt: issuedAfter + expiresIn * 1000 });
    } catch {
      // Do not log/forward fetch errors, upstream bodies, headers, or credentials.
      if (controller.signal.aborted) {
        throw new AppError(504, 'clan_upstream_timeout', 'Clan authentication timed out. Please try again.');
      }
      throw upstreamError();
    } finally {
      clearTimeout(timer);
    }
  });
  return router;
}

