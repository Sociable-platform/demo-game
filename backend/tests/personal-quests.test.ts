import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp, makeClock, signup, tempDbFile } from './helpers.js';
import { PERSONAL_QUESTS } from '../src/personal-quests/config.js';
import { readQuests } from '../src/personal-quests/progress.js';
import { openDb } from '../src/db/connection.js';
import { levelFromXp, xpForLevel } from '../src/game/catalog.js';

type Agent = Awaited<ReturnType<typeof signup>>['agent'];

function setup(dbFile?: string) {
  const clock = makeClock();
  const { app, db } = makeApp({ clock, dbFile });
  const row = (id: string) => db.prepare('SELECT coins, xp FROM players WHERE user_id = ?').get(id) as { coins: number; xp: number };
  const setXp = (id: string, xp: number) => db.prepare('UPDATE players SET xp = ? WHERE user_id = ?').run(xp, id);
  /** Plants a ripe crop straight into plot 0 (growth time is not under test) and harvests it through the real API. */
  const harvest = async (agent: Agent, userId: string, cropId: string, times = 1) => {
    let last;
    for (let i = 0; i < times; i++) {
      db.prepare('UPDATE farm_plots SET crop_id = ?, planted_at = 1, ready_at = 2 WHERE user_id = ? AND plot_index = 0').run(cropId, userId);
      last = await agent.post('/api/game/plots/0/harvest');
      if (last.status !== 200) throw new Error(`harvest failed ${last.status} ${JSON.stringify(last.body)}`);
    }
    return last!;
  };
  const quests = async (agent: Agent) => (await agent.get('/api/game/state')).body.personalQuests as ReturnType<typeof readQuests>;
  const quest = async (agent: Agent, id: string) => (await quests(agent)).find((q) => q.id === id)!;
  const claim = (agent: Agent, id: string) => agent.post(`/api/personal-quests/${id}/claim`).send({});
  /** Marks quests as claimed and starts the next one, like a player who finished them earlier. */
  const fastForward = (userId: string, upTo: number) => {
    for (const q of PERSONAL_QUESTS.slice(0, upTo)) {
      db.prepare('INSERT INTO personal_quests (user_id, quest_id, activated_at, claimed_at) VALUES (?, ?, 1, 2) ON CONFLICT DO UPDATE SET claimed_at = 2').run(userId, q.id);
      for (const o of q.objectives) db.prepare('INSERT INTO personal_quest_progress (user_id, quest_id, crop_id, count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET count = excluded.count').run(userId, q.id, o.cropId, o.target);
    }
  };
  const setCount = (userId: string, questId: string, cropId: string, count: number) =>
    db.prepare('UPDATE personal_quest_progress SET count = ? WHERE user_id = ? AND quest_id = ? AND crop_id = ?').run(count, userId, questId, cropId);
  return { app, db, clock, row, setXp, harvest, quests, quest, claim, fastForward, setCount };
}

describe('personal quest configuration', () => {
  it('has the ten level quests with stable ids and the specified rewards', () => {
    expect(new Set(PERSONAL_QUESTS.map((q) => q.id)).size).toBe(10);
    expect(PERSONAL_QUESTS.map((q) => q.requiredLevel)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(PERSONAL_QUESTS[0]).toMatchObject({ id: 'l01-carrots', objectives: [{ cropId: 'carrot', target: 10 }], rewardXp: 100, rewardCoins: 50 });
    expect(PERSONAL_QUESTS[1]).toMatchObject({ id: 'l02-potatoes', objectives: [{ cropId: 'potato', target: 50 }], rewardXp: 400, rewardCoins: 200 });
    expect(PERSONAL_QUESTS[8]!.objectives).toEqual([{ cropId: 'carrot', target: 100 }, { cropId: 'tomato', target: 50 }]);
    expect(PERSONAL_QUESTS[9]!.objectives).toEqual([{ cropId: 'potato', target: 100 }, { cropId: 'pumpkin', target: 75 }]);
  });
});

describe('potatoes', () => {
  it('are in the catalog, unlock at level 2, and can be bought, planted and harvested', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_pat');
      const state = (await agent.get('/api/game/state')).body;
      expect(state.catalog.find((c: { id: string }) => c.id === 'potato')).toMatchObject({ unlockLevel: 2, buyPrice: 38, sellPrice: 32, growthSeconds: 20, xpReward: 12 });
      expect(state.inventory.crops.potato).toBe(0);
      expect((await agent.post('/api/game/shop/buy').send({ cropId: 'potato', quantity: 1 })).body.error.code).toBe('level_too_low');
      t.setXp(user.id, xpForLevel(2));
      t.db.prepare('UPDATE players SET coins = 100 WHERE user_id = ?').run(user.id);
      expect((await agent.post('/api/game/shop/buy').send({ cropId: 'potato', quantity: 2 })).status).toBe(200);
      expect((await agent.post('/api/game/plots/0/plant').send({ cropId: 'potato' })).status).toBe(200);
      t.clock.advance(20_000);
      const h = await agent.post('/api/game/plots/0/harvest');
      expect(h.body).toMatchObject({ cropId: 'potato', xpGained: 12 });
      expect(h.body.state.inventory.crops.potato).toBe(2); // 2 bought - 1 planted + 1 harvested
    } finally { t.db.close(); }
  });
});

