import { Coin, Logo, Star } from './Icons.jsx';
import AccountMenu from './AccountMenu.jsx';

export default function Header({ player, onHelp, onLogout, onAccountSettings }) {
  const pct = Math.min(100, Math.round((player.xpIntoLevel / player.xpForNextLevel) * 100));
  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={34} />
        <span>Harvest Village</span>
      </div>

      <div className="profile" aria-label="Player progress">
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
        <div className="coins" aria-label={`${player.coins} coins`}>
          <Coin /> <strong>{player.coins}</strong>
        </div>
      </div>

      <div className="top-actions">
        <button type="button" className="account-help" aria-label="Help" title="Help" onClick={onHelp}>?</button>
        <AccountMenu username={player.username} onSettings={onAccountSettings} onLogout={onLogout} />
      </div>
    </header>
  );
}
