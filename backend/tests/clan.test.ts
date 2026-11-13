import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makeApp, signup } from './helpers.js';

const key = 'test-server-only-api-key';
const env = { CLAN_PLATFORM_URL: 'https://platform.example.test/', CLAN_GAME_API_KEY: key };
afterEach(() => vi.unstubAllGlobals());

describe('Clan player token bridge (mock Platform)', () => {
  it('allows only the configured public Social origin in the production page CSP', async () => {
    const { app, db } = makeApp({ env: { ...env, NODE_ENV: 'production', VITE_CLAN_SOCIAL_URL: 'https://social.example.test/prefix' } });
    try {
      const res = await request(app).get('/api/config');
      expect(res.headers['content-security-policy'].split(';')).toContain("connect-src 'self' https://social.example.test");
      expect(res.headers['content-security-policy']).not.toContain(env.CLAN_PLATFORM_URL);
      expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(key);
    } finally { db.close(); }
  });
  it('allows the hosted SDK script origin, and only that, in the production page CSP', async () => {
    const { app, db } = makeApp({ env: { ...env, NODE_ENV: 'production', VITE_CLAN_SDK_URL: 'https://sdk.example.test/v1/clan-sdk.js' } });
    try {
      const res = await request(app).get('/api/config');
      expect(res.headers['content-security-policy'].split(';')).toContain("script-src 'self' https://sdk.example.test");
    } finally { db.close(); }
    const unset = makeApp({ env: { ...env, NODE_ENV: 'production' } });
    try {
      const res = await request(unset.app).get('/api/config');
      expect(res.headers['content-security-policy'].split(';')).toContain("script-src 'self'");
    } finally { unset.db.close(); }
  });
  it('requires the existing game session, including after logout', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, db } = makeApp({ env });
    try {
      const anon = await request(app).post('/api/clan/token').send({});
      expect(anon.status).toBe(401);
      expect(anon.headers['cache-control']).toBe('no-store');
      const { agent } = await signup(app, 'clan_alice');
      await agent.post('/api/auth/logout').send({});
      expect((await agent.post('/api/clan/token').send({})).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it('forced refresh always performs a fresh upstream exchange; no server token cache', async () => {
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({token:'server.token',expiresIn:3600})));
    vi.stubGlobal('fetch',fetchMock);const {app,db}=makeApp({env});
    try {const {agent}=await signup(app,'clan_force');
      await agent.post('/api/clan/token').send({});
      const response=await agent.post('/api/clan/token').send({forceRefresh:true});
      expect(fetchMock).toHaveBeenCalledTimes(2);expect(response.body.expiresIn).toBe(3600);expect(response.body.expiresAt).toBeGreaterThan(Date.now());
      expect(fetchMock.mock.calls[1][1].cache).toBe('no-store');
      expect(response.text).not.toContain(key);
    }finally{db.close();}
  });
  it('uses only database identity, isolates players, and returns only token and expiry metadata', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      token: 'test.player.token', expiresIn: 3600, apiKey: key, internal: 'private',
    })));
    vi.stubGlobal('fetch', fetchMock);
    const { app, db } = makeApp({ env });
    try {
      for (const username of ['clan_alice', 'clan_bob']) {
        const { agent, user } = await signup(app, username);
        // Even a caller supplying identity/game/key overrides cannot affect the upstream request.
        const res = await agent.post('/api/clan/token?externalPlayerId=forged&gameId=other')
          .set('X-Player-Id', 'forged').set('X-API-Key', 'forged')
          .send({ externalPlayerId: 'forged', displayName: 'forged', userId: 'forged', gameId: 'other' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ token: 'test.player.token', expiresIn: 3600, expiresAt: expect.any(Number) });
        expect(res.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toContain(key);
        const [url, options] = fetchMock.mock.calls.at(-1)!;
        expect(String(url)).toBe('https://platform.example.test/api/v1/players/auth');
        expect(options.method).toBe('POST');
        expect(options.redirect).toBe('error');
        expect(options.headers['X-API-Key']).toBe(key);
        expect(JSON.parse(options.body)).toEqual({ externalPlayerId: user.id, displayName: user.username });
        await agent.post('/api/auth/logout').send({});
        await agent.post('/api/auth/login').send({ username, password: 'correct horse' });
        await agent.post('/api/clan/token').send({});
        expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).externalPlayerId).toBe(user.id);
      }
      expect(JSON.stringify((await request(app).get('/api/config')).body)).not.toMatch(/CLAN|apiKey|platform/i);
    } finally { db.close(); }
  });

  it.each([
    {}, { CLAN_PLATFORM_URL: env.CLAN_PLATFORM_URL }, { CLAN_GAME_API_KEY: key },
    { ...env, CLAN_PLATFORM_URL: 'not-a-url' },
    { ...env, CLAN_PLATFORM_URL: 'https://user:secret@platform.test' },
  ] as Record<string, string>[])('isolates missing/invalid configuration from farming: %j', async config => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, db } = makeApp({ env: config });
    try {
      const { agent } = await signup(app, 'clan_config');
      const res = await agent.post('/api/clan/token').send({});
      expect(res.status).toBe(503);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await agent.get('/api/game/state')).status).toBe(200);
      expect((await agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' })).status).toBe(200);
    } finally { db.close(); }
  });

  it.each([400, 401, 403, 429, 500, 503])('sanitizes upstream HTTP %i without expiring game login', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`secret: ${key}`, { status })));
    const { app, db } = makeApp({ env });
    try {
      const { agent } = await signup(app, 'clan_error');
      const res = await agent.post('/api/clan/token').send({});
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('clan_upstream_error');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).not.toContain(key);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    } finally { db.close(); }
  });

  it.each(['not json', '{}', 'null', '[]', '{"token":"x"}', '{"token":"bad token","expiresIn":3600}', '{"token":"x","expiresIn":0}'])
    ('rejects malformed upstream payload: %s', async body => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
      const { app, db } = makeApp({ env });
      try {
        const { agent } = await signup(app, 'clan_payload');
        expect((await agent.post('/api/clan/token').send({})).status).toBe(502);
      } finally { db.close(); }
    });

  it('sanitizes network exceptions and does not log credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(key); }));
    const logger = vi.spyOn(console, 'error');
    const { app, db } = makeApp({ env });
    try {
      const { agent } = await signup(app, 'clan_network');
      const res = await agent.post('/api/clan/token').send({});
      expect(res.status).toBe(502);
      expect(res.text).not.toContain(key);
      expect(logger).not.toHaveBeenCalled();
    } finally { db.close(); logger.mockRestore(); }
  });

  it('bounds response-body loading by the same five-second deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error(key)), { once: true });
      }),
    })));
    const { app, db } = makeApp({ env });
    try {
      const { agent } = await signup(app, 'clan_timeout');
      const res = await agent.post('/api/clan/token').send({});
      expect(res.status).toBe(504);
      expect(res.body.error.code).toBe('clan_upstream_timeout');
      expect(res.text).not.toContain(key);
    } finally { db.close(); }
  });

  it('retains origin protection and no-store on rejection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app, db } = makeApp({ env });
    try {
      const { agent } = await signup(app, 'clan_origin');
      const res = await agent.post('/api/clan/token').set('Origin', 'https://untrusted.test').send({});
      expect(res.status).toBe(403);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(fetchMock).not.toHaveBeenCalled();
      const malformed = await agent.post('/api/clan/token').set('Content-Type', 'application/json').send('{');
      expect(malformed.status).toBe(400);
      expect(malformed.headers['cache-control']).toBe('no-store');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
});


