import { useEffect, useId, useRef, useState } from 'react';
import { getClanPlayerToken } from '../api.js';
import { mountClanWidget } from '../community/mountClanWidget.js';

function DiscoverPanel({ notify }) {
  const container = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    setStatus('loading');
    return mountClanWidget({
      container: container.current,
      settings: {
        gameId: import.meta.env.VITE_GAME_ID,
        platformUrl: import.meta.env.VITE_PLATFORM_URL,
        socialUrl: import.meta.env.VITE_SOCIAL_URL,
        realtimeUrl: import.meta.env.VITE_REALTIME_URL,
      },
      getPlayerToken: getClanPlayerToken,
      onJoined: () => notify('success', 'You joined the clan!'),
      onReady: () => setStatus('ready'),
      onError: () => setStatus('error'),
    });
  }, [notify]);

  return <>
    {status === 'loading' && <p role="status">Opening clans…</p>}
    {status === 'error' && <p role="alert">Clans could not be opened. Please try again later.</p>}
    <div ref={container} />
  </>;
}

export default function CommunityClans({ notify }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  return (
    <div className="community-clans">
      {open && (
        <aside id={panelId} className="community-clan-panel" aria-label="Discover clans"
          onKeyDown={event => { if (event.key === 'Escape') close(); }}>
          <DiscoverPanel notify={notify} />
        </aside>
      )}
      <button ref={toggle} className="btn btn-primary" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>{open ? 'Hide clans' : 'Open clans'}</button>
    </div>
  );
}
