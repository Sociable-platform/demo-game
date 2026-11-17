import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Part, useAssets } from './assets.jsx';
import { PATHS, ROCKS, TREES, WORLD_HALF, fenceLayout } from './world.js';

// 0 when the player prefers reduced motion: ambient animation (sway, clouds, windmill) is switched off.
export const MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1;

const GROUND_Y = 0.4;

/** Wide grass ground (it receives the click-to-move events), dirt paths and a few rocks. */
export function World({ onGround }) {
  const size = WORLD_HALF * 2 + 2;
  return (
    <group>
      <Part geo="box" mat="grass" receive position={[0, 0.2, 0]} scale={[size, 0.4, size]} onClick={onGround} />
      <Part geo="box" mat="dirt" receive position={[0, -0.5, 0]} scale={[size + 0.2, 1.0, size + 0.2]} />
      <Part geo="box" mat="dirtDark" position={[0, -1.4, 0]} scale={[size - 1.5, 1.0, size - 1.5]} />
      {PATHS.map(([x, z, w, d], i) => (
        <Part key={i} geo="box" mat="path" receive position={[x, 0.405, z]} scale={[w, 0.02, d]} />
      ))}
      {ROCKS.map(([x, z, s], i) => (
        <Part key={i} geo="ico" mat="stone" cast receive position={[x, 0.4 + s * 0.4, z]} scale={[s, s * 0.75, s]} rotation={[0, i, 0]} />
      ))}
    </group>
  );
}

export function Farmhouse(props) {
  return (
    <group {...props}>
      <Part geo="box" mat="wall" cast receive position={[0, 0.75, 0]} scale={[2.2, 1.5, 1.9]} />
      <Part geo="roof" mat="roofRed" cast position={[0, 1.5, 0]} scale={[1.2, 0.95, 2.1]} />
      <Part geo="box" mat="door" position={[-0.45, 0.45, 0.96]} scale={[0.5, 0.9, 0.06]} />
      <Part geo="box" mat="window" position={[0.5, 0.85, 0.96]} scale={[0.5, 0.45, 0.06]} />
      <Part geo="box" mat="trim" position={[0.5, 0.85, 0.94]} scale={[0.62, 0.57, 0.04]} />
      <Part geo="box" mat="stone" cast position={[0.55, 2.1, -0.4]} scale={[0.32, 0.8, 0.32]} />
    </group>
  );
}

export function Barn(props) {
  return (
    <group {...props}>
      <Part geo="box" mat="barn" cast receive position={[0, 0.85, 0]} scale={[2.7, 1.7, 2.3]} />
      <Part geo="roof" mat="roofBrown" cast position={[0, 1.7, 0]} scale={[1.45, 1.05, 2.5]} />
      <Part geo="box" mat="trim" position={[0, 0.65, 1.16]} scale={[1.1, 1.3, 0.06]} />
      <Part geo="box" mat="barn" position={[0, 0.65, 1.2]} scale={[0.9, 1.1, 0.04]} />
      <Part geo="box" mat="trim" position={[0, 0.65, 1.23]} scale={[0.07, 1.25, 0.03]} rotation={[0, 0, 0.75]} />
      <Part geo="box" mat="trim" position={[0, 0.65, 1.23]} scale={[0.07, 1.25, 0.03]} rotation={[0, 0, -0.75]} />
      <Part geo="box" mat="hay" position={[0, 1.95, 1.0]} scale={[0.45, 0.3, 0.06]} />
      <Part geo="box" mat="hay" cast position={[1.9, 0.38, 0.5]} scale={[0.7, 0.55, 0.6]} />
    </group>
  );
}

/**
 * The Kiosk: a market stall with a striped awning, a counter with produce and a coin sign. Clicking it opens the
 * market (`onOpen`); the click target is an invisible box so the model itself carries no handlers.
 */
