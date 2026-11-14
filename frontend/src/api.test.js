import { afterEach, expect, it, vi } from 'vitest';
import { api, getClanPlayerToken } from './api.js';

afterEach(() => vi.unstubAllGlobals());

it('acquires player tokens on demand through the game session without exposing backend settings', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'player-token' })));
  vi.stubGlobal('fetch', fetchMock);
  expect(await getClanPlayerToken()).toBe('player-token');
  expect(fetchMock).toHaveBeenCalledWith('/api/clan/token', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
});

it('logs in through the game API with the existing session cookie policy', async () => {
  const user = { id: 'player-1', username: 'farmer' };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user })));
  vi.stubGlobal('fetch', fetchMock);
  expect(await api.login('farmer', 'password')).toEqual({ user });
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'farmer', password: 'password' }),
  });
});

it('propagates game login errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    error: { code: 'invalid_credentials', message: 'Invalid username or password.' },
  }), { status: 401 })));
  await expect(api.login('farmer', 'wrong-password')).rejects.toMatchObject({
    status: 401, code: 'invalid_credentials',
  });
});
