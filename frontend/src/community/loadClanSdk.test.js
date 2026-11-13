import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Minimal DOM: the loader only creates a <script>, appends it to <head> and listens for load/error.
let scripts, load;
beforeEach(async () => {
  scripts = [];
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {
    createElement: () => ({ remove() { scripts.splice(scripts.indexOf(this), 1); } }),
    head: { append: script => scripts.push(script) },
  });
  vi.resetModules();
  ({ loadClanSdk: load } = await import('./loadClanSdk.js'));
});
afterEach(() => vi.unstubAllGlobals());

it('adds one script tag for concurrent callers and resolves window.ClanSDK', async () => {
  const a = load('https://sdk.test/v1/clan-sdk.js'), b = load('https://sdk.test/v1/clan-sdk.js');
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toMatchObject({ src: 'https://sdk.test/v1/clan-sdk.js', async: true });
  window.ClanSDK = { init() {} };
  scripts[0].onload();
  expect(await a).toBe(window.ClanSDK);
  expect(await b).toBe(window.ClanSDK);
  expect(await load('https://sdk.test/v1/clan-sdk.js')).toBe(window.ClanSDK);
  expect(scripts).toHaveLength(1);
});

it('a failed load removes the tag and the next call retries', async () => {
  const first = load('https://sdk.test/v1/clan-sdk.js');
  scripts[0].onerror();
  await expect(first).rejects.toThrow('could not be loaded');
  expect(scripts).toHaveLength(0);
  const second = load('https://sdk.test/v1/clan-sdk.js');
  expect(scripts).toHaveLength(1);
  scripts[0].onload();
  await expect(second).rejects.toThrow('window.ClanSDK');
});

it('rejects without touching the page when no URL is configured', async () => {
  await expect(load('')).rejects.toThrow('VITE_CLAN_SDK_URL');
  expect(scripts).toHaveLength(0);
});
