import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Part } from './assets.jsx';
import { findPath } from './nav.js';
import { lerpAngle } from './farmer.jsx';
import { easeOutBack } from './layout.js';
import { COURIER_ENTRANCES, COURIER_WAYPOINTS, DOOR_POS, DOOR_STAND, HOUSE, PARCEL_LOCAL } from './world.js';
import { MOTION } from './scenery.jsx';

const SPEED = 3.8; // a little slower than the farmer (4.4)
const GREET_S = 1.7; // wave + speech bubble; the reward request is in flight meanwhile
const PLACE_S = 1.1; // bend over and put the parcel down
const COLLECT_S = 1.5; // sparkle + shrink once the player has collected the parcel
const v = new THREE.Vector3();

/** The entrance (end of the road) that is furthest off screen right now, so the courier walks into view. */
function chooseEntrance(camera) {
  let best = 0;
  let bestMargin = -Infinity;
  COURIER_ENTRANCES.forEach(([x, z], i) => {
    v.set(x, 0.4, z).project(camera);
    const margin = Math.max(Math.abs(v.x), Math.abs(v.y));
    if (margin > bestMargin) { bestMargin = margin; best = i; }
  });
  return COURIER_ENTRANCES[best];
}

/** Road route in: entrance -> road junction -> farmhouse road -> beside the door (joined with the nav grid). */
function buildRoute(entrance) {
  const inbound = [];
  let from = entrance;
  for (const target of [...COURIER_WAYPOINTS, DOOR_STAND]) {
    const leg = findPath(from, target);
    if (!leg) return null;
    inbound.push(...leg);
    from = leg[leg.length - 1];
  }
  const outbound = [entrance, ...inbound].reverse().slice(1); // retrace the same road back out
  return { inbound, outbound };
}

/**
 * The delivery courier: one low-poly NPC per visit (mounted by key, so re-renders never duplicate it).
 * Walks the road to the farmhouse, greets (speech bubble), puts the parcel down beside the door, then walks back
 * out and calls onDone. It never touches the reward: the player collects the parcel by walking up to it.
 * All state lives in refs.
 *
 *  onPlaced(): the parcel was put down at the door
 *  onDone(outcome): 'delivered' | 'skipped', called exactly once
 */
