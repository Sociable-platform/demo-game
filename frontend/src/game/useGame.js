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
const pluralName = (name) => `${name}${/o$/i.test(name) ? 'es' : 's'}`;

/** "Level up! You reached level 2. New crop unlocked: 3 Potatoes, 3 Pumpkins." */
function levelUpText(r, cropName) {
  const base = `Level up! You reached level ${r.newLevel}.`;
  const crops = Array.isArray(r.unlockedCrops) ? r.unlockedCrops : [];
  if (!crops.length) return base;
  return `${base} New crop${crops.length === 1 ? '' : 's'} unlocked: ${crops.map((id) => `3 ${pluralName(cropName(id))}`).join(', ')}.`;
}

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
      if (busyRef.current) return { ok: false, err: null };
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await call();
        if (!alive.current) return { ok: true };
        apply(res.state);
        onSuccess(res);
        try { resultRef.current?.(res); } catch { /* visual effects must never break a confirmed action */ }
        return { ok: true };
      } catch (err) {
        fail(err);
        if (err.status === 409) await refresh(); // our view was stale (e.g. crop not actually ready)
        return { ok: false, err };
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
        (r) => notify('success', `Bought ${r.quantity} ${cropName(cropId)}${r.quantity === 1 ? '' : 's'} for ${r.coinsSpent} coins.`),
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
          const n = Number.isInteger(r.yield) && r.yield > 0 ? r.yield : 1;
          notify('success', `Harvested ${n} ${n === 1 ? cropName(r.cropId) : pluralName(cropName(r.cropId))}! +${r.xpGained} XP`);
          if (r.leveledUp) notify('success', levelUpText(r, cropName));
        },
      ),
    // Clan quest: the server decides the clan, the accepted amount and the reward; we only render the answer.
    contributeQuest: (quantity, idempotencyKey) =>
      run(
        () => api.questContribute(quantity, idempotencyKey),
        (r) => notify('success', `Contributed ${plural(r.accepted, 'carrot')} to the Village Festival.`),
      ),
    claimQuest: () =>
      run(
        () => api.questClaim(),
        (r) => notify('success', r.coinsGranted > 0 ? `Reward claimed: +${r.coinsGranted} coins!` : 'Reward already claimed.'),
      ),
    // Kiosk (player-to-player market). The server verifies clan/friends and moves coins and crops atomically.
    marketOffer: (offer) =>
      run(
        () => api.marketCreate(offer),
        () => notify('success', `Offer posted: ${offer.quantity} ${cropName(offer.cropId)} for ${offer.price} coins.`),
      ),
    marketCancel: (id) =>
      run(
        () => api.marketCancel(id),
        (r) => notify('info', r.cancelled ? 'Offer cancelled. Your crops are back in the barn.' : 'That offer was already closed.'),
      ),
    marketBuy: (id) =>
      run(
        () => api.marketBuy(id),
        (r) => notify('success', `Bought ${r.quantity} ${cropName(r.cropId)} from ${r.seller} for ${r.price} coins.`),
      ),
    // Personal level quest: the server validates progress and pays XP + coins once; the state it returns updates the HUD.
    claimPersonalQuest: (questId) =>
      run(
        () => api.personalQuestClaim(questId),
        (r) => {
          if (!r.granted) return notify('info', 'That quest reward was already claimed.');
          notify('success', `Quest complete! +${r.reward.xp} XP, +${r.reward.coins} coins`);
          if (r.leveledUp) notify('success', levelUpText(r, cropName));
          return undefined;
        },
      ),
    // Courier delivery: only the delivery id is sent. The server decides and returns the reward; state is replaced
    // by the authoritative state in `run`. Resolves { ok, granted, reward, err }; never rejects.
    claimDelivery: async (id) => {
      let reply = null;
      const r = await run(() => api.deliveryClaim(id), (res) => { reply = res; });
      return r.ok && reply ? { ok: true, granted: Boolean(reply.granted), reward: reply.reward } : { ok: false, granted: false, err: r.err };
    },
    sell: (cropId, quantity) =>
      run(
        () => api.sell(cropId, quantity),
        (r) => notify('success', `Sold ${r.quantity} ${cropName(cropId)} for ${r.coinsEarned} coins.`),
      ),
  };
}
