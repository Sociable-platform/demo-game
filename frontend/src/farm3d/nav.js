// Grid navigation: obstacles are rasterised once (inflated by the farmer's radius), then A* finds a path and a
// line-of-sight pass straightens it. Pure functions, no three.js.
import { WALK_RADIUS, WORLD_HALF, obstacles, plotApproachPoints } from './world.js';

const CELL = 0.35;
const N = Math.ceil((WORLD_HALF * 2) / CELL);
const toCell = (v) => Math.min(N - 1, Math.max(0, Math.floor((v + WORLD_HALF) / CELL)));
const center = (i) => -WORLD_HALF + (i + 0.5) * CELL;

function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function hit(o, px, pz) {
  const r = WALK_RADIUS;
  if (o.t === 'circle') return Math.hypot(px - o.x, pz - o.z) <= o.r + r;
  if (o.t === 'seg') return segDist(px, pz, o.a, o.b) <= o.r + r;
  const dx = px - o.x;
  const dz = pz - o.z;
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return Math.abs(dx * c - dz * s) <= o.hx + r && Math.abs(dx * s + dz * c) <= o.hz + r;
}

let grid = null;
function getGrid() {
  if (grid) return grid;
  const g = new Uint8Array(N * N);
  const list = obstacles();
  for (let iz = 0; iz < N; iz += 1) {
    for (let ix = 0; ix < N; ix += 1) {
      const x = center(ix);
      const z = center(iz);
      const edge = Math.abs(x) > WORLD_HALF - 1 || Math.abs(z) > WORLD_HALF - 1;
      if (edge || list.some((o) => hit(o, x, z))) g[iz * N + ix] = 1;
    }
  }
  grid = g;
  return g;
}

const free = (g, ix, iz) => ix >= 0 && iz >= 0 && ix < N && iz < N && !g[iz * N + ix];

/** Nearest free cell to (x, z), searching outward in rings. Returns [ix, iz] or null. */
function nearestFree(g, x, z, maxRing = 8) {
  const cx = toCell(x);
  const cz = toCell(z);
  if (free(g, cx, cz)) return [cx, cz];
  let best = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring || !free(g, cx + dx, cz + dz)) continue;
        const d = Math.hypot(center(cx + dx) - x, center(cz + dz) - z);
        if (d < bestD) { bestD = d; best = [cx + dx, cz + dz]; }
      }
    }
    if (best) return best;
  }
  return null;
}

function lineClear(g, [ax, az], [bx, bz]) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (!free(g, toCell(ax + (bx - ax) * t), toCell(az + (bz - az) * t))) return false;
  }
  return true;
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Path from `from` to `to` (both [x, z]) around obstacles. Returns a list of waypoints (excluding the start),
 * or null when the destination cannot be reached. A blocked destination snaps to the nearest free spot.
 */
export function findPath(from, to) {
  const g = getGrid();
  const s = nearestFree(g, from[0], from[1], 12);
  const e = nearestFree(g, to[0], to[1]);
  if (!s || !e) return null;
  const goal = e[1] * N + e[0];
  const start = s[1] * N + s[0];
  const cost = new Float32Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  const open = new Heap();
  cost[start] = 0;
  open.push([0, start]);
  const h = (i) => Math.hypot((i % N) - e[0], Math.floor(i / N) - e[1]);
  let found = false;
  while (open.size) {
    const [, cur] = open.pop();
    if (cur === goal) { found = true; break; }
    const cx = cur % N;
    const cz = Math.floor(cur / N);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!free(g, nx, nz)) continue;
        if (dx && dz && (!free(g, cx + dx, cz) || !free(g, cx, cz + dz))) continue; // no corner cutting
        const ni = nz * N + nx;
        const c = cost[cur] + (dx && dz ? 1.414 : 1);
        if (c < cost[ni]) {
          cost[ni] = c;
          prev[ni] = cur;
          open.push([c + h(ni), ni]);
        }
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = prev[i]) cells.push([center(i % N), center(Math.floor(i / N))]);
  cells.reverse();
  const exact = free(g, toCell(to[0]), toCell(to[1])) ? [to[0], to[1]] : cells[cells.length - 1];
  cells[cells.length - 1] = exact;
  // straighten: from each anchor, jump to the furthest waypoint still in line of sight
  const out = [];
  let anchor = [from[0], from[1]];
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineClear(g, anchor, cells[j])) j -= 1;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}

/** Best reachable standing point beside a plot: { point, path } with the shortest path, or null. */
export function approachPlot(index, from) {
  let best = null;
  for (const p of plotApproachPoints(index)) {
    const path = findPath(from, p);
    if (!path) continue;
    let len = 0;
    let prevP = from;
    for (const q of path) { len += Math.hypot(q[0] - prevP[0], q[1] - prevP[1]); prevP = q; }
    if (!best || len < best.len) best = { point: path[path.length - 1], path, len };
  }
  return best;
}
