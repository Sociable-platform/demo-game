import { useEffect, useRef, useState } from 'react';
import { init } from 'clan-sdk';
import { chatConfig } from '../community/chatConfig.js';

export default function CommunityChat() {
  const container = useRef(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    // init is synchronous and chat mounting does not call Social or acquire a token.
    // Replace these settings when connecting real clan HTTP operations later.
    const sdk = init({
      socialUrl: window.location.origin,
      getPlayerToken: async () => {
        throw new Error('Player token exchange is not connected in this chat preview.');
      },
    });
    let widget;
    try {
      widget = sdk.mountChatWidget({ container: container.current, config: chatConfig });
      setError('');
    } catch (err) {
      setError(err.message);
    }
    return () => widget?.destroy();
  }, [open]);

  return (
    <>
      <div id="community-overlay-root" className="community-slot" ref={container} />
      <button className="btn community-toggle" onClick={() => setOpen(value => !value)}
        aria-expanded={open} aria-controls="community-overlay-root">
        {open ? 'Hide chat' : 'Open chat'}
      </button>
      {error && <p className="community-error" role="alert">Chat preview: {error}</p>}
    </>
  );
}
