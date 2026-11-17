import { describe, expect, it } from 'vitest';
import { clockOffset, formatSeconds, nextHint, plotPhase, plotProgress, remainingSeconds } from './plotState.js';

const plot = { cropId: 'carrot', plantedAt: 1000, readyAt: 16000 };
const empty = { cropId: null, plantedAt: null, readyAt: null };

describe('plot phases', () => {
  it('maps timestamps to empty / planted / growing / ready', () => {
    expect(plotPhase(empty, 5000)).toBe('empty');
    expect(plotPhase(plot, 1000)).toBe('planted');
    expect(plotPhase(plot, 3000)).toBe('planted'); // 13% in
    expect(plotPhase(plot, 8000)).toBe('growing'); // 47% in
    expect(plotPhase(plot, 15999)).toBe('growing');
    expect(plotPhase(plot, 16000)).toBe('ready');
    expect(plotPhase(plot, 99999)).toBe('ready');
  });
  it('computes progress and remaining time from server timestamps', () => {
    expect(plotProgress(plot, 8500)).toBeCloseTo(0.5);
    expect(plotProgress(plot, -5)).toBe(0);
    expect(plotProgress(plot, 1e9)).toBe(1);
    expect(plotProgress(empty, 5000)).toBe(0);
    expect(remainingSeconds(plot, 1000)).toBe(15);
    expect(remainingSeconds(plot, 15001)).toBe(1);
    expect(remainingSeconds(plot, 20000)).toBe(0);
  });
  it('formats durations and clock offsets', () => {
    expect(formatSeconds(9)).toBe('9s');
    expect(formatSeconds(60)).toBe('1m');
    expect(formatSeconds(75)).toBe('1m 15s');
    expect(clockOffset(10_000, 4_000)).toBe(6_000);
  });
});

describe('nextHint', () => {
  const base = (over = {}) => ({
    farm: { plots: [empty, empty] },
    inventory: { crops: { carrot: 1 } },
    ...over,
  });
  it('guides the player through the loop', () => {
    expect(nextHint(base(), 0)).toMatch(/Pick a crop/);
    expect(nextHint(base({ farm: { plots: [plot, empty] } }), 5000)).toMatch(/Pick a crop/);
    expect(nextHint(base({ inventory: { crops: { carrot: 0 } }, farm: { plots: [plot] } }), 5000)).toMatch(/growing/);
    expect(nextHint(base({ farm: { plots: [plot] } }), 20000)).toMatch(/ripe/);
    expect(nextHint(base({ inventory: { crops: { carrot: 2 } }, farm: { plots: [plot] } }), 5000)).toMatch(/Barn/);
    expect(nextHint(base({ inventory: { crops: { carrot: 0 } } }), 0)).toMatch(/Shop/);
  });
});
