import { afterEach, expect, it, vi } from 'vitest';
import { init } from 'clan-sdk';
import { getClanPlayerToken } from '../api.js';

afterEach(() => vi.unstubAllGlobals());

it('connects the SDK list/search/join flow to the game token endpoint (mock HTTP)', async () => {
  const clan = { id: 'clan-1', name: 'Farmers', memberCount: 2, maxMembers: 10 };
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/clan/token') return new Response(JSON.stringify({ token: 'mock.player.token' }));
    if (url === 'https://social.test/api/v1/clans?q=Farmers') return new Response(JSON.stringify({ clans: [clan] }));
    if (url === 'https://social.test/api/v1/clans/clan-1/join') return new Response(JSON.stringify(clan));
    throw new Error('Unexpected request');
  }));
  const sdk = init({ socialUrl: 'https://social.test', getPlayerToken: getClanPlayerToken });
  expect(calls).toEqual([]);
  expect(await sdk.listClans({ q: 'Farmers' })).toEqual({ clans: [clan] });
  await sdk.joinClan('clan-1');
  const socialCalls = calls.filter(call => call.url.startsWith('https://social.test'));
  expect(socialCalls).toHaveLength(2);
  expect(socialCalls.every(call => call.options.headers.Authorization === 'Bearer mock.player.token')).toBe(true);
  expect(socialCalls[1].options.method).toBe('POST');
  expect(socialCalls[1].options.body).toBeUndefined();
  expect(calls.filter(call => call.url === '/api/clan/token')).toHaveLength(2);
});

