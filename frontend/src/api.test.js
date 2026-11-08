import { afterEach, expect, it, vi } from 'vitest';
import { getClanPlayerToken } from './api.js';
import { init } from 'clan-sdk';

afterEach(() => vi.unstubAllGlobals());

it('requests a Clan token on demand through the existing session', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'player.token' })));
  vi.stubGlobal('fetch', fetchMock);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await getClanPlayerToken()).toBe('player.token');
  expect(fetchMock).toHaveBeenCalledWith('/api/clan/token', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
});

it('propagates login errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    error: { code: 'unauthorized', message: 'Please log in to continue.' },
  }), { status: 401 })));
  await expect(getClanPlayerToken()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
});

it('leaves malformed-token validation to the SDK before any Social request', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  const sdk = init({ socialUrl: 'https://social.test', getPlayerToken: getClanPlayerToken });
  await expect(sdk.listClans()).rejects.toThrow('getPlayerToken');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/clan/token');
});
