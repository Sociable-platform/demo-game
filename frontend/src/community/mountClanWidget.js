import { init } from 'clan-sdk';

// Host lifecycle glue only. Published config, caching, fallback and navigation stay in the SDK.
export function mountClanWidget({ container, settings, getPlayerToken, onJoined, onReady, onError }) {
  let active = true;
  let widget;
  const joined = () => { if (active) onJoined(); };
  container.addEventListener('clan-sdk:joined', joined);
  try {
    const sdk = init({ ...settings, getPlayerToken });
    widget = sdk.mountExperience({ container });
    widget.ready.then(
      () => { if (active) onReady(); },
      () => { if (active) onError(); },
    );
  } catch {
    onError();
  }
  return () => {
    if (!active) return;
    active = false;
    container.removeEventListener('clan-sdk:joined', joined);
    widget?.destroy();
  };
}
