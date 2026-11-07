import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

// Optional .env at the repository root (real environment variables always win).
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no .env file: defaults apply */
}

const config = loadConfig();
const db = openDb(config.dbPath);
const ran = migrate(db);
if (ran.length) console.log(`[db] applied migrations: ${ran.join(', ')}`);

const app = createApp({ config, db });
const server = app.listen(config.port, () => {
  console.log(`[api] Harvest Village API on http://localhost:${config.port} (${config.nodeEnv}, db: ${config.dbPath})`);
  if (config.enableDevRoutes) console.log('[api] dev routes ENABLED (/api/dev/*) - development only');
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