export function Kiosk({ onOpen, ...props }) {
  const stripes = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
  return (
    <group {...props}>
      {[[-1.05, -0.55], [1.05, -0.55], [-1.05, 0.55], [1.05, 0.55]].map(([x, z]) => (
        <Part key={`${x}:${z}`} geo="box" mat="woodDark" cast position={[x, 0.85, z]} scale={[0.1, 1.7, 0.1]} />
      ))}
      <Part geo="box" mat="wood" cast receive position={[0, 0.45, 0.45]} scale={[2.2, 0.9, 0.55]} />
      <Part geo="box" mat="woodDark" position={[0, 0.93, 0.45]} scale={[2.3, 0.06, 0.65]} />
      <Part geo="box" mat="wood" cast position={[0, 0.45, -0.5]} scale={[2.2, 0.9, 0.1]} />
      {stripes.map((x, i) => (
        <Part key={x} geo="box" mat={i % 2 ? 'trim' : 'roofRed'} cast position={[x, 1.78, 0.05]} rotation={[0.28, 0, 0]} scale={[0.4, 0.07, 1.5]} />
      ))}
      <Part geo="box" mat="trim" cast position={[0, 1.2, -0.62]} scale={[2.2, 0.9, 0.06]} />
      <group position={[0, 1.55, 0.78]}>
        <Part geo="disc" mat="gold" position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]} scale={[0.2, 0.04, 0.2]} />
      </group>
      <Part geo="box" mat="hay" cast position={[-0.65, 1.07, 0.45]} scale={[0.55, 0.2, 0.4]} />
      <Part geo="sphere" mat="carrot" position={[-0.8, 1.22, 0.45]} scale={[0.14, 0.14, 0.14]} />
      <Part geo="sphere" mat="tomatoRed" position={[-0.55, 1.24, 0.5]} scale={[0.15, 0.15, 0.15]} />
      <Part geo="sphere" mat="pumpkin" position={[0.55, 1.14, 0.45]} scale={[0.22, 0.18, 0.22]} />
      <Part geo="sphere" mat="potato" position={[0.9, 1.1, 0.5]} scale={[0.17, 0.12, 0.13]} />
      <mesh position={[0, 0.9, 0.2]} dispose={null} onClick={(e) => { e.stopPropagation(); onOpen?.(); }}>
        <boxGeometry args={[2.4, 1.9, 1.6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Windmill(props) {
  const blades = useRef();
  useFrame((_, dt) => {
    if (blades.current) blades.current.rotation.z -= Math.min(dt, 0.1) * 0.7 * MOTION;
  });
  return (
    <group {...props}>
      <Part geo="taper8" mat="wall" cast receive position={[0, 1.5, 0]} scale={[1.0, 3.0, 1.0]} />
      <Part geo="cone8" mat="roofRed" cast position={[0, 3.45, 0]} scale={[0.82, 0.95, 0.82]} />
      <Part geo="box" mat="door" position={[0, 0.4, 0.93]} scale={[0.4, 0.8, 0.06]} />
      <Part geo="box" mat="window" position={[0, 2.0, 0.66]} scale={[0.3, 0.35, 0.06]} />
      <group position={[0, 3.0, 0.78]}>
        <Part geo="sphere" mat="woodDark" scale={[0.16, 0.16, 0.16]} />
        <group ref={blades} position={[0, 0, 0.12]}>
          <Part geo="blades" mat="blades" cast />
        </group>
      </group>
    </group>
  );
}

function Tree({ x, z, s, kind, phase }) {
  const sway = useRef();
  useFrame(({ clock }) => {
    const g = sway.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.z = Math.sin(t * 1.1 + phase) * 0.035 * MOTION;
    g.rotation.x = Math.cos(t * 0.9 + phase) * 0.025 * MOTION;
  });
  return (
    <group position={[x, GROUND_Y, z]} scale={s}>
      <group ref={sway}>
        <Part geo="cyl6" mat="trunk" cast position={[0, 0.4, 0]} scale={[0.17, 0.8, 0.17]} />
        {kind === 'pine' ? (
          <>
            <Part geo="cone6" mat="leafDark" cast position={[0, 1.15, 0]} scale={[0.95, 1.3, 0.95]} />
            <Part geo="cone6" mat="leaf" cast position={[0, 1.85, 0]} scale={[0.7, 1.1, 0.7]} />
            <Part geo="cone6" mat="leafLight" cast position={[0, 2.4, 0]} scale={[0.45, 0.8, 0.45]} />
          </>
        ) : (
          <>
            <Part geo="ico" mat="leaf" cast position={[0, 1.45, 0]} scale={[0.95, 0.85, 0.95]} />
            <Part geo="ico" mat="leafLight" cast position={[0.35, 1.95, 0.1]} scale={[0.6, 0.55, 0.6]} />
            <Part geo="ico" mat="leafDark" cast position={[-0.4, 1.2, -0.2]} scale={[0.55, 0.5, 0.55]} />
          </>
        )}
      </group>
    </group>
  );
}

export function Trees() {
  return TREES.map(([x, z, s, kind], i) => <Tree key={i} x={x} z={z} s={s} kind={kind} phase={i * 1.7} />);
}

export function Fences() {
  const a = useAssets();
  const postsRef = useRef();
  const railsRef = useRef();
  const layout = useRef(fenceLayout()).current; // same layout the navigation grid uses
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    layout.posts.forEach(([x, z], i) => {
      m.compose(new THREE.Vector3(x, GROUND_Y + 0.3, z), q.identity(), s.set(0.11, 0.6, 0.11));
      postsRef.current.setMatrixAt(i, m);
    });
    layout.rails.forEach((r, i) => {
      s.set(r.alongX ? r.len : 0.06, 0.07, r.alongX ? 0.06 : r.len);
      m.compose(new THREE.Vector3(r.pos[0], GROUND_Y + r.pos[1], r.pos[2]), q.identity(), s);
      railsRef.current.setMatrixAt(i, m);
    });
    postsRef.current.instanceMatrix.needsUpdate = true;
    railsRef.current.instanceMatrix.needsUpdate = true;
  }, [layout]);
  return (
    <>
      <instancedMesh ref={postsRef} args={[a.geo.box, a.mat.woodDark, layout.posts.length]} castShadow dispose={null} />
      <instancedMesh ref={railsRef} args={[a.geo.box, a.mat.wood, layout.rails.length]} dispose={null} />
    </>
  );
}

