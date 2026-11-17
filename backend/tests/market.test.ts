import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp, makeClock, signup } from './helpers.js';
import { clanVerificationFailed } from '../src/quest/clan-membership.js';
import type { Circle } from '../src/market/social.js';

type Agent = Awaited<ReturnType<typeof signup>>['agent'];

/** A fake Social service: tests describe who is in which clan and who is friends with whom. */
function setup() {
  const circles = new Map<string, Circle>();
  let failing = false;
  const clock = makeClock();
  const { app, db } = makeApp({ clock, circle: async (p) => {
    if (failing) throw clanVerificationFailed();
    const c = circles.get(p.userId);
    if (!c) throw clanVerificationFailed();
    return c;
  } });
  const row = (id: string) => db.prepare('SELECT coins FROM players WHERE user_id = ?').get(id) as { coins: number };
  const crops = (id: string, crop = 'carrot') =>
    (db.prepare("SELECT quantity FROM inventory WHERE user_id = ? AND kind = 'crop' AND crop_id = ?").get(id, crop) as { quantity: number } | undefined)?.quantity ?? 0;
  const give = (id: string, crop: string, qty: number) =>
    db.prepare("INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', ?, ?) ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = ?").run(id, crop, qty, qty);
  const setCoins = (id: string, coins: number) => db.prepare('UPDATE players SET coins = ? WHERE user_id = ?').run(coins, id);
  /** Describes the world: everyone listed shares `clan` (or none) and the given friendships. */
  const world = (people: { name: string; id: string; clan?: string; friends?: string[] }[]) => {
    for (const p of people) {
      const mates = people.filter((q) => p.clan && q.clan === p.clan).map((q) => `social-${q.name}`);
      circles.set(p.id, {
        socialId: `social-${p.name}`,
        clanId: p.clan ?? null,
        clanName: p.clan ? `Clan ${p.clan}` : null,
        clanMemberIds: new Set(mates),
        friendIds: new Set((p.friends ?? []).map((n) => `social-${n}`)),
      });
    }
  };
  // Players start with 3 carrots to plant; clear them so the assertions are only about what the market moves.
  const player = async (name: string) => { const s = await signup(app, name); db.prepare('DELETE FROM inventory WHERE user_id = ?').run(s.user.id); return { ...s, name }; };
  const offer = (a: Agent, body: object) => a.post('/api/market/listings').send(body);
  const browse = (a: Agent) => a.get('/api/market');
  const buy = (a: Agent, id: string) => a.post(`/api/market/listings/${id}/buy`).send({});
  const cancel = (a: Agent, id: string) => a.post(`/api/market/listings/${id}/cancel`).send({});
  return { app, db, clock, row, crops, give, setCoins, world, player, offer, browse, buy, cancel, fail: (v: boolean) => { failing = v; } };
}

