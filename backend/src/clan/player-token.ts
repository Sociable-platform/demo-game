import type { Config } from '../config.js';
import type { SessionUser } from '../auth/sessions.js';
import { AppError } from '../http/errors.js';

export const UPSTREAM_TIMEOUT_MS = 5000;
export function serviceEndpoint(value: string, path: string): URL | null {
  try {
    const base = new URL(value);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null;
    return new URL(base.href.replace(/\/+$/, '') + path);
  } catch { return null; }
}

// Shared by community/token and account deletion: fresh tokens, server identity.
export async function issuePlayerToken(config: Config, player: Pick<SessionUser, 'userId' | 'username'>) {
  const endpoint = serviceEndpoint(config.clanPlatformUrl, '/api/v1/players/auth');
  if (!endpoint || !config.clanGameApiKey || /[\r\n]/.test(config.clanGameApiKey)) {
    throw new AppError(503, 'clan_not_configured', 'Clan authentication is not configured.');
  }
  const upstreamError = () => new AppError(502, 'clan_upstream_error', 'Clan authentication is temporarily unavailable.');
  const issuedAfter = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': config.clanGameApiKey },
      body: JSON.stringify({ externalPlayerId: player.userId, displayName: player.username }),
    });
    if (!upstream.ok) { await upstream.body?.cancel(); throw upstreamError(); }
    const data: unknown = await upstream.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw upstreamError();
    const { token, expiresIn } = data as Record<string, unknown>;
    if (typeof token !== 'string' || !token || /\s/.test(token)
      || typeof expiresIn !== 'number' || !Number.isInteger(expiresIn) || expiresIn <= 0) throw upstreamError();
    return { token, expiresIn, expiresAt: issuedAfter + expiresIn * 1000 };
  } catch {
    // Never log/forward fetch errors, upstream bodies, headers, or credentials.
    if (controller.signal.aborted) throw new AppError(504, 'clan_upstream_timeout', 'Clan authentication timed out. Please try again.');
    throw upstreamError();
  } finally { clearTimeout(timer); }
}
