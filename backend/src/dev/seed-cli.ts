import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { createGameService } from '../game/service.js';
import { seedDemoAccounts } from './demo.js';
import { createAccountDeletion } from '../auth/delete-account.js';

try { process.loadEnvFile(new URL('../../../.env', import.meta.url)); } catch { /* optional */ }
const config = loadConfig();
if (config.isProduction) {
  console.error('Refusing to create demo accounts in production.');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const db = openDb(config.dbPath);
migrate(db);
const game = createGameService(db, Date.now);
try {
  const accounts = await seedDemoAccounts(db, Date.now, game.initPlayer, createAccountDeletion(db, config).deleteAccount, { reset });
  for (const a of accounts) console.log(`${a.created ? 'created' : 'exists '}  ${a.username} / ${a.password}`);
} catch {
  console.error('Demo reset failed. Accounts whose cleanup failed were kept; check server-side Clan configuration/services and retry.');
  process.exitCode = 1;
} finally { db.close(); }
