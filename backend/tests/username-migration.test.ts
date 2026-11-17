import {afterEach, describe, expect, it} from 'vitest';
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import {openDb, type Db} from '../src/db/connection.js';
import {migrate} from '../src/db/migrate.js';
import {UsernameConflictError} from '../src/auth/usernames.js';
import {loadConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {signup} from './helpers.js';

const resources: {db: Db; directory: string}[] = [];
afterEach(() => {for (const {db,directory} of resources.splice(0)) {db.close();rmSync(directory,{recursive:true,force:true});}});
function legacy() {
  const directory = mkdtempSync(join(tmpdir(),'hv-legacy-usernames-'));
  copyFileSync(new URL('../src/db/migrations/001_init.sql',import.meta.url),join(directory,'001_init.sql'));
  // Game state now includes personal quests, so the legacy fixture also has those (independent) tables.
  copyFileSync(new URL('../src/db/migrations/005_personal_quests.sql',import.meta.url),join(directory,'005_personal_quests.sql'));
  const db = openDb(join(directory,'legacy.db')); resources.push({db,directory});
  migrate(db,directory);
  const app = createApp({db,config:loadConfig({RATE_LIMIT:'false'}),rollYield:()=>1});
  return {db,app};
}

describe('normalized username migration', () => {
  it('upgrades a legacy account, preserving its capitalization, password, session and farm', async () => {
    const {db,app} = legacy();
    const {agent,user} = await signup(app,'NuRaY','existing-password');
    await agent.post('/api/game/shop/buy').send({cropId:'carrot',quantity:2});
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('\t NuRaY\u00a0',user.id);
    const hash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    const before = (await agent.get('/api/game/state')).body;
    expect(migrate(db)).toEqual(['002_unique_normalized_usernames.sql', '003_clan_quest.sql', '004_deliveries.sql', '006_market.sql', '007_market_audiences.sql']);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id)).toEqual(hash);
    const after = (await agent.get('/api/game/state')).body;
    expect(after.player.id).toBe(user.id);
    expect(after.player.coins).toBe(before.player.coins);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.farm).toEqual(before.farm);
    const login = await request(app).post('/api/auth/login').send({username:' \u3000nUrAy\t',password:'existing-password'});
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({id:user.id,username:'NuRaY'});
  });

  it('rejects direct SQL inserts and updates using every surrounding whitespace character', async () => {
    const {db,app} = legacy();
    await signup(app,'NuRaY');
    const second = await signup(app,'Other');
    migrate(db);
    const chars = [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279];
    for (const code of chars) {
      const space = String.fromCodePoint(code), name = `${space}nUrAy${space}`;
      expect(name.trim()).toBe('nUrAy');
      expect(() => db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)')
        .run(`duplicate-${code}`,name,'not-used',1)).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare('UPDATE users SET username=? WHERE id=?').run(name,second.user.id)).toThrow(/UNIQUE constraint failed/);
    }
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({n:2});
  });

  it('reports conflicting account IDs, rolls back safely, and supports a rename without losing progress', async () => {
    const {db,app} = legacy();
    const first = await signup(app,'Nuray'), second = await signup(app,'Other');
    await second.agent.post('/api/game/shop/buy').send({cropId:'carrot',quantity:2});
    db.prepare('UPDATE users SET username=? WHERE id=?').run(' nuray ',second.user.id);
    const snapshot = () => Object.fromEntries(['users','players','inventory','farm_plots','sessions'].map(table =>
      [table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const before = snapshot();
    let error: unknown;
    try {migrate(db);} catch (caught) {error = caught;}
    expect(error).toBeInstanceOf(UsernameConflictError);
    expect((error as UsernameConflictError).conflicts).toEqual([{normalized:'nuray',accounts:expect.arrayContaining([
      {id:first.user.id,username:'Nuray'},{id:second.user.id,username:' nuray '},
    ])}]);
    expect((error as Error).message).toContain(second.user.id);
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT name FROM schema_migrations WHERE name='002_unique_normalized_usernames.sql'").get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_users_username_normalized'").get()).toBeUndefined();
    // Admin-selected replacement changes only this account's display/login name.
    db.prepare('UPDATE users SET username=? WHERE id=?').run('Nuray_2',second.user.id);
    migrate(db);
    const login = await request(app).post('/api/auth/login').send({username:' NURAY_2 ',password:'correct horse'});
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(second.user.id);
    const state = await second.agent.get('/api/game/state');
    expect(state.body.player.coins).toBe(30);
    expect(state.body.inventory.seeds.carrot).toBe(5);
  });
});
