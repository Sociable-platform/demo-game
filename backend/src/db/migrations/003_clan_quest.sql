-- Village Festival: one shared quest per clan. Clan IDs come from the Clan Social service (verified server-side),
-- player IDs are the stable game user IDs. All timestamps are integer milliseconds since the Unix epoch.

CREATE TABLE clan_quests (
  clan_id      TEXT PRIMARY KEY,                        -- Social service clan UUID
  target       INTEGER NOT NULL CHECK (target > 0),
  progress     INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  CHECK (progress >= 0 AND progress <= target),
  CHECK ((completed_at IS NULL) = (progress < target))
);

CREATE TABLE clan_quest_contributions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clan_id         TEXT NOT NULL REFERENCES clan_quests(clan_id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  requested       INTEGER NOT NULL CHECK (requested > 0),
  quantity        INTEGER NOT NULL CHECK (quantity > 0), -- accepted amount (may be less than requested)
  created_at      INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key)                      -- a retried request can never deduct twice
);
CREATE INDEX idx_clan_quest_contrib_clan_user ON clan_quest_contributions(clan_id, user_id);

CREATE TABLE clan_quest_claims (
  clan_id    TEXT NOT NULL REFERENCES clan_quests(clan_id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coins      INTEGER NOT NULL CHECK (coins > 0),
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (clan_id, user_id)                          -- one reward per player per clan quest
);
