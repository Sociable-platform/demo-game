import { CROPS } from '../game/catalog.js';

/**
 * Personal level quests: the single backend-owned definition list. IDs are stable (stored in SQLite); the order is
 * the progression order. Levels 1 and 2 are product-specified; levels 3-10 are initial, configurable defaults.
 * XP and coin rewards are paid on claim; claiming never consumes harvested inventory.
 */
export interface PersonalQuestDef {
  id: string;
  requiredLevel: number;
  objectives: readonly { cropId: string; target: number }[];
  rewardXp: number;
  rewardCoins: number;
}

export const PERSONAL_QUESTS: readonly PersonalQuestDef[] = [
  { id: 'l01-carrots', requiredLevel: 1, objectives: [{ cropId: 'carrot', target: 10 }], rewardXp: 100, rewardCoins: 50 },
  { id: 'l02-potatoes', requiredLevel: 2, objectives: [{ cropId: 'potato', target: 50 }], rewardXp: 400, rewardCoins: 200 },
  { id: 'l03-tomatoes', requiredLevel: 3, objectives: [{ cropId: 'tomato', target: 30 }], rewardXp: 600, rewardCoins: 300 },
  { id: 'l04-pumpkins', requiredLevel: 4, objectives: [{ cropId: 'pumpkin', target: 20 }], rewardXp: 800, rewardCoins: 400 },
  { id: 'l05-carrots', requiredLevel: 5, objectives: [{ cropId: 'carrot', target: 100 }], rewardXp: 1000, rewardCoins: 500 },
  { id: 'l06-potatoes', requiredLevel: 6, objectives: [{ cropId: 'potato', target: 100 }], rewardXp: 1200, rewardCoins: 600 },
  { id: 'l07-tomatoes', requiredLevel: 7, objectives: [{ cropId: 'tomato', target: 75 }], rewardXp: 1500, rewardCoins: 750 },
  { id: 'l08-pumpkins', requiredLevel: 8, objectives: [{ cropId: 'pumpkin', target: 50 }], rewardXp: 1800, rewardCoins: 900 },
  {
    id: 'l09-carrots-tomatoes', requiredLevel: 9, rewardXp: 2200, rewardCoins: 1100,
    objectives: [{ cropId: 'carrot', target: 100 }, { cropId: 'tomato', target: 50 }],
  },
  {
    id: 'l10-potatoes-pumpkins', requiredLevel: 10, rewardXp: 3000, rewardCoins: 1500,
    objectives: [{ cropId: 'potato', target: 100 }, { cropId: 'pumpkin', target: 75 }],
  },
];

for (const q of PERSONAL_QUESTS) for (const o of q.objectives) if (!CROPS[o.cropId]) throw new Error(`Quest ${q.id}: unknown crop ${o.cropId}`);
