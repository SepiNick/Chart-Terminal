// Chart Terminal lite launcher: runs the bundled server in the background and opens the UI in the system browser's
// app-mode window (Edge/Chrome/Chromium) with its own profile. The server keeps running after the window closes.
// Usage: node launcher.mjs [--no-window] [--status] [--stop] [--foreground]
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
const args = new Set(process.argv.slice(2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const die = msg => { console.error(`chart-terminal: ${msg}`); process.exit(1) };

if (Number(process.versions.node.split('.')[0]) < 24) die(`Node 24 or newer is required (this is ${process.version}).`);

const DATA = process.env.CT_DATA_DIR || (WIN ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'ChartTerminal')
  : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'chart-terminal'));
mkdirSync(join(DATA, 'data'), { recursive: true });
const F = n => join(DATA, n);   // port.txt: last port; server.json: {pid,port}; stop: stop request; server.log; starting.lock

const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } };
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } };
async function answers(port, token) {
  const nonce = randomBytes(16).toString('hex');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/lite/ping?nonce=${nonce}`, { signal: AbortSignal.timeout(1500) });
    return r.ok && token && (await r.json()).proof === createHash('sha256').update(`${token}:${nonce}`).digest('hex');
  } catch { return false }
}
/** The running server's port, or 0. */
async function running() {
  const s = readJson(F('server.json'));
  return s?.port && alive(s.pid) && await answers(s.port, s.token) ? s.port : 0;
}
/** A free loopback port: `want` if it is free (same port = same origin = localStorage survives), else any. */
const freePort = want => new Promise((ok, fail) => {
  const s = createServer().once('error', () => (want ? freePort(0).then(ok, fail) : fail(Error('No free port'))))
    .listen(want, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) });
});

async function stop() {
  const s = readJson(F('server.json'));
  if (!s || !alive(s.pid)) { rmSync(F('server.json'), { force: true }); return console.log('Not running.') }
  writeFileSync(F('stop'), '1');   // the server polls for it and exits cleanly (flushes the trade recorder)
  for (let i = 0; i < 100 && alive(s.pid); i++) await sleep(100);
  if (alive(s.pid)) { try { process.kill(s.pid) } catch {} console.log('Server did not stop in time; killed.') } else console.log('Stopped.');
  rmSync(F('stop'), { force: true }); rmSync(F('server.json'), { force: true });
}

async function startServer(foreground = false) {
  let saved = 0;
  try { saved = Number(readFileSync(F('port.txt'), 'utf8')) || 0 } catch {}
  const token = randomBytes(24).toString('hex'), port = await freePort(saved);
  if (port !== saved) writeFileSync(F('port.txt'), String(port));
  const log = foreground ? 'inherit' : openSync(F('server.log'), 'w');
  const child = spawn(process.execPath, [join(HERE, 'server', 'index.js')], {
    detached: !foreground, windowsHide: true, stdio: foreground ? 'inherit' : ['ignore', log, log], cwd: HERE,
    env: { ...process.env, CT_LAUNCH_TOKEN: token, PORT: String(port), CT_DATA_DIR: join(DATA, 'data'), CT_DIST_DIR: join(HERE, 'dist') },
  });
  let exited = false; child.once('exit', () => { exited = true });
  writeFileSync(F('server.json'), JSON.stringify({ pid: child.pid, port, token }), { mode: 0o600 });
  if (foreground) {   // systemd / always-on mode: stay attached, pass stop signals on, exit with the server
    for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
    child.once('exit', code => { rmSync(F('server.json'), { force: true }); process.exit(code ?? 0) });
    return port;
  }
  child.unref(); closeSync(log);
  for (let i = 0; i < 300 && !exited; i++) { if (await answers(port, token)) return port; await sleep(100) }
  rmSync(F('server.json'), { force: true });
  let tail = ''; try { tail = readFileSync(F('server.log'), 'utf8').slice(-1500) } catch {}
  die(`the server did not start.\n${tail}`);
}

/** Single instance: whoever takes the lock starts the server; a concurrent launch just waits for it. */
async function ensureServer() {
  for (let i = 0; i < 300; i++) {
    const p = await running(); if (p) return p;
    try { writeFileSync(F('starting.lock'), String(process.pid), { flag: 'wx' }) }
    catch { try { if (Date.now() - statSync(F('starting.lock')).mtimeMs > 60_000) rmSync(F('starting.lock'), { force: true }) } catch {} await sleep(200); continue }
    try { return await running() || await startServer() } finally { rmSync(F('starting.lock'), { force: true }) }
  }
  die('timed out waiting for another launch to start the server.');
}

function findBrowser() {
  if (process.env.CT_BROWSER) return process.env.CT_BROWSER;
  if (WIN) {
    const dirs = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const rel = [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe']];
    for (const r of rel) for (const d of dirs) if (existsSync(join(d, ...r))) return join(d, ...r);
    return null;
  }
  for (const n of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome', 'microsoft-edge', 'microsoft-edge-stable'])
    for (const d of (process.env.PATH || '').split(delimiter)) if (d && existsSync(join(d, n))) return join(d, n);
  return null;
}
function openWindow(port) {
  const url = `http://127.0.0.1:${port}/`, b = findBrowser();
  const run = (cmd, a) => spawn(cmd, a, { detached: true, stdio: 'ignore', windowsHide: false }).once('error', () => {}).unref();
  if (b) return run(b, [`--app=${url}`, `--user-data-dir=${join(DATA, 'browser-profile')}`, '--no-first-run', '--no-default-browser-check',
    // A bare profile: no extensions, sync, background updater or translate/side-panel helpers = fewer browser processes and less RAM.
    '--disable-extensions', '--disable-sync', '--disable-component-update', '--disable-background-networking', '--disable-features=Translate,msEdgeSidebarV2,msShoppingAssistant,EdgeCollections']);
  console.error('No Edge/Chrome/Chromium found; opening the default browser instead.');
  if (WIN) run('cmd.exe', ['/c', 'start', '""', url]); else run('xdg-open', [url]);
}

if (args.has('--stop')) { await stop(); process.exit(0) }
if (args.has('--status')) {
  const s = readJson(F('server.json')), p = await running();
  console.log(p ? `Running: http://127.0.0.1:${p}/ (pid ${s.pid})` : 'Not running.', `\nData: ${DATA}`);
  process.exit(p ? 0 : 3);
}
if (args.has('--foreground')) {
  if (await running()) die('already running.');
  console.log(`Chart Terminal: http://127.0.0.1:${await startServer(true)}/ (data in ${DATA})`);
  await new Promise(() => {});   // until the server exits (handler above)
}
const port = await ensureServer();
console.log(`Chart Terminal: http://127.0.0.1:${port}/ (data in ${DATA})`);
if (!args.has('--no-window')) openWindow(port);
await sleep(300);   // let the window process start before this one exits
process.exit(0);
