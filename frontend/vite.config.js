import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// In dev the browser talks only to Vite (same origin), which proxies /api to the Express backend.
// That keeps the HttpOnly session cookie first-party, exactly as in production.
export default defineConfig({
  // Read public VITE_* settings from the root .env; backend secrets stay unexposed.
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  // Load the local SDK source directly; no package publishing or Windows symlinks needed.
  resolve: {
    alias: { 'clan-sdk': fileURLToPath(new URL('../clan-sdk/clan-sdk/src/index.js', import.meta.url)) },
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false } },
  },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
