import { clearClanPlayerToken } from '../api.js';
import { afterEach, expect, it, vi } from 'vitest';
import { mountClanWidget } from './mountClanWidget.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setTimeout(resolve));
const settings = { gameId: 'game-1', platformUrl: 'https://platform.test', socialUrl: 'https://social.test', realtimeUrl: 'https://realtime.test' };
const callbacks = () => ({ getPlayerToken: vi.fn(), onJoined: vi.fn(), onReady: vi.fn(), onError: vi.fn() });
// Stands in for window.ClanSDK as loaded from the hosted script.
const sdkWith = init => ({ loadSdk: vi.fn(async () => ({ init })) });
afterEach(() => { clearClanPlayerToken(); vi.restoreAllMocks(); });

it('loads the hosted SDK, passes settings and token callback, mounts without config, and handles ready', async () => {
  const pending = deferred();
  const widget = { ready: pending.promise, destroy: vi.fn() };
  const mountExperience = vi.fn(() => widget);
  const init = vi.fn(() => ({ mountExperience }));
  const container = new EventTarget();
  const hooks = callbacks(), sdk = sdkWith(init);
  const cleanup = mountClanWidget({ container, settings, ...hooks, ...sdk });
  await flush();
  expect(sdk.loadSdk).toHaveBeenCalledOnce();
  expect(init).toHaveBeenCalledWith({ ...settings, getPlayerToken: hooks.getPlayerToken });
  expect(mountExperience).toHaveBeenCalledWith({ container });
  expect(hooks.onReady).not.toHaveBeenCalled();
  pending.resolve(); await flush();
  expect(hooks.onReady).toHaveBeenCalledOnce();
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(hooks.onJoined).toHaveBeenCalledOnce();
  cleanup(); cleanup();
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(hooks.onJoined).toHaveBeenCalledOnce();
  expect(widget.destroy).toHaveBeenCalledOnce();
});

it.each(['load', 'initialization', 'mount', 'ready'])('contains %s errors without throwing to gameplay', async stage => {
  const widget = { ready: stage === 'ready' ? Promise.reject(new Error('private details')) : new Promise(() => {}), destroy: vi.fn() };
  const mountExperience = vi.fn(() => { if (stage === 'mount') throw new Error('private details'); return widget; });
  const init = vi.fn(() => { if (stage === 'initialization') throw new Error('private details'); return { mountExperience }; });
  const loadSdk = stage === 'load' ? vi.fn(async () => { throw new Error('script failed'); }) : sdkWith(init).loadSdk;
  const hooks = callbacks();
  const cleanup = mountClanWidget({ container: new EventTarget(), settings, ...hooks, loadSdk });
  await flush();
  expect(hooks.onError).toHaveBeenCalledWith();
  expect(hooks.onError).toHaveBeenCalledOnce();
  expect(hooks.onReady).not.toHaveBeenCalled();
  cleanup();
});

it('closing before the SDK script loads never initializes or mounts', async () => {
  const load = deferred(), init = vi.fn();
  const hooks = callbacks();
  const cleanup = mountClanWidget({ container: new EventTarget(), settings, ...hooks, loadSdk: () => load.promise });
  cleanup();
  load.resolve({ init }); await flush();
  expect(init).not.toHaveBeenCalled();
  expect(hooks.onReady).not.toHaveBeenCalled();
  expect(hooks.onError).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'])('ignores stale %s after StrictMode cleanup and remount', async settle => {
  const pending = [deferred(), deferred()];
  const container = new EventTarget();
  let count = 0, activeMounts = 0;
  const init = () => ({ mountExperience: () => {
    expect(activeMounts).toBe(0);
    activeMounts++;
    return { ready: pending[count++].promise, destroy: vi.fn(() => activeMounts--) };
  } });
  const oldHooks = callbacks(), newHooks = callbacks();
  const firstCleanup = mountClanWidget({ container, settings, ...oldHooks, ...sdkWith(init) });
  await flush();
  firstCleanup();
  const secondCleanup = mountClanWidget({ container, settings, ...newHooks, ...sdkWith(init) });
  await flush();
  pending[0][settle](new Error('stale')); await flush();
  expect(oldHooks.onError).not.toHaveBeenCalled();
  expect(oldHooks.onReady).not.toHaveBeenCalled();
  pending[1].resolve(); await flush();
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(oldHooks.onJoined).not.toHaveBeenCalled();
  expect(newHooks.onJoined).toHaveBeenCalledOnce();
  expect(newHooks.onReady).toHaveBeenCalledOnce();
  secondCleanup();
  expect(activeMounts).toBe(0);
});

it('auth changes destroy the widget before resetting the SDK and suppress late callbacks', async () => {
  const pending = deferred(), order = [];
  const widget = { ready: pending.promise, destroy: vi.fn(() => order.push('destroy')) };
  const resetPlayerSession = vi.fn(() => order.push('reset'));
  const init = () => ({ mountExperience: () => widget, resetPlayerSession });
  const hooks = callbacks(), container = new EventTarget();
  const cleanup = mountClanWidget({ container, settings, ...hooks, ...sdkWith(init) });
  await flush();
  clearClanPlayerToken();
  expect(order).toEqual(['destroy', 'reset']);
  pending.resolve(); await flush();
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(hooks.onReady).not.toHaveBeenCalled();
  expect(hooks.onJoined).not.toHaveBeenCalled();
  cleanup(); clearClanPlayerToken();
  expect(widget.destroy).toHaveBeenCalledTimes(1);
});
