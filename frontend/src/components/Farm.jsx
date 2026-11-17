import { Component, Suspense, lazy } from 'react';
import { CropIcon, Sprout } from './Icons.jsx';
import FarmHud from './FarmHud.jsx';
import { formatSeconds, plotPhase, plotProgress, remainingSeconds } from '../game/plotState.js';

// three.js is loaded on demand, so the login screen and the 2D fallback never download it.
const Farm3D = lazy(() => import('../farm3d/Farm3D.jsx'));

// Any render error in the 3D farm (WebGL creation, shader, chunk load) falls back to the 2D grid.
class FarmBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('3D farm unavailable, using the 2D farm.', error); this.props.onError?.(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const PHASE_LABEL = { empty: 'Empty', planted: 'Planted', growing: 'Growing', ready: 'Ready!' };

function Plot({ plot, catalog, now, onClick }) {
  const crop = catalog.find((c) => c.id === plot.cropId);
  const phase = plotPhase(plot, now);
  const progress = plotProgress(plot, now);
  const secs = remainingSeconds(plot, now);
  const label =
    phase === 'empty'
      ? `Plot ${plot.index + 1}: empty. Tap to plant.`
      : phase === 'ready'
        ? `Plot ${plot.index + 1}: ${crop.name} is ready. Tap to harvest.`
        : `Plot ${plot.index + 1}: ${crop.name} ${PHASE_LABEL[phase].toLowerCase()}, ${secs} seconds left.`;

  return (
    <button type="button" className={`plot plot-${phase}`} onClick={() => onClick(plot, phase)} aria-label={label}>
      <span className="plot-badge">{PHASE_LABEL[phase]}</span>
      <span className="plot-art">
        {phase === 'empty' && <span className="plot-plus" aria-hidden="true">+</span>}
        {(phase === 'planted' || phase === 'growing') && <Sprout scale={0.45 + 0.55 * progress} size={64} />}
        {phase === 'ready' && <CropIcon cropId={plot.cropId} size={60} className="bounce" />}
      </span>
      <span className="plot-foot">
        {phase === 'empty' && <span>Tap to plant</span>}
        {(phase === 'planted' || phase === 'growing') && (
          <>
            <span className="plot-bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
            <span>{crop.name} · {formatSeconds(secs)}</span>
          </>
        )}
        {phase === 'ready' && <span>Tap to harvest</span>}
      </span>
    </button>
  );
}

export default function Farm({ state, now, selectedSeed, onSelectSeed, onPlotClick, hint, busy = false, events, use3d, onFail3d, panel, onTogglePanel }) {
  const { catalog, inventory, farm } = state;
  const hud = (overlay) => (
    <FarmHud catalog={catalog} inventory={inventory} selectedSeed={selectedSeed} onSelectSeed={onSelectSeed} hint={hint}
      panel={panel} onTogglePanel={onTogglePanel} overlay={overlay} />
  );
  const classic = (
    <section className="card panel-farm" aria-labelledby="farm-title">
      <h2 id="farm-title">Your Farm</h2>
      {hud(false)}
      <div className="plot-grid" style={{ '--cols': farm.cols }}>
        {farm.plots.map((p) => (
          <Plot key={p.index} plot={p} catalog={catalog} now={now} onClick={onPlotClick} />
        ))}
      </div>
    </section>
  );
  if (!use3d || !events) return classic;
  return (
    <section className="farm-world" aria-label="Your farm">
      <FarmBoundary fallback={classic} onError={onFail3d}>
        <Suspense fallback={<div className="farm3d-loading" role="status">Loading your 3D farm…</div>}>
          <Farm3D state={state} now={now} busy={busy} events={events} onPlotClick={onPlotClick} onFail={onFail3d} />
        </Suspense>
        {hud(true)}
      </FarmBoundary>
    </section>
  );
}
