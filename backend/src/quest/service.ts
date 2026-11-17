import type { Db } from '../db/connection.js';
import type { SessionUser } from '../auth/sessions.js';
import { AppError } from '../http/errors.js';
import type { GameService } from '../game/service.js';
import type { ClanInfo, ClanLookup } from './clan-membership.js';

/** The one quest of this version: not a framework, just constants. */
export const QUEST = {
  title: 'Village Festival',
  cropId: 'carrot',
  target: 100,
  rewardCoins: 50,
  contributeAmounts: [1, 5] as readonly number[],
} as const;

type Player = Pick<SessionUser, 'userId' | 'username'>;

/**
 * Shared clan quest. Every mutation: (1) resolves the clan through the server-side Clan lookup (never from the
 * request), (2) runs ONE BEGIN IMMEDIATE transaction that re-checks every precondition with conditional SQL, so
 * duplicate or parallel requests can never over-deduct, over-fill progress or pay a reward twice.
 */
export function createQuestService(db: Db, now: () => number, game: GameService, lookupClan: ClanLookup) {
  const tx = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const wrapped = db.transaction(fn);
    return (...args: A): R => wrapped.immediate(...args);
  };

  const ensureQuest = (clanId: string) => {
    const t = now();
    db.prepare('INSERT OR IGNORE INTO clan_quests (clan_id, target, progress, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run(clanId, QUEST.target, t, t);
  };

  function view(clan: { id: string; name: string | null }, userId: string) {
    const q = db.prepare('SELECT target, progress, completed_at FROM clan_quests WHERE clan_id = ?').get(clan.id) as
      { target: number; progress: number; completed_at: number | null } | undefined;
    const progress = q?.progress ?? 0;
    const target = q?.target ?? QUEST.target;
    const completed = q?.completed_at != null;
    const contributed = (db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM clan_quest_contributions WHERE clan_id = ? AND user_id = ?')
      .get(clan.id, userId) as { n: number }).n;
    const claimed = Boolean(db.prepare('SELECT 1 FROM clan_quest_claims WHERE clan_id = ? AND user_id = ?').get(clan.id, userId));
    return {
      clan: { id: clan.id, name: clan.name },
      quest: { title: QUEST.title, cropId: QUEST.cropId, target, progress, completed, rewardCoins: QUEST.rewardCoins },
      me: { contributed, claimed, canClaim: completed && contributed > 0 && !claimed },
    };
  }

  const noClan = () => ({
    clan: null,
    quest: { title: QUEST.title, cropId: QUEST.cropId, target: QUEST.target, progress: 0, completed: false, rewardCoins: QUEST.rewardCoins },
    me: null,
  });

  const recorded = (userId: string, key: string) =>
    db.prepare('SELECT clan_id, requested, quantity FROM clan_quest_contributions WHERE user_id = ? AND idempotency_key = ?')
      .get(userId, key) as { clan_id: string; requested: number; quantity: number } | undefined;

  // A retried request (same key) is answered from the record: no deduction, no upstream call.
  const replay = (player: Player, row: { clan_id: string; requested: number; quantity: number }, requested: number) => {
    if (row.requested !== requested) {
      throw new AppError(409, 'idempotency_key_reused', 'That request key was already used for a different contribution.');
    }
    return { action: 'quest_contribute', accepted: row.quantity, requested, replayed: true,
      ...view({ id: row.clan_id, name: null }, player.userId), state: game.getState(player.userId) };
  };

  const applyContribution = tx((player: Player, clan: ClanInfo, requested: number, key: string) => {
    const again = recorded(player.userId, key); // a concurrent request with the same key may have just committed
    if (again) return { again };
    ensureQuest(clan.id);
    const q = db.prepare('SELECT target, progress FROM clan_quests WHERE clan_id = ?').get(clan.id) as { target: number; progress: number };
    const remaining = q.target - q.progress;
    if (remaining <= 0) throw new AppError(409, 'quest_completed', 'The Village Festival is already complete. Claim your reward!');
    const accepted = Math.min(requested, remaining);
    const taken = db
      .prepare('UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND kind = ? AND crop_id = ? AND quantity >= ?')
      .run(accepted, player.userId, 'crop', QUEST.cropId, accepted);
    if (taken.changes !== 1) {
      throw new AppError(409, 'insufficient_crops', `You need ${accepted} harvested carrot${accepted === 1 ? '' : 's'} to contribute that.`);
    }
    const t = now();
    const advanced = db
      .prepare(`UPDATE clan_quests SET progress = progress + ?, updated_at = ?,
                  completed_at = CASE WHEN progress + ? >= target THEN ? ELSE completed_at END
                WHERE clan_id = ? AND progress + ? <= target`)
      .run(accepted, t, accepted, t, clan.id, accepted);
    if (advanced.changes !== 1) throw new AppError(409, 'quest_completed', 'The Village Festival is already complete. Claim your reward!');
    db.prepare('INSERT INTO clan_quest_contributions (clan_id, user_id, idempotency_key, requested, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(clan.id, player.userId, key, requested, accepted, t);
    db.prepare('UPDATE players SET updated_at = ? WHERE user_id = ?').run(t, player.userId);
    return { accepted };
  });

  const applyClaim = tx((player: Player, clan: ClanInfo) => {
    const q = db.prepare('SELECT completed_at FROM clan_quests WHERE clan_id = ?').get(clan.id) as { completed_at: number | null } | undefined;
    if (!q || q.completed_at == null) throw new AppError(409, 'quest_not_complete', 'The Village Festival is not complete yet.');
    const mine = (db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM clan_quest_contributions WHERE clan_id = ? AND user_id = ?')
      .get(clan.id, player.userId) as { n: number }).n;
    if (mine < 1) throw new AppError(409, 'not_a_contributor', 'Only players who contributed at least one carrot can claim the reward.');
    const t = now();
    const claim = db
      .prepare('INSERT INTO clan_quest_claims (clan_id, user_id, coins, claimed_at) VALUES (?, ?, ?, ?) ON CONFLICT (clan_id, user_id) DO NOTHING')
      .run(clan.id, player.userId, QUEST.rewardCoins, t);
    if (claim.changes !== 1) return { granted: 0 }; // already claimed: a retry or double click is a harmless no-op
    const paid = db.prepare('UPDATE players SET coins = coins + ?, updated_at = ? WHERE user_id = ?').run(QUEST.rewardCoins, t, player.userId);
    if (paid.changes !== 1) throw new AppError(404, 'player_not_found', 'Player profile not found.');
    return { granted: QUEST.rewardCoins };
  });

  return {
    async status(player: Player) {
      const clan = await lookupClan(player);
      if (!clan) return noClan();
      return view(clan, player.userId);
    },

    async contribute(player: Player, requested: number, key: string) {
      const prior = recorded(player.userId, key); // retries are answered without any upstream call
      if (prior) return replay(player, prior, requested);
      const clan = await lookupClan(player);
      if (!clan) throw new AppError(409, 'no_clan', 'Join a clan to participate.');
      const result = applyContribution(player, clan, requested, key);
      if ('again' in result && result.again) return replay(player, result.again, requested);
      return { action: 'quest_contribute', accepted: result.accepted, requested, replayed: false, ...view(clan, player.userId), state: game.getState(player.userId) };
    },

    async claim(player: Player) {
      const clan = await lookupClan(player);
      if (!clan) throw new AppError(409, 'no_clan', 'Join a clan to participate.');
      const { granted } = applyClaim(player, clan);
      return { action: 'quest_claim', coinsGranted: granted, ...view(clan, player.userId), state: game.getState(player.userId) };
    },
  };
}
