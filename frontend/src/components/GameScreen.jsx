import { useCallback, useEffect, useState } from 'react';
import { useGame } from '../game/useGame.js';
import { formatSeconds, nextHint, plotPhase, remainingSeconds } from '../game/plotState.js';
import Header from './Header.jsx';
import Farm from './Farm.jsx';
import Shop from './Shop.jsx';
import Barn from './Barn.jsx';
import Tutorial from './Tutorial.jsx';

const tutorialKey = (userId) => `harvest-village:tutorial-seen:${userId}`;
// localStorage is used ONLY for this cosmetic "seen the tutorial" flag, never for game state.
const hasSeenTutorial = (userId) => {
  try {
    return localStorage.getItem(tutorialKey(userId)) === '1';
  } catch {
    return false;
  }
};

export default function GameScreen({ user, onLogout, onSessionExpired, notify }) {
  const game = useGame({ notify, onSessionExpired });
  const { state, now, busy } = game;
  const [tab, setTab] = useState('farm'); // used on small screens only
  const [selectedSeed, setSelectedSeed] = useState(null);
  const [showTutorial, setShowTutorial] = useState(() => !hasSeenTutorial(user.id));

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
    <div className="app">
      {state ? (
        <>
          <Header player={state.player} onHelp={() => setShowTutorial(true)} onLogout={onLogout} />

          <nav className="tabs" aria-label="Sections">
            {[['farm', 'Farm'], ['shop', 'Seed Shop'], ['barn', 'Barn']].map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'is-active' : ''} aria-current={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>

          <main className="layout">
            <div className={`col-farm tab-panel ${tab === 'farm' ? 'is-active' : ''}`}>
              <Farm
                state={state}
                now={now}
                selectedSeed={selectedSeed}
                onSelectSeed={setSelectedSeed}
                onPlotClick={onPlotClick}
                hint={nextHint(state, now)}
              />
            </div>
            <div className="col-side">
              <div className={`tab-panel ${tab === 'shop' ? 'is-active' : ''}`}>
                <Shop state={state} busy={busy} onBuy={game.buy} />
              </div>
              <div className={`tab-panel ${tab === 'barn' ? 'is-active' : ''}`}>
                <Barn state={state} busy={busy} onSell={game.sell} />
              </div>
            </div>
          </main>
        </>
      ) : (
        <p className="loading">Loading your farm…</p>
      )}
      {showTutorial && state && <Tutorial onClose={closeTutorial} />}
    </div>
  );
}
