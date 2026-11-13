// Loads the hosted Clan SDK bundle with a plain <script> tag and returns window.ClanSDK.
// Loaded lazily (first time the clan panel opens) so the game never waits on, or breaks because of,
// the SDK host. A failed load is not cached: opening the panel again retries.
let pending = null;

export function loadClanSdk(url = import.meta.env.VITE_CLAN_SDK_URL) {
  if (window.ClanSDK) return Promise.resolve(window.ClanSDK);
  if (pending) return pending;
  if (!url) return Promise.reject(new Error('VITE_CLAN_SDK_URL is not set.'));
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => window.ClanSDK
      ? resolve(window.ClanSDK)
      : fail(new Error('The Clan SDK loaded but did not define window.ClanSDK.'));
    script.onerror = () => fail(new Error('The Clan SDK could not be loaded.'));
    function fail(error) {
      script.remove();
      pending = null;
      reject(error);
    }
    document.head.append(script);
  });
  return pending;
}
