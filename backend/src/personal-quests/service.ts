import type { Db } from '../db/connection.js';
import { AppError } from '../http/errors.js';
import { levelFromXp } from '../game/catalog.js';
import { grantUnlockedCrops } from '../game/unlocks.js';
import type { GameService } from '../game/service.js';
import { PERSONAL_QUESTS } from './config.js';
import { activateEligible } from './progress.js';

/**
 * Claiming a personal quest. Identity is the authenticated `userId`. The claim mark, the XP and coin grant and the
 * activation of the next quest happen in ONE BEGIN IMMEDIATE transaction; the conditional UPDATE only matches an
 * unclaimed quest, so retries, double clicks and parallel requests can never pay twice.
 */
export function createPersonalQuestService(db: Db, now: () => number, game: GameService) {
  const tx = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const wrapped = db.transaction(fn);
    return (...args: A): R => wrapped.immediate(...args);
  };

  const applyClaim = tx((userId: string, questId: string) => {
    const def = PERSONAL_QUESTS.find((q) => q.id === questId);
    if (!def) throw new AppError(404, 'quest_not_found', 'That quest does not exist.');
    const reward = { xp: def.rewardXp, coins: def.rewardCoins };
    const row = db.prepare('SELECT claimed_at FROM personal_quests WHERE user_id = ? AND quest_id = ?').get(userId, questId) as { claimed_at: number | null } | undefined;
    if (!row) throw new AppError(409, 'quest_locked', 'That quest is not unlocked yet.');
    const player = db.prepare('SELECT xp FROM players WHERE user_id = ?').get(userId) as { xp: number } | undefined;
    if (!player) throw new AppError(404, 'player_not_found', 'Player profile not found.');
    if (row.claimed_at !== null) return { granted: false, reward, leveledUp: false, newLevel: levelFromXp(player.xp), unlockedCrops: [] as string[] };

    const done = db.prepare('SELECT crop_id, count FROM personal_quest_progress WHERE user_id = ? AND quest_id = ?').all(userId, questId) as { crop_id: string; count: number }[];
    const complete = def.objectives.every((o) => (done.find((d) => d.crop_id === o.cropId)?.count ?? 0) >= o.target);
    if (!complete) throw new AppError(409, 'quest_incomplete', 'Finish the objectives first.');

    const t = now();
    const marked = db.prepare('UPDATE personal_quests SET claimed_at = ? WHERE user_id = ? AND quest_id = ? AND claimed_at IS NULL').run(t, userId, questId);
    if (marked.changes !== 1) return { granted: false, reward, leveledUp: false, newLevel: levelFromXp(player.xp), unlockedCrops: [] as string[] };
    db.prepare('UPDATE players SET xp = xp + ?, coins = coins + ?, updated_at = ? WHERE user_id = ?').run(def.rewardXp, def.rewardCoins, t, userId);
    const newLevel = levelFromXp(player.xp + def.rewardXp);
    const unlockedCrops = grantUnlockedCrops(db, userId, levelFromXp(player.xp), newLevel); // crops that unlock at the new level
    activateEligible(db, userId, newLevel, t);
    return { granted: true, reward, leveledUp: newLevel > levelFromXp(player.xp), newLevel, unlockedCrops };
  });

  return {
    claim(userId: string, questId: string) {
      return { action: 'personal_quest', questId, ...applyClaim(userId, questId), state: game.getState(userId) };
    },
  };
}
