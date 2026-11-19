import { useCallback, useEffect, useRef, useState } from 'react';
import { createFarmEvents } from '../farm3d/farmEvents.js';
import { prefers3d } from '../farm3d/webgl.js';
import { useGame } from '../game/useGame.js';
import { formatSeconds, nextHint, plotPhase, remainingSeconds } from '../game/plotState.js';
import Header from './Header.jsx';
import Farm from './Farm.jsx';
import Shop from './Shop.jsx';
import Barn from './Barn.jsx';
import { useDelivery } from '../game/useDelivery.js';
import DeliveryNotice from './DeliveryNotice.jsx';
import ClanQuestPanel from './ClanQuestPanel.jsx';
import PersonalQuestsPanel from './PersonalQuestsPanel.jsx';
import KioskModal from './KioskModal.jsx';
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

export default function GameScreen({ clansOpen = false, onCloseClans = () => {}, user, onLogout, onDeleteAccount, onSessionExpired, notify }) {
  const [farmEvents] = useState(createFarmEvents);
  const onActionResult = useCallback((res) => farmEvents.emit(res), [farmEvents]);
  const game = useGame({ notify, onSessionExpired, onActionResult });
  const { state, now, busy } = game;
  const [panel, setPanel] = useState(null); // 'shop' | 'barn' | null: one drawer at a time, closed by default
  const [use3d, setUse3d] = useState(prefers3d);
  const [kioskOpen, setKioskOpen] = useState(false);
  const openKiosk = useCallback(() => setKioskOpen(true), []);
  const closeKiosk = useCallback(() => setKioskOpen(false), []);
  const drawerRef = useRef(null);
  // The clans window and the Shop/Barn/Quests drawer share the corner of the screen: opening one closes the other.
  const togglePanel = useCallback((id) => {
    setPanel((p) => (p === id ? null : id));
    onCloseClans();
  }, [onCloseClans]);
  useEffect(() => { if (clansOpen) setPanel(null); }, [clansOpen]);
  useEffect(() => { if (panel) drawerRef.current?.focus(); }, [panel]);
  const fail3d = useCallback(() => setUse3d(false), []);
  const delivery = useDelivery({ game, use3d, ready: Boolean(state), onSessionExpired });
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

  // Keep a sensible crop selected for planting: the current one if we still have it, otherwise the first one we own.
  useEffect(() => {
    if (!state) return;
    const owned = state.inventory.crops;
    const open = state.catalog.filter((c) => c.unlockLevel <= state.player.level); // crops not unlocked yet are not offered
    if (selectedSeed && owned[selectedSeed] > 0 && open.some((c) => c.id === selectedSeed)) return;
    const firstOwned = open.find((c) => owned[c.id] > 0);
    if (firstOwned) setSelectedSeed(firstOwned.id);
    else if (!selectedSeed || !open.some((c) => c.id === selectedSeed)) setSelectedSeed(open[0]?.id ?? state.catalog[0].id);
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
    if (!crop) return notify('info', 'Choose a crop to plant first.');
    if ((state.inventory.crops[crop.id] ?? 0) < 1) {
      return notify('error', `You have no ${crop.name} to plant. Buy one in the Shop or harvest more.`);
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
                delivery={delivery.scene}
                onOpenKiosk={openKiosk}
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
              aria-label={{ shop: 'Shop', barn: 'Barn', quest: 'Quests' }[panel]}
              onKeyDown={(e) => { if (e.key === 'Escape') setPanel(null); }}
            >
              <button type="button" className="drawer-close" aria-label="Close panel" onClick={() => setPanel(null)}>×</button>
              {panel === 'shop' && <Shop state={state} busy={busy} onBuy={game.buy} />}
              {panel === 'barn' && <Barn state={state} busy={busy} onSell={game.sell} />}
              {panel === 'quest' && (
                <>
                  <PersonalQuestsPanel state={state} game={game} />
                  <ClanQuestPanel state={state} game={game} onSessionExpired={onSessionExpired} />
                </>
              )}
            </aside>
          )}
        </>
      ) : (
        <p className="loading">Loading your farm…</p>
      )}
      {state && <DeliveryNotice message={delivery.message} waiting={delivery.waiting} onCollect={delivery.collect} />}
      {kioskOpen && state && <KioskModal state={state} game={game} onClose={closeKiosk} onSessionExpired={onSessionExpired} />}
      {showTutorial && state && <Tutorial onClose={closeTutorial} />}
      {showAccountSettings && <AccountSettingsDialog username={user.username} onClose={() => setShowAccountSettings(false)} onDeleteAccount={onDeleteAccount} />}
    </div>
  );
}
