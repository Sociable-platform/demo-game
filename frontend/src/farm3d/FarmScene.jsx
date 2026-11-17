import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AssetsProvider } from './assets.jsx';
import { Barn, Clouds, Farmhouse, Fences, Kiosk, Trees, Windmill, World } from './scenery.jsx';
import Plot from './plots.jsx';
import Farmer from './farmer.jsx';
import { Basket, FlyingCrops } from './effects.jsx';
import Courier, { DoorParcel } from './courier.jsx';
import { harvestRewards, plotPosition } from './layout.js';
import { BARN, DOOR_STAND, KIOSK, KIOSK_FACE, KIOSK_STAND, FARMER_START, HOUSE, MILL, PARCEL_LOCAL, toWorld } from './world.js';

const COLLECT_RANGE = 1.7; // the farmer must stand this close to the parcel to collect it
const PARCEL_XZ = toWorld(HOUSE, PARCEL_LOCAL[0], PARCEL_LOCAL[1]);

// Elevated isometric-style camera that glides after the farmer and keeps the field in view.
const CAM_OFFSET = [10.5, 10, 10.5];
const LEAD = 0.25; // how far the focus leans from the farmer toward the field centre

function Rig({ posRef, focusRef }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const sun = useRef();
  const sunTarget = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    camera.zoom = Math.max(18, Math.min(56, Math.min(size.width / 20, size.height / 14.5)));
    camera.updateProjectionMatrix();
  }, [camera, size]);

  useLayoutEffect(() => {
    const f = focusRef.current;
    f.x = FARMER_START[0] * (1 - LEAD);
    f.z = FARMER_START[1] * (1 - LEAD);
    camera.position.set(f.x + CAM_OFFSET[0], CAM_OFFSET[1], f.z + CAM_OFFSET[2]);
    camera.lookAt(f.x, 1.2, f.z);
  }, [camera, focusRef]);

  useFrame((_, dt) => {
    const f = focusRef.current;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3);
    f.x += (posRef.current.x * (1 - LEAD) - f.x) * k;
    f.z += (posRef.current.z * (1 - LEAD) - f.z) * k;
    camera.position.set(f.x + CAM_OFFSET[0], CAM_OFFSET[1], f.z + CAM_OFFSET[2]);
    camera.lookAt(f.x, 1.2, f.z);
    if (sun.current) sun.current.position.set(f.x, 0, f.z); // shadows stay sharp around whatever is on screen
  });

  return (
    <group ref={sun}>
      <directionalLight
        position={[7, 12, 5]}
        target={sunTarget}
        intensity={2.1}
        color="#fff0cc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
        shadow-intensity={0.45}
      />
      <primitive object={sunTarget} />
    </group>
  );
}

/**
 * Everything inside the <Canvas>. Fast-changing values (`clockRef`, `busyRef`, farmer position) are refs, so the
 * scene is animated by useFrame and never re-rendered per animation frame.
 *
 * Interaction model: a ground click walks the farmer there; a click on an empty or ripe plot walks the farmer
 * beside it and then calls `onSelect(index)` (the existing plant/harvest handler) once. Any new click cancels a
 * queued, not-yet-submitted interaction. Effects only play from server-confirmed results (`events`).
 */
