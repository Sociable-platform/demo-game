import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  dbPath: string;
  appOrigins: string[];
  sessionTtlMs: number;
  cookieSecure: boolean;
  cookieName: string;
  enableDevRoutes: boolean;
  trustProxy: boolean;
  rateLimitEnabled: boolean;
  frontendDist: string | null;
}

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Works both from src/ (tsx) and dist/ (compiled): backend/ is the parent of either.
const defaultDb = path.join(backendRoot, 'data', 'harvest.db');
const defaultFrontend = path.resolve(backendRoot, '..', 'frontend', 'dist');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  // Secure cookies (and the __Host- prefix) are on in production. COOKIE_SECURE=false lets you
  // run the production build over plain http on your own machine (e.g. Safari on localhost).
  const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction;
  const origins = (env.APP_ORIGIN ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    nodeEnv,
    isProduction,
    port: Number(env.PORT ?? 3001),
    dbPath: env.DB_PATH ? path.resolve(env.DB_PATH) : defaultDb,
    appOrigins: origins,
    sessionTtlMs: Number(env.SESSION_TTL_HOURS ?? 24 * 7) * 3600 * 1000,
    cookieSecure,
    cookieName: cookieSecure ? '__Host-hv_session' : 'hv_session',
    // Dev routes can never be enabled in production, whatever the env says.
    enableDevRoutes: !isProduction && env.ENABLE_DEV_ROUTES !== 'false',
    trustProxy: env.TRUST_PROXY === 'true',
    rateLimitEnabled: env.RATE_LIMIT !== 'false',
    frontendDist: isProduction ? defaultFrontend : null,
  };
}
