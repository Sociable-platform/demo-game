import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import { AppError } from '../http/errors.js';
import { CROPS, MARKET_PRICE_HEADROOM } from '../game/catalog.js';
import type { GameService } from '../game/service.js';
import type { SessionUser } from '../auth/sessions.js';
import type { Circle, CircleLookup } from './social.js';

export const MARKET = { maxQuantity: 999, maxPrice: 100_000, maxActiveOffers: 10, audiences: ['clan', 'friends', 'all'] } as const;
export type Audience = (typeof MARKET.audiences)[number];

interface ListingRow {
  id: string; seller_id: string; seller_social_id: string; to_clan: 0 | 1; to_friends: 0 | 1; to_all: 0 | 1; clan_id: string | null;
  crop_id: string; quantity: number; price: number; status: 'active' | 'sold' | 'cancelled'; created_at: number; seller_name?: string;
}
type Player = Pick<SessionUser, 'userId' | 'username'>;

const unavailable = () => new AppError(409, 'listing_unavailable', 'That offer is no longer available.');

/**
 * Can `c` (the viewer) see this offer, and how is the seller related to them? An offer can target the seller's clan
 * (same clan, seller still a member), the seller's friends, and/or everyone. `relation` always describes the real
 * relationship (so a friend's public offer is still labelled "Friend").
 */
function relationTo(l: ListingRow, c: Circle): { clan: boolean; friend: boolean } | null {
  if (l.seller_social_id === c.socialId) return null;
  const clanMate = c.clanId !== null && c.clanMemberIds.has(l.seller_social_id);
  const friend = c.friendIds.has(l.seller_social_id);
  const byClan = l.to_clan === 1 && clanMate && l.clan_id === c.clanId;
  const byFriend = l.to_friends === 1 && friend;
  if (!(byClan || byFriend || l.to_all === 1)) return null;
  return { clan: clanMate, friend };
}

const audiencesOf = (l: ListingRow): Audience[] => [...(l.to_clan ? ['clan' as const] : []), ...(l.to_friends ? ['friends' as const] : []), ...(l.to_all ? ['all' as const] : [])];
const view = (l: ListingRow) => ({ id: l.id, audiences: audiencesOf(l), cropId: l.crop_id, quantity: l.quantity, price: l.price, createdAt: l.created_at });

/**
 * The Kiosk. Identity is always the authenticated user; the clan/friend relationship is verified on the server
 * through the Social service at browse and buy time. Offers hold the crops in escrow; buying moves coins and crops in
 * ONE BEGIN IMMEDIATE transaction whose conditional UPDATEs match only a still-active offer and a buyer who can pay.
 */
