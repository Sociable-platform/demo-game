/** Static game rules. The backend is the only authority on these numbers; the client just displays them. */

export interface Crop {
  id: 'carrot' | 'tomato' | 'potato' | 'pumpkin';
  name: string;
  buyPrice: number; // coins to buy one of this crop in the shop (always above sellPrice, so buying and re-selling never profits)
  sellPrice: number; // coins when selling one harvested crop
  growthSeconds: number; // short on purpose, for live demos
  xpReward: number; // XP per harvest
  unlockLevel: number;
  marketPrice: number; // default Kiosk price per crop (the cap for an offer is this x amount + MARKET_PRICE_HEADROOM)
}

export const CROP_LIST: readonly Crop[] = [
  { id: 'carrot', name: 'Carrot', buyPrice: 22, sellPrice: 18, growthSeconds: 15, xpReward: 8, unlockLevel: 1, marketPrice: 9 },
  { id: 'tomato', name: 'Tomato', buyPrice: 66, sellPrice: 55, growthSeconds: 30, xpReward: 20, unlockLevel: 1, marketPrice: 28 },
  { id: 'potato', name: 'Potato', buyPrice: 38, sellPrice: 32, growthSeconds: 20, xpReward: 12, unlockLevel: 2, marketPrice: 16 },
  { id: 'pumpkin', name: 'Pumpkin', buyPrice: 168, sellPrice: 140, growthSeconds: 60, xpReward: 50, unlockLevel: 2, marketPrice: 70 },
];

export const CROPS: Readonly<Record<string, Crop>> = Object.fromEntries(CROP_LIST.map((c) => [c.id, c]));

/** How many coins above the default (market) price a Kiosk offer may ask in total. */
export const MARKET_PRICE_HEADROOM = 100;

export const GRID_ROWS = 3;
export const GRID_COLS = 3;
export const GRID_SIZE = GRID_ROWS * GRID_COLS;

export const STARTING_COINS = 50;
/**
 * You plant a crop to grow more of it (like a carrot in Minecraft): there are no separate seeds. A player is given this
 * many of every crop the moment it unlocks: the level 1 crops at sign-up, the others on reaching their unlock level.
 */
export const UNLOCK_GIFT = 3;
export const MAX_BUY_QUANTITY = 99;

/** One harvest yields a random whole number of crops in this range (inclusive). XP is still per harvest. */
export const HARVEST_YIELD = { min: 1, max: 5 } as const;

/** Total XP needed to reach a level: L1=0, L2=50, L3=150, L4=300 ... */
export const xpForLevel = (level: number) => 25 * level * (level - 1);

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const levelStartXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  return { level, levelStartXp, nextLevelXp, xpIntoLevel: xp - levelStartXp, xpForNextLevel: nextLevelXp - levelStartXp };
}
