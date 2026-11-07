import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { createGameService } from '../game/service.js';
import { seedDemoAccounts } from './demo.js';

const config = loadConfig();
if (config.isProduction) {
  console.error('Refusing to create demo accounts in production.');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const db = openDb(config.dbPath);
migrate(db);
const game = createGameService(db, Date.now);
const accounts = await seedDemoAccounts(db, Date.now, game.initPlayer, { reset });
for (const a of accounts) {
  console.log(`${a.created ? 'created' : 'exists '}  ${a.username} / ${a.password}`);
}
db.close();
