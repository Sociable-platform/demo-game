import { Coin, CropIcon } from './Icons.jsx';

export default function Barn({ state, busy, onSell }) {
  const { catalog, inventory } = state;
  const owned = catalog.filter((c) => (inventory.crops[c.id] ?? 0) > 0);
  return (
    <section className="card" aria-labelledby="barn-title">
      <h2 id="barn-title">Barn</h2>

      <h3>Your crops</h3>
      {owned.length === 0 ? (
        <p className="empty-note">Nothing to sell yet. Harvest a ripe crop and it will show up here.</p>
      ) : (
        <ul className="rows">
          {owned.map((c) => {
            const qty = inventory.crops[c.id];
            return (
              <li key={c.id} className="row-item">
                <CropIcon cropId={c.id} size={44} />
                <div className="row-main">
                  <strong>{c.name} ×{qty}</strong>
                  <span className="stats"><Coin size={13} /> {c.sellPrice} each · {c.sellPrice * qty} total</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => onSell(c.id, 1)}>Sell 1</button>
                  {qty > 1 && (
                    <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => onSell(c.id, 'all')}>
                      Sell all
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="hint">Crops are also what you plant, so keep a few to grow more.</p>
    </section>
  );
}
