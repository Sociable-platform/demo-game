// End-to-end check against a REAL running server process + real SQLite file.
// Spawns the backend, drives the HTTP API, restarts the backend mid-way, and verifies persistence,
// isolation and duplicate-reward protection. Takes ~20s because carrots really take 15s to grow.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3190;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hv-e2e-')), 'e2e.db');

let passed = 0;
const failures = [];
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'backend/src/index.ts')], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbFile, NODE_ENV: 'development', RATE_LIMIT: 'false' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => d.toString().includes('Harvest Village API') && resolve(child));
    child.on('exit', (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error('server start timeout')), 20000);
  });
}
const stopServer = (child) => new Promise((resolve) => { child.removeAllListeners('exit'); child.on('exit', resolve); child.kill('SIGTERM'); });

// Minimal cookie-jar client (one per simulated browser).
function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) cookie = c.startsWith('hv_session=;') || /Expires=Thu, 01 Jan 1970/.test(c) ? '' : c.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, setCookie: set };
  };
  return { call, getCookie: () => cookie, setCookie: (c) => { cookie = c; } };
}

let server = await startServer();
try {
  console.log('Auth');
  const alice = client(), bob = client(), anon = client();
  let r = await anon.call('GET', '/game/state');
  check('unauthenticated gameplay request is rejected (401)', r.status === 401);
  r = await alice.call('POST', '/auth/register', { username: 'e2e_alice', password: 'alice-password-1' });
  check('register alice (201) and receive HttpOnly cookie', r.status === 201 && /HttpOnly/i.test(r.setCookie.join(';')));
  const aliceId = r.body.user.id;
  r = await bob.call('POST', '/auth/register', { username: 'e2e_bob', password: 'bob-password-1' });
  check('register bob (201)', r.status === 201);
  const bobId = r.body.user.id;
  check('players have distinct server-generated ids', aliceId !== bobId && /^[0-9a-f-]{36}$/.test(aliceId));
  r = await alice.call('GET', '/auth/me');
  check('GET /auth/me returns alice', r.status === 200 && r.body.user.id === aliceId);
  r = await anon.call('POST', '/auth/login', { username: 'e2e_alice', password: 'wrong-password' });
  check('wrong password rejected (401)', r.status === 401);

  console.log('Isolation');
  r = await alice.call('POST', '/game/plots/0/plant', { cropId: 'carrot' });
  check('alice plants a carrot in plot 0', r.status === 200 && r.body.state.farm.plots[0].state === 'growing');
  const plantedState = r.body.state;
  const carrot = plantedState.catalog.find((crop) => crop.id === 'carrot');
  const bobState = (await bob.call('GET', `/game/state?userId=${aliceId}`)).body;
  check("bob's farm is untouched and he sees his own identity", bobState.player.id === bobId && bobState.farm.plots[0].state === 'empty' && bobState.inventory.crops.carrot === 3);
  check('planting consumes one crop from the unified inventory', plantedState.inventory.crops.carrot === bobState.inventory.crops.carrot - 1 && !Object.hasOwn(plantedState.inventory, 'seeds'));
  r = await bob.call('POST', `/game/plots/0/harvest?userId=${aliceId}`, { userId: aliceId });
  check("bob cannot harvest alice's plot by passing her id (acts on his own empty plot)", r.status === 409 && r.body.error.code === 'plot_empty');

  console.log('Gameplay loop (real 15s carrot)');
  r = await alice.call('POST', '/game/plots/0/harvest');
  check('harvest before ready is refused (not_ready)', r.status === 409 && r.body.error.code === 'not_ready');
  r = await alice.call('POST', '/game/shop/buy', { cropId: 'tomato', quantity: 99 });
  check('buying more than affordable is refused (insufficient_coins / validation)', r.status === 409 || r.status === 400);
  r = await alice.call('POST', '/game/shop/buy', { cropId: 'carrot', quantity: 1 });
  check('buy one carrot at the catalog price', r.status === 200 && r.body.coinsSpent === carrot.buyPrice && r.body.state.player.coins === plantedState.player.coins - carrot.buyPrice && r.body.state.inventory.crops.carrot === plantedState.inventory.crops.carrot + 1);
  const beforeHarvest = r.body.state;
  const t0 = Date.now();
  while (true) {
    const s = (await alice.call('GET', '/game/state')).body;
    if (s.farm.plots[0].state === 'ready') break;
    if (Date.now() - t0 > 25000) throw new Error('crop never became ready');
    await sleep(500);
  }
  console.log(`  (waited ${((Date.now() - t0) / 1000).toFixed(1)}s for the plot to become ready)`);

  console.log('Duplicate-reward protection (15 parallel harvests)');
  const results = await Promise.all(Array.from({ length: 15 }, () => alice.call('POST', '/game/plots/0/harvest')));
  const wins = results.filter((x) => x.status === 200).length;
  check('exactly one harvest succeeds', wins === 1, `(got ${wins})`);
  check('duplicate harvests are rejected as empty plots', results.filter((x) => x.status === 409 && x.body.error.code === 'plot_empty').length === results.length - 1);
  const harvest = results.find((x) => x.status === 200)?.body;
  check('harvest reports a whole-number yield between 1 and 5', Number.isInteger(harvest?.yield) && harvest.yield >= 1 && harvest.yield <= 5);
  let s = (await alice.call('GET', '/game/state')).body;
  check('inventory and XP receive exactly the confirmed harvest reward once', s.inventory.crops.carrot === beforeHarvest.inventory.crops.carrot + harvest?.yield && s.player.xp === beforeHarvest.player.xp + carrot.xpReward && harvest?.xpGained === carrot.xpReward && s.player.coins === beforeHarvest.player.coins);

  console.log('Duplicate-spend protection (parallel buys & sells)');
  const beforeBuys = s;
  // Spend the same wallet concurrently; the catalog, not an obsolete fixed price, defines affordability.
  const affordableBuys = Math.min(10, Math.floor(beforeBuys.player.coins / carrot.buyPrice));
  check('fixture wallet can fund exactly one concurrent purchase', affordableBuys === 1);
  const buys = await Promise.all(Array.from({ length: 10 }, () => alice.call('POST', '/game/shop/buy', { cropId: 'carrot', quantity: 1 })));
  check('parallel purchases cannot spend the same coins twice', buys.filter((x) => x.status === 200).length === affordableBuys);
  s = (await alice.call('GET', '/game/state')).body;
  check('wallet and inventory match successful purchases', s.player.coins >= 0 && s.player.coins === beforeBuys.player.coins - affordableBuys * carrot.buyPrice && s.inventory.crops.carrot === beforeBuys.inventory.crops.carrot + affordableBuys);
  const beforeSells = s;
  // Unified inventory includes unplanted starting/bought crops as well as the random harvest.
  // Selling all of it in each request still permits exactly one payout.
  const sells = await Promise.all(Array.from({ length: 8 }, () => alice.call('POST', '/game/sell', { cropId: 'carrot', quantity: 'all' })));
  check('the entire carrot inventory can only be sold once', sells.filter((x) => x.status === 200).length === 1);
  s = (await alice.call('GET', '/game/state')).body;
  check('sale pays the catalog value exactly once and clears those crops', s.player.coins === beforeSells.player.coins + beforeSells.inventory.crops.carrot * carrot.sellPrice && s.inventory.crops.carrot === 0);
  const before = s;

  console.log('Persistence: logout/login and backend restart');
  r = await alice.call('POST', '/auth/logout', {});
  check('logout succeeds and clears the cookie', r.status === 200 && alice.getCookie() === '');
  r = await alice.call('GET', '/game/state');
  check('after logout gameplay is protected again', r.status === 401);
  await stopServer(server);
  server = await startServer(); // brand-new process, same database file
  r = await alice.call('POST', '/auth/login', { username: 'e2e_alice', password: 'alice-password-1' });
  check('login works after backend restart', r.status === 200 && r.body.user.id === aliceId);
  s = (await alice.call('GET', '/game/state')).body;
  check('coins, xp and crop inventory survived restart', s.player.coins === before.player.coins && s.player.xp === before.player.xp && JSON.stringify(s.inventory) === JSON.stringify(before.inventory));
  const bobAfter = await bob.call('GET', '/game/state'); // bob's old session cookie should also survive the restart
  check("bob's session survived the restart and his farm is intact", bobAfter.status === 200 && bobAfter.body.player.id === bobId && bobAfter.body.player.coins === 50);

  console.log('Dev routes');
  r = await anon.call('POST', '/dev/demo-accounts', { reset: true });
  const names = (r.body?.accounts ?? []).map((a) => a.username);
  check('dev route creates two separate demo accounts', r.status === 200 && names.includes('demo_alice') && names.includes('demo_bob'));
  const da = client(), db = client();
  await da.call('POST', '/auth/login', { username: 'demo_alice', password: 'alice-demo-pass' });
  await db.call('POST', '/auth/login', { username: 'demo_bob', password: 'bob-demo-pass' });
  const ids = [(await da.call('GET', '/auth/me')).body.user.id, (await db.call('GET', '/auth/me')).body.user.id];
  check('demo accounts log in as two distinct players', ids[0] !== ids[1]);
} catch (e) {
  failures.push(`exception: ${e.message}`);
  console.error(e);
} finally {
  await stopServer(server).catch(() => {});
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
