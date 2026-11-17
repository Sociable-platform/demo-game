import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Part } from './assets.jsx';
import { arcPoint } from './layout.js';
import { BASKET_POS } from './world.js';

const FLY_MS = 950;
const SLOTS = 5;

/** The basket harvested crops fly into. It hops when a crop lands (driven by `landRef`, no React state). */
export function Basket({ landRef }) {
  const g = useRef();
  useFrame(() => {
    if (!g.current) return;
    const k = (performance.now() - landRef.current) / 350;
    const bump = k >= 0 && k < 1 ? Math.sin(Math.PI * k) * 0.18 : 0;
    g.current.scale.set(1 + bump * 0.5, 1 - bump * 0.6, 1 + bump * 0.5);
  });
  return (
    <group position={BASKET_POS} rotation={[0, 0.5, 0]}>
      <group ref={g}>
        <Part geo="taper8" mat="basket" cast receive position={[0, 0.25, 0]} scale={[0.55, 0.5, 0.55]} />
        <Part geo="taper8" mat="woodDark" position={[0, 0.3, 0]} scale={[0.57, 0.07, 0.57]} />
        <Part geo="taper8" mat="hay" position={[0, 0.52, 0]} scale={[0.46, 0.06, 0.46]} />
        <Part geo="basketHandle" mat="woodDark" position={[0, 0.5, 0]} rotation={[0, 0, 0]} />
      </group>
    </group>
  );
}

const SHAPES = {
  carrot: { geo: 'cone6', mat: 'carrot', scale: [0.13, 0.5, 0.13], rot: [Math.PI, 0, 0.5] },
  tomato: { geo: 'sphere', mat: 'tomatoRed', scale: [0.24, 0.24, 0.24], rot: [0, 0, 0] },
  pumpkin: { geo: 'sphere', mat: 'pumpkin', scale: [0.34, 0.28, 0.34], rot: [0, 0, 0] },
};

/**
 * A small pool of crop meshes that arc from the harvested plot into the basket.
 * `flightsRef.current` holds { cropId, from, t0 } entries pushed by the scene when the SERVER confirmed a harvest.
 */
export function FlyingCrops({ flightsRef, landRef }) {
  const slots = useRef(Array.from({ length: SLOTS }, () => ({ flight: null, group: null })));

  useFrame(() => {
    const now = performance.now();
    const queue = flightsRef.current;
    for (const slot of slots.current) {
      if (!slot.flight && queue.length) slot.flight = queue.shift();
      const g = slot.group;
      if (!g) continue;
      const f = slot.flight;
      if (!f) {
        g.visible = false;
        continue;
      }
      const k = (now - f.t0) / FLY_MS;
      if (k >= 1) {
        landRef.current = now;
        slot.flight = null;
        g.visible = false;
        continue;
      }
      g.visible = true;
      const to = [BASKET_POS[0], BASKET_POS[1] + 0.55, BASKET_POS[2]];
      const [x, y, z] = arcPoint(f.from, to, k * k * (3 - 2 * k));
      g.position.set(x, y, z);
      g.rotation.y = k * 9;
      g.scale.setScalar(k > 0.8 ? 1 - (k - 0.8) * 2.5 : 1);
      g.children.forEach((c) => { c.visible = c.userData.cropId === f.cropId || (!SHAPES[f.cropId] && c.userData.cropId === 'carrot'); });
    }
  });

  return slots.current.map((slot, i) => (
    <group key={i} ref={(g) => { slot.group = g; }} visible={false}>
      {Object.entries(SHAPES).map(([id, s]) => (
        <Part key={id} geo={s.geo} mat={s.mat} scale={s.scale} rotation={s.rot} userData={{ cropId: id }} />
      ))}
    </group>
  ));
}
