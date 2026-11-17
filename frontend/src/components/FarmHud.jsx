import { SeedPacket } from './Icons.jsx';

/**
 * Compact farm HUD: seed picker, Shop/Barn buttons and the next-step hint. Coins and level/XP live in the header.
 * `overlay` floats it over the 3D world; otherwise it is a normal bar above the 2D farm.
 */
export default function FarmHud({ catalog, inventory, selectedSeed, onSelectSeed, hint, panel, onTogglePanel, overlay = false }) {
  return (
    <div className={`farm-hud ${overlay ? 'farm-hud--overlay' : ''}`}>
      <div className="seed-tray farm-hud-seeds" role="group" aria-label="Choose a seed to plant">
        {catalog.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`seed-pill ${selectedSeed === c.id ? 'is-selected' : ''}`}
            aria-pressed={selectedSeed === c.id}
            onClick={() => onSelectSeed(c.id)}
          >
            <SeedPacket cropId={c.id} size={28} />
            <span className="seed-pill-name">{c.name}</span>
            <strong>×{inventory.seeds[c.id] ?? 0}</strong>
          </button>
        ))}
      </div>
      <div className="farm-hud-menu">
        {[['shop', 'Seed Shop'], ['barn', 'Barn']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-small ${panel === id ? 'btn-primary' : ''}`}
            aria-expanded={panel === id}
            aria-controls="farm-drawer"
            onClick={() => onTogglePanel(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="hint-bar farm-hud-hint" aria-live="polite">{hint}</p>
    </div>
  );
}
