import { Coin, Logo, Star } from './Icons.jsx';

export default function Header({ player, onHelp, onLogout }) {
  const pct = Math.min(100, Math.round((player.xpIntoLevel / player.xpForNextLevel) * 100));
  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={34} />
        <span>Harvest Village</span>
      </div>

      <div className="profile" aria-label="Player profile">
        <div className="avatar" aria-hidden="true">{player.username[0].toUpperCase()}</div>
        <div className="profile-text">
          <strong className="profile-name">{player.username}</strong>
          <div className="level-row">
            <span className="level-badge"><Star size={14} /> Level {player.level}</span>
            <div
              className="xp-bar"
              role="progressbar"
              aria-label="Experience"
              aria-valuemin={0}
              aria-valuemax={player.xpForNextLevel}
              aria-valuenow={player.xpIntoLevel}
              title={`${player.xpIntoLevel} / ${player.xpForNextLevel} XP to level ${player.level + 1}`}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="xp-text">{player.xpIntoLevel}/{player.xpForNextLevel} XP</span>
          </div>
        </div>
        <div className="coins" aria-label={`${player.coins} coins`}>
          <Coin /> <strong>{player.coins}</strong>
        </div>
      </div>

      <div className="top-actions">
        <button type="button" className="btn btn-small" onClick={onHelp}>Help</button>
        <button type="button" className="btn btn-small" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}
