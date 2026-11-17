import { useState } from 'react';
import { Coin, CropIcon } from './Icons.jsx';

const plural = (name) => `${name.toLowerCase()}${/o$/i.test(name) ? 'es' : 's'}`;

/**
 * Personal level quests (the shared Clan quest is a separate section below). All progress, unlocks and rewards come
 * from the server in `state.personalQuests`; this panel only renders them and asks the server to claim by quest id.
 */
export default function PersonalQuestsPanel({ state, game }) {
  const { catalog, personalQuests: quests = [] } = state;
  const [pending, setPending] = useState(null); // quest id being claimed
  const [errors, setErrors] = useState({}); // quest id -> message (progress is never lost on failure)
  const nameOf = (id) => catalog.find((c) => c.id === id)?.name ?? id;
  const claimed = quests.filter((q) => q.status === 'claimed').length;

  const claim = async (id) => {
    if (pending || game.busy) return;
    setPending(id);
    setErrors((e) => ({ ...e, [id]: null }));
    const result = await game.claimPersonalQuest(id);
    setPending(null);
    if (!result.ok && result.err) setErrors((e) => ({ ...e, [id]: result.err.message }));
  };

  return (
    <section className="card pq-card" aria-labelledby="pq-title">
      <h2 id="pq-title">Personal Quests</h2>
      <p className="hint pq-sub">Your own farming goals. {claimed} of {quests.length} completed.</p>
      <ol className="pq-list">
        {quests.map((q) => {
          const goal = q.objectives.map((o) => `${o.target} ${plural(nameOf(o.cropId))}`).join(' + ');
          if (q.status === 'claimed') {
            return (
              <li key={q.id} className="pq-item is-claimed">
                <span className="pq-check" aria-hidden="true">✓</span>
                <span>Level {q.requiredLevel} · Harvest {goal}</span>
                <strong className="pq-done">Completed</strong>
              </li>
            );
          }
          if (q.status === 'locked') {
            return (
              <li key={q.id} className="pq-item is-locked">
                <span>Harvest {goal}</span>
                <strong className="pq-lock">Locked</strong>
                <span className="pq-req">{q.levelMet ? 'Finish the previous quest first' : `Unlocks at level ${q.requiredLevel}`}</span>
              </li>
            );
          }
          return (
            <li key={q.id} className={`pq-item is-open ${q.status === 'ready' ? 'is-ready' : ''}`}>
              <div className="pq-head">
                <strong>Level {q.requiredLevel}: Harvest {goal}</strong>
              </div>
              {q.objectives.map((o) => (
                <div key={o.cropId} className="pq-obj">
                  <CropIcon cropId={o.cropId} size={22} />
                  <div className="xp-bar pq-bar" role="progressbar" aria-label={`${nameOf(o.cropId)} harvested`} aria-valuemin={0} aria-valuemax={o.target} aria-valuenow={o.progress}>
                    <span style={{ width: `${Math.round((o.progress / o.target) * 100)}%` }} />
                  </div>
                  <span className="pq-num">{o.progress} / {o.target}</span>
                </div>
              ))}
              <div className="pq-foot">
                <span className="pq-prize">
                  <strong>+{q.reward.xp} XP</strong>
                  <span><Coin size={14} /> <strong>{q.reward.coins}</strong></span>
                </span>
                <button type="button" className="btn btn-primary btn-small" disabled={q.status !== 'ready' || Boolean(pending) || game.busy} onClick={() => claim(q.id)}>
                  {pending === q.id ? 'Claiming…' : 'Claim'}
                </button>
              </div>
              {errors[q.id] && <p className="pq-error" role="alert">{errors[q.id]}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
