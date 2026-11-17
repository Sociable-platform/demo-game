-- Kiosk marketplace: player-to-player offers for harvested crops, visible only to the seller's clan mates or friends.
-- Offered crops are held in escrow (taken out of the seller's inventory when the offer is created), so an offer can
-- never be oversold. Status changes only through conditional UPDATEs (active -> sold | cancelled), exactly once.

CREATE TABLE market_listings (
  id               TEXT PRIMARY KEY,                                   -- server-generated UUID
  seller_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_social_id TEXT NOT NULL,                                      -- the seller's Social service player ID (verified server-side)
  audience         TEXT NOT NULL CHECK (audience IN ('clan', 'friends')),
  clan_id          TEXT,                                               -- the seller's clan when the offer was made (clan offers)
  crop_id          TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  price            INTEGER NOT NULL CHECK (price > 0),                 -- total coins for the whole offer
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  buyer_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  closed_at        INTEGER,
  CHECK (audience <> 'clan' OR clan_id IS NOT NULL)
);
CREATE INDEX idx_market_listings_active ON market_listings(status, created_at);
CREATE INDEX idx_market_listings_seller ON market_listings(seller_id, status);