describe('personal quests', () => {
  it('requires the game session', async () => {
    const t = setup();
    try {
      expect((await request(t.app).post('/api/personal-quests/l01-carrots/claim').send({})).status).toBe(401);
    } finally { t.db.close(); }
  });

  it('activates the first quest, counts only harvests, and ignores buying, selling and delivery carrots', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_ann');
      let list = await t.quests(agent);
      expect(list.map((q) => q.status)).toEqual(['active', ...Array(9).fill('locked')]);
      expect(list[0]!.objectives).toEqual([{ cropId: 'carrot', target: 10, progress: 0 }]);

      // Not harvests: buy crops, sell crops, receive a courier delivery of carrots.
      t.db.prepare("INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', 'carrot', 5) ON CONFLICT DO UPDATE SET quantity = 5").run(user.id);
      await agent.post('/api/game/shop/buy').send({ cropId: 'carrot', quantity: 2 });
      await agent.post('/api/game/sell').send({ cropId: 'carrot', quantity: 3 });
      const delivery = (await agent.get('/api/delivery')).body.delivery.id as string;
      t.db.prepare("UPDATE deliveries SET reward_kind = 'carrots', reward_amount = 3 WHERE id = ?").run(delivery);
      await agent.post(`/api/delivery/${delivery}/claim`).send({});
      expect((await t.quest(agent, 'l01-carrots')).objectives[0]!.progress).toBe(0);

      const h = await t.harvest(agent, user.id, 'carrot', 3);
      expect(h.body.state.personalQuests[0].objectives[0].progress).toBe(3); // returned with the harvest result
      expect(h.body.state.inventory.crops.carrot).toBeGreaterThan(3);
      await t.harvest(agent, user.id, 'tomato', 2); // other crops do not count towards a carrot quest
      expect((await t.quest(agent, 'l01-carrots')).objectives[0]!.progress).toBe(3);
    } finally { t.db.close(); }
  });

  it('caps at the target, keeps the quest ready until claimed, and pays XP and coins exactly once', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_bob');
      expect((await t.claim(agent, 'l01-carrots')).body.error.code).toBe('quest_incomplete');
      await t.harvest(agent, user.id, 'carrot', 12);
      const q = await t.quest(agent, 'l01-carrots');
      expect(q.status).toBe('ready');
      expect(q.objectives[0]!.progress).toBe(10); // capped at the target

      const before = t.row(user.id);
      const results = await Promise.all(Array.from({ length: 8 }, () => t.claim(agent, 'l01-carrots')));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.granted)).toHaveLength(1);
      const after = t.row(user.id);
      expect(after.coins).toBe(before.coins + 50);
      expect(after.xp).toBe(before.xp + 100);
      expect(results.find((r) => r.body.granted)!.body.state.player).toMatchObject({ coins: after.coins, xp: after.xp });

      const again = await t.claim(agent, 'l01-carrots');
      expect(again.body.granted).toBe(false);
      expect(t.row(user.id)).toEqual(after);
      // harvest rewards do not count again towards a claimed quest, and claiming consumed no inventory
      expect((await t.quest(agent, 'l01-carrots')).status).toBe('claimed');
      expect(again.body.state.inventory.crops.carrot).toBe(15); // 3 starting + 12 harvested
    } finally { t.db.close(); }
  });

  it('starts the next quest at zero after a claim and does not count earlier harvests', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_cat');
      t.setXp(user.id, xpForLevel(2));
      await t.harvest(agent, user.id, 'potato', 5); // level 2 reached, but quest 1 is unclaimed: quest 2 is not active
      let list = await t.quests(agent);
      expect(list[1]).toMatchObject({ status: 'locked', levelMet: true });
      expect((await t.claim(agent, 'l02-potatoes')).body.error.code).toBe('quest_locked');

      await t.harvest(agent, user.id, 'carrot', 10);
      expect((await t.claim(agent, 'l01-carrots')).body.granted).toBe(true);
      list = await t.quests(agent);
      expect(list[1]).toMatchObject({ status: 'active', objectives: [{ cropId: 'potato', target: 50, progress: 0 }] });
      await t.harvest(agent, user.id, 'potato', 2);
      expect((await t.quest(agent, 'l02-potatoes')).objectives[0]!.progress).toBe(2);
    } finally { t.db.close(); }
  });

  it('keeps quests reachable when XP skips levels, and never withdraws an unfinished one', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_dan');
      await t.harvest(agent, user.id, 'carrot', 10);
      t.setXp(user.id, xpForLevel(6)); // a big jump past levels 2-5 while quest 1 is still unclaimed
      let list = await t.quests(agent);
      expect(list[0]!.status).toBe('ready');
      expect(list.slice(1).every((q) => q.status === 'locked')).toBe(true);

      expect((await t.claim(agent, 'l01-carrots')).body.granted).toBe(true);
      list = await t.quests(agent);
      expect(list[1]!.status).toBe('active'); // one at a time, in order; skipped levels never lock anything
      expect(list[2]!.status).toBe('locked');
      t.setCount(user.id, 'l02-potatoes', 'potato', 50);
      expect((await t.claim(agent, 'l02-potatoes')).body.granted).toBe(true);
      expect((await t.quest(agent, 'l03-tomatoes')).status).toBe('active'); // level 3 requirement already met
      expect((await t.quest(agent, 'l01-carrots')).status).toBe('claimed');
      expect(levelFromXp(t.row(user.id).xp)).toBeGreaterThanOrEqual(6); // thresholds untouched, no cap
    } finally { t.db.close(); }
  });

  it('activates a quest unlocked by a harvest level-up, counting only later harvests', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_eve');
      t.fastForward(user.id, 1); // level-1 quest already claimed
      t.setXp(user.id, xpForLevel(2) - 4); // the next carrot (+8 XP) crosses level 2
      const h = await t.harvest(agent, user.id, 'carrot');
      expect(h.body.leveledUp).toBe(true);
      const q = await t.quest(agent, 'l02-potatoes');
      expect(q.status).toBe('active');
      expect(q.objectives[0]!.progress).toBe(0);
    } finally { t.db.close(); }
  });

  it('completes a two-objective quest only when both crops are done, and pays once', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'q_fay');
      t.fastForward(user.id, 8);
      t.setXp(user.id, xpForLevel(9));
      expect((await t.quest(agent, 'l09-carrots-tomatoes')).status).toBe('active');
      t.setCount(user.id, 'l09-carrots-tomatoes', 'carrot', 100);
      t.setCount(user.id, 'l09-carrots-tomatoes', 'tomato', 49);
      let q = await t.quest(agent, 'l09-carrots-tomatoes');
      expect(q.status).toBe('active');
      expect((await t.claim(agent, 'l09-carrots-tomatoes')).body.error.code).toBe('quest_incomplete');

      await t.harvest(agent, user.id, 'tomato', 2); // 49 -> 50, extra harvest capped
      q = await t.quest(agent, 'l09-carrots-tomatoes');
      expect(q.status).toBe('ready');
      expect(q.objectives.map((o) => o.progress)).toEqual([100, 50]);

      const before = t.row(user.id);
      const res = await Promise.all([t.claim(agent, q.id), t.claim(agent, q.id), t.claim(agent, q.id)]);
      expect(res.filter((r) => r.body.granted)).toHaveLength(1);
      expect(t.row(user.id).coins).toBe(before.coins + 1100);
      expect(t.row(user.id).xp).toBe(before.xp + 2200);
      const next = await t.quest(agent, 'l10-potatoes-pumpkins');
      expect(next.status).toBe('active'); // level 10 reached by the reward
      expect(next.objectives).toEqual([{ cropId: 'potato', target: 100, progress: 0 }, { cropId: 'pumpkin', target: 75, progress: 0 }]);
    } finally { t.db.close(); }
  });

  it('keeps each player separate, rejects bad ids, and ignores client-supplied rewards', async () => {
    const t = setup();
    try {
      const a = await signup(t.app, 'q_gus');
      const b = await signup(t.app, 'q_hal');
      await t.harvest(a.agent, a.user.id, 'carrot', 10);
      expect((await t.quest(b.agent, 'l01-carrots')).objectives[0]!.progress).toBe(0);
      expect((await t.claim(b.agent, 'l01-carrots')).body.error.code).toBe('quest_incomplete');
      expect((await t.claim(a.agent, 'no-such-quest')).status).toBe(404);
      expect((await t.claim(a.agent, 'BAD ID!')).status).toBe(400);
      const before = t.row(a.user.id);
      const forged = await a.agent.post('/api/personal-quests/l01-carrots/claim').send({ coins: 99999, xp: 99999, userId: b.user.id, level: 10 });
      expect(forged.body.granted).toBe(true);
      expect(t.row(a.user.id)).toEqual({ coins: before.coins + 50, xp: before.xp + 100 });
      expect(t.row(b.user.id).coins).toBe(50);
    } finally { t.db.close(); }
  });

  it('persists progress and claims across a server restart', async () => {
    const file = tempDbFile();
    const t = setup(file);
    const { agent, user } = await signup(t.app, 'q_ivy');
    await t.harvest(agent, user.id, 'carrot', 10);
    await t.claim(agent, 'l01-carrots');
    await t.harvest(agent, user.id, 'potato', 0);
    t.db.close();
    const reopened = openDb(file);
    try {
      const list = readQuests(reopened, user.id, 2);
      expect(list[0]!.status).toBe('claimed');
      expect(list[1]!.status).toBe('active');
    } finally { reopened.close(); }
  });
});
