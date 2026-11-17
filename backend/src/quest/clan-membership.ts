import type { Config } from '../config.js';
import type { SessionUser } from '../auth/sessions.js';
import { issuePlayerToken, serviceEndpoint, UPSTREAM_TIMEOUT_MS } from '../clan/player-token.js';
import { AppError } from '../http/errors.js';

export interface ClanInfo { id: string; name: string }
export type ClanLookup = (player: Pick<SessionUser, 'userId' | 'username'>) => Promise<ClanInfo | null>;

export const clanVerificationFailed = () =>
  new AppError(503, 'clan_verification_failed', "We couldn't verify your clan right now. Please try again in a moment.", { retryable: true });

/**
 * Resolves the player's CURRENT clan on the server. Identity comes from the game session; the Platform player
 * token is minted server-side with the game API key (never exposed) and presented to the Social service's
 * documented `GET /api/v1/players/me/clan`: 200 `{ clan: { id, name, ... }, role }`, or 404 `not_in_clan`.
 * Any other outcome is a retryable failure, so no quest action ever relies on a browser-supplied clan.
 */
export function createClanLookup(config: Config, assertAllowed: (userId: string) => void): ClanLookup {
  return async (player) => {
    assertAllowed(player.userId); // not while account deletion is in progress
    const endpoint = serviceEndpoint(config.clanSocialUrl, '/api/v1/players/me/clan');
    if (!endpoint) throw clanVerificationFailed();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const { token } = await issuePlayerToken(config, player);
      const res = await fetch(endpoint, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (res.status === 404) {
        const body: unknown = await res.json().catch(() => null);
        const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
        if (code === 'not_in_clan') return null;
        throw new Error('unexpected 404');
      }
      if (!res.ok) { await res.body?.cancel(); throw new Error('refused'); }
      const data = (await res.json()) as { clan?: { id?: unknown; name?: unknown } } | null;
      const id = data?.clan?.id;
      const name = data?.clan?.name;
      if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id) || typeof name !== 'string') throw new Error('bad shape');
      return { id, name: name.slice(0, 40) };
    } catch {
      // Never log or forward fetch errors, bodies, tokens or headers.
      throw clanVerificationFailed();
    } finally {
      clearTimeout(timer);
    }
  };
}
