import { defineConfig } from 'vite';

// The data server (server/index.ts) is reached through this same-origin proxy, so it needs no CORS.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
});
