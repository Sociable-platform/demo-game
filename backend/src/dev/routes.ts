import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { seedDemoAccounts } from './demo.js';
import type { DeleteAccount } from '../auth/delete-account.js';

/** Mounted only when config.enableDevRoutes is true (never in production). */
export function createDevRouter(db: Db, now: () => number, onUserCreated: (userId: string) => void, deleteAccount: DeleteAccount): Router {
  const router = Router();
  // POST /api/dev/demo-accounts            -> create demo_alice and demo_bob if missing
  // POST /api/dev/demo-accounts {reset:true} -> recreate both with a fresh farm
  router.post('/demo-accounts', async (req, res) => {
    const reset = req.body?.reset === true;
    res.json({ accounts: await seedDemoAccounts(db, now, onUserCreated, deleteAccount, { reset }) });
  });
  return router;
}
