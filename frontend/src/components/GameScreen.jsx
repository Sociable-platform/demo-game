import { useCallback, useEffect, useRef, useState } from 'react';
import { createFarmEvents } from '../farm3d/farmEvents.js';
import { prefers3d } from '../farm3d/webgl.js';
import { useGame } from '../game/useGame.js';
import { formatSeconds, nextHint, plotPhase, remainingSeconds } from '../game/plotState.js';
import Header from './Header.jsx';
import Farm from './Farm.jsx';
import Shop from './Shop.jsx';
import Barn from './Barn.jsx';
import Tutorial from './Tutorial.jsx';
import AccountSettingsDialog from './AccountSettingsDialog.jsx';

const tutorialKey = (userId) => `harvest-village:tutorial-seen:${userId}`;
// localStorage is used ONLY for this cosmetic "seen the tutorial" flag, never for game state.
const hasSeenTutorial = (userId) => {
  try {
    return localStorage.getItem(tutorialKey(userId)) === '1';
  } catch {
    return false;
  }
};

export default function GameScreen({ user, onLogout, onDeleteAccount, onSessionExpired, notify }) {
  const [farmEvents] = useState(createFarmEvents);
  const onActionResult = useCallback((res) => farmEvents.emit(res), [farmEvents]);
  const game = useGame({ notify, onSessionExpired, onActionResult });
  const { state, now, busy } = game;
  const [panel, setPanel] = useState(null); // 'shop' | 'barn' | null: one drawer at a time, closed by default
  const [use3d, setUse3d] = useState(prefers3d);
  const drawerRef = useRef(null);
  const togglePanel = useCallback((id) => setPanel((p) => (p === id ? null : id)), []);
  useEffect(() => { if (panel) drawerRef.current?.focus(); }, [panel]);
  const fail3d = useCallback(() => setUse3d(false), []);
  const [selectedSeed, setSelectedSeed] = useState(null);
  const [showTutorial, setShowTutorial] = useState(() => !hasSeenTutorial(user.id));
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  const closeTutorial = useCallback(() => {
    setShowTutorial(false);
    try {
      localStorage.setItem(tutorialKey(user.id), '1');
    } catch {
      /* private mode: tutorial will simply show again next time */
    }
  }, [user.id]);

  // Keep a sensible seed selected: the current one if we still have it, otherwise the first one we own.
  useEffect(() => {
    if (!state) return;
    const seeds = state.inventory.seeds;
    if (selectedSeed && seeds[selectedSeed] > 0) return;
    const firstOwned = state.catalog.find((c) => seeds[c.id] > 0);
    if (firstOwned) setSelectedSeed(firstOwned.id);
    else if (!selectedSeed) setSelectedSeed(state.catalog[0].id);
  }, [state, selectedSeed]);

  const onPlotClick = (plot) => {
    const phase = plotPhase(plot, now);
    const name = state.catalog.find((c) => c.id === plot.cropId)?.name;
    if (phase === 'ready') return game.harvest(plot.index);
    if (phase === 'planted' || phase === 'growing') {
      return notify('info', `${name} is still growing: ${formatSeconds(remainingSeconds(plot, now))} left.`);
    }
    // Empty plot
    const crop = state.catalog.find((c) => c.id === selectedSeed);
    if (!crop) return notify('info', 'Choose a seed first.');
    if ((state.inventory.seeds[crop.id] ?? 0) < 1) {
      return notify('error', `You're out of ${crop.name} seeds. Buy more in the Seed Shop.`);
    }
    return game.plant(plot.index, crop.id);
  };

  return (
    <div className={`app ${use3d ? 'app-3d' : ''}`}>
      {state ? (
        <>
          <Header player={state.player} onHelp={() => setShowTutorial(true)} onLogout={onLogout}
            onAccountSettings={() => { setShowTutorial(false); setShowAccountSettings(true); }} />

          <main className="layout">
            <div className="col-farm">
              <Farm
                state={state}
                now={now}
                selectedSeed={selectedSeed}
                onSelectSeed={setSelectedSeed}
                onPlotClick={onPlotClick}
                hint={nextHint(state, now)}
                busy={busy}
                events={farmEvents}
                use3d={use3d}
                onFail3d={fail3d}
                panel={panel}
                onTogglePanel={togglePanel}
              />
            </div>
          </main>

          {panel && (
            <aside
              id="farm-drawer"
              ref={drawerRef}
              tabIndex={-1}
              className="drawer"
              role="dialog"
              aria-label={panel === 'shop' ? 'Seed Shop' : 'Barn'}
              onKeyDown={(e) => { if (e.key === 'Escape') setPanel(null); }}
            >
              <button type="button" className="drawer-close" aria-label="Close panel" onClick={() => setPanel(null)}>×</button>
              {panel === 'shop' ? <Shop state={state} busy={busy} onBuy={game.buy} /> : <Barn state={state} busy={busy} onSell={game.sell} />}
            </aside>
          )}
        </>
      ) : (
        <p className="loading">Loading your farm…</p>
      )}
      {showTutorial && state && <Tutorial onClose={closeTutorial} />}
      {showAccountSettings && <AccountSettingsDialog username={user.username} onClose={() => setShowAccountSettings(false)} onDeleteAccount={onDeleteAccount} />}
    </div>
  );
}
