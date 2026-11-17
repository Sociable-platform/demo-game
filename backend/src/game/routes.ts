import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { MAX_BUY_QUANTITY } from './catalog.js';
import type { GameService } from './service.js';

const cropId = z.string().min(1).max(32);
const plotParam = z.coerce.number().int();
const quantity = z.number().int('Quantity must be a whole number.').min(1, 'Quantity must be at least 1.');

const buySchema = z.object({ cropId, quantity: quantity.max(MAX_BUY_QUANTITY, `You can buy at most ${MAX_BUY_QUANTITY} at a time.`) });
const plantSchema = z.object({ cropId });
const sellSchema = z.object({ cropId, quantity: z.union([quantity.max(100000), z.literal('all')]) });

/** All routes require authentication; the player is always `req.auth.userId`, never client input. */
export function createGameRouter(game: GameService, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/state', (req, res) => {
    res.json(game.getState(req.auth!.userId));
  });

  router.post('/shop/buy', (req, res) => {
    const body = buySchema.parse(req.body);
    res.json(game.buyCrops(req.auth!.userId, body.cropId, body.quantity));
  });

  router.post('/plots/:plotIndex/plant', (req, res) => {
    const plotIndex = plotParam.parse(req.params.plotIndex);
    const body = plantSchema.parse(req.body);
    res.json(game.plant(req.auth!.userId, plotIndex, body.cropId));
  });

  router.post('/plots/:plotIndex/harvest', (req, res) => {
    const plotIndex = plotParam.parse(req.params.plotIndex);
    res.json(game.harvest(req.auth!.userId, plotIndex));
  });

  router.post('/sell', (req, res) => {
    const body = sellSchema.parse(req.body);
    res.json(game.sell(req.auth!.userId, body.cropId, body.quantity));
  });

  return router;
}
