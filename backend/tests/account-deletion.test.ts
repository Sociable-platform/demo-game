import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makeApp, signup } from './helpers.js';
import type { Db } from '../src/db/connection.js';

const key = 'private-game-key', token = 'private.cleanup.token';
const env = { CLAN_PLATFORM_URL: 'https://platform.test', CLAN_SOCIAL_URL: 'https://social.test', CLAN_GAME_API_KEY: key };
const issued = () => new Response(JSON.stringify({ token, expiresIn: 3600 }));
const gone = () => new Response(null, { status: 204 });
const dbs: Db[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); });
function setup(overrides = {}) {
  const f = makeApp({ env: { ...env, ...overrides } }); dbs.push(f.db); return f;
}
const exists = (db: Db, id: string) => Boolean(db.prepare('SELECT id FROM users WHERE id = ?').get(id));
function snapshot(db: Db, id: string) {
  return Object.fromEntries(['users', 'sessions', 'players', 'farm_plots', 'inventory'].map(table => [table, db.prepare(`SELECT * FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} = ?`).all(id)]));
}
function mockFetch() {
  const mock = vi.fn(async (_url: URL | string, options: RequestInit) => options.method === 'POST' ? issued() : gone());
  vi.stubGlobal('fetch', mock); return mock;
}

describe('account deletion (mock Platform/Social; real sessions and SQLite)', () => {
  it('cleans Social before deleting the authenticated user, cascades progress/sessions and clears the cookie', async () => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'DeleteMe');
    const other = await signup(app, 'OtherPlayer');
    await agent.post('/api/game/plots/0/plant').send({ cropId: 'carrot' });
    const extraLogin = await request(app).post('/api/auth/login').send({ username: 'deleteme', password: 'correct horse' });
    const otherBefore = snapshot(db, other.user.id);
    const mock = mockFetch();
    mock.mockImplementation(async (_url, options) => {
      expect(exists(db, user.id)).toBe(true);
      expect((snapshot(db, user.id).farm_plots as unknown[]).length).toBe(9);
      return options.method === 'POST' ? issued() : gone();
    });
    const res = await agent.delete('/api/auth/account?userId='+other.user.id).set('X-Player-Id', other.user.id)
      .send({ userId: other.user.id, externalPlayerId: other.user.id, displayName: 'forged' });
    expect(res.status).toBe(200); expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['set-cookie'])).toMatch(/hv_session=;/);
    expect(mock).toHaveBeenCalledTimes(2);
    const [platform, platformOptions] = mock.mock.calls[0];
    expect(String(platform)).toBe('https://platform.test/api/v1/players/auth');
    expect(JSON.parse(String(platformOptions.body))).toEqual({ externalPlayerId: user.id, displayName: user.username });
    expect(platformOptions.headers).toMatchObject({ 'X-API-Key': key });
    const [social, socialOptions] = mock.mock.calls[1];
    expect(String(social)).toBe('https://social.test/api/v1/players/me');
    expect(socialOptions).toMatchObject({ method: 'DELETE', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${token}` }, signal: expect.any(AbortSignal) });
    expect(socialOptions.headers).not.toHaveProperty('X-API-Key');
    expect(Object.values(snapshot(db, user.id)).every(rows => (rows as unknown[]).length === 0)).toBe(true);
    expect(snapshot(db, other.user.id)).toEqual(otherBefore);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/game/state').set('Cookie', extraLogin.headers['set-cookie'][0].split(';')[0])).status).toBe(401);
    expect((await agent.post('/api/auth/login').send({ username: 'DeleteMe', password: 'correct horse' })).status).toBe(401);
    expect(res.text).not.toContain(token); expect(res.text).not.toContain(key);
    const again = await signup(app, ' deleteme '); expect(again.user.id).not.toBe(user.id);
  });

  it('accepts only 401 player_deleted as already-cleaned Social state', async () => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'AlreadyGone');
    const mock = mockFetch();mock.mockResolvedValueOnce(issued()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'player_deleted' } }), { status: 401 }));
    expect((await agent.delete('/api/auth/account')).status).toBe(200); expect(exists(db, user.id)).toBe(false);
  });

  it.each([200, 202, 400, 401, 403, 404, 429, 500, 503])('keeps the complete local account for other Social HTTP %i responses', async status => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'SocialFailure');const before = snapshot(db, user.id);
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {}), mock = mockFetch();
    mock.mockResolvedValueOnce(issued()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'token_expired', message: key+token } }), { status }));
    const res = await agent.delete('/api/auth/account');
    expect(res.status).toBe(502); expect(res.body.error.message).toMatch(/saved.*retry/i);
    expect(snapshot(db, user.id)).toEqual(before);expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();expect(logger).toHaveBeenCalledWith('[account-deletion] failed', { stage: 'social', userId: user.id });
    expect(JSON.stringify(logger.mock.calls)+res.text).not.toContain(key);expect(JSON.stringify(logger.mock.calls)+res.text).not.toContain(token);
  });

  it('preserves local data when Social is unreachable or its 401 response is malformed', async () => {
    for (const mode of ['network', 'malformed']) {
      const { app, db } = setup(), { agent, user } = await signup(app, 'BadSocial');const before = snapshot(db, user.id);
      vi.spyOn(console, 'warn').mockImplementation(() => {});const mock = mockFetch();mock.mockResolvedValueOnce(issued());
      if (mode === 'network') mock.mockRejectedValueOnce(new Error(key+token));else mock.mockResolvedValueOnce(new Response('invalid JSON', { status: 401 }));
      expect((await agent.delete('/api/auth/account')).status).toBe(502);expect(snapshot(db, user.id)).toEqual(before);
    }
  });

  it.each(['network', 'http', 'payload'])('preserves local account and never calls Social on Platform %s failure', async mode => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'PlatformFail');const before = snapshot(db, user.id);
    vi.spyOn(console, 'warn').mockImplementation(() => {});const mock = mockFetch();
    if (mode === 'network') mock.mockRejectedValueOnce(new Error(key));
    else mock.mockResolvedValueOnce(new Response(mode === 'http' ? key : '{}', { status: mode === 'http' ? 401 : 200 }));
    expect((await agent.delete('/api/auth/account')).status).toBe(502);expect(mock).toHaveBeenCalledTimes(1);expect(snapshot(db, user.id)).toEqual(before);
  });

  it.each([{ CLAN_SOCIAL_URL: '' }, { CLAN_SOCIAL_URL: 'https://user:pass@social.test' }, { CLAN_SOCIAL_URL: 'https://social.test?token=x' }, { CLAN_PLATFORM_URL: '' }, { CLAN_GAME_API_KEY: '' }])('refuses unconfigured cleanup without deleting locally: %j', async overrides => {
    const { app, db } = setup(overrides), { agent, user } = await signup(app, 'ConfigFailure');vi.spyOn(console, 'warn').mockImplementation(() => {});const mock = mockFetch();
    expect((await agent.delete('/api/auth/account')).status).toBe(503);expect(mock).not.toHaveBeenCalled();expect(exists(db, user.id)).toBe(true);
  });

  it('requires authentication and the existing same-origin protection', async () => {
    const { app } = setup(), mock = mockFetch();expect((await request(app).delete('/api/auth/account')).status).toBe(401);
    const { agent } = await signup(app, 'ProtectedUser');
    expect((await agent.delete('/api/auth/account').set('Origin', 'https://evil.test')).status).toBe(403);expect(mock).not.toHaveBeenCalled();
  });

  it('rolls back local failure, then retries with a fresh token and accepts already-deleted Social', async () => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'LocalFailure'), mock = mockFetch();const before = snapshot(db, user.id);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.exec("CREATE TRIGGER fail_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'temporary local failure'); END;");
    expect((await agent.delete('/api/auth/account')).status).toBe(500);expect(snapshot(db, user.id)).toEqual(before);
    db.exec('DROP TRIGGER fail_user_delete');
    mock.mockResolvedValueOnce(issued()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'player_deleted' } }), { status: 401 }));
    expect((await agent.delete('/api/auth/account')).status).toBe(200);expect(exists(db, user.id)).toBe(false);
    expect(mock.mock.calls.filter(([, opts]) => opts.method === 'POST')).toHaveLength(2);
  });

  it('bounds hanging Social error-body loading and preserves the account', async () => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'TimeoutUser');vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mock = mockFetch();mock.mockImplementationOnce(async () => issued()).mockImplementationOnce(async (_url, opts) => ({
      status: 401, json: () => new Promise((_resolve, reject) => opts.signal!.addEventListener('abort', () => reject(new Error(token)), { once: true })),
    } as unknown as Response));
    expect((await agent.delete('/api/auth/account')).status).toBe(502);expect(exists(db, user.id)).toBe(true);
  });

  it('shares concurrent deletions and prevents widget token issuance during cleanup', async () => {
    const { app, db } = setup(), { agent, user } = await signup(app, 'ConcurrentUser');
    let resolve!: (r: Response) => void;const wait = new Promise<Response>(done => { resolve = done; });
    const mock = mockFetch();mock.mockImplementationOnce(() => wait);
    const a = agent.delete('/api/auth/account').then(r => r), b = agent.delete('/api/auth/account').then(r => r);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    expect((await agent.post('/api/community/token').send({})).status).toBe(409);
    resolve(issued());expect((await Promise.all([a, b])).map(r => r.status)).toEqual([200, 200]);
    expect(mock).toHaveBeenCalledTimes(2);expect(exists(db, user.id)).toBe(false);
  });

  it('does not return an in-flight widget token after its local account was deleted', async () => {
    const { app } = setup(), { agent } = await signup(app, 'LateToken');
    let resolve!: (r: Response) => void;const mock = mockFetch();mock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const bridge = agent.post('/api/community/token').send({}).then(r => r);await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    expect((await agent.delete('/api/auth/account')).status).toBe(200);resolve(issued());
    const response = await bridge;expect(response.status).toBe(401);expect(response.text).not.toContain(token);
  });

  it('demo bulk/reset cleans each old identity; failure keeps the failed and unprocessed accounts', async () => {
    const { app, db } = setup(), mock = mockFetch();
    expect((await request(app).post('/api/dev/demo-accounts').send({})).status).toBe(200);expect(mock).not.toHaveBeenCalled();
    const original = db.prepare('SELECT id FROM users ORDER BY username').all() as { id: string }[];
    vi.spyOn(console, 'warn').mockImplementation(() => {});mock.mockResolvedValueOnce(issued()).mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await request(app).post('/api/dev/demo-accounts').send({ reset: true })).status).toBe(502);
    expect(db.prepare('SELECT id FROM users ORDER BY username').all()).toEqual(original);
    mock.mockClear();expect((await request(app).post('/api/dev/demo-accounts').send({ reset: true })).status).toBe(200);
    for (const old of original) expect(exists(db, old.id)).toBe(false);
    expect(mock.mock.calls.filter(([, opts]) => opts.method === 'POST').map(([, opts]) => JSON.parse(String(opts.body)).externalPlayerId)).toEqual(original.map(x => x.id));
    expect(mock.mock.calls.filter(([, opts]) => opts.method === 'DELETE')).toHaveLength(2);
  });
});
