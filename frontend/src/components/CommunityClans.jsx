import { useEffect, useId, useRef, useState } from 'react';
import { init } from 'clan-sdk';
import { getClanPlayerToken } from '../api.js';
import discoverConfig from '../community/discoverConfig.json';

function ClanWidgetPanel({ notify }) {
  const container = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
<<<<<<< Updated upstream
    setError('');
    const root = container.current;
    const onJoined = () => notify('success', 'You joined the clan!');
    let widget;
    root.addEventListener('clan-sdk:joined', onJoined);
    try {
      const socialUrl = import.meta.env.VITE_CLAN_SOCIAL_URL
        || (import.meta.env.DEV ? 'http://localhost:8082' : '');
      const sdk = init({ socialUrl, getPlayerToken: getClanPlayerToken });
      widget = sdk.mountExperience({ container: root, config: discoverConfig });
    } catch {
      setError('Clans could not be opened. Please try again later.');
    }
    return () => {
      root.removeEventListener('clan-sdk:joined', onJoined);
      widget?.destroy();
    };
=======
    setStatus('loading');
    return mountClanWidget({
      container: container.current,
      settings: {
        gameId: import.meta.env.VITE_GAME_ID,
        platformUrl: import.meta.env.VITE_PLATFORM_URL,
        socialUrl: import.meta.env.VITE_SOCIAL_URL,
      },
      getPlayerToken: getClanPlayerToken,
      onJoined: () => notify('success', 'You joined the clan!'),
      onCreated: () => notify('success', 'Your clan was created!'),
      onReady: () => setStatus('ready'),
      onError: () => setStatus('error'),
    });
>>>>>>> Stashed changes
  }, [notify]);

  return <>{error && <p role="alert">{error}</p>}<div ref={container} /></>;
}

export default function CommunityClans({ notify }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  return (
    <div className="community-clans">
      {open && (
        <aside id={panelId} className="community-clan-panel" aria-label="Clan community"
          onKeyDown={event => { if (event.key === 'Escape') close(); }}>
          <ClanWidgetPanel notify={notify} />
        </aside>
      )}
      <button ref={toggle} className="btn btn-primary" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>{open ? 'Hide clans' : 'Open clans'}</button>
    </div>
  );
}
