import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Coin, CropIcon } from './Icons.jsx';

const REFRESH_MS = 15000;
const MAX_QUANTITY = 999;
const MAX_PRICE = 100000;
const PRICE_HEADROOM = 100; // the server enforces: asking price <= default price x amount + 100
const AUDIENCE_LABEL = { clan: 'Clan', friends: 'Friends', all: 'Everyone' };
const audienceText = (list) => list.map((a) => AUDIENCE_LABEL[a]).join(' + ');
const plural = (name, n) => (n === 1 ? name : `${name}${/o$/i.test(name) ? 'es' : 's'}`);

/**
 * The Kiosk: trade harvested crops with clan mates and friends. Everything shown (offers, who may see them, prices)
 * comes from the server, which verifies the clan/friend relationship itself; this modal only renders it and asks the
 * server to post, cancel or buy an offer by id. Modal DOM sits outside the canvas, so nothing here moves the farmer.
 */
export default function KioskModal({ state, game, onClose, onSessionExpired }) {
  const dialog = useRef(null);
  const [view, setView] = useState('home'); // 'home' | 'sell' | 'buy'
  const [market, setMarket] = useState(null); // last server answer
  const [loadError, setLoadError] = useState(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const { catalog, inventory, player } = state;
  const nameOf = (id) => catalog.find((c) => c.id === id)?.name ?? id;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await api.market();
      if (alive.current && mine === seq.current) { setMarket(next); setLoadError(null); }
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      if (err.status === 401) return onSessionExpired();
      setMarket(null); // never keep showing offers we could not re-verify
      setLoadError(err.message);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    load();
    game.refresh(); // coins from sales made while the Kiosk was closed
    const tick = () => { if (document.visibilityState === 'visible') { load(); game.refresh(); } };
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
      dialog.current?.close();
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const back = () => setView('home');
  return (
    <dialog ref={dialog} className="card kiosk-dialog" aria-labelledby="kiosk-title"
      onCancel={(e) => { e.preventDefault(); if (view === 'home') onClose(); else back(); }}>
      <div className="kiosk-top">
        {view !== 'home' && <button type="button" className="btn btn-small" onClick={back}>← Back</button>}
        <h2 id="kiosk-title">{view === 'sell' ? 'Sell Product' : view === 'buy' ? 'Buy Product' : 'Kiosk'}</h2>
        <button type="button" className="kiosk-x" aria-label="Close Kiosk" onClick={onClose}>×</button>
      </div>

      {view === 'home' && (
        <div className="kiosk-home">
          <p className="hint">Trade your harvest with your clan and your friends.</p>
          <div className="kiosk-choices">
            <button type="button" className="btn btn-primary kiosk-choice" onClick={() => setView('sell')}>Sell Product</button>
            <button type="button" className="btn btn-primary kiosk-choice" onClick={() => setView('buy')}>Buy Product</button>
          </div>
          {market && <p className="hint kiosk-note">{market.mine.length} of your offers open · {market.offers.length} offers for you</p>}
          {loadError && <p className="kiosk-error" role="alert">{loadError} <button type="button" className="btn btn-small" onClick={load}>Try again</button></p>}
        </div>
      )}
      {view === 'sell' && (
        <SellView catalog={catalog} inventory={inventory} market={market} loadError={loadError} nameOf={nameOf} game={game} reload={load} />
      )}
      {view === 'buy' && (
        <BuyView market={market} loadError={loadError} coins={player.coins} nameOf={nameOf} game={game} reload={load} />
      )}
    </dialog>
  );
}

function SellView({ catalog, inventory, market, loadError, nameOf, game, reload }) {
  const owned = catalog.filter((c) => (inventory.crops[c.id] ?? 0) > 0);
  const [cropId, setCropId] = useState(owned[0]?.id ?? null);
  const [quantity, setQuantity] = useState(() => String(Math.max(1, Math.min(10, inventory.crops[owned[0]?.id] ?? 1))));
  const [price, setPrice] = useState('');
  const [customPrice, setCustomPrice] = useState(false); // the player typed their own price: stop auto-updating it
  const [audiences, setAudiences] = useState({ clan: false, friends: true, all: false });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const crop = catalog.find((c) => c.id === cropId);
  const have = cropId ? inventory.crops[cropId] ?? 0 : 0;
  const hasClan = Boolean(market?.circle.clan);
  const qty = Number(quantity);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= Math.min(have, MAX_QUANTITY);
  const suggested = crop && qtyOk ? crop.marketPrice * qty : null; // default price for this amount
  const maxPrice = suggested === null ? null : suggested + PRICE_HEADROOM;
  const cost = Number(price);
  const chosen = ['clan', 'friends', 'all'].filter((k) => audiences[k]);
  const priceOk = Number.isInteger(cost) && cost >= 1 && maxPrice !== null && cost <= maxPrice;
  const valid = Boolean(cropId) && qtyOk && priceOk && chosen.length > 0 && (!audiences.clan || hasClan);

  // The price follows the amount (default price x amount) until the player sets their own.
  useEffect(() => { if (!customPrice && suggested !== null) setPrice(String(suggested)); }, [customPrice, suggested]);
  useEffect(() => { if (market && !hasClan && audiences.clan) setAudiences((a) => ({ ...a, clan: false })); }, [market, hasClan, audiences.clan]);
  useEffect(() => { if (cropId && have < 1) setCropId(owned[0]?.id ?? null); }, [cropId, have, owned]);

  const pickCrop = (id) => {
    setCropId(id);
    setCustomPrice(false);
    const max = inventory.crops[id] ?? 1;
    setQuantity((q) => (Number(q) > max || !Number(q) ? String(Math.max(1, Math.min(10, max))) : q)); // never more than you own
  };
  // "Everyone" replaces the narrower audiences (it already includes them); picking Clan/Friends turns it off.
  const toggle = (key) => setAudiences((a) => (key === 'all' ? { clan: false, friends: false, all: !a.all } : { ...a, all: false, [key]: !a[key] }));

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || pending || game.busy) return;
    setPending(true);
    setError(null);
    const result = await game.marketOffer({ cropId, quantity: qty, price: cost, audiences: chosen });
    setPending(false);
    if (result.ok) { setCustomPrice(false); reload(); } else if (result.err) setError(result.err.message);
  };
  const cancel = async (id) => { await game.marketCancel(id); reload(); };

  return (
    <div className="kiosk-body">
      {owned.length === 0 ? (
        <p className="kiosk-empty">You have nothing to sell yet. Harvest some crops first!</p>
      ) : (
        <form onSubmit={submit} className="kiosk-form">
          <fieldset className="kiosk-field">
            <legend>What do you want to sell?</legend>
            <div className="kiosk-crops">
              {owned.map((c) => (
                <button key={c.id} type="button" className={`kiosk-crop ${cropId === c.id ? 'is-selected' : ''}`} aria-pressed={cropId === c.id} onClick={() => pickCrop(c.id)}>
                  <CropIcon cropId={c.id} size={30} />
                  <span>{c.name}</span>
                  <strong>×{inventory.crops[c.id]}</strong>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="kiosk-numbers">
            <label>Amount
              <input type="number" inputMode="numeric" min="1" max={Math.min(have, MAX_QUANTITY)} step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <label>Price (total coins)
              <input type="number" inputMode="numeric" min="1" max={maxPrice ?? MAX_PRICE} step="1" value={price}
                onChange={(e) => { setPrice(e.target.value); setCustomPrice(true); }} aria-describedby="kiosk-price-help" />
            </label>
          </div>
          <p id="kiosk-price-help" className="hint kiosk-note">
            {suggested !== null ? (
              <>
                Default price: <strong>{suggested} coins</strong> ({crop.marketPrice} each) · highest allowed: <strong>{maxPrice}</strong>
                {customPrice && <> · <button type="button" className="kiosk-link" onClick={() => setCustomPrice(false)}>Use default price</button></>}
              </>
            ) : 'Enter an amount you own to see the default price.'}
          </p>
          {suggested !== null && price !== '' && cost > maxPrice && <p className="kiosk-error" role="alert">The most you can ask for {qty} {plural(nameOf(cropId), qty)} is {maxPrice} coins.</p>}
          <fieldset className="kiosk-field">
            <legend>Who can buy it?</legend>
            <div className="kiosk-audience">
              <button type="button" aria-pressed={audiences.clan} className={`btn btn-small ${audiences.clan ? 'btn-primary' : ''}`} disabled={!hasClan} onClick={() => toggle('clan')}>
                {hasClan ? `My clan (${market.circle.clan.name})` : 'My clan'}
              </button>
              <button type="button" aria-pressed={audiences.friends} className={`btn btn-small ${audiences.friends ? 'btn-primary' : ''}`} onClick={() => toggle('friends')}>My friends</button>
              <button type="button" aria-pressed={audiences.all} className={`btn btn-small ${audiences.all ? 'btn-primary' : ''}`} onClick={() => toggle('all')}>All players</button>
            </div>
            <p className="hint kiosk-note">
              {chosen.length === 0 ? 'Choose at least one.' : audiences.all ? 'Every player can see this offer.' : 'You can pick clan and friends together.'}
              {market && !hasClan && ' Join a clan to sell to your clan.'}
            </p>
          </fieldset>
          {valid && <p className="kiosk-summary">{qty} {plural(nameOf(cropId), qty)} for <Coin size={14} /> <strong>{cost} coins</strong>{qty > 1 ? ` (${(cost / qty).toFixed(cost % qty ? 1 : 0)} each)` : ''} · {audienceText(chosen)}</p>}
          {cropId && quantity !== '' && qty > have && <p className="hint kiosk-note">You only have {have} {plural(nameOf(cropId), have)}.</p>}
          <button type="submit" className="btn btn-primary btn-wide" disabled={!valid || pending || game.busy}>{pending ? 'Posting…' : 'Offer for sale'}</button>
          {error && <p className="kiosk-error" role="alert">{error}</p>}
        </form>
      )}

      <section className="kiosk-list-section" aria-label="Your offers">
        <h3>Your offers</h3>
        {loadError && <p className="kiosk-error" role="alert">{loadError} <button type="button" className="btn btn-small" onClick={reload}>Try again</button></p>}
        {market && market.mine.length === 0 && <p className="hint">No open offers.</p>}
        <ul className="kiosk-list">
          {market?.mine.map((o) => (
            <li key={o.id} className="kiosk-offer">
              <CropIcon cropId={o.cropId} size={28} />
              <span className="kiosk-offer-main"><strong>{o.quantity} {plural(nameOf(o.cropId), o.quantity)}</strong><small>For {audienceText(o.audiences).toLowerCase()}</small></span>
              <span className="kiosk-price"><Coin size={14} /> {o.price}</span>
              <button type="button" className="btn btn-small" disabled={game.busy} onClick={() => cancel(o.id)}>Cancel</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function BuyView({ market, loadError, coins, nameOf, game, reload }) {
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const offers = (market?.offers ?? []).filter((o) =>
    filter === 'all' || (filter === 'clan' && o.relation.clan) || (filter === 'friends' && o.relation.friend) || (filter === 'others' && !o.relation.clan && !o.relation.friend));

  const buy = async (o) => {
    if (pending || game.busy) return;
    setPending(o.id);
    setError(null);
    const result = await game.marketBuy(o.id);
    setPending(null);
    if (!result.ok && result.err) setError(result.err.message);
    reload(); // a sold-out or withdrawn offer disappears
  };

  return (
    <div className="kiosk-body">
      <div className="kiosk-audience" role="tablist" aria-label="Show offers from">
        {[['all', 'All'], ['clan', 'Clan'], ['friends', 'Friends'], ['others', 'Others']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} className={`btn btn-small ${filter === id ? 'btn-primary' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      <p className="hint kiosk-note">Your coins: <Coin size={14} /> <strong>{coins}</strong></p>
      {!market && !loadError && <p role="status">Looking for offers…</p>}
      {loadError && <p className="kiosk-error" role="alert">{loadError} <button type="button" className="btn btn-small" onClick={reload}>Try again</button></p>}
      {market && offers.length === 0 && (
        <p className="kiosk-empty">
          {!market.circle.clan && market.circle.friends === 0
            ? 'Join a clan or add friends to see their offers. Offers for all players show up here too.'
            : 'No offers for you right now.'}
        </p>
      )}
      <ul className="kiosk-list">
        {offers.map((o) => {
          const poor = coins < o.price;
          return (
            <li key={o.id} className="kiosk-offer">
              <CropIcon cropId={o.cropId} size={28} />
              <span className="kiosk-offer-main"><strong>{o.quantity} {plural(nameOf(o.cropId), o.quantity)}</strong><small>from {o.seller} · {[o.relation.clan && 'Clan', o.relation.friend && 'Friend'].filter(Boolean).join(' + ') || 'Player'}</small></span>
              <span className="kiosk-price"><Coin size={14} /> {o.price}</span>
              <button type="button" className="btn btn-primary btn-small" disabled={poor || Boolean(pending) || game.busy} title={poor ? `You need ${o.price - coins} more coins` : undefined} onClick={() => buy(o)}>
                {pending === o.id ? 'Buying…' : 'Buy'}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="kiosk-error" role="alert">{error}</p>}
    </div>
  );
}
