import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp, makeClock, signup, tempDbFile } from './helpers.js';

describe('authentication', () => {
  it('registers, sets an HttpOnly session cookie, and returns the current player', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/auth/register').send({ username: 'Alice_1', password: 'secret-pass' });
    expect(res.status).toBe(201);
    expect(res.body.user.id).toMatch(/^[0-9a-f-]{36}$/); // server-generated UUID
    expect(res.body.user.username).toBe('Alice_1');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('hv_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure'); // dev over http

    const { agent, user } = await signup(app, 'bob');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);
  });

  it('uses Secure + __Host- cookies in production', async () => {
    const { app } = makeApp({ env: { NODE_ENV: 'production' } });
    const res = await request(app).post('/api/auth/register').send({ username: 'prod_user', password: 'secret-pass' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('__Host-hv_session=');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
  });

  it('never stores plaintext passwords and never returns the hash', async () => {
    const { app, db } = makeApp();
    const res = await request(app).post('/api/auth/register').send({ username: 'carol', password: 'plaintext-check-1' });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|plaintext-check-1/);
    const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('carol') as { password_hash: string };
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('plaintext-check-1');
  });

  it('stores only a hash of the session token', async () => {
    const { app, db } = makeApp();
    const res = await request(app).post('/api/auth/register').send({ username: 'dave', password: 'secret-pass' });
    const token = /hv_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
    const rows = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
  });

  it('rejects duplicate usernames case-insensitively and validates input', async () => {
    const { app } = makeApp();
    await signup(app, 'Erin');
    const dup = await request(app).post('/api/auth/register').send({ username: 'erin', password: 'secret-pass' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('username_taken');
    expect(dup.body.error.message).toBe('This username is already taken.');
    for (const bad of [
      { username: 'ab', password: 'secret-pass' },
      { username: 'has space', password: 'secret-pass' },
      { username: 'valid_name', password: 'short' },
      { username: 'valid_name' },
      {},
    ]) {
      const r = await request(app).post('/api/auth/register').send(bad);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('validation_error');
    }
  });

  it('trims registration/login usernames and preserves the chosen display capitalization', async () => {
    const { app } = makeApp();
    const registered = await request(app).post('/api/auth/register')
      .send({ username: '\t \u3000NuRaY\u00a0 ', password: 'secret-pass' });
    expect(registered.status).toBe(201);
    expect(registered.body.user.username).toBe('NuRaY');
    for (const username of ['Nuray', 'nuray', ' nuray ', '\tNURAY\u00a0']) {
      const duplicate = await request(app).post('/api/auth/register').send({ username, password: 'another-password' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toMatchObject({ code: 'username_taken', message: 'This username is already taken.' });
      const login = await request(app).post('/api/auth/login').send({ username, password: 'secret-pass' });
      expect(login.status).toBe(200);
      expect(login.body.user).toEqual(registered.body.user);
    }
  });

  it('permits only one concurrent registration across separate database connections', async () => {
    const file = tempDbFile();
    const first = makeApp({ dbFile: file }), second = makeApp({ dbFile: file });
    try {
      const results = await Promise.all(['Nuray', ' NURAY ', '\tnuray\t', 'NuRaY'].map((username, i) =>
        request(i % 2 ? first.app : second.app).post('/api/auth/register').send({ username, password: 'secret-pass' })));
      expect(results.filter(r => r.status === 201)).toHaveLength(1);
      expect(results.filter(r => r.status === 409)).toHaveLength(3);
      for (const result of results.filter(r => r.status === 409)) {
        expect(result.body.error.message).toBe('This username is already taken.');
      }
      expect(first.db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
      expect(first.db.prepare('SELECT count(*) AS n FROM players').get()).toEqual({ n: 1 });
      expect(first.db.prepare('SELECT count(*) AS n FROM farm_plots').get()).toEqual({ n: 9 });
    } finally { first.db.close(); second.db.close(); }
  });

  it('uses the same trimmed case-insensitive username for login rate limiting', async () => {
    const { app } = makeApp({ env: { RATE_LIMIT: 'true' } });
    const names = [' Nobody ', 'NOBODY', '\tnobody\t'];
    let result;
    for (let i = 0; i < 11; i++) {
      result = await request(app).post('/api/auth/login').send({ username: names[i % names.length], password: 'wrong-password' });
    }
    expect(result!.status).toBe(429);
  });

  it('logs in with the right password only, with identical errors for unknown users and wrong passwords', async () => {
    const { app } = makeApp();
    await signup(app, 'frank', 'right-password');
    const ok = await request(app).post('/api/auth/login').send({ username: 'FRANK', password: 'right-password' });
    expect(ok.status).toBe(200);
    expect(String(ok.headers['set-cookie'])).toContain('hv_session=');
    const wrong = await request(app).post('/api/auth/login').send({ username: 'frank', password: 'wrong-password' });
    const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('logout destroys the session server-side, even if the old cookie is replayed', async () => {
    const { app } = makeApp();
    const reg = await request(app).post('/api/auth/register').send({ username: 'gina', password: 'secret-pass' });
    const cookie = String(reg.headers['set-cookie'][0]).split(';')[0];
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('expires sessions', async () => {
    const clock = makeClock();
    const { app } = makeApp({ clock, env: { SESSION_TTL_HOURS: '1' } });
    const { agent } = await signup(app, 'hank');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    clock.advance(61 * 60 * 1000);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('protects every gameplay endpoint', async () => {
    const { app } = makeApp();
    const calls = [
      request(app).get('/api/game/state'),
      request(app).post('/api/game/shop/buy').send({ cropId: 'carrot', quantity: 1 }),
      request(app).post('/api/game/plots/0/plant').send({ cropId: 'carrot' }),
      request(app).post('/api/game/plots/0/harvest'),
      request(app).post('/api/game/sell').send({ cropId: 'carrot', quantity: 1 }),
      request(app).get('/api/auth/me'),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    }
  });

  it('rejects state-changing requests from foreign origins (CSRF defence)', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ username: 'x_user', password: 'secret-pass' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden_origin');
    const allowed = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ username: 'x_user', password: 'secret-pass' });
    expect(allowed.status).toBe(401);
  });

  it('rate limits repeated login attempts', async () => {
    const { app } = makeApp({ env: { RATE_LIMIT: 'true' } });
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await request(app).post('/api/auth/login').send({ username: 'ivy_x', password: 'wrong-password' })).status;
    }
    expect(last).toBe(429);
  });

  it('only mounts dev routes outside production', async () => {
    const dev = makeApp();
    expect((await request(dev.app).get('/api/config')).body.devMode).toBe(true);
    expect((await request(dev.app).post('/api/dev/demo-accounts').send({})).status).toBe(200);
    const prod = makeApp({ env: { NODE_ENV: 'production', ENABLE_DEV_ROUTES: 'true' } });
    expect((await request(prod.app).get('/api/config')).body.devMode).toBe(false);
    expect((await request(prod.app).post('/api/dev/demo-accounts').send({})).status).toBe(404);
  });

  it('keeps users, sessions and passwords across a backend restart', async () => {
    const file = tempDbFile();
    const first = makeApp({ dbFile: file });
    const reg = await request(first.app).post('/api/auth/register').send({ username: 'jules', password: 'secret-pass' });
    const cookie = String(reg.headers['set-cookie'][0]).split(';')[0];
    first.db.close();
    const second = makeApp({ dbFile: file }); // "restart": brand new app + db handle on the same file
    expect((await request(second.app).get('/api/auth/me').set('Cookie', cookie)).body.user.username).toBe('jules');
    expect((await request(second.app).post('/api/auth/login').send({ username: 'jules', password: 'secret-pass' })).status).toBe(200);
  });
});
