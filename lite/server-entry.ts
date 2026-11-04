// The server as the lite launcher runs it: the normal server plus a clean exit on `chart-terminal --stop`.
// Stopping goes through process.exit() so the trade recorder flushes (it hooks 'exit'); SIGTERM/SIGINT do the same.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import '../server/index.ts';
import { route } from '../server/core/http.ts';

// Proves to the launcher that the process on the saved port is the server it started (another local user could bind that
// port): the answer is sha256(launch token + nonce); the token only lives in this process's environment and server.json.
route('GET', '/api/lite/ping', c => ({ proof: createHash('sha256').update(`${process.env.CT_LAUNCH_TOKEN ?? ''}:${c.url.searchParams.get('nonce') ?? ''}`).digest('hex') }), { public: true });

const stopFile = join(process.env.CT_DATA_DIR ?? '.', '..', 'stop');   // launcher puts it next to the data dir
try { rmSync(stopFile, { force: true }) } catch {}
setInterval(() => { if (existsSync(stopFile)) { try { rmSync(stopFile, { force: true }) } catch {} process.exit(0) } }, 1000).unref();
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(s, () => process.exit(0));
