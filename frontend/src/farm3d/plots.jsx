import { memo, useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Part } from './assets.jsx';
import { MOTION } from './scenery.jsx';
import { PLOT_SIZE, SOIL_TOP_Y, easeOutBack, growthScale, plotPosition, progressAt } from './layout.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const POP_MS = 700;

// Server-clock-adjusted "now", extrapolated between the 4 Hz React updates so growth looks continuous.
const serverNow = (clockRef) => clockRef.current.now + (performance.now() - clockRef.current.at);

function Carrot({ getP }) {
  const roots = useRef();
  useFrame(() => {
    const k = clamp01((getP() - 0.4) / 0.6);
    if (!roots.current) return;
    roots.current.visible = k > 0;
    roots.current.scale.setScalar(0.35 + 0.65 * k);
  });
  return (
    <>
      <Part geo="carrotLeaves" mat="leaf" />
      <Part ref={roots} geo="carrotRoots" mat="carrot" visible={false} />
    </>
  );
}

function Tomato({ getP, ready }) {
  const fruits = useRef();
  useFrame(() => {
    const k = clamp01((getP() - 0.55) / 0.45);
    if (!fruits.current) return;
    fruits.current.visible = k > 0;
    fruits.current.scale.setScalar(0.45 + 0.55 * k);
  });
  return (
    <>
      <Part geo="tomatoFoliage" mat="leafDark" />
      <Part ref={fruits} geo="tomatoFruits" mat={ready ? 'tomatoRed' : 'tomatoGreen'} visible={false} />
    </>
  );
}

function Potato({ getP, ready }) {
  const tubers = useRef();
  useFrame(() => {
    const k = clamp01((getP() - 0.45) / 0.55);
    if (!tubers.current) return;
    tubers.current.visible = k > 0;
    tubers.current.scale.setScalar(0.4 + 0.6 * k);
  });
  return (
    <>
      <Part geo="potatoFoliage" mat="leaf" />
      <Part ref={tubers} geo="potatoTubers" mat={ready ? 'potato' : 'potatoPale'} visible={false} />
    </>
  );
}

function Pumpkin({ getP, ready }) {
  const body = useRef();
  useFrame(() => {
    const k = clamp01((getP() - 0.2) / 0.8);
    if (!body.current) return;
    body.current.visible = k > 0;
    body.current.scale.setScalar(0.25 + 0.75 * k);
  });
  return (
    <>
      <Part geo="pumpkinLeaves" mat="leaf" />
      <group ref={body} visible={false}>
        <Part geo="pumpkinBody" mat={ready ? 'pumpkin' : 'pumpkinGreen'} cast />
        <Part geo="pumpkinStem" mat="stem" />
      </group>
    </>
  );
}

const KINDS = { carrot: Carrot, tomato: Tomato, potato: Potato, pumpkin: Pumpkin };

function Crop({ view, clockRef, popRef }) {
  const group = useRef();
  const { index, cropId, plantedAt, readyAt, phase } = view;
  const getP = useCallback(() => progressAt(plantedAt, readyAt, serverNow(clockRef)), [plantedAt, readyAt, clockRef]);
  useFrame(() => {
    if (!group.current) return;
    let s = growthScale(getP());
    const t0 = popRef.current[index];
    if (t0 !== undefined) {
      const k = (performance.now() - t0) / POP_MS;
      if (k >= 1) delete popRef.current[index];
      else s *= Math.max(0.001, easeOutBack(k));
    }
    group.current.scale.setScalar(s);
  });
  const Kind = KINDS[cropId] ?? Carrot;
  return (
    <group ref={group} scale={0.01}>
      <Kind getP={getP} ready={phase === 'ready'} />
    </group>
  );
}

const SPARKLES = [0, 1, 2];

