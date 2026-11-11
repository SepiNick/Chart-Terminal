import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

// The server (server/index.ts) is reached through this same-origin proxy, so it needs no CORS. changeOrigin stays
// false: the server checks that Origin matches Host (CSRF) and that Host is one it serves (DNS rebinding).
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },   // shown in bug reports (src/bugreport.ts)
  build: { rollupOptions: { input: { main: 'index.html', widget: 'widget.html' } } },   // widget.html: the desktop widgets
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true, changeOrigin: false },
      '/s/': { target: 'http://127.0.0.1:8787', changeOrigin: false },   // shared snapshot images
    },
  },
});
