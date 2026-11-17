import { useImperativeHandle, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Part } from './assets.jsx';
import { approachPlot, findPath } from './nav.js';
import { FARMER_START } from './world.js';
import { plotPosition } from './layout.js';

const SPEED = 4.4; // world units per second
const WORK_S = 0.38; // seconds of "bend over" before the action is submitted

export const lerpAngle = (a, b, k) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

/**
 * Low-poly farmer with a straw hat. Walks along a path from the navigation grid; all movement state lives in a
 * ref and is advanced in useFrame, so walking never triggers a React render.
 *
 * Imperative API (via `apiRef`):
 *  - walkTo([x, z])   walk there and drop any queued plot interaction
 *  - interact(index)  walk beside a plot, then call onArrive(index) ONCE; returns false if unreachable
 *  - visit(point, face, fn)  walk to `point`, turn towards `face`, then call fn() ONCE (e.g. open the Kiosk)
 *  - cancel()         drop the queued interaction and stop
 */
export default function Farmer({ apiRef, posRef, onArrive }) {
  const root = useRef();
  const bob = useRef();
  const legL = useRef();
  const legR = useRef();
  const armL = useRef();
  const armR = useRef();
  const marker = useRef();
  const s = useRef({ x: FARMER_START[0], z: FARMER_START[1], path: [], intent: null, angle: Math.PI * 0.85, gait: 0, moving: 0, dest: null });
  posRef.current = { x: s.current.x, z: s.current.z };

  useImperativeHandle(apiRef, () => ({
    walkTo(point) {
      const st = s.current;
      st.intent = null;
      const path = findPath([st.x, st.z], point);
      if (!path) return false;
      st.path = path;
      st.dest = path[path.length - 1];
      return true;
    },
    interact(index) {
      const st = s.current;
      const route = approachPlot(index, [st.x, st.z]);
      if (!route) return false;
      st.path = route.path;
      st.dest = null;
      st.intent = { index, t: 0 };
      return true;
    },
    visit(point, face, fn) {
      const st = s.current;
      const path = findPath([st.x, st.z], point);
      if (!path) return false;
      st.path = path;
      st.dest = null;
      st.intent = { face, fn, t: 0 };
      return true;
    },
    cancel() {
      const st = s.current;
      st.intent = null;
      st.path = [];
      st.dest = null;
    },
  }), []);

  useFrame((_, rawDt) => {
    const st = s.current;
    const dt = Math.min(rawDt, 0.05);
    let moving = false;
    if (st.path.length) {
      const [tx, tz] = st.path[0];
      const dx = tx - st.x;
      const dz = tz - st.z;
      const dist = Math.hypot(dx, dz);
      const step = SPEED * dt;
      if (dist <= step) {
        st.x = tx;
        st.z = tz;
        st.path.shift();
      } else {
        st.x += (dx / dist) * step;
        st.z += (dz / dist) * step;
        st.angle = lerpAngle(st.angle, Math.atan2(dx, dz), Math.min(1, dt * 12));
      }
      moving = true;
    }
    if (!moving) st.dest = null;

    // Arrived beside the plot: face it, bend over briefly, then submit exactly once.
    let work = 0;
    if (!moving && st.intent) {
      st.intent.t += dt;
      const [px, pz] = st.intent.face ?? [plotPosition(st.intent.index)[0], plotPosition(st.intent.index)[2]];
      st.angle = lerpAngle(st.angle, Math.atan2(px - st.x, pz - st.z), Math.min(1, dt * 12));
      if (st.intent.fn) {
        if (st.intent.t >= 0.3) { const fn = st.intent.fn; st.intent = null; fn(); } // arrived at a building: no bending
      } else {
      work = Math.min(1, st.intent.t / WORK_S);
      if (work >= 1) {
        const index = st.intent.index;
        st.intent = null;
        onArrive(index);
      }
      }
    }

    st.moving += ((moving ? 1 : 0) - st.moving) * Math.min(1, dt * 10);
    st.gait += dt * SPEED * 2.1 * (moving ? 1 : 0);
    const swing = Math.sin(st.gait) * 0.8 * st.moving;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.8;
    if (armR.current) armR.current.rotation.x = swing * 0.8;
    if (bob.current) {
      bob.current.position.y = Math.abs(Math.sin(st.gait)) * 0.07 * st.moving;
      bob.current.rotation.x = Math.sin(work * Math.PI) * 0.45;
    }
    if (root.current) {
      root.current.position.set(st.x, 0.4, st.z);
      root.current.rotation.y = st.angle;
    }
    if (marker.current) {
      marker.current.visible = Boolean(moving && st.dest);
      if (st.dest) marker.current.position.set(st.dest[0], 0.43, st.dest[1]);
    }
    posRef.current.x = st.x;
    posRef.current.z = st.z;
  });

  return (
    <>
      <Part ref={marker} geo="disc" mat="highlight" scale={[0.4, 1, 0.4]} visible={false} />
      <group ref={root} position={[FARMER_START[0], 0.4, FARMER_START[1]]}>
        <group ref={bob}>
          <group ref={legL} position={[-0.13, 0.55, 0]}>
            <Part geo="box" mat="pants" cast position={[0, -0.25, 0]} scale={[0.17, 0.5, 0.2]} />
          </group>
          <group ref={legR} position={[0.13, 0.55, 0]}>
            <Part geo="box" mat="pants" cast position={[0, -0.25, 0]} scale={[0.17, 0.5, 0.2]} />
          </group>
          <Part geo="box" mat="shirt" cast position={[0, 0.85, 0]} scale={[0.5, 0.6, 0.3]} />
          <group ref={armL} position={[-0.34, 1.07, 0]}>
            <Part geo="box" mat="shirt" cast position={[0, -0.2, 0]} scale={[0.13, 0.46, 0.15]} />
            <Part geo="sphere" mat="skin" position={[0, -0.47, 0]} scale={[0.08, 0.08, 0.08]} />
          </group>
          <group ref={armR} position={[0.34, 1.07, 0]}>
            <Part geo="box" mat="shirt" cast position={[0, -0.2, 0]} scale={[0.13, 0.46, 0.15]} />
            <Part geo="sphere" mat="skin" position={[0, -0.47, 0]} scale={[0.08, 0.08, 0.08]} />
          </group>
          <Part geo="sphere" mat="skin" cast position={[0, 1.4, 0]} scale={[0.21, 0.21, 0.21]} />
          <Part geo="cyl10" mat="hat" cast position={[0, 1.54, 0]} scale={[0.4, 0.035, 0.4]} />
          <Part geo="cyl10" mat="hat" cast position={[0, 1.66, 0]} scale={[0.21, 0.22, 0.21]} />
          <Part geo="cyl10" mat="hatBand" position={[0, 1.59, 0]} scale={[0.215, 0.05, 0.215]} />
        </group>
      </group>
    </>
  );
}
