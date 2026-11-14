// Real production image + fresh Docker volume. No mocked game services.
// --keep leaves the disposable environment running for manual browser checks.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

try {process.loadEnvFile(new URL('../.env', import.meta.url));} catch {}
const image = process.env.IMAGE_CHECK_IMAGE ?? 'harvest-village:image-check';
const name = 'harvest-village-image-check';
const volume = `${name}-${Date.now()}`;
const port = process.env.IMAGE_CHECK_PORT ?? '3001';
const base = `http://127.0.0.1:${port}`;
const keep = process.argv.includes('--keep');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = (...args) => {
  const result = spawnSync('docker', args, {encoding: 'utf8', maxBuffer: 8e6});
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker command failed');
  return result.stdout.trim();
};
const existing = spawnSync('docker', ['container', 'inspect', name], {stdio: 'ignore'});
assert.notEqual(existing.status, 0, `${name} already exists; stop/remove your previous check container first`);
// The browser uses localhost service URLs; a container reaches those services
// through the Docker host. This affects only the test process's runtime env.
if (process.env.CLAN_PLATFORM_URL) {
  const url = new URL(process.env.CLAN_PLATFORM_URL);
  if (['localhost', '127.0.0.1'].includes(url.hostname)) url.hostname = 'host.docker.internal';
  process.env.CLAN_PLATFORM_URL = url.href;
}
let cookie = '', created = false, running = false, passed = false;
async function api(method, path, body, status = 200) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: {Origin: base, ...(cookie ? {Cookie: cookie} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  for (const value of response.headers.getSetCookie()) cookie = value.split(';')[0];
  assert.equal(response.status, status, `${method} ${path}`);
  return response.json();
}
async function start() {
  docker('run', '-d', '--init', '--name', name, '-p', `127.0.0.1:${port}:3001`,
    '--env', 'COOKIE_SECURE=false', '--env', `APP_ORIGIN=http://localhost:${port},${base}`,
    '--env', 'CLAN_PLATFORM_URL', '--env', 'CLAN_GAME_API_KEY',
    '--add-host', 'host.docker.internal:host-gateway', '--mount', `type=volume,source=${volume},target=/app/data`, image);
  running = true;
  for (let i = 0; i < 100; i++) {
    try {const r = await fetch(`${base}/api/health`); if (r.ok) return;} catch {}
    await sleep(200);
  }
  throw new Error('Production container did not become healthy');
}
function removeContainer() {
  if (running) {docker('stop', name); docker('rm', name); running = false;}
}
try {
  docker('volume', 'create', volume); created = true;
  await start();
  assert.deepEqual(await api('GET', '/health'), {ok: true});
  const runtime = docker('exec', name, 'node', '--input-type=module', '-e',
    "import {DatabaseSync} from 'node:sqlite';import {accessSync,constants} from 'node:fs';if(process.getuid()===0)throw Error('root');accessSync('/app/data',constants.W_OK);const db=new DatabaseSync(':memory:');if(db.prepare('select 42 as n').get().n!==42)throw Error('sqlite');db.close();console.log('uid='+process.getuid()+'; '+process.arch+'; node:sqlite OK; /app/data writable');");
  console.log(`PASS runtime: ${runtime}`);
  const config = JSON.parse(docker('image', 'inspect', image, '--format', '{{json .Config}}'));
  assert.ok(!config.Env.some(value => value.startsWith('CLAN_GAME_API_KEY=')), 'API key baked into image');
  assert.equal(config.Env.find(value => value.startsWith('DB_PATH=')), 'DB_PATH=/app/data/harvest.db');
  const html = await (await fetch(base)).text();
  const sdkUrl = html.match(/<script src="([^"]+)"/)[1];
  assert.equal(sdkUrl, config.Env.find(value => value.startsWith('VITE_CLAN_SDK_URL=')).slice('VITE_CLAN_SDK_URL='.length));
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2, 'Built frontend assets missing');
  for (const path of assets) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const content = await response.text();
    if (process.env.CLAN_GAME_API_KEY) assert.ok(!content.includes(process.env.CLAN_GAME_API_KEY), 'API key in frontend');
  }
  console.log(`PASS /api/health, built frontend JS/CSS, hosted SDK URL (${sdkUrl}), runtime-only key`);
  assert.deepEqual(await api('GET', '/config'), {devMode: false});
  const credentials = {username: `img_${Date.now().toString(36)}`, password: randomUUID()};
  const {user} = await api('POST', '/auth/register', credentials, 201);
  await api('POST', '/game/shop/buy', {cropId: 'carrot', quantity: 4});
  await api('POST', '/game/plots/0/plant', {cropId: 'carrot'});
  console.log('Waiting for the real 15-second carrot timer…');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if ((await api('GET', '/game/state')).farm.plots[0].state === 'ready') {ready = true; break;}
    await sleep(500);
  }
  assert.ok(ready, 'Crop did not ripen');
  await api('POST', '/game/plots/0/harvest');
  await api('POST', '/game/sell', {cropId: 'carrot', quantity: 'all'});
  await api('POST', '/game/plots/1/plant', {cropId: 'carrot'});
  const before = await api('GET', '/game/state');
  assert.equal(before.player.coins, 28); assert.equal(before.player.xp, 8);
  console.log('PASS register, buy, plant, grow, harvest and sell');
  removeContainer();
  await start(); // A new container, same named volume and saved session cookie.
  const after = await api('GET', '/game/state');
  assert.equal(after.player.id, user.id);
  assert.equal(after.player.coins, before.player.coins);
  assert.equal(after.player.xp, before.player.xp);
  assert.deepEqual(after.inventory, before.inventory);
  for (const key of ['cropId', 'plantedAt', 'readyAt']) assert.equal(after.farm.plots[1][key], before.farm.plots[1][key]);
  await api('POST', '/auth/logout', {}); cookie = '';
  assert.equal((await api('POST', '/auth/login', credentials)).user.id, user.id);
  console.log('PASS session, account/password, coins, XP, inventory and planted-crop timestamps survive container recreation');
  passed = true;
} finally {
  if (keep && passed) {
    console.log(`Kept ${name} at http://localhost:${port}; isolated volume: ${volume}`);
    console.log(`Cleanup: docker stop ${name}; docker rm ${name}; docker volume rm ${volume}`);
  } else {
    removeContainer();
    if (created) docker('volume', 'rm', volume);
  }
}
