import {clearClanPlayerToken} from '../api.js';
import { afterEach, expect, it, vi } from 'vitest';
const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('clan-sdk', () => ({ init }));
import { mountClanWidget } from './mountClanWidget.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const settings = { gameId: 'game-1', platformUrl: 'https://platform.test', socialUrl: 'https://social.test', realtimeUrl: 'https://realtime.test' };
const callbacks = () => ({ getPlayerToken: vi.fn(), onJoined: vi.fn(), onReady: vi.fn(), onError: vi.fn() });
afterEach(() => vi.resetAllMocks());

it('passes connection settings including Realtime and token callback, mounts without config, and handles ready', async () => {
  const pending = deferred();
  const widget = { ready: pending.promise, destroy: vi.fn() };
  const mountExperience = vi.fn(() => widget);
  init.mockReturnValue({ mountExperience });
  const container = new EventTarget();
  const hooks = callbacks();
  const cleanup = mountClanWidget({ container, settings, ...hooks });
  expect(init).toHaveBeenCalledWith({ ...settings, getPlayerToken: hooks.getPlayerToken });
  expect(mountExperience).toHaveBeenCalledWith({ container });
  expect(hooks.onReady).not.toHaveBeenCalled();
  pending.resolve(); await pending.promise;
  expect(hooks.onReady).toHaveBeenCalledOnce();
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(hooks.onJoined).toHaveBeenCalledOnce();
  cleanup(); cleanup();
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(hooks.onJoined).toHaveBeenCalledOnce();
  expect(widget.destroy).toHaveBeenCalledOnce();
});

it.each(['initialization', 'mount', 'ready'])('contains %s errors without throwing to gameplay', async stage => {
  const pending = deferred();
  const widget = { ready: pending.promise, destroy: vi.fn() };
  const mountExperience = vi.fn(() => { if (stage === 'mount') throw new Error('private details'); return widget; });
  init.mockImplementation(() => { if (stage === 'initialization') throw new Error('private details'); return { mountExperience }; });
  const hooks = callbacks();
  const cleanup = mountClanWidget({ container: new EventTarget(), settings, ...hooks });
  if (stage === 'ready') { pending.reject(new Error('private details')); await pending.promise.catch(() => {}); }
  expect(hooks.onError).toHaveBeenCalledWith();
  expect(hooks.onError).toHaveBeenCalledOnce();
  expect(hooks.onReady).not.toHaveBeenCalled();
  cleanup();
});

it.each(['resolve', 'reject'])('ignores stale %s after StrictMode cleanup and remount', async settle => {
  const pending = [deferred(), deferred()];
  const container = new EventTarget();
  let count = 0, activeMounts = 0;
  const widgets = [];
  init.mockReturnValue({ mountExperience: () => {
    expect(activeMounts).toBe(0);
    activeMounts++;
    const widget = { ready: pending[count++].promise, destroy: vi.fn(() => activeMounts--) };
    widgets.push(widget); return widget;
  } });
  const oldHooks = callbacks(), newHooks = callbacks();
  const firstCleanup = mountClanWidget({ container, settings, ...oldHooks });
  firstCleanup();
  const secondCleanup = mountClanWidget({ container, settings, ...newHooks });
  pending[0][settle](new Error('stale')); await pending[0].promise.catch(() => {});
  expect(oldHooks.onError).not.toHaveBeenCalled();
  expect(oldHooks.onReady).not.toHaveBeenCalled();
  pending[1].resolve(); await pending[1].promise;
  container.dispatchEvent(new Event('clan-sdk:joined'));
  expect(oldHooks.onJoined).not.toHaveBeenCalled();
  expect(newHooks.onJoined).toHaveBeenCalledOnce();
  expect(newHooks.onReady).toHaveBeenCalledOnce();
  secondCleanup();
  expect(activeMounts).toBe(0);
});

it('auth changes destroy the widget before resetting the SDK and suppress late callbacks',async()=>{
 const pending=deferred(),order=[];const widget={ready:pending.promise,destroy:vi.fn(()=>order.push('destroy'))};
 const resetPlayerSession=vi.fn(()=>order.push('reset'));init.mockReturnValue({mountExperience:()=>widget,resetPlayerSession});
 const hooks=callbacks(),container=new EventTarget();const cleanup=mountClanWidget({container,settings,...hooks});clearClanPlayerToken();
 expect(order).toEqual(['destroy','reset']);pending.resolve();await pending.promise;container.dispatchEvent(new Event('clan-sdk:joined'));expect(hooks.onReady).not.toHaveBeenCalled();expect(hooks.onJoined).not.toHaveBeenCalled();cleanup();clearClanPlayerToken();expect(widget.destroy).toHaveBeenCalledTimes(1);
});
