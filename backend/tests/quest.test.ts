import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makeApp, signup } from './helpers.js';

const env = {
  CLAN_PLATFORM_URL: 'https://platform.example.test',
  CLAN_SOCIAL_URL: 'https://social.example.test',
  CLAN_GAME_API_KEY: 'test-server-only-api-key',
};
afterEach(() => vi.unstubAllGlobals());

/** Mock Platform (token exchange) + Social (GET /players/me/clan). `clanOf` maps game user id -> clan. */
function mockClan(clanOf: Map<string, { id: string; name: string }>, mode: { fail?: 'http' | 'shape' | 'throw' | 'other404' } = {}) {
  const calls: { url: string; auth?: string }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: href, auth: headers.Authorization });
    if (href.endsWith('/api/v1/players/auth')) {
      const { externalPlayerId } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ token: `tok-${externalPlayerId}`, expiresIn: 3600 }));
    }
    if (href.endsWith('/api/v1/players/me/clan')) {
      if (mode.fail === 'throw') throw new Error('network down');
      if (mode.fail === 'http') return new Response('{}', { status: 500 });
      if (mode.fail === 'shape') return new Response(JSON.stringify({ clan: { id: 7 } }));
      if (mode.fail === 'other404') return new Response(JSON.stringify({ error: { code: 'player_deleted' } }), { status: 404 });
      const clan = clanOf.get(String(headers.Authorization).replace('Bearer tok-', ''));
      if (!clan) return new Response(JSON.stringify({ error: { code: 'not_in_clan', message: 'no' } }), { status: 404 });
      return new Response(JSON.stringify({ clan: { ...clan, memberCount: 3, maxMembers: 10 }, role: 'member' }));
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const WOLVES = { id: '3b0c7a52-6d1e-4f0a-9c2b-1e2d3c4b5a69', name: 'Wolves' };
const BEARS = { id: '9a0c7a52-6d1e-4f0a-9c2b-1e2d3c4b5a70', name: 'Bears' };

function setup() {
  const clanOf = new Map<string, { id: string; name: string }>();
  const ctl = { mode: {} as NonNullable<Parameters<typeof mockClan>[1]> };
  mockClan(clanOf, ctl.mode);
  const { app, db } = makeApp({ env });
  const player = async (name: string, carrots = 0, clan: typeof WOLVES | null = WOLVES) => {
    const { agent, user } = await signup(app, name);
    if (clan) clanOf.set(user.id, clan);
    if (carrots) db.prepare("INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', 'carrot', ?) ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = ?").run(user.id, carrots, carrots);
    return { agent, user };
  };
  const carrots = (userId: string) =>
    (db.prepare("SELECT quantity FROM inventory WHERE user_id = ? AND kind = 'crop' AND crop_id = 'carrot'").get(userId) as { quantity: number } | undefined)?.quantity ?? 0;
  const coins = (userId: string) => (db.prepare('SELECT coins FROM players WHERE user_id = ?').get(userId) as { coins: number }).coins;
  const progress = (clanId: string) => (db.prepare('SELECT progress FROM clan_quests WHERE clan_id = ?').get(clanId) as { progress: number } | undefined)?.progress ?? 0;
  const setProgress = (clanId: string, n: number) => {
    const t = Date.now();
    db.prepare('INSERT OR IGNORE INTO clan_quests (clan_id, target, progress, created_at, updated_at) VALUES (?, 100, 0, ?, ?)').run(clanId, t, t);
    db.prepare('UPDATE clan_quests SET progress = ?, completed_at = CASE WHEN ? >= 100 THEN ? END WHERE clan_id = ?').run(n, n, t, clanId);
  };
  return { app, db, clanOf, ctl, player, carrots, coins, progress, setProgress };
}
type Agent = Awaited<ReturnType<ReturnType<typeof setup>['player']>>['agent'];
const give = (agent: Agent, quantity: number, key: string, extra: object = {}) => agent.post('/api/quest/contribute').send({ quantity, idempotencyKey: key, ...extra });

describe('Village Festival (mock Platform + Social)', () => {
  it('requires the game session', async () => {
    const t = setup();
    try {
      expect((await request(t.app).get('/api/quest')).status).toBe(401);
      expect((await request(t.app).post('/api/quest/contribute').send({ quantity: 1, idempotencyKey: 'abcdefgh' })).status).toBe(401);
      expect((await request(t.app).post('/api/quest/claim').send({})).status).toBe(401);
    } finally { t.db.close(); }
  });

  it('verifies the clan server-side with a server-minted token and never exposes the API key', async () => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_alice', 5);
      const res = await agent.get('/api/quest');
      expect(res.status).toBe(200);
      expect(res.body.clan).toEqual(WOLVES);
      expect(res.body.quest).toMatchObject({ title: 'Village Festival', target: 100, progress: 0, completed: false, rewardCoins: 50 });
      expect(res.body.me).toEqual({ contributed: 0, claimed: false, canClaim: false });
      expect(res.text).not.toContain(env.CLAN_GAME_API_KEY);
      expect(user.id).toBeTruthy();
    } finally { t.db.close(); }
  });

  it('shows a "join a clan" state and rejects actions without a clan, leaving inventory alone', async () => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_loner', 10, null);
      const status = await agent.get('/api/quest');
      expect(status.body.clan).toBeNull();
      expect(status.body.me).toBeNull();
      const res = await give(agent, 5, 'key-loner-1');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('no_clan');
      expect(t.carrots(user.id)).toBe(10);
      expect((await agent.post('/api/quest/claim').send({})).body.error.code).toBe('no_clan');
    } finally { t.db.close(); }
  });

  it.each(['http', 'shape', 'throw', 'other404'] as const)('fails with a retryable error and no inventory change when verification fails (%s)', async (fail) => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_unlucky', 10);
      t.ctl.mode.fail = fail;
      const res = await give(agent, 5, 'key-unlucky-1');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('clan_verification_failed');
      expect(res.body.error.details).toEqual({ retryable: true });
      expect(t.carrots(user.id)).toBe(10);
      expect(t.progress(WOLVES.id)).toBe(0);
      t.ctl.mode.fail = undefined; // retryable: the very same request works once verification recovers
      const retry = await give(agent, 5, 'key-unlucky-1');
      expect(retry.status).toBe(200);
      expect(t.carrots(user.id)).toBe(5);
    } finally { t.db.close(); }
  });

  it('deducts carrots, records the contribution and advances shared progress; ignores browser-supplied identity', async () => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_bob', 12);
      const one = await give(agent, 1, 'key-bob-0001', { clanId: BEARS.id, userId: 'someone-else', progress: 99, reward: 9999 });
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({ accepted: 1, requested: 1, replayed: false });
      const five = await give(agent, 5, 'key-bob-0002');
      expect(five.body.accepted).toBe(5);
      expect(five.body.quest.progress).toBe(6);
      expect(five.body.me.contributed).toBe(6);
      expect(five.body.state.inventory.crops.carrot).toBe(6);
      expect(t.carrots(user.id)).toBe(6);
      expect(t.progress(WOLVES.id)).toBe(6);
      expect(t.progress(BEARS.id)).toBe(0); // the verified clan, not the one the browser claimed
      const stored = t.db.prepare('SELECT user_id, clan_id FROM clan_quest_contributions').all() as { user_id: string; clan_id: string }[];
      expect(stored.every((r) => r.user_id === user.id && r.clan_id === WOLVES.id)).toBe(true);
    } finally { t.db.close(); }
  });

  it('rejects other amounts and insufficient carrots without changing anything', async () => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_carol', 3);
      expect((await give(agent, 3, 'key-carol-01')).status).toBe(400);
      expect((await give(agent, 1, 'short')).status).toBe(400);
      const res = await give(agent, 5, 'key-carol-02');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('insufficient_crops');
      expect(t.carrots(user.id)).toBe(3);
      expect(t.progress(WOLVES.id)).toBe(0);
    } finally { t.db.close(); }
  });

  it('accepts only the remaining amount, then stops accepting once complete', async () => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_dave', 10);
      t.setProgress(WOLVES.id, 98);
      const res = await give(agent, 5, 'key-dave-001');
      expect(res.body).toMatchObject({ accepted: 2, requested: 5 });
      expect(res.body.quest).toMatchObject({ progress: 100, completed: true });
      expect(t.carrots(user.id)).toBe(8);
      const more = await give(agent, 1, 'key-dave-002');
      expect(more.status).toBe(409);
      expect(more.body.error.code).toBe('quest_completed');
      expect(t.carrots(user.id)).toBe(8);
      expect(t.progress(WOLVES.id)).toBe(100);
    } finally { t.db.close(); }
  });

  it('a retried request (same key) never deducts twice and needs no new clan lookup', async () => {
    const clanOf = new Map<string, { id: string; name: string }>();
    const { fetchMock } = mockClan(clanOf);
    const { app, db } = makeApp({ env });
    try {
      const { agent, user } = await signup(app, 'q_erin');
      clanOf.set(user.id, WOLVES);
      db.prepare("INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', 'carrot', 10) ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = 10").run(user.id);
      const first = await give(agent, 5, 'key-erin-0001');
      const before = fetchMock.mock.calls.length;
      const again = await give(agent, 5, 'key-erin-0001');
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ accepted: 5, replayed: true });
      expect(first.body.replayed).toBe(false);
      expect(fetchMock.mock.calls.length).toBe(before);
      expect((db.prepare("SELECT quantity FROM inventory WHERE user_id = ? AND crop_id = 'carrot'").get(user.id) as { quantity: number }).quantity).toBe(5);
      expect((db.prepare('SELECT progress FROM clan_quests').get() as { progress: number }).progress).toBe(5);
      const clash = await give(agent, 1, 'key-erin-0001');
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('idempotency_key_reused');
    } finally { db.close(); }
  });

  it('parallel contributions never overfill progress or drive inventory negative', async () => {
    const t = setup();
    try {
      const players = await Promise.all(['q_p1', 'q_p2', 'q_p3'].map((n) => t.player(n, 40)));
      const attempts = players.flatMap((p, pi) => Array.from({ length: 12 }, (_, i) => give(p.agent, 5, `key-par-${pi}-${i}`)));
      const results = await Promise.all(attempts);
      const accepted = results.filter((r) => r.status === 200).reduce((n, r) => n + r.body.accepted, 0);
      expect(accepted).toBe(100);
      expect(t.progress(WOLVES.id)).toBe(100);
      const left = players.map((p) => t.carrots(p.user.id));
      expect(left.every((n) => n >= 0)).toBe(true);
      expect(left.reduce((a, b) => a + b, 0)).toBe(120 - 100);
      expect(results.filter((r) => r.status !== 200).every((r) => r.body.error.code === 'quest_completed' || r.body.error.code === 'insufficient_crops')).toBe(true);
    } finally { t.db.close(); }
  });

  it('parallel duplicates of one request deduct once', async () => {
    const t = setup();
    try {
      const { agent, user } = await t.player('q_dup', 10);
      const results = await Promise.all(Array.from({ length: 6 }, () => give(agent, 5, 'key-dup-0001')));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(t.carrots(user.id)).toBe(5);
      expect(t.progress(WOLVES.id)).toBe(5);
    } finally { t.db.close(); }
  });

  it('keeps clans separate', async () => {
    const t = setup();
    try {
      const a = await t.player('q_wolf', 5, WOLVES);
      const b = await t.player('q_bear', 5, BEARS);
      await give(a.agent, 5, 'key-wolf-001');
      expect(t.progress(WOLVES.id)).toBe(5);
      expect(t.progress(BEARS.id)).toBe(0);
      expect((await b.agent.get('/api/quest')).body.quest.progress).toBe(0);
      expect((await a.agent.get('/api/quest')).body.quest.progress).toBe(5);
    } finally { t.db.close(); }
  });

  it('pays the 50 coin reward exactly once, only to contributors still in the clan', async () => {
    const t = setup();
    try {
      const worker = await t.player('q_worker', 5);
      const idler = await t.player('q_idler', 0);
      const quitter = await t.player('q_quitter', 5);
      expect((await worker.agent.post('/api/quest/claim').send({})).body.error.code).toBe('quest_not_complete');
      t.setProgress(WOLVES.id, 90);
      await give(worker.agent, 5, 'key-work-0001');
      await give(quitter.agent, 5, 'key-quit-0001');
      expect(t.progress(WOLVES.id)).toBe(100);

      const startCoins = t.coins(worker.user.id);
      const status = await worker.agent.get('/api/quest');
      expect(status.body.me).toMatchObject({ contributed: 5, claimed: false, canClaim: true });
      const results = await Promise.all(Array.from({ length: 6 }, () => worker.agent.post('/api/quest/claim').send({})));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.coinsGranted === 50)).toHaveLength(1);
      expect(t.coins(worker.user.id)).toBe(startCoins + 50);
      const again = await worker.agent.post('/api/quest/claim').send({});
      expect(again.body).toMatchObject({ coinsGranted: 0, me: { claimed: true, canClaim: false } });
      expect(t.coins(worker.user.id)).toBe(startCoins + 50);
      expect(again.body.state.player.coins).toBe(startCoins + 50);

      const noWork = await idler.agent.post('/api/quest/claim').send({});
      expect(noWork.status).toBe(409);
      expect(noWork.body.error.code).toBe('not_a_contributor');

      t.clanOf.delete(quitter.user.id); // left the clan
      const left = await quitter.agent.post('/api/quest/claim').send({});
      expect(left.body.error.code).toBe('no_clan');
      t.clanOf.set(quitter.user.id, BEARS); // joined another clan: contributions to Wolves do not count there
      expect((await quitter.agent.post('/api/quest/claim').send({})).body.error.code).toBe('quest_not_complete');
      expect(t.coins(quitter.user.id)).toBe(50);
    } finally { t.db.close(); }
  });
});
