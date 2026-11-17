import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Coin, CropIcon } from './Icons.jsx';

const REFRESH_MS = 15000;

const newKey = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* insecure context: fall through */ }
  return `k${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

/**
 * Village Festival drawer. Everything shown comes from the server (clan, progress, rewards); the panel is mounted
 * only while open, so opening it always re-verifies the clan, and closing/logout/account change drops its state.
 */
export default function ClanQuestPanel({ state, game, onSessionExpired }) {
  const [quest, setQuest] = useState(null); // last server answer (null while loading or if it could not be verified)
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const attempt = useRef(null); // { quantity, key }: reused when a request may or may not have reached the server
  const { busy } = game;
  const carrots = state.inventory.crops.carrot ?? 0;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await api.quest();
      if (alive.current && mine === seq.current) { setQuest(next); setError(null); }
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      if (err.status === 401) return onSessionExpired();
      setQuest(null); // could not verify the clan: never keep showing data that may belong to another clan
      setError(err.message);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    alive.current = true;
    load();
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  const contribute = async (quantity) => {
    const a = attempt.current?.quantity === quantity ? attempt.current : { quantity, key: newKey() };
    attempt.current = a; // same key on a retry after a network/server failure, so it can never deduct twice
    const result = await game.contributeQuest(quantity, a.key);
    if (result.ok || (result.err && result.err.status > 0 && result.err.status < 500)) attempt.current = null;
    load();
  };
  const claim = async () => {
    await game.claimQuest();
    load();
  };

  const q = quest?.quest;
  const me = quest?.me;
  const pct = q ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
  let why = null;
  if (q && !q.completed) {
    if (carrots < 1) why = 'Harvest some carrots first, then contribute them here.';
    else if (carrots < 5) why = 'You need 5 carrots for “Contribute 5”.';
  }

  return (
    <section className="card quest-card" aria-labelledby="quest-title">
      <h2 id="quest-title">Village Festival</h2>
      <p className="hint">Your clan is planning a festival! Work together in chat and bring {q?.target ?? 100} carrots to the village.</p>

      {!quest && !error && <p role="status">Checking your clan…</p>}

      {error && (
        <div className="quest-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-small" onClick={load}>Try again</button>
        </div>
      )}

      {quest && !quest.clan && (
        <p className="quest-note" role="status">
          <strong>Join a clan to participate.</strong> Use the “Open clans” button in the corner to find or join one, then come back.
        </p>
      )}

      {quest?.clan && (
        <>
          <p className="quest-clan">Clan: <strong>{quest.clan.name}</strong></p>
          <div className={`quest-progress ${q.completed ? 'is-done' : ''}`}>
            <div className="quest-count">
              <CropIcon cropId={q.cropId} size={26} />
              <strong>{q.progress} / {q.target} carrots</strong>
            </div>
            <div className="xp-bar quest-bar" role="progressbar" aria-label="Shared quest progress" aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={q.progress}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>

          <ul className="quest-facts">
            <li>You contributed: <strong>{me.contributed}</strong></li>
            <li>Your harvested carrots: <strong>{carrots}</strong></li>
            <li>Reward: <Coin size={14} /> <strong>{q.rewardCoins} coins</strong> each for contributors</li>
          </ul>

          {!q.completed && (
            <>
              <div className="row">
                {[1, 5].map((n) => (
                  <button key={n} type="button" className="btn btn-primary" disabled={busy || carrots < n} onClick={() => contribute(n)}>
                    Contribute {n}
                  </button>
                ))}
              </div>
              {why && <p className="hint quest-why">{why}</p>}
              {busy && <p className="hint quest-why" role="status">Working…</p>}
            </>
          )}

          {q.completed && (
            <div className="quest-celebrate" role="status">
              <p className="quest-party" aria-hidden="true"><i /><i /><i /><i /><i /></p>
              <strong>The Village Festival is complete!</strong>
              {me.claimed ? (
                <p className="quest-claimed">Reward claimed</p>
              ) : me.canClaim ? (
                <button type="button" className="btn btn-primary btn-wide" disabled={busy} onClick={claim}>Claim {q.rewardCoins} coins</button>
              ) : (
                <p className="hint">You didn’t contribute any carrots before it finished, so there is no reward for you this time.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
