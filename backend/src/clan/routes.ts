import { Router, type RequestHandler } from 'express';
import type { Config } from '../config.js';
import { issuePlayerToken } from './player-token.js';

// /api/community/token and its existing /api/clan/token alias share this bridge.
export function createClanRouter(config: Config, requireAuth: RequestHandler, assertTokenAllowed: (userId: string) => void) {
  const router = Router();
  router.post('/token', requireAuth, async (req, res) => {
    const player = req.auth!;
    assertTokenAllowed(player.userId);
    const issued = await issuePlayerToken(config, player);
    // Deletion may begin/finish while Platform responds. Never hand its token
    // back to an old widget after the account has gone or deletion has begun.
    assertTokenAllowed(player.userId);
    res.json(issued);
  });
  return router;
}