export default function Courier({ onPlaced, onDone, bubbleRef }) {
  const camera = useThree((s) => s.camera);
  const root = useRef();
  const bob = useRef();
  const legL = useRef();
  const legR = useRef();
  const armL = useRef();
  const armR = useRef();
  const backParcel = useRef();
  const heldParcel = useRef();

  const init = useRef(null);
  if (!init.current) {
    const entrance = chooseEntrance(camera);
    const route = buildRoute(entrance);
    init.current = {
      route,
      st: { x: entrance[0], z: entrance[1], path: route ? [...route.inbound] : [], phase: route ? 'in' : 'end', t: 0, angle: Math.PI * 0.5, gait: 0, moving: 0, placed: false, finished: false, outcome: 'skipped' },
    };
  }
  const { route, st } = init.current;
  const [dx, dz] = [DOOR_POS[0] - DOOR_STAND[0], DOOR_POS[1] - DOOR_STAND[1]];
  const faceDoor = Math.atan2(dx, dz);

  useEffect(() => () => { if (bubbleRef.current) bubbleRef.current.style.opacity = '0'; }, [bubbleRef]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    let moving = false;
    if (st.path.length) {
      const [tx, tz] = st.path[0];
      const ex = tx - st.x;
      const ez = tz - st.z;
      const dist = Math.hypot(ex, ez);
      const step = SPEED * dt;
      if (dist <= step) { st.x = tx; st.z = tz; st.path.shift(); }
      else {
        st.x += (ex / dist) * step;
        st.z += (ez / dist) * step;
        st.angle = lerpAngle(st.angle, Math.atan2(ex, ez), Math.min(1, dt * 8)); // smooth turning
      }
      moving = true;
    }

    let greet = 0;
    let place = 0;
    if (!moving) {
      if (st.phase === 'in') { st.phase = 'greet'; st.t = 0; }
      if (st.phase === 'greet') {
        st.t += dt;
        st.angle = lerpAngle(st.angle, faceDoor, Math.min(1, dt * 8));
        greet = st.t;
        if (st.t >= GREET_S) { st.phase = 'place'; st.t = 0; }
      } else if (st.phase === 'place') {
        st.t += dt;
        place = Math.min(1, st.t / PLACE_S);
        st.angle = lerpAngle(st.angle, faceDoor, Math.min(1, dt * 8));
        if (!st.placed && st.t >= PLACE_S * 0.5) { st.placed = true; onPlaced(); }
        if (st.t >= PLACE_S) { st.phase = 'leave'; st.outcome = 'delivered'; st.path = [...route.outbound]; }
      } else if (st.phase === 'leave' && !st.path.length) {
        st.phase = 'end';
      }
      if (st.phase === 'end' && !st.finished) {
        st.finished = true;
        onDone(st.outcome);
      }
    }

    st.moving += ((moving ? 1 : 0) - st.moving) * Math.min(1, dt * 10);
    st.gait += dt * SPEED * 2.2 * (moving ? 1 : 0);
    const swing = Math.sin(st.gait) * 0.8 * st.moving;
    const holding = (st.phase === 'greet' || st.phase === 'place') && !st.placed;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = st.phase === 'place' ? -1.15 : holding ? -0.6 : -swing * 0.8;
    if (armR.current) armR.current.rotation.x = st.phase === 'place' ? -1.15 : st.phase === 'greet' ? -2.5 + Math.sin(greet * 9 * MOTION) * 0.35 : swing * 0.8;
    if (bob.current) {
      bob.current.position.y = Math.abs(Math.sin(st.gait)) * 0.07 * st.moving;
      bob.current.rotation.x = st.phase === 'place' ? Math.sin(place * Math.PI) * 0.5 : 0;
    }
    if (backParcel.current) backParcel.current.visible = !holding && !st.placed;
    if (heldParcel.current) heldParcel.current.visible = holding;
    if (root.current) {
      root.current.visible = st.phase !== 'end';
      root.current.position.set(st.x, 0.4, st.z);
      root.current.rotation.y = st.angle;
    }

    // Speech bubble: a DOM node moved imperatively (no React updates while walking).
    const b = bubbleRef.current;
    if (b) {
      const show = st.phase === 'greet' || (st.phase === 'place' && st.t < 0.6);
      b.style.opacity = show ? '1' : '0';
      if (show) {
        v.set(st.x, 2.65, st.z).project(state.camera);
        b.style.left = `${(v.x * 0.5 + 0.5) * state.size.width}px`;
        b.style.top = `${(-v.y * 0.5 + 0.5) * state.size.height}px`;
      }
    }
  });

  return (
    <group ref={root} position={[st.x, 0.4, st.z]} rotation={[0, st.angle, 0]} visible={Boolean(route)}>
      <group ref={bob}>
        <group ref={legL} position={[-0.13, 0.55, 0]}>
          <Part geo="box" mat="pants" cast position={[0, -0.25, 0]} scale={[0.17, 0.5, 0.2]} />
        </group>
        <group ref={legR} position={[0.13, 0.55, 0]}>
          <Part geo="box" mat="pants" cast position={[0, -0.25, 0]} scale={[0.17, 0.5, 0.2]} />
        </group>
        <Part geo="box" mat="courier" cast position={[0, 0.85, 0]} scale={[0.52, 0.6, 0.32]} />
        <group ref={armL} position={[-0.35, 1.07, 0]}>
          <Part geo="box" mat="courier" cast position={[0, -0.2, 0]} scale={[0.13, 0.46, 0.15]} />
          <Part geo="sphere" mat="skin" position={[0, -0.47, 0]} scale={[0.08, 0.08, 0.08]} />
        </group>
        <group ref={armR} position={[0.35, 1.07, 0]}>
          <Part geo="box" mat="courier" cast position={[0, -0.2, 0]} scale={[0.13, 0.46, 0.15]} />
          <Part geo="sphere" mat="skin" position={[0, -0.47, 0]} scale={[0.08, 0.08, 0.08]} />
        </group>
        <Part geo="sphere" mat="skin" cast position={[0, 1.4, 0]} scale={[0.21, 0.21, 0.21]} />
        <Part geo="cyl10" mat="courier" cast position={[0, 1.58, 0]} scale={[0.225, 0.14, 0.225]} />
        <Part geo="box" mat="courierDark" position={[0, 1.52, 0.22]} scale={[0.3, 0.03, 0.2]} />
        {/* backpack with a parcel strapped on top */}
        <Part geo="box" mat="courierDark" cast position={[0, 0.88, -0.26]} scale={[0.38, 0.46, 0.2]} />
        <group ref={backParcel} position={[0, 1.2, -0.27]}>
          <Part geo="box" mat="parcel" cast scale={[0.3, 0.2, 0.2]} />
          <Part geo="box" mat="ribbon" position={[0, 0.001, 0]} scale={[0.07, 0.205, 0.205]} />
        </group>
        {/* parcel carried in the hands while greeting */}
        <group ref={heldParcel} position={[-0.05, 0.85, 0.42]} visible={false}>
          <Part geo="box" mat="parcel" cast scale={[0.34, 0.24, 0.28]} />
          <Part geo="box" mat="ribbon" position={[0, 0.001, 0]} scale={[0.08, 0.245, 0.285]} />
        </group>
      </group>
    </group>
  );
}

