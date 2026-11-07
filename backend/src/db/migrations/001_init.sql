-- Harvest Village initial schema. All timestamps are integer milliseconds since the Unix epoch.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,                       -- server-generated UUID, stable for life
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,                          -- scrypt hash, never plaintext
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                          -- sha256 of the random cookie token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Game profile: coins and progression (level is derived from xp).
CREATE TABLE players (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins      INTEGER NOT NULL CHECK (coins >= 0),
  xp         INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE farm_plots (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plot_index INTEGER NOT NULL CHECK (plot_index >= 0),
  crop_id    TEXT,
  planted_at INTEGER,
  ready_at   INTEGER,
  PRIMARY KEY (user_id, plot_index),
  CHECK (
    (crop_id IS NULL AND planted_at IS NULL AND ready_at IS NULL) OR
    (crop_id IS NOT NULL AND planted_at IS NOT NULL AND ready_at IS NOT NULL AND ready_at >= planted_at)
  )
);

CREATE TABLE inventory (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('seed', 'crop')),
  crop_id  TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (user_id, kind, crop_id)
);
