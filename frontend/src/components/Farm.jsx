import { CropIcon, SeedPacket, Sprout } from './Icons.jsx';
import { formatSeconds, plotPhase, plotProgress, remainingSeconds } from '../game/plotState.js';

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

export default function Farm({ state, now, selectedSeed, onSelectSeed, onPlotClick, hint }) {
  const { catalog, inventory, farm } = state;
  return (
    <section className="card panel-farm" aria-labelledby="farm-title">
      <h2 id="farm-title">Your Farm</h2>
      <p className="hint-bar" aria-live="polite">{hint}</p>

      <div className="seed-tray" role="group" aria-label="Choose a seed to plant">
        {catalog.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`seed-pill ${selectedSeed === c.id ? 'is-selected' : ''}`}
            aria-pressed={selectedSeed === c.id}
            onClick={() => onSelectSeed(c.id)}
          >
            <SeedPacket cropId={c.id} size={30} />
            <span>{c.name}</span>
            <strong>×{inventory.seeds[c.id] ?? 0}</strong>
          </button>
        ))}
      </div>

      <div className="plot-grid" style={{ '--cols': farm.cols }}>
        {farm.plots.map((p) => (
          <Plot key={p.index} plot={p} catalog={catalog} now={now} onClick={onPlotClick} />
        ))}
      </div>
    </section>
  );
}
