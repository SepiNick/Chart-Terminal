// Python tool routes (private server): off by default, switched on only from this PC, run limits, one run at a time.
// CT_TRUST_PROXY=1 lets the tests play a phone on the LAN with X-Forwarded-For (which also proves the right client-address function is used).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'ct-py-test-'));
Object.assign(process.env, { CT_DATA_DIR: dir, CT_TRUST_PROXY: '1', CT_PY_TIMEOUT: '2' });
delete process.env.CT_PYTHON;
const { handle } = await import('./core/http.ts');
await import('./authroutes.ts');
await import('./pyrun.ts');
const server = http.createServer((req, res) => handle(req, res, false));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} });

const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0];
const LAN = { 'x-forwarded-for': '192.168.1.5' };
const call = async (method: string, path: string, body?: unknown, h: Record<string, string> = {}, auth = true) => {
  const r = await fetch(base + path, { method, headers: { ...(auth ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any };
};
const bars = (n = 30) => Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 5 }));
const run = (code: string, extra: object = {}, h: Record<string, string> = {}) => call('POST', '/api/py/run', { code, entry: 'script', bars: bars(), ...extra }, h);
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } };

test('off by default; not reachable without a login', async () => {
  assert.equal(setup.status, 200);
  assert.equal((await call('GET', '/api/py/status', undefined, {}, false)).status, 401);
  assert.equal((await call('POST', '/api/py/run', { code: 'print(1)', entry: 'script' }, {}, false)).status, 401);
  const st = (await call('GET', '/api/py/status')).body;
  assert.equal(st.enabled, false); assert.equal(st.remoteAllowed, false); assert.equal(st.local, true);
  assert.match(st.python, /^3\.\d+/, 'a Python 3 interpreter is needed to run this test');
  assert.equal((await run('print(1)')).status, 403);
});

test('only this PC can switch it on; a phone on the LAN cannot, even when the address looks local to the proxy', async () => {
  assert.equal((await call('POST', '/api/py/config', { enabled: true }, LAN)).status, 403);
  // fetch() cannot set Host; http.request can. A name that is not loopback is refused even from a loopback socket (DNS rebinding).
  const withHost = (host: string) => new Promise<number>(res => { const r = http.request(base + '/api/py/config', { method: 'POST', headers: { host, cookie, 'content-type': 'application/json' } }, m => { m.resume(); res(m.statusCode ?? 0) }); r.end('{"enabled":true}') });
  assert.equal(await withHost('evil.example'), 421, 'unknown host name');
  const own = Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
  if (own) assert.equal(await withHost(`${own}:${(server.address() as AddressInfo).port}`), 403, 'this PC under its LAN address is not "localhost"');
  assert.equal((await call('POST', '/api/py/config', { enabled: 'yes' })).status, 400);
  assert.equal((await call('GET', '/api/py/status')).body.enabled, false);
  const on = await call('POST', '/api/py/config', { enabled: true });
  assert.equal(on.status, 200); assert.equal(on.body.enabled, true); assert.equal(on.body.remote, false);
});

test('runs on the PC itself; other devices need the second switch', async () => {
  const r = await run('print(len(df), df.close.iloc[-1])');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true); assert.equal(r.body.stdout.trim(), '30 129.5'); assert.ok(r.body.durationMs > 0);
  assert.equal((await run('print(1)', {}, LAN)).status, 403, 'a LAN device is refused while py.remote is off');
  assert.equal((await call('POST', '/api/py/config', { remote: true }, LAN)).status, 403, 'and cannot turn it on itself');
  assert.equal((await call('POST', '/api/py/config', { remote: true })).body.remote, true);
  const lan = await run('print("lan")', {}, LAN);
  assert.equal(lan.status, 200); assert.equal(lan.body.stdout.trim(), 'lan');
  assert.equal((await call('POST', '/api/py/config', { remote: false })).body.remote, false);
  assert.equal((await run('print(1)', {}, LAN)).status, 403);
});

