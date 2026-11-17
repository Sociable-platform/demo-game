import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { clockOffset } from './plotState.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Holds the server's game state and exposes the player's actions.
 * - Every successful action returns the new authoritative state from the server; we just render it.
 * - `now` is server-adjusted time, refreshed 4x per second, used only to DRAW progress.
 * - `busy` blocks overlapping requests (double clicks); the server independently guards against duplicates.
 */
export function useGame({ notify, onSessionExpired, onActionResult }) {
  const [state, setState] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const offsetRef = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const resultRef = useRef(onActionResult);
  useEffect(() => { resultRef.current = onActionResult; }, [onActionResult]);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = useCallback((next) => {
    if (!alive.current) return;
    offsetRef.current = clockOffset(next.serverTime);
    setNow(Date.now() + offsetRef.current);
    setState(next);
  }, []);

  const fail = useCallback(
    (err) => {
      if (!alive.current) return;
      if (err.status === 401) onSessionExpired();
      else notify('error', err.message);
    },
    [notify, onSessionExpired],
  );

  const refresh = useCallback(async () => {
    try {
      apply(await api.state());
    } catch (err) {
      fail(err);
    }
  }, [apply, fail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Tick the display clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetRef.current), 250);
    return () => clearInterval(id);
  }, []);

  // When the next crop should become ripe, re-sync with the server instead of trusting the local timer.
  useEffect(() => {
    if (!state) return undefined;
    const serverNow = Date.now() + offsetRef.current;
    const upcoming = state.farm.plots.filter((p) => p.cropId && p.readyAt > serverNow).map((p) => p.readyAt);
    if (upcoming.length === 0) return undefined;
    const delay = Math.min(...upcoming) - serverNow + 400;
    const id = setTimeout(refresh, delay);
    return () => clearTimeout(id);
  }, [state, refresh]);

  const run = useCallback(
    async (call, onSuccess) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await call();
        if (!alive.current) return;
        apply(res.state);
        onSuccess(res);
        try { resultRef.current?.(res); } catch { /* visual effects must never break a confirmed action */ }
      } catch (err) {
        fail(err);
        if (err.status === 409) await refresh(); // our view was stale (e.g. crop not actually ready)
      } finally {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [apply, fail, refresh],
  );

  const cropName = (id) => state?.catalog.find((c) => c.id === id)?.name ?? id;

  return {
    state,
    now,
    busy,
    refresh,
    buy: (cropId, quantity) =>
      run(
        () => api.buy(cropId, quantity),
        (r) => notify('success', `Bought ${plural(r.quantity, cropName(cropId) + ' seed')} for ${r.coinsSpent} coins.`),
      ),
    plant: (plotIndex, cropId) =>
      run(
        () => api.plant(plotIndex, cropId),
        () => notify('success', `Planted ${cropName(cropId)} in plot ${plotIndex + 1}.`),
      ),
    harvest: (plotIndex) =>
      run(
        () => api.harvest(plotIndex),
        (r) => {
          notify('success', `Harvested ${cropName(r.cropId)}! +${r.xpGained} XP`);
          if (r.leveledUp) notify('success', `Level up! You reached level ${r.newLevel}.`);
        },
      ),
    sell: (cropId, quantity) =>
      run(
        () => api.sell(cropId, quantity),
        (r) => notify('success', `Sold ${r.quantity} ${cropName(cropId)} for ${r.coinsEarned} coins.`),
      ),
  };
}
