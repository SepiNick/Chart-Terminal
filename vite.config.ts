import { defineConfig } from 'vite';

// The server (server/index.ts) is reached through this same-origin proxy, so it needs no CORS. changeOrigin stays
// false: the server checks that Origin matches Host (CSRF) and that Host is one it serves (DNS rebinding).
export default defineConfig({
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true, changeOrigin: false },
    },
  },
});
