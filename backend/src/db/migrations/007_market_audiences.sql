-- An offer can now be shown to the seller's clan, friends and/or everyone at once (was: exactly one of clan/friends).
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt; existing offers keep their audience.

CREATE TABLE market_listings_new (
  id               TEXT PRIMARY KEY,
  seller_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_social_id TEXT NOT NULL,
  to_clan          INTEGER NOT NULL DEFAULT 0 CHECK (to_clan IN (0, 1)),
  to_friends       INTEGER NOT NULL DEFAULT 0 CHECK (to_friends IN (0, 1)),
  to_all           INTEGER NOT NULL DEFAULT 0 CHECK (to_all IN (0, 1)),
  clan_id          TEXT,
  crop_id          TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  price            INTEGER NOT NULL CHECK (price > 0),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  buyer_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  closed_at        INTEGER,
  CHECK (to_clan + to_friends + to_all >= 1),
  CHECK (to_clan = 0 OR clan_id IS NOT NULL)
);
INSERT INTO market_listings_new (id, seller_id, seller_social_id, to_clan, to_friends, to_all, clan_id, crop_id, quantity, price, status, buyer_id, created_at, closed_at)
  SELECT id, seller_id, seller_social_id, CASE WHEN audience = 'clan' THEN 1 ELSE 0 END, CASE WHEN audience = 'friends' THEN 1 ELSE 0 END, 0,
         clan_id, crop_id, quantity, price, status, buyer_id, created_at, closed_at
    FROM market_listings;
DROP TABLE market_listings;
ALTER TABLE market_listings_new RENAME TO market_listings;
CREATE INDEX idx_market_listings_active ON market_listings(status, created_at);
CREATE INDEX idx_market_listings_seller ON market_listings(seller_id, status);