// Clouds are positioned relative to the camera focus so they always drift behind the view, never over the field.
const CLOUDS = [
  { y: 9.0, z: -13, speed: 0.34, x0: -6, s: 1.0 },
  { y: 9.8, z: -17, speed: 0.22, x0: 6, s: 1.3 },
  { y: 8.6, z: -10, speed: 0.28, x0: 14, s: 0.8 },
  { y: 9.4, z: -21, speed: 0.4, x0: -14, s: 1.1 },
];

function Cloud({ y, z, speed, x0, s }) {
  const g = useRef();
  const x = useRef(x0);
  useFrame((_, dt) => {
    x.current += Math.min(dt, 0.1) * speed * MOTION;
    if (x.current > 20) x.current = -20;
    if (g.current) g.current.position.x = x.current;
  });
  return (
    <group position={[0, y, z]}>
      <group ref={g} position={[x0, 0, 0]} scale={s}>
        <Part geo="sphere" mat="cloud" scale={[1.7, 0.75, 1.0]} />
        <Part geo="sphere" mat="cloud" position={[1.1, -0.1, 0.1]} scale={[1.2, 0.6, 0.85]} />
        <Part geo="sphere" mat="cloud" position={[-1.2, -0.12, 0]} scale={[1.1, 0.55, 0.8]} />
        <Part geo="sphere" mat="cloud" position={[0.2, 0.45, 0]} scale={[0.9, 0.55, 0.8]} />
      </group>
    </group>
  );
}

export function Clouds({ focusRef }) {
  const g = useRef();
  useFrame(() => {
    if (g.current && focusRef.current) g.current.position.set(focusRef.current.x, 0, focusRef.current.z);
  });
  return <group ref={g}>{CLOUDS.map((c, i) => <Cloud key={i} {...c} />)}</group>;
}
