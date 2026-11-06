// Python tool: runs the owner's own Python code on the chart's bars (ml/pyrun.py, one JSON request on stdin).
// NOT a sandbox: the code runs with the privileges of whoever started this server. So it is off by default, can only be
// switched on from this computer, and never exists on a public server (app.ts imports this file in private mode only).
// docs/python.md
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configGet, configSet } from './core/db.ts';
import { HttpError, bad, isLoopbackHost, obj, route } from './core/http.ts';
import { clientIp } from './core/mode.ts';

export const PYRUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'ml', 'pyrun.py');
export const MAX_BARS = 20_000;
const MAX_CODE = 512 * 1024, MAX_OUT = 32 * 1024 * 1024, MAX_ERR = 64 * 1024;
const PACKAGES = ['pandas', 'numpy', 'scipy', 'sklearn', 'ta', 'matplotlib'];
const PROBE = `import sys,json,importlib.util as u;print(json.dumps({"version":sys.version.split()[0],"packages":{n:u.find_spec(n) is not None for n in ${JSON.stringify(PACKAGES)}}}))`;

interface PyConfig { enabled: boolean; remote: boolean }
const cfg = (): PyConfig => ({ enabled: false, remote: false, ...configGet<Partial<PyConfig>>('py', {}) });
const isLocal = (req: Parameters<typeof clientIp>[0]) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp(req));
/** Seconds a run may take (CT_PY_TIMEOUT, default 60). */
export const timeoutSec = () => { const n = Number(process.env.CT_PY_TIMEOUT); return Number.isFinite(n) && n >= 1 ? Math.min(n, 3600) : 60 };

const candidates = (): string[][] => process.env.CT_PYTHON ? [[process.env.CT_PYTHON]] : process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];

/** Kill a process and everything it started (`py -3` starts python.exe as a child; user code may start more). */
function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else process.kill(-pid, 'SIGKILL');
  } catch { /* already gone */ }
}

interface Done { out: string; err: string; timedOut: boolean; tooBig: boolean; code: number | null }
function spawnPy(cmd: string[], args: string[], input: string, cwd: string, ms: number, killAfterAnswer = false): Promise<Done> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd[0], [...cmd.slice(1), '-X', 'utf8', ...args], { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' } });
    const out: Buffer[] = [], err: Buffer[] = [];
    let nOut = 0, nErr = 0, timedOut = false, tooBig = false;
    const timer = setTimeout(() => { timedOut = true; killTree(p.pid) }, ms);
    p.stdout.on('data', (b: Buffer) => { nOut += b.length; if (nOut > MAX_OUT) { tooBig = true; killTree(p.pid); return } out.push(b) });
    p.stderr.on('data', (b: Buffer) => { if (nErr < MAX_ERR) { nErr += b.length; err.push(b) } });
    // The harness closes its answer pipe when it has answered, then waits for us: kill the tree while its root is alive (taskkill /T cannot find the children of a dead process).
    p.stdout.on('end', () => { if (killAfterAnswer) setTimeout(() => killTree(p.pid), 150) });
    p.stdin.on('error', () => {});
    p.on('error', e => { clearTimeout(timer); reject(e) });
    p.on('close', code => { clearTimeout(timer); killTree(p.pid); resolve({ out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8'), timedOut, tooBig, code }) });   // killTree again: user code may have left children
    p.stdin.end(input);
  });
}

// ---------- which interpreter, and what it has installed (cached: it does not change while the server runs) ----------
interface Probe { cmd: string[] | null; version: string | null; packages: Record<string, boolean>; at: number; key: string }
let probed: Probe | null = null;
async function probe(force = false): Promise<Probe> {
  const key = JSON.stringify(candidates());
  if (!force && probed && probed.key === key && Date.now() - probed.at < (probed.cmd ? 5 * 60_000 : 15_000)) return probed;
  for (const cmd of candidates()) {
    try {
      const r = await spawnPy(cmd, ['-c', PROBE], '', tmpdir(), 20_000);
      const j = JSON.parse(r.out) as { version: string; packages: Record<string, boolean> };
      if (typeof j.version === 'string') return (probed = { cmd, version: j.version, packages: j.packages ?? {}, at: Date.now(), key });
    } catch { /* not found, or the Windows Store stub: next candidate */ }
  }
  return (probed = { cmd: null, version: null, packages: {}, at: Date.now(), key });
}

async function status(req: Parameters<typeof clientIp>[0]) {
  const c = cfg(), p = await probe(), local = isLocal(req);
  return { enabled: c.enabled, remote: c.remote, remoteAllowed: c.remote, local, canRun: c.enabled && (local || c.remote), python: p.version, packages: p.packages, timeoutSec: timeoutSec(), maxBars: MAX_BARS };
}

// ---------- request checks ----------
interface Row { time: number; open: number; high: number; low: number; close: number; volume: number }
function cleanBars(raw: unknown): Row[] {
  if (!Array.isArray(raw)) throw bad('bars must be a list');
  if (raw.length > MAX_BARS) throw bad(`at most ${MAX_BARS} bars (got ${raw.length})`);
  let prev = -Infinity;
  return raw.map((b, i) => {
    const o = (b ?? {}) as Record<string, unknown>, f = (k: string, need = true) => { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) return v; if (need) throw bad(`bars[${i}].${k} must be a number`); return 0 };
    const row = { time: f('time'), open: f('open'), high: f('high'), low: f('low'), close: f('close'), volume: f('volume', false) };
    if (row.time <= prev) throw bad('bars must be in ascending time order');
    prev = row.time;
    return row;
  });
}
function cleanParams(raw: unknown): Record<string, string | number | boolean | null> {
  const p = raw === undefined ? {} : obj(raw, 'params');
  if (JSON.stringify(p).length > 64 * 1024) throw bad('params are too large');
  for (const [k, v] of Object.entries(p)) if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v))) throw bad(`params.${k} must be a number, text, true/false or null`);
  return p as Record<string, string | number | boolean | null>;
}
const text = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';

