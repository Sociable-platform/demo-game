import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig, type Config } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import type { CircleLookup } from '../src/market/social.js';

export function makeClock(start = 1_700_000_000_000) {
  const clock = { t: start, now: () => clock.t, advance: (ms: number) => (clock.t += ms) };
  return clock;
}

export function makeApp(opts: { env?: Record<string, string>; dbFile?: string; clock?: ReturnType<typeof makeClock>; rollYield?: () => number; circle?: CircleLookup } = {}) {
  const config: Config = loadConfig({ RATE_LIMIT: 'false', ...opts.env } as NodeJS.ProcessEnv);
  const db = openDb(opts.dbFile ?? ':memory:');
  migrate(db);
  const clock = opts.clock ?? makeClock();
  const app = createApp({ config, db, now: clock.now, rollYield: opts.rollYield ?? (() => 1), circle: opts.circle });
  return { app, db, config, clock };
}

export async function signup(app: Parameters<typeof request.agent>[0], username: string, password = 'correct horse') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ username, password });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; username: string } };
}

export function tempDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-test-'));
  return path.join(dir, 'test.db');
}
