import { afterEach, expect, it, vi } from 'vitest';
import { getClanPlayerToken, clearClanPlayerToken, api } from './api.js';

afterEach(() => {clearClanPlayerToken();vi.unstubAllGlobals();});

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

it('reuses browser memory token but forces a new exchange with explicit forceRefresh',async()=>{
 const mock=vi.fn(async()=>new Response(JSON.stringify({token:'cached',expiresIn:3600})));vi.stubGlobal('fetch',mock);
 await Promise.all([getClanPlayerToken(),getClanPlayerToken()]);await getClanPlayerToken();expect(mock).toHaveBeenCalledTimes(1);
 await getClanPlayerToken({forceRefresh:true});expect(mock).toHaveBeenCalledTimes(2);expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({forceRefresh:true});
});
it('logout blocks acquisition during transition and clears any cached token',async()=>{
 let finish;vi.stubGlobal('fetch',vi.fn(async url=>url==='/api/auth/logout'?new Promise(resolve=>finish=()=>resolve(new Response('{}'))):new Response(JSON.stringify({token:'session',expiresIn:3600}))));
 await getClanPlayerToken();const logout=api.logout();await expect(getClanPlayerToken()).rejects.toMatchObject({name:'AbortError'});finish();await logout;await getClanPlayerToken();expect(fetch.mock.calls.filter(([url])=>url==='/api/clan/token')).toHaveLength(2);
});