test('results, errors with the failing line, and bad requests', async () => {
  const ok = await run('def indicator(df, params):\n    return {"plots": [{"name": "c", "values": df.close}]}', { entry: 'indicator' });
  assert.equal(ok.body.result.plots[0].values.length, 30);
  const err = await run('x = 1\nprint(1/0)\n', { name: 'algo.py' });
  assert.equal(err.status, 200); assert.equal(err.body.ok, false); assert.equal(err.body.error.line, 2); assert.equal(err.body.error.type, 'ZeroDivisionError');
  for (const body of [{ entry: 'script' }, { code: 'x', entry: 'nope' }, { code: 'x', entry: 'script', bars: 'no' }, { code: 'x', entry: 'script', bars: [{ time: 1 }] },
    { code: 'x', entry: 'script', params: { a: [1] } }, { code: ' ', entry: 'script' }, { code: 'x', entry: 'script', bars: [...bars(2), ...bars(2)] }]) {
    assert.equal((await call('POST', '/api/py/run', body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
});

test('size caps: too many bars, too much code, a huge request body', async () => {
  const many = await call('POST', '/api/py/run', { code: 'print(1)', entry: 'script', bars: bars(20_001) });
  assert.equal(many.status, 400); assert.match(many.body.error, /at most 20000/);
  assert.equal((await run('print(1)', { bars: bars(20_000) })).status, 200, 'exactly the cap is fine');
  assert.equal((await call('POST', '/api/py/run', { code: 'x'.repeat(600 * 1024), entry: 'script' })).status, 400);
  const big = await call('POST', '/api/py/run', JSON.stringify({ code: 'print(1)', entry: 'script', pad: 'x'.repeat(17 * 1024 * 1024) }));
  assert.equal(big.status, 413);
});

test('a huge print is capped', async () => {
  const r = await run('for i in range(300000): print("x" * 100)');
  assert.equal(r.body.ok, true); assert.ok(r.body.stdout.length <= 64 * 1024); assert.equal(r.body.truncated.stdout, true);
});

test('an infinite loop is stopped at the time limit and its child processes die with it', async () => {
  const t0 = Date.now();
  const r = await run('import subprocess, sys\nc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])\nprint(c.pid, flush=True)\nwhile True: pass\n');
  assert.equal(r.status, 200); assert.equal(r.body.ok, false); assert.equal(r.body.timedOut, true); assert.equal(r.body.error.type, 'Timeout');
  assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms`);
  const child = Number(r.body.stdout.trim());
  assert.ok(child > 0, 'the partial output of the stopped run is returned');
  for (let i = 0; i < 40 && alive(child); i++) await new Promise(res => setTimeout(res, 100));
  assert.equal(alive(child), false, 'the child process was killed');
});

test('a run that holds the interpreter (the harness cannot stop it itself) is killed by the server', async () => {
  const t0 = Date.now();
  const r = await run('sum(range(10**14))');
  assert.equal(r.body.timedOut, true);
  assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms`);
});

test('only one run at a time per user: an overlapping run is refused with 429', async () => {
  const first = run('import time\ntime.sleep(1)\nprint("slow")');
  await new Promise(r => setTimeout(r, 300));
  const second = await run('print("second")');
  assert.equal(second.status, 429); assert.ok(second.headers.get('retry-after'));
  const f = await first;
  assert.equal(f.status, 200); assert.equal(f.body.stdout.trim(), 'slow');
  assert.equal((await run('print("after")')).status, 200, 'free again once the first one has finished');
});

test('a missing interpreter is explained', async () => {
  process.env.CT_PYTHON = 'definitely-not-python';
  const r = await run('print(1)');
  assert.equal(r.status, 501); assert.match(r.body.error, /Python 3 was not found/);
  delete process.env.CT_PYTHON;
  assert.equal((await run('print(1)')).status, 200);
});
