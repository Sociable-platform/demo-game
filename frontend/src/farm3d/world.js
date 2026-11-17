// Shared world layout: scenery is placed from these constants and the farmer's navigation grid is built from
// the very same obstacles, so what you see is what blocks movement. Pure data/functions (no three.js).
import { PLOT_SIZE, plotPosition } from './layout.js';

export const WORLD_HALF = 20; // walkable world is [-20, 20] on x and z
export const WALK_RADIUS = 0.3;
export const FARMER_START = [0, 7.4];

export const FENCE_D = 5.7;
export const FENCE_STEP = 1.14;
const GATE_HALF = 1.0; // posts/rails inside |v| < GATE_HALF on the camera-facing sides are left out (gates)

export const HOUSE = { x: -10.5, z: -2.5, rot: Math.PI / 4 + 0.3 };
export const BARN = { x: -3.5, z: -11, rot: Math.PI / 4 - 0.25 };
export const MILL = { x: 10, z: -9, rot: Math.PI / 4 };
export const BASKET_POS = [8, 0.4, 6.2];

export const TREES = [
  [-8.2, 7.0, 1.1, 'pine'], [-13.5, 3.5, 1.0, 'round'], [-14.5, -7.5, 1.2, 'pine'], [-9.5, -9.2, 0.9, 'round'],
  [1.5, -13.5, 1.1, 'pine'], [6.5, -12.5, 0.9, 'round'], [14.5, -3.5, 1.1, 'pine'], [15.5, 4.0, 0.9, 'round'],
  [13.5, 12.5, 1.1, 'pine'], [5.5, 14.5, 1.0, 'round'], [-4.5, 14.8, 1.2, 'pine'], [-13.5, 12.8, 1.0, 'round'],
  [11.5, 8.2, 0.8, 'round'], [-16.5, -1.5, 0.9, 'pine'], [-7.2, -6.2, 0.8, 'round'], [8.5, -5.2, 0.8, 'pine'],
];
export const ROCKS = [[-5.5, 9.6, 0.32], [11.8, 3.2, 0.26], [-12, -5.8, 0.22], [4.2, -8.4, 0.3]];

// Dirt paths: [centreX, centreZ, width(x), depth(z)]
export const PATHS = [
  [0, 7.0, 1.8, 3.2], // front gate
  [0, 8.2, 22, 1.6], // east-west road
  [7.5, 0, 3.6, 1.8], // side gate
  [9.2, 4.1, 1.6, 8.2], // side road down to the road
  [-10.2, 3.0, 1.6, 10.4], // road to the farmhouse
];

/** Fence posts and rails around the field, with gate openings on the +z and +x sides. */
export function fenceLayout() {
  const posts = [];
  const rails = [];
  const sides = [
    { axis: 'x', fixed: FENCE_D, gate: true },
    { axis: 'x', fixed: -FENCE_D, gate: false },
    { axis: 'z', fixed: FENCE_D, gate: true },
    { axis: 'z', fixed: -FENCE_D, gate: false },
  ];
  for (const side of sides) {
    const n = Math.round((FENCE_D * 2) / FENCE_STEP);
    const pts = Array.from({ length: n + 1 }, (_, i) => -FENCE_D + (i * FENCE_D * 2) / n);
    const isGap = (v) => side.gate && Math.abs(v) < GATE_HALF;
    const at = (v) => (side.axis === 'x' ? [v, side.fixed] : [side.fixed, v]);
    pts.forEach((v, i) => {
      if (!isGap(v)) posts.push(at(v));
      const next = pts[i + 1];
      if (next !== undefined && !isGap((v + next) / 2)) {
        const mid = (v + next) / 2;
        for (const y of [0.28, 0.5]) {
          rails.push({ pos: side.axis === 'x' ? [mid, y, side.fixed] : [side.fixed, y, mid], alongX: side.axis === 'x', len: next - v, a: at(v), b: at(next) });
        }
      }
    });
  }
  return { posts, rails };
}

const toWorld = (o, lx, lz) => [o.x + lx * Math.cos(o.rot) + lz * Math.sin(o.rot), o.z - lx * Math.sin(o.rot) + lz * Math.cos(o.rot)];

/** Everything the farmer cannot walk through (before inflating by WALK_RADIUS). */
export function obstacles() {
  const out = [];
  out.push({ t: 'rect', x: HOUSE.x, z: HOUSE.z, rot: HOUSE.rot, hx: 1.3, hz: 1.15 });
  out.push({ t: 'rect', x: BARN.x, z: BARN.z, rot: BARN.rot, hx: 1.5, hz: 1.3 });
  const [hx, hz] = toWorld(BARN, 1.9, 0.5);
  out.push({ t: 'circle', x: hx, z: hz, r: 0.5 });
  out.push({ t: 'circle', x: MILL.x, z: MILL.z, r: 1.15 });
  out.push({ t: 'circle', x: BASKET_POS[0], z: BASKET_POS[2], r: 0.5 });
  TREES.forEach(([x, z, s]) => out.push({ t: 'circle', x, z, r: 0.4 * s }));
  ROCKS.forEach(([x, z, s]) => out.push({ t: 'circle', x, z, r: s * 1.1 }));
  const half = (PLOT_SIZE + 0.24) / 2;
  for (let i = 0; i < 9; i += 1) {
    const [x, , z] = plotPosition(i);
    out.push({ t: 'rect', x, z, rot: 0, hx: half, hz: half });
  }
  const { posts, rails } = fenceLayout();
  posts.forEach(([x, z]) => out.push({ t: 'circle', x, z, r: 0.09 }));
  rails.forEach((r) => out.push({ t: 'seg', a: r.a, b: r.b, r: 0.05 }));
  return out;
}

/** Candidate standing points beside a plot (in the aisles around it), nearest the farmer tried first by the caller. */
export function plotApproachPoints(index) {
  const [x, , z] = plotPosition(index);
  const d = (PLOT_SIZE + 0.24) / 2 + 0.5;
  return [[x, z + d], [x + d, z], [x - d, z], [x, z - d]];
}
