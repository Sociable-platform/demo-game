import { randomInt, randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { AppError } from '../http/errors.js';
import type { GameService } from '../game/service.js';

/** Initial, configurable delivery rules. Edit here (or pass different rules to createDeliveryService). */
export const DELIVERY_RULES = {
  cooldownMs: 10 * 60 * 1000, // one delivery per player every 10 minutes (counted from the previous claim)
  rewards: [
    { kind: 'coins', amount: 20 },
    { kind: 'carrots', amount: 3 },
  ],
} as const;

export type DeliveryRules = { cooldownMs: number; rewards: readonly { kind: 'coins' | 'carrots'; amount: number }[] };
const REWARD_CROP = 'carrot';

interface Row { id: string; reward_kind: 'coins' | 'carrots'; reward_amount: number; claimed_at: number | null }

/**
 * Courier deliveries. Identity is always the authenticated `userId`. A pending delivery is created (or resumed)
 * when the player is eligible; claiming it marks it claimed and applies the reward in ONE BEGIN IMMEDIATE
 * transaction whose conditional UPDATE only matches an unclaimed delivery, so duplicates can never pay twice.
 * There is no offline accumulation: at most one pending delivery exists per player.
 */
export function createDeliveryService(
  db: Db,
  now: () => number,
  game: GameService,
  rules: DeliveryRules = DELIVERY_RULES,
  pick: (n: number) => number = (n) => randomInt(n),
  // Terminal log (npm run dev output). Silent under tests.
  log: (line: string) => void = (line) => { if (process.env.NODE_ENV !== 'test') console.log(line); },
) {
  const who = (userId: string) => userId.slice(0, 8);
  const tx = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const wrapped = db.transaction(fn);
    return (...args: A): R => wrapped.immediate(...args);
  };

  const ensureDelivery = tx((userId: string) => {
    const pending = db.prepare('SELECT id FROM deliveries WHERE user_id = ? AND claimed_at IS NULL').get(userId) as { id: string } | undefined;
    if (pending) { log(`[delivery] NPC approaching (resumed pending delivery ${pending.id.slice(0, 8)}) for user ${who(userId)}`); return { delivery: { id: pending.id }, nextEligibleAt: null }; }
    const last = (db.prepare('SELECT MAX(claimed_at) AS t FROM deliveries WHERE user_id = ?').get(userId) as { t: number | null }).t;
    const t = now();
    if (last !== null && t < last + rules.cooldownMs) {
      log(`[delivery] no NPC for user ${who(userId)}: cooldown, next in ${Math.ceil((last + rules.cooldownMs - t) / 1000)}s`);
      return { delivery: null, nextEligibleAt: last + rules.cooldownMs };
    }
    const reward = rules.rewards[pick(rules.rewards.length)]!;
    const id = randomUUID();
    db.prepare('INSERT INTO deliveries (id, user_id, reward_kind, reward_amount, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, userId, reward.kind, reward.amount, t);
    log(`[delivery] NPC approaching (new delivery ${id.slice(0, 8)}, reward ${reward.amount} ${reward.kind}) for user ${who(userId)}`);
    return { delivery: { id }, nextEligibleAt: null };
  });

  const applyClaim = tx((userId: string, deliveryId: string) => {
    const row = db.prepare('SELECT id, reward_kind, reward_amount, claimed_at FROM deliveries WHERE id = ? AND user_id = ?')
      .get(deliveryId, userId) as Row | undefined;
    if (!row) throw new AppError(404, 'delivery_not_found', 'That delivery does not exist.');
    const reward = { kind: row.reward_kind, amount: row.reward_amount };
    if (row.claimed_at !== null) {
      log(`[delivery] duplicate claim ignored for delivery ${deliveryId.slice(0, 8)} (user ${who(userId)})`);
      return { granted: false, reward, nextEligibleAt: row.claimed_at + rules.cooldownMs };
    }
    const t = now();
    const marked = db.prepare('UPDATE deliveries SET claimed_at = ? WHERE id = ? AND user_id = ? AND claimed_at IS NULL').run(t, deliveryId, userId);
    if (marked.changes !== 1) return { granted: false, reward, nextEligibleAt: t + rules.cooldownMs };
    if (row.reward_kind === 'coins') {
      const paid = db.prepare('UPDATE players SET coins = coins + ?, updated_at = ? WHERE user_id = ?').run(row.reward_amount, t, userId);
      if (paid.changes !== 1) throw new AppError(404, 'player_not_found', 'Player profile not found.');
    } else {
      db.prepare(
        `INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', ?, ?)
         ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      ).run(userId, REWARD_CROP, row.reward_amount);
      db.prepare('UPDATE players SET updated_at = ? WHERE user_id = ?').run(t, userId);
    }
    log(`[delivery] parcel collected: +${row.reward_amount} ${row.reward_kind} for user ${who(userId)} (delivery ${deliveryId.slice(0, 8)})`);
    return { granted: true, reward, nextEligibleAt: t + rules.cooldownMs };
  });

  return {
    /** The pending delivery (no reward details yet) or when the next one becomes possible. */
    status(userId: string) {
      return { ...ensureDelivery(userId), serverTime: now() };
    },
    claim(userId: string, deliveryId: string) {
      const result = applyClaim(userId, deliveryId);
      return { action: 'delivery', ...result, state: game.getState(userId) };
    },
  };
}
