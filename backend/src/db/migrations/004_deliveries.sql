-- Courier deliveries. The server decides eligibility and the reward when it creates a delivery; the client only
-- ever refers to a delivery by its ID. Timestamps are integer milliseconds since the Unix epoch.

CREATE TABLE deliveries (
  id            TEXT PRIMARY KEY,                          -- server-generated UUID
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_kind   TEXT NOT NULL CHECK (reward_kind IN ('coins', 'carrots')),
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  created_at    INTEGER NOT NULL,
  claimed_at    INTEGER                                    -- NULL while pending; set once, in the reward's transaction
);
-- At most one pending delivery per player, even with parallel tabs or requests.
CREATE UNIQUE INDEX idx_deliveries_one_pending ON deliveries(user_id) WHERE claimed_at IS NULL;
CREATE INDEX idx_deliveries_user_claimed ON deliveries(user_id, claimed_at);