const busy = new Set<number>();   // one run at a time per user: a second one is refused, not queued

export async function runPython(body: unknown): Promise<Record<string, unknown>> {
  const b = obj(body, 'body'), entry = b.entry;
  if (typeof b.code !== 'string' || !b.code.trim()) throw bad('code is empty');
  if (b.code.length > MAX_CODE) throw bad(`code is longer than ${MAX_CODE / 1024} KB`);
  if (entry !== 'indicator' && entry !== 'strategy' && entry !== 'script') throw bad('entry must be indicator, strategy or script');
  const bars = cleanBars(b.bars ?? []), params = cleanParams(b.params);
  if (!existsSync(PYRUN)) throw new HttpError(501, 'The Python tool is missing from this installation (ml/pyrun.py)');
  const p = await probe();
  if (!p.cmd) throw new HttpError(501, 'Python 3 was not found: install it from python.org (tick "Add python.exe to PATH"), or set CT_PYTHON to the interpreter');
  const limit = timeoutSec(), dir = await mkdtemp(join(tmpdir(), 'ct-py-')), t0 = Date.now();
  try {
    const input = JSON.stringify({ code: b.code, entry, bars, params, name: basename(text(b.name, 100)) || 'script.py', managed: true, symbol: text(b.symbol, 64), tf: text(b.tf, 16), timeoutSec: limit });
    const r = await spawnPy(p.cmd, [PYRUN], input, dir, limit * 1000 + 3000, true);   // the harness stops itself at `limit` and returns the partial output; this is the backstop
    const durationMs = Date.now() - t0;
    if (r.tooBig) return { ok: false, error: { type: 'ResultTooLarge', message: `The result is larger than ${MAX_OUT / 1024 / 1024} MB: return fewer values`, line: null, traceback: '' }, stdout: '', stderr: '', durationMs };
    if (r.timedOut) return { ok: false, timedOut: true, error: { type: 'Timeout', message: `Stopped after ${limit} s (time limit)`, line: null, traceback: '' }, stdout: '', stderr: r.err.slice(-MAX_ERR), durationMs };
    try { return { ...(JSON.parse(r.out) as object), durationMs } }
    catch {
      const tail = r.err.trim().split('\n').pop() || `the interpreter stopped with exit code ${r.code}`;
      return { ok: false, error: { type: 'ProcessError', message: /No module named/.test(r.err) ? `${tail}  (pip install pandas numpy)` : tail, line: null, traceback: r.err.slice(-4000) }, stdout: '', stderr: r.err.slice(-MAX_ERR), durationMs };
    }
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {}) }
}

route('GET', '/api/py/status', c => status(c.req));
route('POST', '/api/py/config', async c => {
  // Only this PC may turn code execution on or off. clientIp() honours CT_TRUST_PROXY, so a local reverse proxy does not make everyone "local";
  // the Host name must be a loopback name as well (DNS rebinding), like the first-password setup.
  if (!isLocal(c.req) || !isLoopbackHost(c.req)) throw new HttpError(403, 'Python can only be switched on or off on the computer running the server (open http://localhost there)');
  const b = obj(c.body, 'body'), now = cfg();
  for (const k of ['enabled', 'remote']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw bad(`${k} must be true or false`);
  const next: PyConfig = { enabled: (b.enabled as boolean | undefined) ?? now.enabled, remote: (b.remote as boolean | undefined) ?? now.remote };
  configSet('py', next);
  console.log(`[python] code execution ${next.enabled ? 'ON' : 'off'}, other devices ${next.remote ? 'ALLOWED' : 'not allowed'}`);
  return status(c.req);
}, { limit: 4096 });
route('POST', '/api/py/run', async c => {
  const conf = cfg();
  if (!conf.enabled) throw new HttpError(403, 'Python is turned off. Switch it on in Server settings, on the computer that runs the server');
  if (!isLocal(c.req) && !conf.remote) throw new HttpError(403, 'Python runs only from the computer running the server. To use it from this device, allow other devices in Server settings on that computer');
  const uid = c.user.id;
  if (busy.has(uid)) throw Object.assign(new HttpError(429, 'A Python run is already in progress'), { retryAfter: 2 });
  busy.add(uid);
  try { return await runPython(c.body) } finally { busy.delete(uid) }
}, { limit: 16 * 1024 * 1024 });
