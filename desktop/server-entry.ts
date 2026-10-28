// The server as the desktop app runs it (bundled by build.mjs, started by main.cjs as an Electron utility process).
// Same server as `node server/index.ts`; this only adds a clean exit so the trade recorder flushes (process 'exit').
import '../server/index.ts';

type ParentPort = { on(ev: 'message', f: (e: { data: unknown }) => void): void };
(process as unknown as { parentPort?: ParentPort }).parentPort?.on('message', e => { if (e.data === 'quit') process.exit(0) });