export default function FarmScene({ views, events, onSelect, busyRef, clockRef, cropNameRef, onFloat, controlRef, delivery, bubbleRef, onKiosk }) {
  const popRef = useRef({}); // plotIndex -> performance.now() of the confirmed plant
  const flightsRef = useRef([]); // crops about to fly to the basket
  const landRef = useRef(-1e9); // performance.now() of the last crop landing in the basket
  const posRef = useRef({ x: FARMER_START[0], z: FARMER_START[1] });
  const focusRef = useRef({ x: 0, z: 0 });
  const farmer = useRef(null);
  const parcelRef = useRef(null); // the parcel at the door: { phase: 'idle' | 'collected', t0 }
  const collecting = useRef({ busy: false, retryAt: 0 });
  const deliveryRef = useRef(delivery);
  deliveryRef.current = delivery;
  const viewsRef = useRef(views);
  const get = useThree((s) => s.get);
  useEffect(() => { viewsRef.current = views; }, [views]);

  useEffect(() => {
    if (controlRef) controlRef.current = { cancel: () => farmer.current?.cancel() };
    return () => { if (controlRef) controlRef.current = null; };
  }, [controlRef]);

  // The farmer reached the plot. Re-check at submit time: skip if a request is already pending or the plot changed.
  const onArrive = useCallback(
    (index) => {
      if (busyRef.current) return;
      const phase = viewsRef.current.find((v) => v.index === index)?.phase;
      if (phase === 'empty' || phase === 'ready') onSelect(index);
    },
    [busyRef, onSelect],
  );

  const onPlot = useCallback(
    (index) => {
      const phase = viewsRef.current.find((v) => v.index === index)?.phase;
      if (phase === 'empty' || phase === 'ready') {
        farmer.current?.interact(index);
      } else {
        farmer.current?.cancel(); // another target was chosen
        onSelect(index); // still growing: the existing handler explains how long is left
      }
    },
    [onSelect],
  );

  const onParcelPlaced = useCallback(() => {
    parcelRef.current = { phase: 'idle', t0: performance.now() };
    deliveryRef.current?.onPlaced();
  }, []);
  const onParcelPick = useCallback(() => farmer.current?.walkTo(DOOR_STAND), []);

  // Reward: only when the farmer stands next to the parcel. The server decides and confirms; visuals follow it.
  useFrame(() => {
    const c = collecting.current;
    if (parcelRef.current?.phase !== 'idle' || c.busy || performance.now() < c.retryAt) return;
    const p = posRef.current;
    if (Math.hypot(p.x - PARCEL_XZ[0], p.z - PARCEL_XZ[1]) > COLLECT_RANGE) return;
    c.busy = true;
    deliveryRef.current.collect().then((r) => {
      c.busy = false;
      if (r.ok) parcelRef.current = r.granted ? { phase: 'collected', t0: performance.now() } : null;
      else c.retryAt = performance.now() + 3000; // the delivery stays pending on the server; try again shortly
    });
  });

  // The market opens only once the farmer has walked up to the stall (a new click elsewhere cancels the visit).
  const onKioskOpen = useCallback(() => { farmer.current?.visit(KIOSK_STAND, KIOSK_FACE, () => onKiosk?.()); }, [onKiosk]);

  const onGround = useCallback((e) => {
    e.stopPropagation();
    farmer.current?.walkTo([e.point.x, e.point.z]);
  }, []);

  useEffect(
    () =>
      events.subscribe((result) => {
        if (!result || result.plotIndex === undefined) return;
        const now = performance.now();
        if (result.action === 'plant') {
          popRef.current[result.plotIndex] = now;
        } else if (result.action === 'harvest') {
          const [x, y, z] = plotPosition(result.plotIndex);
          const crops = Math.min(5, Number.isInteger(result.yield) && result.yield > 0 ? result.yield : 1); // one flying crop per crop gained
          for (let i = 0; i < crops; i += 1) flightsRef.current.push({ cropId: result.cropId, from: [x, y + 0.5, z], t0: now + i * 130 });
          const { camera, size } = get();
          const p = new THREE.Vector3(x, y + 0.8, z).project(camera);
          onFloat(
            harvestRewards(result, cropNameRef.current(result.cropId)),
            (p.x * 0.5 + 0.5) * size.width,
            (-p.y * 0.5 + 0.5) * size.height,
          );
        }
      }),
    [events, get, onFloat, cropNameRef],
  );

  return (
    <AssetsProvider>
      <Rig posRef={posRef} focusRef={focusRef} />
      <hemisphereLight args={['#fff6e0', '#8fb86e', 1.15]} />
      <ambientLight intensity={0.25} />
      <World onGround={onGround} />
      <Farmhouse position={[HOUSE.x, 0.4, HOUSE.z]} rotation={[0, HOUSE.rot, 0]} />
      <Barn position={[BARN.x, 0.4, BARN.z]} rotation={[0, BARN.rot, 0]} />
      <Kiosk position={[KIOSK.x, 0.4, KIOSK.z]} rotation={[0, KIOSK.rot, 0]} onOpen={onKioskOpen} />
      <Windmill position={[MILL.x, 0.4, MILL.z]} rotation={[0, MILL.rot, 0]} />
      <Trees />
      <Fences />
      <Basket landRef={landRef} />
      <FlyingCrops flightsRef={flightsRef} landRef={landRef} />
      <Clouds focusRef={focusRef} />
      <Farmer apiRef={farmer} posRef={posRef} onArrive={onArrive} />
      <DoorParcel parcelRef={parcelRef} onPick={onParcelPick} />
      {delivery?.visit && (
        <Courier key={delivery.visit.key} onPlaced={onParcelPlaced} onDone={delivery.onDone} bubbleRef={bubbleRef} />
      )}
      {views.map((view) => (
        <Plot key={view.index} view={view} onSelect={onPlot} busyRef={busyRef} clockRef={clockRef} popRef={popRef} />
      ))}
    </AssetsProvider>
  );
}
