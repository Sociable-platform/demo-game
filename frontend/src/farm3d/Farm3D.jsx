import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import FarmScene from './FarmScene.jsx';
import { plotsSignature } from './layout.js';
import { formatSeconds, plotPhase, remainingSeconds } from '../game/plotState.js';

const PHASE_LABEL = { empty: 'Empty', planted: 'Planted', growing: 'Growing', ready: 'Ready!' };
const FLOAT_MS = 1700;

/**
 * The 3D farm. It renders the SAME authoritative state as the 2D grid and calls the SAME click handler.
 * A compact DOM list under the canvas keeps timers, status and keyboard access readable outside WebGL.
 */
export default function Farm3D({ state, now, busy, events, onPlotClick, onFail }) {
  const { catalog, farm } = state;

  // Refs hold fast-changing values so the WebGL scene reads them per frame without React re-renders.
  const clockRef = useRef({ now, at: performance.now() });
  const busyRef = useRef(busy);
  const plotsRef = useRef(farm.plots);
  const cropNameRef = useRef(() => '');
  const controlRef = useRef(null); // lets the DOM plot list cancel a queued farmer interaction
  useEffect(() => { clockRef.current = { now, at: performance.now() }; }, [now]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { plotsRef.current = farm.plots; }, [farm.plots]);
  useEffect(() => { cropNameRef.current = (id) => catalog.find((c) => c.id === id)?.name; }, [catalog]);

  // Scene props only change when a plot's crop or phase changes (not on every 250 ms clock tick).
  const phases = farm.plots.map((p) => plotPhase(p, now));
  const signature = plotsSignature(farm.plots, (p) => phases[p.index] ?? plotPhase(p, now));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => farm.plots.map((p) => ({ index: p.index, cropId: p.cropId, plantedAt: p.plantedAt, readyAt: p.readyAt, phase: plotPhase(p, now) })), [signature]);

  const onSelect = useCallback(
    (index) => {
      const plot = plotsRef.current.find((p) => p.index === index);
      if (plot) onPlotClick(plot, plotPhase(plot, clockRef.current.now + performance.now() - clockRef.current.at));
    },
    [onPlotClick],
  );

  // Floating "+XP" feedback is created only from server-confirmed harvest results (see FarmScene).
  const [floats, setFloats] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  const onFloat = useCallback((items, x, y) => {
    const batch = items.map((item, i) => ({ ...item, x, y, delay: i * 160, id: nextId.current++ }));
    setFloats((f) => [...f, ...batch]);
    const t = setTimeout(() => {
      timers.current.delete(t);
      setFloats((f) => f.filter((it) => !batch.includes(it)));
    }, FLOAT_MS + batch.length * 160);
    timers.current.add(t);
  }, []);

  // If the GPU drops the WebGL context and it does not come back, hand over to the 2D farm.
  const cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(), []);
  const onCreated = useCallback(
    ({ gl }) => {
      const el = gl.domElement;
      let timer = null;
      const lost = (e) => { e.preventDefault(); timer = setTimeout(() => onFail?.(new Error('WebGL context lost')), 2500); };
      const restored = () => clearTimeout(timer);
      el.addEventListener('webglcontextlost', lost);
      el.addEventListener('webglcontextrestored', restored);
      cleanup.current = () => { clearTimeout(timer); el.removeEventListener('webglcontextlost', lost); el.removeEventListener('webglcontextrestored', restored); };
    },
    [onFail],
  );

  return (
    <div className="farm3d" aria-busy={busy}>
      <div className="farm3d-stage">
        <Canvas
          orthographic
          shadows
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [10.5, 10, 17.9], zoom: 40, near: 0.1, far: 120 }}
          onCreated={onCreated}
          role="img"
          aria-label="Your 3D farm. Use the plot list below the picture for keyboard access."
        >
          <FarmScene views={views} events={events} onSelect={onSelect} busyRef={busyRef} clockRef={clockRef} cropNameRef={cropNameRef} onFloat={onFloat} controlRef={controlRef} />
        </Canvas>
        <div className="farm3d-floats" aria-hidden="true">
          {floats.map((f) => (
            <span key={f.id} className={`farm3d-float farm3d-float-${f.kind}`} style={{ left: f.x, top: f.y, animationDelay: `${f.delay}ms` }}>
              {f.text}
            </span>
          ))}
        </div>
        {busy && <div className="farm3d-pending" role="status">Working…</div>}
      </div>

      <details className="farm3d-plotpanel">
        <summary>Plots</summary>
      <ul className="farm3d-plots" aria-label="Farm plots">
        {farm.plots.map((p) => {
          const crop = catalog.find((c) => c.id === p.cropId);
          const phase = phases[p.index] ?? 'empty';
          const secs = remainingSeconds(p, now);
          const label =
            phase === 'empty'
              ? `Plot ${p.index + 1}: empty. Activate to plant.`
              : phase === 'ready'
                ? `Plot ${p.index + 1}: ${crop?.name} is ready. Activate to harvest.`
                : `Plot ${p.index + 1}: ${crop?.name} ${PHASE_LABEL[phase].toLowerCase()}, ${secs} seconds left.`;
          return (
            <li key={p.index}>
              <button type="button" className={`farm3d-chip farm3d-chip-${phase}`} aria-disabled={busy} aria-label={label} onClick={() => { if (busy) return; controlRef.current?.cancel(); onPlotClick(p, phase); }}>
                <span className="farm3d-chip-no">{p.index + 1}</span>
                <span className="farm3d-chip-text">
                  {phase === 'empty' && 'Empty'}
                  {(phase === 'planted' || phase === 'growing') && `${crop?.name} · ${formatSeconds(secs)}`}
                  {phase === 'ready' && `${crop?.name} · Ready!`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      </details>
    </div>
  );
}
