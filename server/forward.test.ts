import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-fwd-'));
process.env.CT_NO_AUTOSTART = '1';
const F = await import('./forward.ts');
const { stateGet } = await import('./state.ts');
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Account = import('../src/trading.ts').Account;

const bars: Bar[] = Array.from({ length: 60 }, (_, i) => { const c = 100 + Math.sin(i / 3) * 5; return { time: 1_700_000_000 + i * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 10 } });
const SRC = `strategy("t")
if bar_index % 6 == 0
    strategy.entry("L", strategy.long)
if bar_index % 6 == 3
    strategy.close("L")`;
const source = { lang: 'pine' as const, files: { 't.pine': SRC }, main: 't.pine', prec: 2 };
const job = F.buildJob(source, 'BTCUSDT', '1m');

test('freshFills: first run records the start, later runs mirror only new fills once', () => {
  const f = (time: number, side: 'buy' | 'sell' = 'buy') => ({ time, side, qty: 1 });
  const a = F.freshFills([f(10), f(20, 'sell')], null, new Set(), 30);
  assert.equal(a.start, 30); assert.deepEqual(a.fresh, []);
  const b = F.freshFills([f(10), f(20, 'sell'), f(30), f(40, 'sell')], a.start, a.done, 99);
  assert.deepEqual(b.fresh.map(x => x.time), [30, 40]);
  const c = F.freshFills([f(10), f(20, 'sell'), f(30), f(40, 'sell')], b.start, b.done, 99);
  assert.deepEqual(c.fresh, []);
  assert.ok([...c.done].every(k => +k.split('|')[0] >= 30), 'keys before the start are dropped');
});

test('forward test lifecycle mirrors fills into the paper account', () => {
  let now = 1_000_000;
  const subs: ((b: Bar[], closed: boolean) => void)[] = [];
  let stops = 0;
  const notices: { channels: string[] }[] = [];
  F.deps.now = () => now;
  F.deps.watch = (_s, _tf, cb) => { subs.push(cb); return () => { stops++ } };
  F.deps.notify = async n => { notices.push(n); return [] };

  const id = F.create({ name: 'T', sym: 'BTCUSDT', tf: '1m', source, qtyMult: 2, channels: ['telegram'] });
  assert.equal(F.list()[0].status, 'starting');
  const feed = (n: number, closed: boolean) => subs.at(-1)!(bars.slice(0, n), closed);

  feed(30, false);   // first evaluation: everything so far is history
  const info0 = F.list()[0];
  assert.equal(info0.status, 'running'); assert.equal(info0.start, bars[29].time); assert.equal(info0.fills, 0);
  assert.equal(stateGet('acct'), null);

  for (let n = 31; n <= 45; n++) { now += 60_000; feed(n, true) }
  const all = F.runFills(job, bars.slice(0, 45), {});
  const expected = all.filter(f => f.time >= bars[29].time && !F.runFills(job, bars.slice(0, 30), {}).some(g => F.fillKey(g) === F.fillKey(f)));
  assert.ok(expected.length >= 4, `strategy should trade (${expected.length})`);
  const acct = stateGet<Account>('acct')!.value;
  assert.equal(acct.fills.length, expected.length);
  assert.deepEqual(acct.fills.map(f => [f.side, f.qty]), expected.map(f => [f.side, 2]));
  assert.equal(F.list()[0].fills, expected.length);
  assert.equal(F.log(id).length, expected.length);
  assert.equal(notices.length, expected.length);
  assert.deepEqual(notices[0].channels, ['popup', 'telegram']);

  // Re-running the same series (and a throttled live tick) mirrors nothing new.
  now += 60_000; feed(45, true); now += 100; feed(45, false);
  assert.equal(stateGet<Account>('acct')!.value.fills.length, expected.length);

  // Restart: stop everything, resume from the DB; dedupe state survives.
  F.stopAll(); assert.equal(stops, 1);
  F.resumeAll(); assert.equal(subs.length, 2);
  now += 60_000; feed(45, true);
  assert.equal(stateGet<Account>('acct')!.value.fills.length, expected.length);

  // Script errors are reported, not thrown.
  assert.equal(F.remove(id), true); assert.equal(stops, 2); assert.deepEqual(F.list(), []);
  const bad = F.create({ name: 'B', sym: 'BTCUSDT', tf: '1m', source: { ...source, files: { 't.pine': 'strategy("x")\nplot(nope)' } }, qtyMult: 1, channels: [] });
  feed(30, true);
  assert.equal(F.list()[0].status, 'error'); assert.match(F.list()[0].lastError!, /nope/);
  F.remove(bad);
});

test('POST body: only sources are accepted, compiled JS is refused, MQL compiles on the server', async () => {
  const { NEW_MQL5_EA } = await import('../src/mql/templates.ts');
  const base = { name: 'X', sym: 'BTCUSDT', tf: '1h', qtyMult: 1, channels: [] };
  const status = (f: () => unknown) => { try { f(); return 0 } catch (e) { return (e as { status?: number }).status } };
  assert.equal(status(() => F.validate({ ...base, job: { kind: 'mql', js: 'process.exit(1)', opts: {} } })), 400);
  assert.equal(status(() => F.validate({ ...base, lang: 'mql5', files: { 'a.mq5': NEW_MQL5_EA }, main: 'a.mq5', js: 'x' })), 400);
  assert.equal(status(() => F.validate({ ...base, lang: 'ninja', files: { 'a.cs': '' }, main: 'a.cs', inputs: { cr: { js: 'x' } } })), 400);
  assert.equal(status(() => F.validate({ ...base, lang: 'pine', files: { 'a.pine': 'x'.repeat(1024 * 1024 + 1) }, main: 'a.pine' })), 400);
  assert.equal(status(() => F.validate({ ...base, lang: 'pine', files: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, ''])), main: 'f0' })), 400);
  assert.equal(status(() => F.validate({ ...base, lang: 'pine', files: { 'a.pine': SRC }, main: 'b.pine' })), 400);

  F.deps.watch = () => () => {};
  const mql = F.validate({ ...base, lang: 'mql5', files: { 'MyExpert.mq5': NEW_MQL5_EA }, main: 'MyExpert.mq5', prec: 2 });
  const id = F.create(mql);
  assert.equal(F.list().find(f => f.id === id)!.lastError, null);
  assert.equal(F.buildJob(mql.source, 'BTCUSDT', '1h').kind, 'mql');
  assert.equal(status(() => F.create(F.validate({ ...base, lang: 'mql5', files: { 'B.mq5': 'void OnTick( {' }, main: 'B.mq5' }))), 400);
  const pine = F.create(F.validate({ ...base, lang: 'pine', files: { 'a.pine': SRC, 'other.pine': 'x' }, main: 'a.pine' }));
  F.remove(id); F.remove(pine);
});
