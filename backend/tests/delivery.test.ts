import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp, makeClock, signup } from './helpers.js';
import { DELIVERY_RULES } from '../src/delivery/service.js';

const COOLDOWN = DELIVERY_RULES.cooldownMs;

function setup() {
  const clock = makeClock();
  const { app, db } = makeApp({ clock });
  const coins = (id: string) => (db.prepare('SELECT coins FROM players WHERE user_id = ?').get(id) as { coins: number }).coins;
  const carrots = (id: string) =>
    (db.prepare("SELECT quantity FROM inventory WHERE user_id = ? AND kind = 'crop' AND crop_id = 'carrot'").get(id) as { quantity: number } | undefined)?.quantity ?? 0;
  const setReward = (id: string, kind: 'coins' | 'carrots', amount: number) =>
    db.prepare('UPDATE deliveries SET reward_kind = ?, reward_amount = ? WHERE id = ?').run(kind, amount, id);
  return { app, db, clock, coins, carrots, setReward };
}
type Agent = Awaited<ReturnType<typeof signup>>['agent'];
const status = (a: Agent) => a.get('/api/delivery');
const claim = (a: Agent, id: string, body: object = {}) => a.post(`/api/delivery/${id}/claim`).send(body);

describe('courier deliveries', () => {
  it('requires the game session', async () => {
    const t = setup();
    try {
      expect((await request(t.app).get('/api/delivery')).status).toBe(401);
      expect((await request(t.app).post('/api/delivery/3b0c7a52-6d1e-4f0a-9c2b-1e2d3c4b5a69/claim').send({})).status).toBe(401);
    } finally { t.db.close(); }
  });

  it('creates one pending delivery and resumes it on refresh, without revealing the reward', async () => {
    const t = setup();
    try {
      const { agent } = await signup(t.app, 'd_alice');
      const first = await status(agent);
      expect(first.status).toBe(200);
      expect(first.body.delivery.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(first.body.delivery).toEqual({ id: first.body.delivery.id }); // no reward details before the claim
      const parallel = await Promise.all(Array.from({ length: 6 }, () => status(agent)));
      expect(new Set(parallel.map((r) => r.body.delivery.id))).toEqual(new Set([first.body.delivery.id]));
      expect((t.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number }).n).toBe(1);
    } finally { t.db.close(); }
  });

  it('grants 20 coins or 3 carrots, decided by the server, exactly once', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'd_bob');
      const id = (await status(agent)).body.delivery.id as string;

      t.setReward(id, 'coins', 20);
      const before = t.coins(user.id);
      // Forged reward, player and cooldown values in the request are ignored.
      const results = await Promise.all(Array.from({ length: 6 }, () => claim(agent, id, { amount: 9999, kind: 'carrots', userId: 'other', coins: 5000 })));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.granted)).toHaveLength(1);
      expect(results[0]!.body.reward).toEqual({ kind: 'coins', amount: 20 });
      expect(t.coins(user.id)).toBe(before + 20);
      const granted = results.find((r) => r.body.granted)!;
      expect(granted.body.state.player.coins).toBe(before + 20);

      const repeat = await claim(agent, id);
      expect(repeat.body.granted).toBe(false);
      expect(t.coins(user.id)).toBe(before + 20);
      expect(repeat.body.state.player.coins).toBe(before + 20);
    } finally { t.db.close(); }
  });

  it('can pay carrots into the harvested inventory, once', async () => {
    const t = setup();
    try {
      const { agent, user } = await signup(t.app, 'd_carol');
      const id = (await status(agent)).body.delivery.id as string;
      t.setReward(id, 'carrots', 3);
      const coinsBefore = t.coins(user.id);
      const res = await claim(agent, id);
      expect(res.body).toMatchObject({ granted: true, reward: { kind: 'carrots', amount: 3 } });
      expect(res.body.state.inventory.crops.carrot).toBe(6); // 3 to plant at the start + 3 delivered
      await claim(agent, id);
      expect(t.carrots(user.id)).toBe(6);
      expect(t.coins(user.id)).toBe(coinsBefore);
    } finally { t.db.close(); }
  });

  it('enforces the 10 minute cooldown from the claim, then offers the next delivery', async () => {
    const t = setup();
    try {
      const { agent } = await signup(t.app, 'd_dave');
      const id = (await status(agent)).body.delivery.id as string;
      const claimed = await claim(agent, id);
      const claimedAt = t.clock.t;
      expect(claimed.body.nextEligibleAt).toBe(claimedAt + COOLDOWN);

      const early = await status(agent);
      expect(early.body.delivery).toBeNull();
      expect(early.body.nextEligibleAt).toBe(claimedAt + COOLDOWN);
      t.clock.advance(COOLDOWN - 1);
      expect((await status(agent)).body.delivery).toBeNull();
      expect((t.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number }).n).toBe(1);

      t.clock.advance(1);
      const next = await status(agent);
      expect(next.body.delivery.id).toBeTruthy();
      expect(next.body.delivery.id).not.toBe(id);
      expect((t.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get() as { n: number }).n).toBe(2);
      // the old delivery can never pay again
      const coinsBefore = (t.db.prepare('SELECT coins FROM players').get() as { coins: number }).coins;
      expect((await claim(agent, id)).body.granted).toBe(false);
      expect((t.db.prepare('SELECT coins FROM players').get() as { coins: number }).coins).toBe(coinsBefore);
    } finally { t.db.close(); }
  });

  it('keeps an unclaimed delivery recoverable (no accumulation) and isolates players', async () => {
    const t = setup();
    try {
      const a = await signup(t.app, 'd_erin');
      const b = await signup(t.app, 'd_frank');
      const first = (await status(a.agent)).body.delivery.id as string;
      t.clock.advance(COOLDOWN * 5); // hours pass without claiming: still exactly one pending delivery
      expect((await status(a.agent)).body.delivery.id).toBe(first);
      expect((t.db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE user_id = ?').get(a.user.id) as { n: number }).n).toBe(1);

      const bId = (await status(b.agent)).body.delivery.id as string;
      expect(bId).not.toBe(first);
      const stolen = await claim(b.agent, first); // another player's delivery id grants nothing
      expect(stolen.status).toBe(404);
      expect(stolen.body.error.code).toBe('delivery_not_found');
      expect((await claim(a.agent, 'not-a-uuid')).status).toBe(400);
      expect((await claim(a.agent, '3b0c7a52-6d1e-4f0a-9c2b-1e2d3c4b5a69')).status).toBe(404);
      expect((t.db.prepare('SELECT claimed_at FROM deliveries WHERE id = ?').get(first) as { claimed_at: number | null }).claimed_at).toBeNull();
    } finally { t.db.close(); }
  });
});