/** Ready crops: a soft pulsing glow on the soil plus a few rising sparkles. Mutates meshes directly. */
function ReadyFX() {
  const glow = useRef();
  const sparks = useRef([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (glow.current) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 * Math.max(MOTION, 0.2));
      glow.current.scale.setScalar(0.88 + 0.08 * pulse);
      glow.current.material.opacity = 0.2 + 0.12 * pulse;
    }
    sparks.current.forEach((m, i) => {
      if (!m) return;
      const k = (t * 0.45 * Math.max(MOTION, 0.3) + i / SPARKLES.length) % 1;
      const a = t * 0.8 * MOTION + i * 2.1;
      m.position.set(Math.cos(a) * 0.62, 0.25 + k * 0.95, Math.sin(a) * 0.62);
      m.scale.setScalar(0.07 * Math.sin(Math.PI * k) + 0.001);
      m.rotation.y = t * 2 + i;
    });
  });
  return (
    <group>
      <Part ref={glow} geo="disc" mat="glow" position={[0, 0.03, 0]} scale={[0.9, 1, 0.9]} />
      {SPARKLES.map((i) => (
        <Part key={i} ref={(m) => { sparks.current[i] = m; }} geo="oct" mat="sparkle" />
      ))}
    </group>
  );
}

/** Soil dust ring shown briefly after a confirmed plant. */
function PlantPuff({ index, popRef }) {
  const ring = useRef();
  useFrame(() => {
    const m = ring.current;
    if (!m) return;
    const t0 = popRef.current[index];
    const k = t0 === undefined ? 2 : (performance.now() - t0) / 450;
    m.visible = k >= 0 && k < 1;
    if (m.visible) m.scale.set(0.4 + k * 1.1, 1, 0.4 + k * 1.1);
  });
  return <Part ref={ring} geo="disc" mat="puff" position={[0, 0.04, 0]} visible={false} />;
}

const Plot = memo(function Plot({ view, onSelect, busyRef, clockRef, popRef }) {
  const highlight = useRef();
  const dom = useThree((s) => s.gl.domElement);
  const [x, , z] = plotPosition(view.index);
  const filled = Boolean(view.cropId);

  const over = useCallback(
    (e) => {
      e.stopPropagation();
      if (highlight.current) highlight.current.visible = true;
      dom.style.cursor = busyRef.current ? 'progress' : 'pointer';
    },
    [dom, busyRef],
  );
  const out = useCallback(
    (e) => {
      e.stopPropagation();
      if (highlight.current) highlight.current.visible = false;
      dom.style.cursor = '';
    },
    [dom],
  );
  const click = useCallback(
    (e) => {
      e.stopPropagation();
      if (busyRef.current) return; // an action is pending: ignore until the server answers
      onSelect(view.index);
    },
    [busyRef, onSelect, view.index],
  );

  return (
    <group position={[x, 0, z]} onPointerOver={over} onPointerOut={out} onClick={click}>
      <Part geo="box" mat="frame" receive position={[0, SOIL_TOP_Y - 0.1, 0]} scale={[PLOT_SIZE + 0.24, 0.1, PLOT_SIZE + 0.24]} />
      <Part geo="box" mat="soil" receive position={[0, SOIL_TOP_Y - 0.09, 0]} scale={[PLOT_SIZE - 0.02, 0.18, PLOT_SIZE - 0.02]} />
      <Part geo="ridge" mat="furrow" position={[0, SOIL_TOP_Y + 0.02, 0]} />
      <group ref={highlight} visible={false} position={[0, SOIL_TOP_Y + 0.06, 0]}>
        <Part geo="plane" mat="highlight" scale={[PLOT_SIZE + 0.36, 1, PLOT_SIZE + 0.36]} />
      </group>
      <group position={[0, SOIL_TOP_Y, 0]}>
        {filled && <Crop key={`${view.cropId}:${view.plantedAt}`} view={view} clockRef={clockRef} popRef={popRef} />}
        {view.phase === 'ready' && <ReadyFX />}
        <PlantPuff index={view.index} popRef={popRef} />
      </group>
    </group>
  );
});

export default Plot;
