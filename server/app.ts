// Composition: which modules a server runs. Modules register their routes and WebSocket ops when imported, so a module
// that is not imported has no code path at all. Public mode never imports brokers, secrets, forward, the script engine,
// the recorder, llm, mt5, ml or lan.
import http from 'node:http';
import { handle, upgrade } from './core/http.ts';
import { isPublic } from './core/mode.ts';

// Order matters for route matching (first registered wins) and is the same as before in private mode.
await import('./market.ts');
await import('./authroutes.ts');
await import('./state.ts');
await import('./restore.ts');
await import('./notify/index.ts');
await import('./alerts/index.ts');
if (!isPublic) { await import('./forward.ts'); await import('./recorder.ts'); await import('./dominance/record.ts') }
await import('./share.ts');
await import('./derivs.ts');
if (!isPublic) await import('./brokers/index.ts');
await import('./marketdata.ts');
await import('./sec.ts');
if (!isPublic || process.env.CT_ENABLE_PTR === '1') await import('./ptr.ts');   // shells out to pdftotext: opt-in on a public server
if (!isPublic) { await import('./llm.ts'); await import('./ml.ts') }

export const createServer = () => {
  const server = http.createServer((req, res) => handle(req, res, false));
  server.on('upgrade', upgrade);
  return server;
};
