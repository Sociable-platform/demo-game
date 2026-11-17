import type { Db } from '../db/connection.js';
import { createUser } from '../auth/routes.js';
import { hashPassword } from '../auth/passwords.js';
import type { DeleteAccount } from '../auth/delete-account.js';
import { usernameSql } from '../auth/usernames.js';

/**
 * DEVELOPMENT ONLY. These are public, throwaway credentials for demos. The HTTP route that uses this is
 * never mounted in production (see config.enableDevRoutes), and the CLI refuses to run in production.
 */
export const DEMO_ACCOUNTS = [
  { username: 'demo_alice', password: 'alice-demo-pass' },
  { username: 'demo_bob', password: 'bob-demo-pass' },
] as const;

export async function seedDemoAccounts(
  db: Db,
  now: () => number,
  onUserCreated: (userId: string) => void,
  deleteAccount: DeleteAccount,
  opts: { reset?: boolean } = {},
) {
  const results: { username: string; password: string; created: boolean }[] = [];
  for (const acct of DEMO_ACCOUNTS) {
    const existing = db.prepare(`SELECT id FROM users WHERE ${usernameSql} = ?`).get(acct.username) as { id: string } | undefined;
    if (existing && opts.reset) {
      await deleteAccount(existing.id);
    }
    if (existing && !opts.reset) {
      results.push({ ...acct, created: false });
      continue;
    }
    createUser(db, now(), acct.username, await hashPassword(acct.password), onUserCreated);
    results.push({ ...acct, created: true });
  }
  return results;
}
