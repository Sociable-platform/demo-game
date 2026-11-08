import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// In dev the browser talks only to Vite (same origin), which proxies /api to the Express backend.
// That keeps the HttpOnly session cookie first-party, exactly as in production.
export default defineConfig(({ mode }) => {
  const gameRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, gameRoot, 'CLAN_SDK_');
  const sdkEntry = path.resolve(gameRoot, process.env.CLAN_SDK_ENTRY || env.CLAN_SDK_ENTRY || 'clan-sdk/clan-sdk/src/index.js');
  return {
  // Read public VITE_* settings from the root .env; backend secrets stay unexposed.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  // Load the local SDK source directly; no package publishing or Windows symlinks needed.
  resolve: {
    alias: { 'clan-sdk': sdkEntry },
  },
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [gameRoot, path.dirname(path.dirname(sdkEntry))] },
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false } },
  },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
  };
});