export function createMarketService(db: Db, now: () => number, game: GameService, circles: CircleLookup) {
  const tx = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const wrapped = db.transaction(fn);
    return (...args: A): R => wrapped.immediate(...args);
  };
  const addCrop = (userId: string, cropId: string, qty: number) =>
    db.prepare(`INSERT INTO inventory (user_id, kind, crop_id, quantity) VALUES (?, 'crop', ?, ?)
                ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = quantity + excluded.quantity`).run(userId, cropId, qty);

  const insertOffer = tx((player: Player, circle: Circle, o: { cropId: string; quantity: number; price: number; audiences: readonly Audience[] }) => {
    const active = (db.prepare("SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ? AND status = 'active'").get(player.userId) as { n: number }).n;
    if (active >= MARKET.maxActiveOffers) throw new AppError(409, 'too_many_offers', `You can have at most ${MARKET.maxActiveOffers} offers at a time. Cancel one first.`);
    const taken = db.prepare("UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND kind = 'crop' AND crop_id = ? AND quantity >= ?")
      .run(o.quantity, player.userId, o.cropId, o.quantity);
    if (taken.changes !== 1) throw new AppError(409, 'insufficient_crops', `You don't have ${o.quantity} ${CROPS[o.cropId]!.name} to offer.`);
    const id = randomUUID();
    const t = now();
    const toClan = o.audiences.includes('clan') ? 1 : 0;
    db.prepare(`INSERT INTO market_listings (id, seller_id, seller_social_id, to_clan, to_friends, to_all, clan_id, crop_id, quantity, price, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, player.userId, circle.socialId, toClan, o.audiences.includes('friends') ? 1 : 0, o.audiences.includes('all') ? 1 : 0,
        toClan ? circle.clanId : null, o.cropId, o.quantity, o.price, t);
    db.prepare('UPDATE players SET updated_at = ? WHERE user_id = ?').run(t, player.userId);
    return id;
  });

  const cancelOffer = tx((userId: string, listingId: string) => {
    const row = db.prepare('SELECT crop_id, quantity FROM market_listings WHERE id = ? AND seller_id = ?').get(listingId, userId) as { crop_id: string; quantity: number } | undefined;
    if (!row) throw new AppError(404, 'listing_not_found', 'That offer does not exist.');
    const t = now();
    const closed = db.prepare("UPDATE market_listings SET status = 'cancelled', closed_at = ? WHERE id = ? AND seller_id = ? AND status = 'active'").run(t, listingId, userId);
    if (closed.changes !== 1) return false; // already sold or cancelled: nothing is returned twice
    addCrop(userId, row.crop_id, row.quantity);
    db.prepare('UPDATE players SET updated_at = ? WHERE user_id = ?').run(t, userId);
    return true;
  });

  const buyOffer = tx((buyer: Player, circle: Circle, listingId: string) => {
    const l = db.prepare(
      `SELECT m.*, u.username AS seller_name FROM market_listings m JOIN users u ON u.id = m.seller_id WHERE m.id = ?`,
    ).get(listingId) as ListingRow | undefined;
    if (!l || l.status !== 'active') throw unavailable();
    if (l.seller_id === buyer.userId) throw new AppError(409, 'own_listing', "You can't buy your own offer.");
    if (!relationTo(l, circle)) throw unavailable(); // not your clan / not a friend / not public: same as a missing offer
    const t = now();
    const sold = db.prepare("UPDATE market_listings SET status = 'sold', buyer_id = ?, closed_at = ? WHERE id = ? AND status = 'active'").run(buyer.userId, t, listingId);
    if (sold.changes !== 1) throw unavailable();
    const paid = db.prepare('UPDATE players SET coins = coins - ?, updated_at = ? WHERE user_id = ? AND coins >= ?').run(l.price, t, buyer.userId, l.price);
    if (paid.changes !== 1) throw new AppError(409, 'insufficient_coins', `You need ${l.price} coins for that, but you don't have enough.`);
    const credited = db.prepare('UPDATE players SET coins = coins + ?, updated_at = ? WHERE user_id = ?').run(l.price, t, l.seller_id);
    if (credited.changes !== 1) throw new AppError(409, 'listing_unavailable', 'That offer is no longer available.');
    addCrop(buyer.userId, l.crop_id, l.quantity);
    return { cropId: l.crop_id, quantity: l.quantity, price: l.price, seller: l.seller_name! };
  });

  return {
    /** Offers the player can buy (from clan mates and friends), the player's own open offers, and their circle summary. */
    async browse(player: Player) {
      const circle = await circles(player);
      const rows = db.prepare(
        `SELECT m.*, u.username AS seller_name FROM market_listings m JOIN users u ON u.id = m.seller_id
          WHERE m.status = 'active' AND m.seller_id <> ? ORDER BY m.created_at DESC LIMIT 500`,
      ).all(player.userId) as ListingRow[];
      const mine = db.prepare("SELECT * FROM market_listings WHERE seller_id = ? AND status = 'active' ORDER BY created_at DESC").all(player.userId) as ListingRow[];
      return {
        offers: rows.flatMap((l) => {
          const relation = relationTo(l, circle);
          return relation ? [{ ...view(l), seller: l.seller_name!, relation }] : [];
        }),
        mine: mine.map(view),
        circle: { clan: circle.clanId ? { name: circle.clanName } : null, friends: circle.friendIds.size },
        serverTime: now(),
      };
    },

    async create(player: Player, offer: { cropId: string; quantity: number; price: number; audiences: readonly Audience[] }) {
      const crop = CROPS[offer.cropId];
      if (!crop) throw new AppError(400, 'unknown_crop', `Unknown crop "${offer.cropId}".`);
      const maxPrice = crop.marketPrice * offer.quantity + MARKET_PRICE_HEADROOM; // default price for the amount, plus 100
      if (offer.price > maxPrice) {
        throw new AppError(400, 'price_too_high', `That price is too high. The most you can ask for ${offer.quantity} ${crop.name}${offer.quantity === 1 ? '' : 's'} is ${maxPrice} coins.`, { maxPrice });
      }
      const circle = await circles(player);
      if (offer.audiences.includes('clan') && !circle.clanId) throw new AppError(409, 'no_clan', 'Join a clan to sell to your clan.');
      const id = insertOffer(player, circle, offer);
      return { action: 'market_list', id, state: game.getState(player.userId) };
    },

    cancel(userId: string, listingId: string) {
      const cancelled = cancelOffer(userId, listingId);
      return { action: 'market_cancel', cancelled, state: game.getState(userId) };
    },

    async buy(player: Player, listingId: string) {
      const circle = await circles(player);
      const bought = buyOffer(player, circle, listingId);
      return { action: 'market_buy', ...bought, state: game.getState(player.userId) };
    },
  };
}
