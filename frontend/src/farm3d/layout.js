// Pure layout / growth / reward helpers for the 3D farm. No three.js imports, so they are unit-testable in Node.

export const PLOT_SPACING = 3.2; // wide aisles so the farmer can reach every plot
export const PLOT_SIZE = 1.75;
export const SOIL_TOP_Y = 0.53; // world height of the soil surface

/** Plot index -> world position, same reading order as the 2D grid (row-major). */
export function plotPosition(index, cols = 3, rows = 3) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return [(col - (cols - 1) / 2) * PLOT_SPACING, SOIL_TOP_Y, (row - (rows - 1) / 2) * PLOT_SPACING];
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Growth progress 0..1 from the authoritative server timestamps (server-clock adjusted `now`). */
export function progressAt(plantedAt, readyAt, now) {
  const total = readyAt - plantedAt;
  if (!(total > 0)) return 1;
  return clamp01((now - plantedAt) / total);
}

/** Crop size multiplier: a small sprout right after planting, full size when ripe. */
export function growthScale(progress) {
  return 0.28 + 0.72 * clamp01(progress);
}

/** Overshooting ease used for the "pop in" after a confirmed plant. t is 0..1. */
export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Quadratic bezier-ish arc used by the crop-to-basket effect. */
export function arcPoint(from, to, t, lift = 2.2) {
  const k = clamp01(t);
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k + Math.sin(Math.PI * k) * lift,
    from[2] + (to[2] - from[2]) * k,
  ];
}

/**
 * Floating feedback items for a confirmed harvest. Only values the server actually returned are shown,
 * so nothing is displayed for rewards that were not granted.
 */
export function harvestRewards(result, cropName) {
  if (!result || result.action !== 'harvest') return [];
  const items = [];
  if (Number.isFinite(result.xpGained) && result.xpGained > 0) items.push({ kind: 'xp', text: `+${result.xpGained} XP` });
  const amount = Number.isInteger(result.yield) && result.yield > 0 ? result.yield : 1; // crops this harvest actually gave (server roll)
  items.push({ kind: 'crop', text: `+${amount} ${cropName ?? result.cropId}` });
  if (result.leveledUp) items.push({ kind: 'level', text: `Level ${result.newLevel}!` });
  return items;
}

/** Signature that changes only when something the 3D scene must re-render for changes. */
export function plotsSignature(plots, phaseOf) {
  return plots.map((p) => `${p.index}:${p.cropId ?? '-'}:${p.plantedAt ?? 0}:${p.readyAt ?? 0}:${phaseOf(p)}`).join('|');
}
