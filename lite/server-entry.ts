// The server as the lite launcher runs it: the normal server plus a clean exit on `chart-terminal --stop`.
// Stopping goes through process.exit() so the trade recorder flushes (it hooks 'exit'); SIGTERM/SIGINT do the same.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import '../server/index.ts';

const stopFile = join(process.env.CT_DATA_DIR ?? '.', '..', 'stop');   // launcher puts it next to the data dir
try { rmSync(stopFile, { force: true }) } catch {}
setInterval(() => { if (existsSync(stopFile)) { try { rmSync(stopFile, { force: true }) } catch {} process.exit(0) } }, 1000).unref();
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(s, () => process.exit(0));
