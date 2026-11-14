-- Match JavaScript String.trim, with case-insensitive ASCII username comparison.
-- Create the index first: conflicting legacy accounts abort the whole migration
-- before any display names are trimmed. Account IDs and related data stay intact.
CREATE UNIQUE INDEX idx_users_username_normalized ON users (
  trim(username, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)) COLLATE NOCASE
);

UPDATE users SET username = trim(username, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279));
