import type { Config } from '../config.js';
import type { SessionUser } from '../auth/sessions.js';
import { issuePlayerToken, serviceEndpoint, UPSTREAM_TIMEOUT_MS } from '../clan/player-token.js';
import { clanVerificationFailed } from '../quest/clan-membership.js';

/** The caller's social circle as the Social service reports it right now (all IDs are Social player IDs). */
export interface Circle {
  socialId: string;
  clanId: string | null;
  clanName: string | null;
  clanMemberIds: ReadonlySet<string>;
  friendIds: ReadonlySet<string>;
}
export type CircleLookup = (player: Pick<SessionUser, 'userId' | 'username'>) => Promise<Circle>;

const ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Resolves the player's own Social ID, clan, clan members and friends on the SERVER, using a player token minted with
 * the game API key (never exposed). Documented endpoints only: `GET /players/me`, `/players/me/clan`,
 * `/clans/{id}/members` and `/friends`. Anything unexpected is a retryable failure, so the marketplace never relies on
 * a browser-supplied clan, friend or player ID.
 */
export function createCircleLookup(config: Config, assertAllowed: (userId: string) => void): CircleLookup {
  return async (player) => {
    assertAllowed(player.userId);
    const { token } = await issuePlayerToken(config, player);
    const get = async (path: string) => {
      const endpoint = serviceEndpoint(config.clanSocialUrl, path);
      if (!endpoint) throw new Error('not configured');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        const body: unknown = await res.json().catch(() => null);
        return { status: res.status, body } as { status: number; body: any };
      } finally { clearTimeout(timer); }
    };
    try {
      const [me, clan, friends] = await Promise.all([get('/api/v1/players/me'), get('/api/v1/players/me/clan'), get('/api/v1/friends')]);
      const socialId = me.body?.id;
      if (me.status !== 200 || typeof socialId !== 'string' || !ID.test(socialId)) throw new Error('me');
      if (friends.status !== 200 || !Array.isArray(friends.body?.friends)) throw new Error('friends');
      const friendIds = new Set<string>();
      for (const f of friends.body.friends) if (typeof f?.id === 'string' && ID.test(f.id)) friendIds.add(f.id);

      let clanId: string | null = null;
      let clanName: string | null = null;
      const clanMemberIds = new Set<string>();
      if (clan.status === 404 && clan.body?.error?.code === 'not_in_clan') {
        // not in a clan: clan offers are simply unavailable
      } else if (clan.status === 200 && typeof clan.body?.clan?.id === 'string' && ID.test(clan.body.clan.id) && typeof clan.body.clan.name === 'string') {
        clanId = clan.body.clan.id;
        clanName = String(clan.body.clan.name).slice(0, 40);
        const members = await get(`/api/v1/clans/${encodeURIComponent(clanId!)}/members`);
        if (members.status !== 200 || !Array.isArray(members.body?.members)) throw new Error('members');
        for (const m of members.body.members) if (typeof m?.playerId === 'string' && ID.test(m.playerId)) clanMemberIds.add(m.playerId);
      } else {
        throw new Error('clan');
      }
      return { socialId, clanId, clanName, clanMemberIds, friendIds };
    } catch {
      // Never log or forward fetch errors, bodies, tokens or headers.
      throw clanVerificationFailed();
    }
  };
}
