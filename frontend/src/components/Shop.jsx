import { Coin, SeedPacket, Star } from './Icons.jsx';
import { formatSeconds } from '../game/plotState.js';

export default function Shop({ state, busy, onBuy }) {
  const { catalog, player, inventory } = state;
  return (
    <section className="card" aria-labelledby="shop-title">
      <h2 id="shop-title">Seed Shop</h2>
      <ul className="rows">
        {catalog.map((c) => {
          const locked = player.level < c.unlockLevel;
          return (
            <li key={c.id} className={`row-item ${locked ? 'is-locked' : ''}`}>
              <SeedPacket cropId={c.id} size={46} />
              <div className="row-main">
                <strong>{c.name} seeds</strong>
                {locked ? (
                  <span className="lock-note">Unlocks at level {c.unlockLevel}</span>
                ) : (
                  <span className="stats">
                    <span title="Grow time">Grows {formatSeconds(c.growthSeconds)}</span>
                    <span title="Sale price"><Coin size={13} /> sells {c.sellPrice}</span>
                    <span title="XP per harvest"><Star size={13} /> +{c.xpReward} XP</span>
                  </span>
                )}
                <span className="owned">You have {inventory.seeds[c.id] ?? 0}</span>
              </div>
              <div className="row-actions">
                {[1, 5].map((q) => {
                  const cost = c.seedPrice * q;
                  return (
                    <button
                      key={q}
                      type="button"
                      className="btn btn-small btn-primary buy-btn"
                      disabled={busy || locked || player.coins < cost}
                      title={player.coins < cost && !locked ? 'Not enough coins' : undefined}
                      onClick={() => onBuy(c.id, q)}
                    >
                      Buy {q}
                      <span className="price"><Coin size={13} /> {cost}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
