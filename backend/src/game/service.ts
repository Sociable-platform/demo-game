import type { Db } from '../db/connection.js';
import { AppError } from '../http/errors.js';
import {
  CROPS,
  CROP_LIST,
  GRID_COLS,
  GRID_ROWS,
  GRID_SIZE,
  STARTING_COINS,
  STARTING_SEEDS,
  levelFromXp,
  levelProgress,
  type Crop,
} from './catalog.js';

/**
 * Authoritative game logic. Identity always arrives as `userId` from the verified session;
 * nothing here accepts a user id from request input.
 *
 * Concurrency: every mutation runs in a BEGIN IMMEDIATE transaction (takes the write lock up front),
 * AND each resource change is a conditional UPDATE whose WHERE clause re-checks the precondition
 * (enough coins, enough items, plot still has a ripe crop). If a precondition fails we throw and the
 * whole transaction rolls back, so a repeated or parallel request can never apply twice.
 */
export function createGameService(db: Db, now: () => number) {
  const tx = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const wrapped = db.transaction(fn);
    return (...args: A): R => wrapped.immediate(...args);
  };

  const requireCrop = (cropId: string): Crop => {
    const crop = CROPS[cropId];
    if (!crop) throw new AppError(400, 'unknown_crop', `Unknown crop "${cropId}".`);
    return crop;
  };

  const assertPlot = (plotIndex: number) => {
    if (!Number.isInteger(plotIndex) || plotIndex < 0 || plotIndex >= GRID_SIZE) {
      throw new AppError(404, 'plot_not_found', 'That plot does not exist.');
    }
  };

  const getXp = (userId: string): number => {
    const row = db.prepare('SELECT xp FROM players WHERE user_id = ?').get(userId) as { xp: number } | undefined;
    if (!row) throw new AppError(404, 'player_not_found', 'Player profile not found.');
    return row.xp;
  };

  const assertUnlocked = (userId: string, crop: Crop) => {
    if (levelFromXp(getXp(userId)) < crop.unlockLevel) {
      throw new AppError(409, 'level_too_low', `${crop.name} unlocks at level ${crop.unlockLevel}.`);
    }
  };

  const addInventory = (userId: string, kind: 'seed' | 'crop', cropId: string, qty: number) => {
    db.prepare(
      `INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
    ).run(userId, kind, cropId, qty);
  };

  /** Atomically takes items out of the inventory; fails (and the caller rolls back) if there are not enough. */
  const takeInventory = (userId: string, kind: 'seed' | 'crop', cropId: string, qty: number): boolean =>
    db
      .prepare(
        `UPDATE inventory SET quantity = quantity - ?
          WHERE user_id = ? AND kind = ? AND crop_id = ? AND quantity >= ?`,
      )
      .run(qty, userId, kind, cropId, qty).changes === 1;

  const touch = (userId: string) =>
    db.prepare('UPDATE players SET updated_at = ? WHERE user_id = ?').run(now(), userId);

  function readState(userId: string) {
    const t = now();
    const p = db
      .prepare(
        `SELECT u.id AS id, u.username AS username, p.coins AS coins, p.xp AS xp
           FROM users u JOIN players p ON p.user_id = u.id WHERE u.id = ?`,
      )
      .get(userId) as { id: string; username: string; coins: number; xp: number } | undefined;
    if (!p) throw new AppError(404, 'player_not_found', 'Player profile not found.');

    const plots = (
      db
        .prepare('SELECT plot_index, crop_id, planted_at, ready_at FROM farm_plots WHERE user_id = ? ORDER BY plot_index')
        .all(userId) as { plot_index: number; crop_id: string | null; planted_at: number | null; ready_at: number | null }[]
    ).map((r) => ({
      index: r.plot_index,
      state: r.crop_id === null ? 'empty' : r.ready_at! <= t ? 'ready' : 'growing',
      cropId: r.crop_id,
      plantedAt: r.planted_at,
      readyAt: r.ready_at,
    }));

    const seeds: Record<string, number> = {};
    const crops: Record<string, number> = {};
    for (const c of CROP_LIST) {
      seeds[c.id] = 0;
      crops[c.id] = 0;
    }
    for (const r of db
      .prepare('SELECT kind, crop_id, quantity FROM inventory WHERE user_id = ?')
      .all(userId) as { kind: 'seed' | 'crop'; crop_id: string; quantity: number }[]) {
      (r.kind === 'seed' ? seeds : crops)[r.crop_id] = r.quantity;
    }

    return {
      serverTime: t,
      player: { id: p.id, username: p.username, coins: p.coins, xp: p.xp, ...levelProgress(p.xp) },
      farm: { rows: GRID_ROWS, cols: GRID_COLS, plots },
      inventory: { seeds, crops },
      catalog: CROP_LIST,
    };
  }

  return {
    /** Create the starting farm for a new user. Must be called inside the caller's transaction. */
    initPlayer(userId: string) {
      db.prepare('INSERT INTO players (user_id, coins, xp, updated_at) VALUES (?, ?, 0, ?)').run(
        userId,
        STARTING_COINS,
        now(),
      );
      const plot = db.prepare('INSERT INTO farm_plots (user_id, plot_index) VALUES (?, ?)');
      for (let i = 0; i < GRID_SIZE; i++) plot.run(userId, i);
      for (const [cropId, qty] of Object.entries(STARTING_SEEDS)) addInventory(userId, 'seed', cropId, qty);
    },

    getState: (userId: string) => readState(userId),

    buySeeds: tx((userId: string, cropId: string, quantity: number) => {
      const crop = requireCrop(cropId);
      assertUnlocked(userId, crop);
      const cost = crop.seedPrice * quantity;
      const paid = db
        .prepare('UPDATE players SET coins = coins - ? WHERE user_id = ? AND coins >= ?')
        .run(cost, userId, cost);
      if (paid.changes !== 1) {
        throw new AppError(409, 'insufficient_coins', `You need ${cost} coins for that, but you don't have enough.`);
      }
      addInventory(userId, 'seed', cropId, quantity);
      touch(userId);
      return { action: 'buy', cropId, quantity, coinsSpent: cost, state: readState(userId) };
    }),

    plant: tx((userId: string, plotIndex: number, cropId: string) => {
      assertPlot(plotIndex);
      const crop = requireCrop(cropId);
      assertUnlocked(userId, crop);
      if (!takeInventory(userId, 'seed', cropId, 1)) {
        throw new AppError(409, 'insufficient_seeds', `You have no ${crop.name} seeds. Buy some in the shop.`);
      }
      const t = now();
      const planted = db
        .prepare(
          `UPDATE farm_plots SET crop_id = ?, planted_at = ?, ready_at = ?
            WHERE user_id = ? AND plot_index = ? AND crop_id IS NULL`,
        )
        .run(cropId, t, t + crop.growthSeconds * 1000, userId, plotIndex);
      if (planted.changes !== 1) {
        throw new AppError(409, 'plot_occupied', 'Something is already growing in that plot.');
      }
      touch(userId);
      return { action: 'plant', cropId, plotIndex, state: readState(userId) };
    }),

    harvest: tx((userId: string, plotIndex: number) => {
      assertPlot(plotIndex);
      const t = now();
      const plot = db
        .prepare('SELECT crop_id, ready_at FROM farm_plots WHERE user_id = ? AND plot_index = ?')
        .get(userId, plotIndex) as { crop_id: string | null; ready_at: number | null } | undefined;
      if (!plot || plot.crop_id === null) throw new AppError(409, 'plot_empty', 'There is nothing planted in that plot.');
      if (plot.ready_at! > t) {
        throw new AppError(409, 'not_ready', 'That crop is not ready yet.', { remainingMs: plot.ready_at! - t });
      }
      const cropId = plot.crop_id;
      const crop = requireCrop(cropId);
      // The WHERE clause re-checks "still planted and ripe", so a second harvest of the same crop matches 0 rows.
      const cleared = db
        .prepare(
          `UPDATE farm_plots SET crop_id = NULL, planted_at = NULL, ready_at = NULL
            WHERE user_id = ? AND plot_index = ? AND crop_id IS NOT NULL AND ready_at <= ?`,
        )
        .run(userId, plotIndex, t);
      if (cleared.changes !== 1) throw new AppError(409, 'plot_empty', 'There is nothing planted in that plot.');

      const xpBefore = getXp(userId);
      db.prepare('UPDATE players SET xp = xp + ? WHERE user_id = ?').run(crop.xpReward, userId);
      addInventory(userId, 'crop', cropId, 1);
      touch(userId);
      const levelBefore = levelFromXp(xpBefore);
      const levelAfter = levelFromXp(xpBefore + crop.xpReward);
      return {
        action: 'harvest',
        cropId,
        plotIndex,
        xpGained: crop.xpReward,
        leveledUp: levelAfter > levelBefore,
        newLevel: levelAfter,
        state: readState(userId),
      };
    }),

    sell: tx((userId: string, cropId: string, quantity: number | 'all') => {
      const crop = requireCrop(cropId);
      let qty: number;
      if (quantity === 'all') {
        const row = db
          .prepare("SELECT quantity FROM inventory WHERE user_id = ? AND kind = 'crop' AND crop_id = ?")
          .get(userId, cropId) as { quantity: number } | undefined;
        qty = row?.quantity ?? 0;
        if (qty < 1) throw new AppError(409, 'insufficient_crops', `You have no ${crop.name} to sell.`);
      } else {
        qty = quantity;
      }
      if (!takeInventory(userId, 'crop', cropId, qty)) {
        throw new AppError(409, 'insufficient_crops', `You don't have ${qty} ${crop.name} to sell.`);
      }
      const earned = crop.sellPrice * qty;
      db.prepare('UPDATE players SET coins = coins + ? WHERE user_id = ?').run(earned, userId);
      touch(userId);
      return { action: 'sell', cropId, quantity: qty, coinsEarned: earned, state: readState(userId) };
    }),
  };
}

export type GameService = ReturnType<typeof createGameService>;
