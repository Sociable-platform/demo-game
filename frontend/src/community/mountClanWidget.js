// The HTML script tag loads the SDK before the game module starts.
export function mountClanWidget({ container, settings, getPlayerToken, onJoined, onReady, onError }) {
  let active = true;
  let sdk;
  let widget;
  const joined = () => { if (active) onJoined(); };
  const dispose = () => {
    if (!active) return;
    active = false;
    container.removeEventListener('clan-sdk:joined', joined);
    widget?.destroy();
    sdk?.resetPlayerSession?.();
  };
  container.addEventListener('clan-sdk:joined', joined);
  try {
    const ClanSDK = window.ClanSDK;
    if (typeof ClanSDK?.init !== 'function') throw new Error('Clan SDK script is unavailable.');
    sdk = ClanSDK.init({ ...settings, getPlayerToken });
    widget = sdk.mountExperience({ container });
    widget.ready.then(
      () => { if (active) onReady(); },
      () => { if (active) onError(); },
    );
  } catch {
    dispose();
    onError();
  }
  return dispose;
}
