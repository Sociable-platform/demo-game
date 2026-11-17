// Headless smoke test: mounts the real 3D scene with R3F's test renderer (no GPU needed), then drives frames,
// pointer events and the server-confirmed plant/harvest effects.
import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import FarmScene from './FarmScene.jsx';
import { createFarmEvents } from './farmEvents.js';

const NOW = 1_000_000;
const plot = (index, cropId = null, grown = 0, total = 15000) => ({
  index, cropId, plantedAt: cropId ? NOW - grown : null, readyAt: cropId ? NOW - grown + total : null,
});
const phaseOf = (p) => (!p.cropId ? 'empty' : NOW >= p.readyAt ? 'ready' : 'growing');
const toViews = (plots) => plots.map((p) => ({ index: p.index, cropId: p.cropId, plantedAt: p.plantedAt, readyAt: p.readyAt, phase: phaseOf(p) }));

function setup(plots, { busy = false } = {}) {
  const events = createFarmEvents();
  const onSelect = vi.fn();
  const onFloat = vi.fn();
  const props = {
    views: toViews(plots), events, onSelect, onFloat,
    busyRef: { current: busy },
    clockRef: { current: { now: NOW, at: performance.now() } },
    cropNameRef: { current: (id) => ({ carrot: 'Carrot', tomato: 'Tomato', pumpkin: 'Pumpkin' })[id] },
  };
  return { props, events, onSelect, onFloat };
}

const nine = (fill = {}) => Array.from({ length: 9 }, (_, i) => fill[i] ?? plot(i));
const all = (r) => { const out = []; r.scene.instance.traverse((o) => out.push(o)); return out; };

describe('FarmScene (headless)', () => {
  it('mounts all scenery, runs animation frames, and unmounts cleanly', async () => {
    const { props } = setup(nine({ 0: plot(0, 'carrot', 2000), 1: plot(1, 'tomato', 20000, 30000), 2: plot(2, 'pumpkin', 60000, 60000) }));
    const r = await ReactThreeTestRenderer.create(<FarmScene {...props} />, { width: 800, height: 600 });
    await r.advanceFrames(5, 0.05);
    const meshes = all(r).filter((o) => o.isMesh || o.isInstancedMesh);
    expect(meshes.length).toBeGreaterThan(60);
    expect(meshes.length).toBeLessThan(260); // modest draw-call budget
    await r.unmount();
  });

  it('grows the crop with real progress', async () => {
    const early = setup(nine({ 4: plot(4, 'carrot', 1500) }));
    const late = setup(nine({ 4: plot(4, 'carrot', 13500) }));
    const scaleOf = async (s) => {
      const r = await ReactThreeTestRenderer.create(<FarmScene {...s.props} />, { width: 800, height: 600 });
      await r.advanceFrames(3, 0.02);
      const crop = all(r).find((o) => o.isGroup && Math.abs(o.parent.position.x) < 0.01 && Math.abs(o.parent.position.y - 0.53) < 0.01 && o.children.some((c) => c.geometry && c.material?.color?.getHexString?.() === '5faa43'));
      const v = crop.scale.x;
      await r.unmount();
      return v;
    };
    expect(await scaleOf(early)).toBeLessThan(await scaleOf(late));
  });

  it('walks to a clicked plot before calling the handler, and ignores clicks while an action is pending', async () => {
    for (const busy of [false, true]) {
      const { props, onSelect } = setup(nine(), { busy });
      const r = await ReactThreeTestRenderer.create(<FarmScene {...props} />, { width: 800, height: 600 });
      const plots = r.scene.findAll((o) => o.type === 'Group' && typeof o.props.onClick === 'function');
      expect(plots.length).toBe(9);
      await r.fireEvent(plots[4], 'click');
      expect(onSelect).not.toHaveBeenCalled(); // the farmer must walk beside the plot first
      await r.advanceFrames(400, 0.05); // ...and only then is the existing handler called, once
      expect(onSelect).toHaveBeenCalledTimes(busy ? 0 : 1);
      if (!busy) expect(onSelect).toHaveBeenCalledWith(4);
      await r.unmount();
    }
  });

  it('reacts only to server-confirmed results and reports real harvest rewards', async () => {
    const { props, events, onFloat } = setup(nine({ 0: plot(0, 'carrot', 15000) }));
    const r = await ReactThreeTestRenderer.create(<FarmScene {...props} />, { width: 800, height: 600 });
    events.emit({ action: 'plant', plotIndex: 3, cropId: 'carrot' });
    expect(onFloat).not.toHaveBeenCalled();
    events.emit({ action: 'harvest', plotIndex: 0, cropId: 'carrot', xpGained: 8, leveledUp: false });
    expect(onFloat).toHaveBeenCalledTimes(1);
    const [items] = onFloat.mock.calls[0];
    expect(items.map((i) => i.text)).toEqual(['+8 XP', '+1 Carrot']);
    await r.advanceFrames(60, 0.02); // the crop flies to the basket and lands without errors
    events.emit(null);
    events.emit({ action: 'buy' });
    await r.unmount();
  });
});
