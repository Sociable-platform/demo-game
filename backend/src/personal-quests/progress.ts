import type { Db } from '../db/connection.js';
import { PERSONAL_QUESTS, type PersonalQuestDef } from './config.js';

interface QuestRow { quest_id: string; claimed_at: number | null }

const rowsFor = (db: Db, userId: string) =>
  new Map((db.prepare('SELECT quest_id, claimed_at FROM personal_quests WHERE user_id = ?').all(userId) as QuestRow[]).map((r) => [r.quest_id, r]));

/**
 * The quest that should become active next, or null. The chain is strict: nothing activates while an earlier quest
 * is still unclaimed; the next one needs the player's level to have reached its requirement (a level skipped by a big
 * XP reward just means the requirement is already met). Earlier unfinished quests are never withdrawn.
 */
export function nextActivatable(db: Db, userId: string, level: number): PersonalQuestDef | null {
  const rows = rowsFor(db, userId);
  for (const def of PERSONAL_QUESTS) {
    const row = rows.get(def.id);
    if (row) {
      if (row.claimed_at === null) return null; // still open: blocks the chain
      continue;
    }
    return level >= def.requiredLevel ? def : null;
  }
  return null;
}

/** Activates the next eligible quest (progress starts at zero NOW). Call inside the caller's transaction. */
export function activateEligible(db: Db, userId: string, level: number, t: number): void {
  const def = nextActivatable(db, userId, level);
  if (!def) return;
  db.prepare('INSERT INTO personal_quests (user_id, quest_id, activated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(userId, def.id, t);
  const ins = db.prepare('INSERT INTO personal_quest_progress (user_id, quest_id, crop_id, count) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING');
  for (const o of def.objectives) ins.run(userId, def.id, o.cropId);
}

/**
 * Counts the crops one harvest yielded towards the player's active, unclaimed quests (capped at each objective's target).
 * Only the authoritative harvest path calls this, inside the harvest transaction.
 */
export function recordHarvest(db: Db, userId: string, cropId: string, amount = 1): void {
  const upd = db.prepare(
    `UPDATE personal_quest_progress SET count = MIN(count + ?, ?)
      WHERE user_id = ? AND quest_id = ? AND crop_id = ?
        AND EXISTS (SELECT 1 FROM personal_quests q WHERE q.user_id = ? AND q.quest_id = ? AND q.claimed_at IS NULL)`,
  );
  for (const def of PERSONAL_QUESTS) {
    const o = def.objectives.find((x) => x.cropId === cropId);
    if (o) upd.run(amount, o.target, userId, def.id, cropId, userId, def.id);
  }
}

export type QuestStatus = 'locked' | 'active' | 'ready' | 'claimed';

/** The player's quest list for the UI: every quest with its status and objective progress. */
export function readQuests(db: Db, userId: string, level: number) {
  const rows = rowsFor(db, userId);
  const counts = new Map<string, number>();
  for (const r of db.prepare('SELECT quest_id, crop_id, count FROM personal_quest_progress WHERE user_id = ?').all(userId) as { quest_id: string; crop_id: string; count: number }[]) {
    counts.set(`${r.quest_id}:${r.crop_id}`, r.count);
  }
  return PERSONAL_QUESTS.map((def) => {
    const row = rows.get(def.id);
    const objectives = def.objectives.map((o) => ({ cropId: o.cropId, target: o.target, progress: row ? Math.min(o.target, counts.get(`${def.id}:${o.cropId}`) ?? 0) : 0 }));
    const complete = Boolean(row) && objectives.every((o) => o.progress >= o.target);
    const status: QuestStatus = !row ? 'locked' : row.claimed_at !== null ? 'claimed' : complete ? 'ready' : 'active';
    return {
      id: def.id,
      requiredLevel: def.requiredLevel,
      status,
      objectives,
      reward: { xp: def.rewardXp, coins: def.rewardCoins },
      levelMet: level >= def.requiredLevel, // locked + levelMet means "finish the previous quest first"
    };
  });
}

