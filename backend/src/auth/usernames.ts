import type { Db } from '../db/connection.js';

// ECMAScript String.trim whitespace, including Unicode spaces and line breaks.
// Keep this expression in sync with migration 002. Usernames themselves remain
// ASCII letters/digits/underscores, so SQLite NOCASE matches JS case folding.
export const usernameSql = 'trim(username, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)) COLLATE NOCASE';

export interface UsernameAccount { id: string; username: string }
export interface UsernameConflict { normalized: string; accounts: UsernameAccount[] }

export function usernameConflicts(db: Db): UsernameConflict[] {
  const groups = new Map<string, UsernameAccount[]>();
  const accounts = db.prepare('SELECT id, username FROM users ORDER BY created_at, id').all() as UsernameAccount[];
  for (const account of accounts) {
    const key = account.username.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  return [...groups].filter(([, accounts]) => accounts.length > 1)
    .map(([normalized, accounts]) => ({ normalized, accounts }));
}

export class UsernameConflictError extends Error {
  constructor(readonly conflicts: UsernameConflict[]) {
    super(`Username migration blocked: ${JSON.stringify(conflicts)}. Rename conflicting usernames by account ID before retrying; see README "Existing username conflicts". No accounts or progress were deleted.`);
    this.name = 'UsernameConflictError';
  }
}
