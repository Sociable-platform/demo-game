import { describe, expect, it } from 'vitest';
import { makeApp, makeClock, signup, tempDbFile } from './helpers.js';

const setup = async () => {
  const ctx = makeApp();
  const alice = await signup(ctx.app, 'alice');
  return { ...ctx, alice };
};

describe('starting state', () => {
  it('gives a new player coins, carrot seeds, an empty 3x3 farm and level 1', async () => {
    const { alice } = await setup();
    const res = await alice.agent.get('/api/game/state');
    expect(res.status).toBe(200);
    expect(res.body.player).toMatchObject({ username: 'alice', coins: 50, xp: 0, level: 1 });
    expect(res.body.farm.plots).toHaveLength(9);
    expect(res.body.farm.plots.every((p: { state: string }) => p.state === 'empty')).toBe(true);
    expect(res.body.inventory.seeds).toMatchObject({ carrot: 3, tomato: 0, pumpkin: 0 });
    expect(res.body.catalog).toHaveLength(4);
  });
});

describe('buying seeds', () => {
  it('spends coins and adds seeds', async () => {
    const { alice } = await setup();
    const res = await alice.agent.post('/api/game/shop/buy').send({ cropId: 'tomato', quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.state.player.coins).toBe(0);
    expect(res.body.state.inventory.seeds.tomato).toBe(2);
  });

  it('refuses when coins are insufficient, without changing anything', async () => {
    const { alice } = await setup();
    const res = await alice.agent.post('/api/game/shop/buy').send({ cropId: 'tomato', quantity: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('insufficient_coins');
    const state = (await alice.agent.get('/api/game/state')).body;
    expect(state.player.coins).toBe(50);
    expect(state.inventory.seeds.tomato).toBe(0);
  });

  it('locks pumpkins until level 2 and validates input', async () => {
    const { alice } = await setup();
    const locked = await alice.agent.post('/api/game/shop/buy').send({ cropId: 'pumpkin', quantity: 1 });
    expect(locked.body.error.code).toBe('level_too_low');
    const unknown = await alice.agent.post('/api/game/shop/buy').send({ cropId: 'bananas', quantity: 1 });
    expect(unknown.body.error.code).toBe('unknown_crop');
    for (const body of [{ cropId: 'carrot', quantity: 0 }, { cropId: 'carrot', quantity: -3 }, { cropId: 'carrot', quantity: 1.5 }, { cropId: 'carrot', quantity: '2' }, { cropId: 'carrot', quantity: 1000 }, {}]) {
      const r = await alice.agent.post('/api/game/shop/buy').send(body);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('validation_error');
    }
  });
});

describe('the full loop: buy -> plant -> grow -> harvest -> sell', () => {
  it('works end to end using server timestamps', async () => {
    const { alice, clock } = await setup();
    const plant = await alice.agent.post('/api/game/plots/4/plant').send({ cropId: 'carrot' });
    expect(plant.status).toBe(200);
    const plot = plant.body.state.farm.plots[4];
    expect(plot).toMatchObject({ state: 'growing', cropId: 'carrot' });
    expect(plot.readyAt - plot.plantedAt).toBe(15_000);
    expect(plant.body.state.inventory.seeds.carrot).toBe(2);

    clock.advance(14_000);
    const early = await alice.agent.post('/api/game/plots/4/harvest');
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('not_ready');
    expect(early.body.error.details.remainingMs).toBe(1000);

    clock.advance(1_000);
    expect((await alice.agent.get('/api/game/state')).body.farm.plots[4].state).toBe('ready');
    const harvest = await alice.agent.post('/api/game/plots/4/harvest');
    expect(harvest.status).toBe(200);
    expect(harvest.body.state.inventory.crops.carrot).toBe(1);
    expect(harvest.body.state.player.xp).toBe(8);
    expect(harvest.body.state.farm.plots[4].state).toBe('empty');

    const sell = await alice.agent.post('/api/game/sell').send({ cropId: 'carrot', quantity: 1 });
    expect(sell.status).toBe(200);
    expect(sell.body.coinsEarned).toBe(18);
    expect(sell.body.state.player.coins).toBe(68);
    expect(sell.body.state.inventory.crops.carrot).toBe(0);
  });

  it('levels up from harvesting and unlocks pumpkins', async () => {
    const { alice, clock } = await setup();
    await alice.agent.post('/api/game/shop/buy').send({ cropId: 'tomato', quantity: 2 }); // 50 coins -> 0
    for (let i = 0; i < 3; i++) await alice.agent.post(`/api/game/plots/${i}/plant`).send({ cropId: 'carrot' });
    await alice.agent.post('/api/game/plots/3/plant').send({ cropId: 'tomato' });
    await alice.agent.post('/api/game/plots/4/plant').send({ cropId: 'tomato' });
    clock.advance(30_000);
    let last: any;
    for (let i = 0; i < 5; i++) last = await alice.agent.post(`/api/game/plots/${i}/harvest`);
    // 3*8 + 2*20 = 64 xp => level 2 (50 xp)
    expect(last.body.state.player).toMatchObject({ xp: 64, level: 2 });
    expect(last.body.leveledUp).toBe(true); // 44 -> 64 xp crosses the 50 xp threshold on the final harvest
    await alice.agent.post('/api/game/sell').send({ cropId: 'tomato', quantity: 'all' });
    await alice.agent.post('/api/game/sell').send({ cropId: 'carrot', quantity: 'all' });
    const buy = await alice.agent.post('/api/game/shop/buy').send({ cropId: 'pumpkin', quantity: 1 });
    expect(buy.status).toBe(200);
  });

  it('reports leveledUp on the harvest that crosses the threshold', async () => {
    const { alice, clock, db } = await setup();
    db.prepare('UPDATE players SET xp = 45').run();
    await alice.agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' });
    clock.advance(15_000);
    const res = await alice.agent.post('/api/game/plots/0/harvest');
    expect(res.body).toMatchObject({ leveledUp: true, newLevel: 2, xpGained: 8 });
  });

  it('rejects invalid plant/harvest/sell requests', async () => {
    const { alice } = await setup();
    expect((await alice.agent.post('/api/game/plots/9/plant').send({ cropId: 'carrot' })).body.error.code).toBe('plot_not_found');
    expect((await alice.agent.post('/api/game/plots/-1/harvest')).body.error.code).toBe('plot_not_found');
    expect((await alice.agent.post('/api/game/plots/abc/harvest')).status).toBe(400);
    expect((await alice.agent.post('/api/game/plots/0/harvest')).body.error.code).toBe('plot_empty');
    expect((await alice.agent.post('/api/game/plots/0/plant').send({ cropId: 'tomato' })).body.error.code).toBe('insufficient_seeds');
    await alice.agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' });
    const occupied = await alice.agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' });
    expect(occupied.body.error.code).toBe('plot_occupied');
    // a failed plant must not have consumed the seed
    expect((await alice.agent.get('/api/game/state')).body.inventory.seeds.carrot).toBe(2);
    expect((await alice.agent.post('/api/game/sell').send({ cropId: 'carrot', quantity: 1 })).body.error.code).toBe('insufficient_crops');
    expect((await alice.agent.post('/api/game/sell').send({ cropId: 'carrot', quantity: 'all' })).body.error.code).toBe('insufficient_crops');
  });
});

describe('duplicate-action protection (parallel requests)', () => {
  it('pays a harvest reward exactly once when the same plot is harvested 12 times in parallel', async () => {
    const { alice, clock } = await setup();
    await alice.agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' });
    clock.advance(15_000);
    const results = await Promise.all(Array.from({ length: 12 }, () => alice.agent.post('/api/game/plots/0/harvest')));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(11);
    const state = (await alice.agent.get('/api/game/state')).body;
    expect(state.inventory.crops.carrot).toBe(1);
    expect(state.player.xp).toBe(8);
  });

  it('cannot spend the same coins twice with parallel purchases', async () => {
    const { alice } = await setup();
    // 50 coins; each request costs 40 (4 carrot seeds)
    const results = await Promise.all(Array.from({ length: 8 }, () => alice.agent.post('/api/game/shop/buy').send({ cropId: 'carrot', quantity: 4 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const state = (await alice.agent.get('/api/game/state')).body;
    expect(state.player.coins).toBe(10);
    expect(state.inventory.seeds.carrot).toBe(3 + 4);
  });

  it('cannot plant one seed into several plots, or sell the same crop twice', async () => {
    const { alice, clock, db } = await setup();
    db.prepare("UPDATE inventory SET quantity = 1 WHERE kind = 'seed' AND crop_id = 'carrot'").run();
    const plants = await Promise.all(Array.from({ length: 9 }, (_, i) => alice.agent.post(`/api/game/plots/${i}/plant`).send({ cropId: 'carrot' })));
    expect(plants.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await alice.agent.get('/api/game/state')).body.inventory.seeds.carrot).toBe(0);

    clock.advance(15_000);
    const idx = (await alice.agent.get('/api/game/state')).body.farm.plots.findIndex((p: any) => p.cropId);
    await alice.agent.post(`/api/game/plots/${idx}/harvest`);
    const sells = await Promise.all(Array.from({ length: 6 }, () => alice.agent.post('/api/game/sell').send({ cropId: 'carrot', quantity: 1 })));
    expect(sells.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await alice.agent.get('/api/game/state')).body.player.coins).toBe(50 + 18);
  });

  it('the database itself refuses negative coins and inventory', async () => {
    const { db, alice } = await setup();
    expect(() => db.prepare('UPDATE players SET coins = -1').run()).toThrow(/CHECK/);
    expect(() => db.prepare('UPDATE inventory SET quantity = -1').run()).toThrow(/CHECK/);
    expect(alice).toBeTruthy();
  });
});

describe('player isolation', () => {
  it('keeps every farm private, and ignores any user id the client tries to send', async () => {
    const { app, alice } = await setup();
    const bob = await signup(app, 'bob');
    await alice.agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' });
    await alice.agent.post('/api/game/shop/buy').send({ cropId: 'tomato', quantity: 1 });

    const bobState = (await bob.agent.get('/api/game/state')).body;
    expect(bobState.player.id).toBe(bob.user.id);
    expect(bobState.player.coins).toBe(50);
    expect(bobState.farm.plots[0].state).toBe('empty');
    expect(bobState.inventory.seeds.tomato).toBe(0);

    // spoofing attempts: body, query string, headers
    const spoof = await bob.agent
      .post(`/api/game/plots/0/harvest?userId=${alice.user.id}`)
      .set('X-User-Id', alice.user.id)
      .send({ userId: alice.user.id, user_id: alice.user.id });
    expect(spoof.body.error.code).toBe('plot_empty'); // acted on Bob's own (empty) plot
    const spoofState = await bob.agent.get(`/api/game/state?userId=${alice.user.id}`);
    expect(spoofState.body.player.id).toBe(bob.user.id);

    // Alice's plant is untouched
    expect((await alice.agent.get('/api/game/state')).body.farm.plots[0].state).toBe('growing');
  });

  it('lets each player spend resources without affecting the other', async () => {
    const { app, alice } = await setup();
    const bob = await signup(app, 'bob');
    await alice.agent.post('/api/game/shop/buy').send({ cropId: 'tomato', quantity: 2 });
    expect((await bob.agent.get('/api/game/state')).body.player.coins).toBe(50);
  });
});

describe('persistence', () => {
  it('keeps farm, inventory, coins, xp and growth timers across logout, login and backend restart', async () => {
    const file = tempDbFile();
    const clock = makeClock();
    const first = makeApp({ dbFile: file, clock });
    const { agent } = await signup(first.app, 'persist_me');
    await agent.post('/api/game/shop/buy').send({ cropId: 'carrot', quantity: 2 });
    await agent.post('/api/game/plots/2/plant').send({ cropId: 'carrot' });
    const before = (await agent.get('/api/game/state')).body;
    await agent.post('/api/auth/logout');
    first.db.close();

    clock.advance(20_000); // time passes while the "backend is down"
    const second = makeApp({ dbFile: file, clock });
    const again = await (await import('supertest')).default.agent(second.app);
    expect((await again.post('/api/auth/login').send({ username: 'persist_me', password: 'correct horse' })).status).toBe(200);
    const after = (await again.get('/api/game/state')).body;
    expect(after.player.id).toBe(before.player.id);
    expect(after.player.coins).toBe(before.player.coins);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.farm.plots[2]).toMatchObject({ cropId: 'carrot', plantedAt: before.farm.plots[2].plantedAt, readyAt: before.farm.plots[2].readyAt, state: 'ready' });
    expect((await again.post('/api/game/plots/2/harvest')).status).toBe(200);
  });
});

describe('random harvest yield', () => {
  const harvestWith = async (yields: number[]) => {
    const queue = [...yields];
    const ctx = makeApp({ rollYield: () => queue.shift() ?? 1 });
    const { agent, user } = await signup(ctx.app, 'yielder');
    const go = async () => {
      ctx.db.prepare("UPDATE farm_plots SET crop_id = 'carrot', planted_at = 1, ready_at = 2 WHERE user_id = ? AND plot_index = 0").run(user.id);
      return agent.post('/api/game/plots/0/harvest');
    };
    return { ...ctx, agent, user, go };
  };

  it('adds the rolled number of crops, reports it, and keeps XP per harvest', async () => {
    const { go, db } = await harvestWith([4, 1, 5]);
    try {
      const a = await go();
      expect(a.body).toMatchObject({ yield: 4, xpGained: 8 });
      expect(a.body.state.inventory.crops.carrot).toBe(4);
      expect((await go()).body.yield).toBe(1);
      const c = await go();
      expect(c.body.state.inventory.crops.carrot).toBe(10);
      expect(c.body.state.player.xp).toBe(24);
      // quest progress counts the crops collected (capped at the target)
      expect(c.body.state.personalQuests[0].objectives[0].progress).toBe(10);
    } finally { db.close(); }
  });

  it('really yields 1 to 5 with the default random roll, and every value occurs', async () => {
    // makeApp injects a fixed yield, so build an app with the production roller instead.
    const { createApp } = await import('../src/app.js');
    const { openDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    const { loadConfig } = await import('../src/config.js');
    const db = openDb(':memory:'); migrate(db);
    const app = createApp({ config: loadConfig({ RATE_LIMIT: 'false' } as NodeJS.ProcessEnv), db });
    try {
      const { agent, user } = await signup(app, 'rolls');
      const seen = new Set<number>();
      for (let i = 0; i < 120; i++) {
        db.prepare("UPDATE farm_plots SET crop_id = 'carrot', planted_at = 1, ready_at = 2 WHERE user_id = ? AND plot_index = 0").run(user.id);
        const n = (await agent.post('/api/game/plots/0/harvest')).body.yield as number;
        expect(Number.isInteger(n) && n >= 1 && n <= 5).toBe(true);
        seen.add(n);
      }
      expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
    } finally { db.close(); }
  });
});
