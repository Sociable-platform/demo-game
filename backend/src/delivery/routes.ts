import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { createDeliveryService } from './service.js';

const idParam = z.string().uuid('Invalid delivery.');

/** The player is always `req.auth`; the browser only names a delivery, never a reward, amount or time. */
export function createDeliveryRouter(delivery: ReturnType<typeof createDeliveryService>, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', (req, res) => { res.json(delivery.status(req.auth!.userId)); });
  router.post('/:id/claim', (req, res) => { res.json(delivery.claim(req.auth!.userId, idParam.parse(req.params.id))); });
  return router;
}
