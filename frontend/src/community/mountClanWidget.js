import { onClanPlayerSessionChange } from '../api.js';
import { loadClanSdk } from './loadClanSdk.js';

// Mounts the Clan experience into `container`. Returns a synchronous dispose function; anything that
// settles after dispose (SDK script load, widget readiness, join events) is ignored.
export function mountClanWidget({ container, settings, getPlayerToken, onJoined, onReady, onError, loadSdk = loadClanSdk }) {
  let active = true, widget, sdk, unsubscribe;
  const joined = () => { if (active) onJoined(); };
  const failed = () => { if (active) onError(); };
  function dispose() {
    if (!active) return;
    active = false;
    unsubscribe?.();
    container.removeEventListener('clan-sdk:joined', joined);
    widget?.destroy();
    sdk?.resetPlayerSession?.();
  }
  container.addEventListener('clan-sdk:joined', joined);
  unsubscribe = onClanPlayerSessionChange(dispose);
  Promise.resolve().then(loadSdk).then(ClanSDK => {
    if (!active) return;
    sdk = ClanSDK.init({ ...settings, getPlayerToken });
    widget = sdk.mountExperience({ container });
    widget.ready.then(() => { if (active) onReady(); }, failed);
  }).catch(failed);
  return dispose;
}