/**
 * The parcel beside the door, driven by `parcelRef` ({ phase: 'idle' | 'collected', t0 } or null).
 * Idle: it pops in, bobs and glints so the player can spot it. Collected (after server confirmation): a short
 * sparkle burst while it shrinks away. `onPick` makes the farmer walk over when it is clicked.
 */
export function DoorParcel({ parcelRef, onPick }) {
  const group = useRef();
  const sparks = useRef([]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const info = parcelRef.current;
    const t = info ? (performance.now() - info.t0) / 1000 : 0;
    const collected = info?.phase === 'collected';
    g.visible = Boolean(info) && (!collected || t < COLLECT_S);
    if (!g.visible) return;
    const grow = collected ? Math.max(0, 1 - Math.max(0, t - 0.5) / (COLLECT_S - 0.5)) : easeOutBack(Math.min(1, t / 0.5));
    g.scale.setScalar(Math.max(0.001, grow));
    g.position.y = 0.14 + (collected ? t * 0.5 : Math.sin(t * 2.4) * 0.03 * MOTION);
    sparks.current.forEach((m, i) => {
      if (!m) return;
      const k = collected ? t / COLLECT_S : ((t * 0.55 + i * 0.25) % 1);
      m.visible = true;
      const a = i * 1.6 + t * 3;
      const r = collected ? 0.3 + k * 0.7 : 0.38;
      m.position.set(Math.cos(a) * r, 0.2 + k * (collected ? 1.3 : 0.7), Math.sin(a) * r);
      m.scale.setScalar((collected ? 0.1 : 0.05) * Math.sin(Math.PI * Math.min(1, k)) + 0.001);
      m.rotation.y = t * 4 + i;
    });
  });
  return (
    <group position={[HOUSE.x, 0.4, HOUSE.z]} rotation={[0, HOUSE.rot, 0]}>
      <group ref={group} position={[PARCEL_LOCAL[0], 0.14, PARCEL_LOCAL[1]]} visible={false}>
        <Part geo="box" mat="parcel" cast receive scale={[0.44, 0.28, 0.36]} />
        <Part geo="box" mat="ribbon" position={[0, 0.001, 0]} scale={[0.09, 0.285, 0.365]} />
        <mesh position={[0, 0.2, 0]} dispose={null} onClick={(e) => { e.stopPropagation(); onPick?.(); }}>
          <boxGeometry args={[1.1, 0.9, 1.1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <Part key={i} ref={(m) => { sparks.current[i] = m; }} geo="oct" mat="sparkle" visible={false} />
        ))}
      </group>
    </group>
  );
}
