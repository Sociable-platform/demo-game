import { init } from 'clan-sdk';
import {onClanPlayerSessionChange} from '../api.js';

export function mountClanWidget({ container, settings, getPlayerToken, onJoined, onReady, onError }) {
  let active = true, widget, sdk, unsubscribe;
  const joined = () => { if (active) onJoined(); };
  function dispose() {
    if (!active) return;
    active = false;
    unsubscribe?.();
    container.removeEventListener('clan-sdk:joined', joined);
    widget?.destroy();
    sdk?.resetPlayerSession?.();
  }
  container.addEventListener('clan-sdk:joined', joined);
  try {
    sdk = init({ ...settings, getPlayerToken });
    unsubscribe = onClanPlayerSessionChange(dispose);
    widget = sdk.mountExperience({ container });
    widget.ready.then(() => { if (active) onReady(); }, () => { if (active) onError(); });
  } catch { if(active)onError(); }
  return dispose;
}
