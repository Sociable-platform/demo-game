import { describe, expect, it } from 'vitest';
import { arcPoint, easeOutBack, growthScale, harvestRewards, plotPosition, plotsSignature, progressAt } from './layout.js';
import { createFarmEvents } from './farmEvents.js';
import { webglAvailable } from './webgl.js';

describe('farm3d layout helpers', () => {
  it('maps plot indexes to a centred 3x3 grid in reading order', () => {
    expect(plotPosition(4)).toEqual([0, expect.any(Number), 0]);
    const [x0, , z0] = plotPosition(0);
    const [x8, , z8] = plotPosition(8);
    expect(x0).toBeLessThan(0);
    expect(z0).toBeLessThan(0);
    expect(x8).toBeCloseTo(-x0);
    expect(z8).toBeCloseTo(-z0);
    expect(plotPosition(1)[0]).toBeGreaterThan(plotPosition(0)[0]);
    expect(plotPosition(3)[2]).toBeGreaterThan(plotPosition(0)[2]);
  });

  it('derives progress from server timestamps and clamps it', () => {
    expect(progressAt(1000, 3000, 1000)).toBe(0);
    expect(progressAt(1000, 3000, 2000)).toBe(0.5);
    expect(progressAt(1000, 3000, 9000)).toBe(1);
    expect(progressAt(1000, 3000, 0)).toBe(0);
    expect(progressAt(1000, 1000, 1000)).toBe(1);
  });

  it('scales crops with real growth progress', () => {
    expect(growthScale(0)).toBeLessThan(growthScale(0.5));
    expect(growthScale(0.5)).toBeLessThan(growthScale(1));
    expect(growthScale(1)).toBe(1);
    expect(growthScale(5)).toBe(1);
  });

  it('eases to exactly 1 and overshoots on the way', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
  });

  it('arcs between two points and lifts in the middle', () => {
    expect(arcPoint([0, 0, 0], [4, 0, 4], 0)).toEqual([0, 0, 0]);
    expect(arcPoint([0, 0, 0], [4, 0, 4], 1)[0]).toBeCloseTo(4);
    expect(arcPoint([0, 0, 0], [4, 0, 4], 0.5)[1]).toBeGreaterThan(1);
  });

  it('builds harvest feedback only from the server result', () => {
    const res = { action: 'harvest', cropId: 'carrot', xpGained: 8, leveledUp: false };
    expect(harvestRewards(res, 'Carrot')).toEqual([
      { kind: 'xp', text: '+8 XP' },
      { kind: 'crop', text: '+1 Carrot' },
    ]);
    expect(harvestRewards({ ...res, leveledUp: true, newLevel: 2 }, 'Carrot').at(-1)).toEqual({ kind: 'level', text: 'Level 2!' });
    expect(harvestRewards({ action: 'plant' }, 'Carrot')).toEqual([]);
    expect(harvestRewards(null)).toEqual([]);
    expect(harvestRewards({ ...res, xpGained: undefined }, 'Carrot').some((i) => i.kind === 'xp')).toBe(false);
  });

  it('changes the plot signature only when scene-relevant data changes', () => {
    const plots = [{ index: 0, cropId: 'carrot', plantedAt: 1, readyAt: 2 }, { index: 1, cropId: null }];
    const a = plotsSignature(plots, () => 'growing');
    expect(plotsSignature(plots, () => 'growing')).toBe(a);
    expect(plotsSignature(plots, () => 'ready')).not.toBe(a);
  });
});

describe('farm events & webgl detection', () => {
  it('delivers events to subscribers until they unsubscribe', () => {
    const bus = createFarmEvents();
    const seen = [];
    const off = bus.subscribe((e) => seen.push(e));
    bus.emit({ a: 1 });
    off();
    bus.emit({ a: 2 });
    expect(seen).toEqual([{ a: 1 }]);
  });

  it('reports no WebGL without a document or context', () => {
    expect(webglAvailable(null)).toBe(false);
    expect(webglAvailable({ createElement: () => ({ getContext: () => null }) })).toBe(false);
    expect(webglAvailable({ createElement: () => { throw new Error('boom'); } })).toBe(false);
    expect(webglAvailable({ createElement: () => ({ getContext: () => ({}) }) })).toBe(true);
  });
});
