import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { createPersonalQuestService } from './service.js';

const idParam = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Invalid quest.');

/** Progress arrives inside the game state; the only action is a claim by quest id (no amounts, level or player). */
export function createPersonalQuestRouter(quests: ReturnType<typeof createPersonalQuestService>, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);
  router.post('/:id/claim', (req, res) => { res.json(quests.claim(req.auth!.userId, idParam.parse(req.params.id))); });
  return router;
}
