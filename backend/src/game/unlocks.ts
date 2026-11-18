import type { Db } from '../db/connection.js';
import { CROP_LIST, UNLOCK_GIFT } from './catalog.js';

/**
 * Gives UNLOCK_GIFT of every crop that unlocks after `fromLevel` and at or below `toLevel` (use 0 for a new player).
 * Call it inside the transaction that raised the level, so the gift lands once, together with the XP that earned it.
 * Returns the crop ids that were granted.
 */
export function grantUnlockedCrops(db: Db, userId: string, fromLevel: number, toLevel: number): string[] {
  const unlocked = CROP_LIST.filter((c) => c.unlockLevel > fromLevel && c.unlockLevel <= toLevel);
  const add = db.prepare(
    `INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', ?, ?)
     ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  );
  for (const c of unlocked) add.run(userId, c.id, UNLOCK_GIFT);
  return unlocked.map((c) => c.id);
}
