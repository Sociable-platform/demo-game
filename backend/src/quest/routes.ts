import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { QUEST, type createQuestService } from './service.js';

const contributeSchema = z.object({
  quantity: z.number().int().refine((n) => QUEST.contributeAmounts.includes(n), 'You can contribute 1 or 5 carrots at a time.'),
  idempotencyKey: z.string().min(8, 'Missing request key.').max(80).regex(/^[A-Za-z0-9_-]+$/, 'Invalid request key.'),
});

/**
 * Village Festival endpoints. The player is always `req.auth` (the game session). The browser supplies only the
 * amount and a retry key; the clan, progress, inventory and reward are all decided on the server.
 */
export function createQuestRouter(quest: ReturnType<typeof createQuestService>, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => { res.json(await quest.status(req.auth!)); });
  router.post('/contribute', async (req, res) => {
    const body = contributeSchema.parse(req.body);
    res.json(await quest.contribute(req.auth!, body.quantity, body.idempotencyKey));
  });
  router.post('/claim', async (req, res) => { res.json(await quest.claim(req.auth!)); });
  return router;
}
