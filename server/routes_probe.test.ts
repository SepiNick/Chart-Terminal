import { test } from 'node:test';
import { boot } from './publictest.ts';
test('p', async () => { const b = await boot(); const { routeTable } = await import('./core/http.ts'); console.log(routeTable().map(r => `${r.method} ${r.path}${r.public ? ' P' : ''}`).join('\n')); b.close() });
