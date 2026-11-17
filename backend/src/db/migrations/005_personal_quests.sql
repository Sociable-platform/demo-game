-- Personal level quests (definitions live in backend/src/personal-quests/config.ts, keyed by stable quest IDs).
-- A row in personal_quests means the quest is ACTIVE for that player (activated_at); progress only ever counts
-- harvests made after activation. claimed_at is set exactly once, in the same transaction as the reward.

CREATE TABLE personal_quests (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id     TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  claimed_at   INTEGER,
  PRIMARY KEY (user_id, quest_id)
);

-- One row per objective (levels 9 and 10 have two crops).
CREATE TABLE personal_quest_progress (
  user_id  TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  crop_id  TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, quest_id, crop_id),
  FOREIGN KEY (user_id, quest_id) REFERENCES personal_quests(user_id, quest_id) ON DELETE CASCADE
);
