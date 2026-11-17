import type { Db } from '../db/connection.js';
import type { Config } from '../config.js';
import { issuePlayerToken, serviceEndpoint, UPSTREAM_TIMEOUT_MS } from '../clan/player-token.js';
import { AppError, unauthorized } from '../http/errors.js';

export type DeleteAccount = (userId: string) => Promise<void>;
export function createAccountDeletion(db: Db, config: Config) {
  const pending = new Map<string, Promise<void>>();
  async function perform(userId: string) {
    let stage = 'local';
    try {
      const player = db.prepare('SELECT id AS userId, username FROM users WHERE id = ?').get(userId) as { userId: string; username: string } | undefined;
      if (!player) return;
      stage = 'configuration';
      const endpoint = serviceEndpoint(config.clanSocialUrl, '/api/v1/players/me');
      if (!endpoint) throw new AppError(503, 'account_deletion_not_configured', 'Account deletion is not configured.');
      stage = 'platform';
      const { token } = await issuePlayerToken(config, player);
      stage = 'social';
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          method: 'DELETE', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (response.status !== 204) {
          // TEAM-249: this is the only non-204 status confirming prior cleanup.
          const alreadyDeleted = response.status === 401 && (await response.json())?.error?.code === 'player_deleted';
          if (!alreadyDeleted) { await response.body?.cancel(); throw new Error('Social cleanup refused'); }
        }
      } finally { clearTimeout(timer); }
      stage = 'local';
      // No transaction spans network calls. Foreign-key cascades delete all
      // sessions, game profile, plots and inventory atomically for this user.
      db.transaction(() => db.prepare('DELETE FROM users WHERE id = ?').run(userId)).immediate();
    } catch (error) {
      // Fetch errors/bodies can contain credentials: log only static stage + UUID.
      console.warn('[account-deletion] failed', { stage, userId });
      if (stage === 'configuration' || stage === 'platform' && error instanceof AppError && error.status === 503) {
        throw new AppError(503, 'account_deletion_not_configured', 'Account deletion is not configured. Your game account is still saved. Please try again later.');
      }
      if (stage === 'local') throw new AppError(500, 'account_deletion_failed', 'Account deletion could not finish. Your game account is still saved. Please retry deletion.');
      throw new AppError(502, 'account_cleanup_failed', 'Social profile cleanup is temporarily unavailable. Your game account and progress are still saved. Please retry deletion.');
    }
  }
  const deleteAccount: DeleteAccount = userId => {
    const existing = pending.get(userId);
    if (existing) return existing;
    const task = Promise.resolve().then(() => perform(userId)).finally(() => pending.delete(userId));
    pending.set(userId, task);
    return task;
  };
  return {
    deleteAccount,
    assertTokenAllowed(userId: string) {
      if (pending.has(userId)) throw new AppError(409, 'account_deletion_pending', 'Account deletion is in progress.');
      if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) throw unauthorized();
    },
  };
}
