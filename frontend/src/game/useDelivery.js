import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const MESSAGE_MS = 4500;
const SLACK_MS = 800; // wait slightly past the server's cooldown end before asking again
const RETRY_MS = 30000;

const rewardText = ({ kind, amount }) => (kind === 'coins' ? `+${amount} coins` : `+${amount} carrot${amount === 1 ? '' : 's'}`);

/**
 * Courier deliveries. The SERVER decides eligibility, the delivery id and the reward; this hook only asks
 * (GET /api/delivery), plays the visit, and requests the claim by id when the PLAYER collects the parcel
 * (the farmer walking up to it in 3D, or the button in the 2D fallback). Nothing is paid on the courier's arrival.
 *
 *  scene:   props for the 3D scene ({ visit, onPlaced, onDone, collect })
 *  waiting: 2D fallback only - a delivery is waiting and can be collected
 *  message: "Delivery received: +20 coins", set ONLY from a server-confirmed claim
 *
 * No timers run after unmount; GameScreen is keyed by user, so logout / account change tears everything down.
 */
export function useDelivery({ game, use3d, ready, onSessionExpired }) {
  const [visit, setVisit] = useState(null); // { key, id }: the courier is walking
  const [waiting, setWaiting] = useState(null); // delivery id, 2D fallback
  const [message, setMessage] = useState(null);
  const alive = useRef(true);
  const timers = useRef({ next: null, msg: null, retry: null });
  const visitRef = useRef(null);
  const parcelRef = useRef(null); // id of the parcel waiting at the door (3D)
  const waitingRef = useRef(null);
  const loading = useRef(false);
  const claims = useRef(new Map()); // delivery id -> in-flight claim promise (one request per id)
  const keySeq = useRef(0);
  const gameRef = useRef(game);
  const use3dRef = useRef(use3d);
  const expiredRef = useRef(onSessionExpired);
  gameRef.current = game;
  use3dRef.current = use3d;
  expiredRef.current = onSessionExpired;

  const setVisitBoth = (v) => { visitRef.current = v; setVisit(v); };
  const setWaitingBoth = (w) => { waitingRef.current = w; setWaiting(w); };
  const busyNow = () => Boolean(visitRef.current || parcelRef.current || waitingRef.current);

  const showMessage = useCallback((text) => {
    clearTimeout(timers.current.msg);
    setMessage(text);
    timers.current.msg = setTimeout(() => setMessage(null), MESSAGE_MS);
  }, []);

  const load = useCallback(async () => {
    if (!alive.current || loading.current || busyNow()) return;
    loading.current = true;
    clearTimeout(timers.current.next);
    clearTimeout(timers.current.retry);
    try {
      const res = await api.delivery();
      if (!alive.current || busyNow()) return;
      if (res.delivery) {
        if (use3dRef.current) setVisitBoth({ key: ++keySeq.current, id: res.delivery.id });
        else setWaitingBoth(res.delivery.id);
      } else if (res.nextEligibleAt) {
        const wait = Math.max(1000, res.nextEligibleAt - res.serverTime + SLACK_MS);
        timers.current.next = setTimeout(load, Math.min(wait, 2 ** 30));
      }
    } catch (err) {
      if (!alive.current) return;
      if (err.status === 401) expiredRef.current();
      else timers.current.retry = setTimeout(load, RETRY_MS); // quiet: nothing was promised to the player yet
    } finally {
      loading.current = false;
    }
  }, []);

  // One claim request per delivery id. Resolves { ok, granted }; never rejects. Shows the message only on success.
  const claim = useCallback((id) => {
    const existing = claims.current.get(id);
    if (existing) return existing;
    const p = (async () => {
      let r = { ok: false, granted: false };
      for (let attempt = 0; attempt < 6 && alive.current; attempt += 1) {
        r = await gameRef.current.claimDelivery(id);
        if (r.ok || r.err) break; // success, or a real error (already reported by useGame)
        await new Promise((resolve) => setTimeout(resolve, 500)); // another action was in flight: try again shortly
      }
      if (r.ok && r.granted && alive.current) showMessage(`Delivery received: ${rewardText(r.reward)}`);
      if (r.err?.status === 404) return { ok: true, granted: false }; // not ours / gone: nothing to retry
      return { ok: r.ok, granted: r.ok && r.granted };
    })().finally(() => { claims.current.delete(id); });
    claims.current.set(id, p);
    return p;
  }, [showMessage]);

  // The courier put the parcel down: from now on the player can collect it.
  const onPlaced = useCallback(() => { if (visitRef.current) parcelRef.current = visitRef.current.id; }, []);

  const onDone = useCallback((outcome) => {
    if (!alive.current) return;
    if (outcome === 'skipped') { setWaitingBoth(visitRef.current?.id ?? null); setVisitBoth(null); return; }
    setVisitBoth(null); // the parcel (parcelRef) stays at the door until collected
  }, []);

  // 3D: called when the farmer reaches the parcel.
  const collect = useCallback(async () => {
    const id = parcelRef.current;
    if (!id) return { ok: true, granted: false };
    const r = await claim(id);
    if (r.ok && alive.current) { parcelRef.current = null; load(); }
    return r;
  }, [claim, load]);

  // 2D fallback (or WebGL lost): the same server-controlled delivery, collected with a button.
  const collect2d = useCallback(async () => {
    const id = waitingRef.current;
    if (!id) return;
    const r = await claim(id);
    if (!alive.current) return;
    if (r.ok) { setWaitingBoth(null); load(); }
  }, [claim, load]);

  useEffect(() => {
    if (use3d) return;
    const id = visitRef.current?.id ?? parcelRef.current;
    if (id) { parcelRef.current = null; setVisitBoth(null); setWaitingBoth(id); }
  }, [use3d]);

  useEffect(() => {
    alive.current = true;
    const t = timers.current;
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(t.next); clearTimeout(t.msg); clearTimeout(t.retry);
    };
  }, [load]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  return {
    scene: { visit, onPlaced, onDone, collect },
    waiting: Boolean(waiting) && !use3d,
    message,
    collect: collect2d,
  };
}
