import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { MARKET, type createMarketService } from './service.js';

const offerSchema = z.object({
  cropId: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(MARKET.maxQuantity),
  price: z.number().int().min(1).max(MARKET.maxPrice),
  audiences: z.array(z.enum(MARKET.audiences)).min(1, 'Choose who can buy it.').max(3).refine((a) => new Set(a).size === a.length, 'Duplicate audience.'),
});
const idParam = z.string().uuid('Invalid offer.');

/** The seller/buyer is always `req.auth`; the browser names only an offer or the terms of its own new offer. */
export function createMarketRouter(market: ReturnType<typeof createMarketService>, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => { res.json(await market.browse(req.auth!)); });
  router.post('/listings', async (req, res) => { res.status(201).json(await market.create(req.auth!, offerSchema.parse(req.body))); });
  router.post('/listings/:id/cancel', (req, res) => { res.json(market.cancel(req.auth!.userId, idParam.parse(req.params.id))); });
  router.post('/listings/:id/buy', async (req, res) => { res.json(await market.buy(req.auth!, idParam.parse(req.params.id))); });
  return router;
}