describe('kiosk marketplace', () => {
  it('requires the game session', async () => {
    const t = setup();
    try {
      expect((await request(t.app).get('/api/market')).status).toBe(401);
      expect((await request(t.app).post('/api/market/listings').send({})).status).toBe(401);
    } finally { t.db.close(); }
  });

  it('puts the offered crops in escrow and returns them when the offer is cancelled (once)', async () => {
    const t = setup();
    try {
      const a = await t.player('m_ann');
      t.world([{ name: 'm_ann', id: a.user.id, clan: 'X' }]);
      t.give(a.user.id, 'carrot', 25);
      const res = await t.offer(a.agent, { cropId: 'carrot', quantity: 20, price: 100, audiences: ['clan'] });
      expect(res.status).toBe(201);
      expect(res.body.state.inventory.crops.carrot).toBe(5);
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 6, price: 10, audiences: ['clan'] })).body.error.code).toBe('insufficient_crops');
      const mine = (await t.browse(a.agent)).body.mine;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ cropId: 'carrot', quantity: 20, price: 100, audiences: ['clan'] });

      const first = await Promise.all([t.cancel(a.agent, res.body.id), t.cancel(a.agent, res.body.id)]);
      expect(first.filter((r) => r.body.cancelled)).toHaveLength(1);
      expect(t.crops(a.user.id)).toBe(25);
      expect((await t.browse(a.agent)).body.mine).toHaveLength(0);
    } finally { t.db.close(); }
  });

  it('lets a clan mate buy: coins and crops move atomically, exactly once under parallel clicks', async () => {
    const t = setup();
    try {
      const a = await t.player('m_bea');
      const b = await t.player('m_cal');
      const c = await t.player('m_dee');
      t.world([{ name: 'm_bea', id: a.user.id, clan: 'X' }, { name: 'm_cal', id: b.user.id, clan: 'X' }, { name: 'm_dee', id: c.user.id, clan: 'X' }]);
      t.give(a.user.id, 'carrot', 20);
      t.setCoins(b.user.id, 500); t.setCoins(c.user.id, 500); t.setCoins(a.user.id, 0);
      const id = (await t.offer(a.agent, { cropId: 'carrot', quantity: 20, price: 100, audiences: ['clan'] })).body.id as string;

      const seen = (await t.browse(b.agent)).body;
      expect(seen.offers).toEqual([expect.objectContaining({ id, seller: 'm_bea', cropId: 'carrot', quantity: 20, price: 100, audiences: ['clan'], relation: { clan: true, friend: false } })]);
      expect(seen.circle.clan.name).toBe('Clan X');

      const results = await Promise.all([t.buy(b.agent, id), t.buy(b.agent, id), t.buy(c.agent, id), t.buy(b.agent, id)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'listing_unavailable')).toBe(true);
      const winner = results.find((r) => r.status === 200)!;
      expect(winner.body).toMatchObject({ cropId: 'carrot', quantity: 20, price: 100, seller: 'm_bea' });
      const buyers = [b, c];
      const buyer = buyers.find((p) => t.crops(p.user.id) === 20)!;
      expect(t.row(buyer.user.id).coins).toBe(400);
      expect(t.row(a.user.id).coins).toBe(100);
      expect(t.crops(a.user.id)).toBe(0);
      expect(buyers.reduce((n, p) => n + t.row(p.user.id).coins, 0)).toBe(900); // coins only moved, never created
      expect((await t.browse(b.agent)).body.offers).toHaveLength(0);
    } finally { t.db.close(); }
  });

  it('rejects a buyer who cannot pay, with nothing changed and the offer still open', async () => {
    const t = setup();
    try {
      const a = await t.player('m_eli');
      const b = await t.player('m_fay');
      t.world([{ name: 'm_eli', id: a.user.id, friends: ['m_fay'] }, { name: 'm_fay', id: b.user.id, friends: ['m_eli'] }]);
      t.give(a.user.id, 'tomato', 4);
      t.setCoins(b.user.id, 99); t.setCoins(a.user.id, 0);
      const id = (await t.offer(a.agent, { cropId: 'tomato', quantity: 4, price: 100, audiences: ['friends'] })).body.id as string;
      const res = await t.buy(b.agent, id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('insufficient_coins');
      expect(t.row(b.user.id).coins).toBe(99);
      expect(t.row(a.user.id).coins).toBe(0);
      expect(t.crops(b.user.id, 'tomato')).toBe(0);
      expect(((await t.browse(b.agent)).body.offers as unknown[])).toHaveLength(1); // still active: the sale rolled back
      t.setCoins(b.user.id, 100);
      expect((await t.buy(b.agent, id)).status).toBe(200);
    } finally { t.db.close(); }
  });

  it('shows offers only to the right audience: clan mates for clan offers, friends for friends offers', async () => {
    const t = setup();
    try {
      const seller = await t.player('m_gus');
      const mate = await t.player('m_hal');
      const friend = await t.player('m_ida');
      const stranger = await t.player('m_jon');
      const otherClan = await t.player('m_kim');
      t.world([
        { name: 'm_gus', id: seller.user.id, clan: 'X', friends: ['m_ida'] },
        { name: 'm_hal', id: mate.user.id, clan: 'X' },
        { name: 'm_ida', id: friend.user.id, friends: ['m_gus'] },
        { name: 'm_jon', id: stranger.user.id },
        { name: 'm_kim', id: otherClan.user.id, clan: 'Y' },
      ]);
      t.give(seller.user.id, 'carrot', 10); t.give(seller.user.id, 'pumpkin', 10);
      const clanOffer = (await t.offer(seller.agent, { cropId: 'carrot', quantity: 5, price: 20, audiences: ['clan'] })).body.id as string;
      const friendOffer = (await t.offer(seller.agent, { cropId: 'pumpkin', quantity: 5, price: 30, audiences: ['friends'] })).body.id as string;
      const ids = async (a: Agent) => ((await t.browse(a)).body.offers as { id: string }[]).map((o) => o.id).sort();

      expect(await ids(mate.agent)).toEqual([clanOffer]);
      expect(await ids(friend.agent)).toEqual([friendOffer]);
      expect(await ids(stranger.agent)).toEqual([]);
      expect(await ids(otherClan.agent)).toEqual([]);
      expect(await ids(seller.agent)).toEqual([]); // your own offers are under "mine"

      for (const [who, offerId] of [[stranger, clanOffer], [stranger, friendOffer], [otherClan, clanOffer], [mate, friendOffer], [friend, clanOffer]] as const) {
        const res = await t.buy(who.agent, offerId);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('listing_unavailable');
      }
      expect((await t.buy(seller.agent, friendOffer)).body.error.code).toBe('own_listing');
      expect(t.crops(stranger.user.id, 'carrot')).toBe(0);
    } finally { t.db.close(); }
  });

  it('hides a clan offer once the seller is no longer in that clan', async () => {
    const t = setup();
    try {
      const a = await t.player('m_lee');
      const b = await t.player('m_mia');
      t.world([{ name: 'm_lee', id: a.user.id, clan: 'X' }, { name: 'm_mia', id: b.user.id, clan: 'X' }]);
      t.give(a.user.id, 'carrot', 3);
      const id = (await t.offer(a.agent, { cropId: 'carrot', quantity: 3, price: 9, audiences: ['clan'] })).body.id as string;
      expect(((await t.browse(b.agent)).body.offers as unknown[])).toHaveLength(1);
      t.world([{ name: 'm_lee', id: a.user.id }, { name: 'm_mia', id: b.user.id, clan: 'X' }]); // Lee left the clan
      expect(((await t.browse(b.agent)).body.offers as unknown[])).toHaveLength(0);
      expect((await t.buy(b.agent, id)).body.error.code).toBe('listing_unavailable');
    } finally { t.db.close(); }
  });

  it('needs a clan to sell to a clan, validates offers, and ignores client-supplied identities', async () => {
    const t = setup();
    try {
      const a = await t.player('m_ned');
      const b = await t.player('m_oli');
      t.world([{ name: 'm_ned', id: a.user.id }, { name: 'm_oli', id: b.user.id }]);
      t.give(a.user.id, 'carrot', 10);
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 5, audiences: ['clan'] })).body.error.code).toBe('no_clan');
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 5, audiences: ['friends'] })).status).toBe(201);
      for (const bad of [
        { cropId: 'carrot', quantity: 0, price: 5, audiences: ['friends'] },
        { cropId: 'carrot', quantity: 1.5, price: 5, audiences: ['friends'] },
        { cropId: 'carrot', quantity: 1, price: 0, audiences: ['friends'] },
        { cropId: 'carrot', quantity: 1, price: 10 ** 9, audiences: ['friends'] },
        { cropId: 'carrot', quantity: 1, price: 5, audiences: ['everyone'] },
        { cropId: 'carrot', quantity: 1000, price: 5, audiences: ['friends'] },
      ]) expect((await t.offer(a.agent, bad)).status).toBe(400);
      expect((await t.offer(a.agent, { cropId: 'gold', quantity: 1, price: 5, audiences: ['friends'] })).body.error.code).toBe('unknown_crop');
      // the seller is the session user, whatever the body says
      const spoof = await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 5, audiences: ['friends'], sellerId: b.user.id, userId: b.user.id });
      expect(spoof.status).toBe(201);
      expect(t.crops(b.user.id)).toBe(0);
      expect(((await t.browse(b.agent)).body.mine as unknown[])).toHaveLength(0);
      // another player cannot cancel my offer
      expect((await t.cancel(b.agent, spoof.body.id)).status).toBe(404);
    } finally { t.db.close(); }
  });

  it('caps open offers per player', async () => {
    const t = setup();
    try {
      const a = await t.player('m_pam');
      t.world([{ name: 'm_pam', id: a.user.id }]);
      t.give(a.user.id, 'carrot', 50);
      for (let i = 0; i < 10; i++) expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 1, audiences: ['friends'] })).status).toBe(201);
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 1, audiences: ['friends'] })).body.error.code).toBe('too_many_offers');
      expect(t.crops(a.user.id)).toBe(40);
    } finally { t.db.close(); }
  });

  it('fails safely and retryably when the clan/friends lookup is unavailable', async () => {
    const t = setup();
    try {
      const a = await t.player('m_quin');
      const b = await t.player('m_rae');
      t.world([{ name: 'm_quin', id: a.user.id, friends: ['m_rae'] }, { name: 'm_rae', id: b.user.id, friends: ['m_quin'] }]);
      t.give(a.user.id, 'carrot', 5); t.setCoins(b.user.id, 50);
      const id = (await t.offer(a.agent, { cropId: 'carrot', quantity: 5, price: 10, audiences: ['friends'] })).body.id as string;
      t.fail(true);
      for (const res of [await t.browse(b.agent), await t.buy(b.agent, id), await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 1, audiences: ['friends'] })]) {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('clan_verification_failed');
        expect(res.body.error.details).toEqual({ retryable: true });
      }
      expect(t.row(b.user.id).coins).toBe(50);
      expect(t.crops(b.user.id)).toBe(0);
      t.fail(false);
      expect((await t.buy(b.agent, id)).status).toBe(200);
    } finally { t.db.close(); }
  });

  it('does not count bought crops towards personal quests (only harvesting does)', async () => {
    const t = setup();
    try {
      const a = await t.player('m_sue');
      const b = await t.player('m_tom');
      t.world([{ name: 'm_sue', id: a.user.id, friends: ['m_tom'] }, { name: 'm_tom', id: b.user.id, friends: ['m_sue'] }]);
      t.give(a.user.id, 'carrot', 12); t.setCoins(b.user.id, 100);
      const id = (await t.offer(a.agent, { cropId: 'carrot', quantity: 12, price: 50, audiences: ['friends'] })).body.id as string;
      const res = await t.buy(b.agent, id);
      expect(res.body.state.inventory.crops.carrot).toBe(12);
      expect(res.body.state.personalQuests[0].objectives[0].progress).toBe(0);
    } finally { t.db.close(); }
  });

  it('can offer to clan, friends and everyone at once, with each viewer seeing it only where it applies', async () => {
    const t = setup();
    try {
      const seller = await t.player('m_uma');
      const mate = await t.player('m_vic');
      const friend = await t.player('m_wes');
      const stranger = await t.player('m_xia');
      t.world([
        { name: 'm_uma', id: seller.user.id, clan: 'X', friends: ['m_wes'] },
        { name: 'm_vic', id: mate.user.id, clan: 'X' },
        { name: 'm_wes', id: friend.user.id, friends: ['m_uma'] },
        { name: 'm_xia', id: stranger.user.id },
      ]);
      t.give(seller.user.id, 'carrot', 30);
      const both = (await t.offer(seller.agent, { cropId: 'carrot', quantity: 10, price: 90, audiences: ['clan', 'friends'] })).body.id as string;
      const everyone = (await t.offer(seller.agent, { cropId: 'carrot', quantity: 10, price: 90, audiences: ['all'] })).body.id as string;
      const ids = async (a: Agent) => ((await t.browse(a)).body.offers as { id: string }[]).map((o) => o.id).sort();
      expect(await ids(mate.agent)).toEqual([both, everyone].sort());
      expect(await ids(friend.agent)).toEqual([both, everyone].sort());
      expect(await ids(stranger.agent)).toEqual([everyone]); // strangers only see the public one
      const offerFor = async (a: Agent, id: string) => ((await t.browse(a)).body.offers as { id: string; relation: object; audiences: string[] }[]).find((o) => o.id === id)!;
      expect((await offerFor(mate.agent, both)).relation).toEqual({ clan: true, friend: false });
      expect((await offerFor(friend.agent, both)).relation).toEqual({ clan: false, friend: true });
      expect((await offerFor(stranger.agent, everyone)).relation).toEqual({ clan: false, friend: false });
      expect((await offerFor(mate.agent, both)).audiences).toEqual(['clan', 'friends']);
      t.setCoins(stranger.user.id, 200);
      expect((await t.buy(stranger.agent, both)).body.error.code).toBe('listing_unavailable');
      expect((await t.buy(stranger.agent, everyone)).status).toBe(200);
      expect(t.crops(stranger.user.id)).toBe(10);
      // an offer for the clan needs a clan, even when combined with other audiences
      t.world([{ name: 'm_uma', id: seller.user.id }]);
      expect((await t.offer(seller.agent, { cropId: 'carrot', quantity: 1, price: 5, audiences: ['clan', 'all'] })).body.error.code).toBe('no_clan');
      expect((await t.offer(seller.agent, { cropId: 'carrot', quantity: 1, price: 5, audiences: [] })).status).toBe(400);
      expect((await t.offer(seller.agent, { cropId: 'carrot', quantity: 1, price: 5, audiences: ['all', 'all'] })).status).toBe(400);
    } finally { t.db.close(); }
  });

  it('caps the asking price at the default price for the amount plus 100 coins', async () => {
    const t = setup();
    try {
      const a = await t.player('m_yan');
      t.world([{ name: 'm_yan', id: a.user.id }]);
      t.give(a.user.id, 'carrot', 40);
      const state = (await a.agent.get('/api/game/state')).body;
      expect(Object.fromEntries(state.catalog.map((c: { id: string; marketPrice: number }) => [c.id, c.marketPrice]))).toEqual({ carrot: 9, tomato: 28, potato: 16, pumpkin: 70 });
      // 10 carrots: default 90, so up to 190 is allowed and 191 is not
      const over = await t.offer(a.agent, { cropId: 'carrot', quantity: 10, price: 191, audiences: ['all'] });
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe('price_too_high');
      expect(over.body.error.details).toEqual({ maxPrice: 190 });
      expect(t.crops(a.user.id)).toBe(40); // nothing was taken
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 10, price: 190, audiences: ['all'] })).status).toBe(201);
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 10, price: 1, audiences: ['all'] })).status).toBe(201); // cheaper is fine
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 110, audiences: ['all'] })).status).toBe(400); // 9 + 100 = 109
      expect((await t.offer(a.agent, { cropId: 'carrot', quantity: 1, price: 109, audiences: ['all'] })).status).toBe(201);
    } finally { t.db.close(); }
  });
});
