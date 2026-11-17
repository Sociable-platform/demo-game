import { CropIcon } from './Icons.jsx';

/**
 * Compact farm HUD: crop picker (what to plant), Shop/Barn buttons and the next-step hint. Coins and level/XP live in the header.
 * `overlay` floats it over the 3D world; otherwise it is a normal bar above the 2D farm.
 */
export default function FarmHud({ catalog, inventory, selectedSeed, onSelectSeed, hint, panel, onTogglePanel, onOpenKiosk, overlay = false }) {
  return (
    <div className={`farm-hud ${overlay ? 'farm-hud--overlay' : ''}`}>
      <div className="seed-tray farm-hud-seeds" role="group" aria-label="Choose a crop to plant">
        {catalog.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`seed-pill ${selectedSeed === c.id ? 'is-selected' : ''}`}
            aria-pressed={selectedSeed === c.id}
            onClick={() => onSelectSeed(c.id)}
          >
            <CropIcon cropId={c.id} size={28} />
            <span className="seed-pill-name">{c.name}</span>
            <strong>×{inventory.crops[c.id] ?? 0}</strong>
          </button>
        ))}
      </div>
      <div className="farm-hud-menu">
        {/* In the 3D world only Quests is a button; the Kiosk is reached by walking up to it. The 2D farm has no world to walk in, so it keeps every button. */}
        {!overlay && <button type="button" className="btn btn-small" aria-haspopup="dialog" onClick={onOpenKiosk}>Kiosk</button>}
        {[['shop', 'Shop'], ['barn', 'Barn'], ['quest', 'Quests']].filter(([id]) => !overlay || id === 'quest').map(([id, label]) => (
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
