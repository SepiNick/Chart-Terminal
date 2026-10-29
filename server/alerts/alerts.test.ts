import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Alert } from '../../src/alerttypes.ts';
import { runScript } from '../../src/pine/engine.ts';
import * as E from './evaluate.ts';

const bar = (i: number, c: number, o = c) => ({ time: 1_700_000_000 + i * 60, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1 });
const series = (closes: number[]) => closes.map((c, i) => bar(i, c));
const alert = (p: Partial<Alert>): Alert => ({ id: 'a', sym: 'BTCUSDT', tf: '1m', source: { kind: 'price' }, frequency: 'every_time', channels: [], message: '', active: true, created: 0, fireCount: 0, ...p });

test('trend line price: interpolation, extension, reversed points', () => {
  const l = { type: 'trend' as const, t1: 100, p1: 10, t2: 200, p2: 20 };
  assert.equal(E.linePrice({ type: 'hline', price: 5 }, 1e9), 5);
  assert.equal(E.linePrice(l, 150), 15);
  assert.ok(Number.isNaN(E.linePrice(l, 300)));
  assert.equal(E.linePrice({ ...l, extendRight: true }, 300), 30);
  assert.ok(Number.isNaN(E.linePrice({ ...l, extendRight: true }, 50)));
  assert.equal(E.linePrice({ ...l, extendLeft: true }, 50), 5);
  // drawn right-to-left: "right" extension continues past t2, which is the earlier time
  assert.equal(E.linePrice({ type: 'trend', t1: 200, p1: 20, t2: 100, p2: 10, extendRight: true }, 50), 5);
});

test('every condition', () => {
  const m = E.conditionMet;
  assert.ok(m('crossing_up', { x: 11, px: 9, lo: 10 }));
  assert.ok(!m('crossing_up', { x: 9, px: 11, lo: 10 }));
  assert.ok(m('crossing_down', { x: 9, px: 11, lo: 10 }));
  assert.ok(m('crossing', { x: 9, px: 11, lo: 10 }) && m('crossing', { x: 10, px: 9, lo: 10 }));
  assert.ok(!m('crossing', { x: 11, lo: 10 }), 'no previous value: no crossing');
  assert.ok(m('crossing_down', { x: 12, px: 12, lo: 13, plo: 11 }), 'a rising level crosses a flat price');
  assert.ok(!m('crossing_up', { x: 12, px: 12, lo: 13, plo: 11 }));
  assert.ok(m('greater', { x: 11, lo: 10 }) && !m('greater', { x: 10, lo: 10 }));
  assert.ok(m('less', { x: 9, lo: 10 }));
  assert.ok(m('inside_channel', { x: 5, lo: 10, hi: 0 }) && !m('inside_channel', { x: 11, lo: 0, hi: 10 }));
  assert.ok(m('outside_channel', { x: 11, lo: 0, hi: 10 }));
  assert.ok(m('entering_channel', { x: 5, px: 11, lo: 0, hi: 10 }) && !m('entering_channel', { x: 5, px: 6, lo: 0, hi: 10 }));
  assert.ok(m('exiting_channel', { x: -1, px: 5, lo: 0, hi: 10 }));
  assert.ok(m('moving_up', { x: 105, back: 100, lo: NaN }, 5) && !m('moving_up', { x: 104, back: 100, lo: NaN }, 5));
  assert.ok(m('moving_down', { x: 95, back: 100, lo: NaN }, 5));
  assert.ok(m('moving_up_pct', { x: 102, back: 100, lo: NaN }, 2) && !m('moving_up_pct', { x: 101, back: 100, lo: NaN }, 2));
  assert.ok(m('moving_down_pct', { x: 97, back: 100, lo: NaN }, 3));
  assert.ok(!m('greater', { x: 5, lo: NaN }), 'line not defined here');
});

test('forming bar: crossing compares with the previously evaluated price', () => {
  const a = alert({ condition: 'crossing_up', value: 100 }), st = E.newState();
  assert.ok(!E.evalLevel(a, st, [99], 0, 0), 'first evaluation only records');
  assert.ok(!E.evalLevel(a, st, [99.5], 0, 0));
  assert.ok(E.evalLevel(a, st, [100.5], 0, 0));
  assert.ok(!E.evalLevel(a, st, [101], 0, 0), 'already above');
});

test('once_per_bar_close evaluates the bar that just closed against the one before', () => {
  const bars = series([99, 101, 98]);   // bar 1 closed above 100 from 99; bar 2 is forming (back below)
  assert.equal(E.pick('once_per_bar_close', bars, false), null);
  assert.equal(E.pick('once_per_bar_close', bars, true), 1);
  assert.equal(E.pick('once_per_bar', bars, false), 2);
  const a = alert({ condition: 'crossing_up', value: 100, frequency: 'once_per_bar_close' }), st = E.newState();
  const closes = bars.map(b => b.close);
  assert.ok(E.evalLevel(a, st, closes, 1, bars[1].time, bars[0].time));
  // the forming value 98 is not a crossing up at all
  assert.ok(!E.evalLevel(alert({ condition: 'crossing_up', value: 100 }), { ...E.newState(), prev: 101 }, closes, 2, 0));
});

test('drawing alert: price crosses a rising trend line (extrapolated to the right)', () => {
  const bars = series([100, 100, 100, 100]);
  const t0 = bars[0].time;
  // line from 98 at bar 0 to 99 at bar 1 → 100 at bar 2, 101 at bar 3
  const a = alert({ source: { kind: 'drawing', line: { type: 'trend', t1: t0, p1: 98, t2: t0 + 60, p2: 99, extendRight: true } }, condition: 'crossing_down', frequency: 'once_per_bar_close' });
  const c = bars.map(b => b.close), st = E.newState();
  assert.ok(!E.evalLevel(a, st, c, 1, bars[1].time, bars[0].time), 'still above the line');
  assert.ok(E.evalLevel(a, st, c, 2, bars[2].time, bars[1].time), 'reaching the line from above counts');
  assert.ok(!E.evalLevel(a, st, c, 3, bars[3].time, bars[2].time), 'already below');
  const noExt = alert({ ...a, source: { kind: 'drawing', line: { type: 'trend', t1: t0, p1: 98, t2: t0 + 60, p2: 99 } } });
  assert.ok(!E.evalLevel(noExt, E.newState(), c, 3, bars[3].time, bars[2].time), 'segment ends at bar 1');
  const ch = alert({ source: { kind: 'drawing', line: { type: 'hline', price: 90 }, line2: { type: 'hline', price: 110 } }, condition: 'inside_channel' });
  assert.ok(E.evalLevel(ch, E.newState(), c, 3, 0));
});

test('moving_* over N bars', () => {
  const a = alert({ condition: 'moving_up_pct', value: 5, bars: 2 });
  assert.ok(E.evalLevel(a, E.newState(), [100, 103, 105.5], 2, 0));
  assert.ok(!E.evalLevel(a, E.newState(), [100, 103, 104], 2, 0));
});

test('frequencies', () => {
  const st = E.newState(), t = 1000;
  assert.ok(E.frequencyAllows('once_per_bar', st, t, 0));
  E.recordFire(st, t, 0);
  assert.ok(!E.frequencyAllows('once_per_bar', st, t, 1));
  assert.ok(!E.frequencyAllows('once_per_bar_close', st, t, 1));
  assert.ok(E.frequencyAllows('once_per_bar', st, t + 60, 1));
  assert.ok(!E.frequencyAllows('once_per_minute', st, t + 60, 59_999));
  assert.ok(E.frequencyAllows('once_per_minute', st, t + 60, 60_000));
  assert.ok(E.frequencyAllows('every_time', st, t, 1) && E.frequencyAllows('once', st, t, 1));
});

test('auto-stop: more than 15 fires in 3 minutes; expiration', () => {
  const st = E.newState();
  for (let k = 0; k < 15; k++) assert.equal(E.recordFire(st, k, k * 1000), undefined);
  assert.match(E.recordFire(st, 99, 15_000)!, /auto-stopped/);
  const slow = E.newState();
  for (let k = 0; k < 30; k++) assert.equal(E.recordFire(slow, k, k * 20_000), undefined, 'spread over 10 min stays below the limit');
  assert.match(E.recordFire(E.newState(), 0, 0, { count: 0, minutes: 1 })!, /more than 0/);
  assert.ok(E.expired({ expires: 10 }, 10) && !E.expired({ expires: 10 }, 9) && !E.expired({ expires: null }, 1e15) && !E.expired({}, 1));
});

test('Pine script alerts: alertcondition, alert() and strategy fills on synthetic bars', () => {
  const bars = series([9, 9, 11, 12, 9, 11]);
  const opts = { symbol: 'BTCUSDT', tf: '1m', tfSec: 60, mintick: 0.01 };
  const src = `//@version=5
indicator("x")
plot(close * 2)
alertcondition(ta.crossover(close, 10), "Up", "up {{close}}")
alertcondition(ta.crossunder(close, 10), "Down", "")
if ta.crossunder(close, 10)
    alert("went down", alert.freq_once_per_bar_close)`;
  const { out, error } = runScript(src, bars, opts);
  assert.equal(error, undefined);
  const up = alert({ source: { kind: 'script', script: src, event: 'alertcondition', index: 0 } });
  assert.deepEqual([0, 1, 2, 3, 4, 5].filter(i => E.scriptHits(up, E.newState(), out!, i, false).length), [2, 5]);
  assert.equal(E.scriptHits(up, E.newState(), out!, 2, false)[0].message, 'up {{close}}');
  const down = alert({ source: { kind: 'script', script: src, event: 'alertcondition', index: 1 } });
  assert.equal(E.scriptHits(down, E.newState(), out!, 4, false)[0].message, 'Down', 'empty message falls back to the title');
  const al = alert({ source: { kind: 'script', script: src, event: 'alert' } });
  assert.equal(E.scriptHits(al, E.newState(), out!, 4, false).length, 0, 'freq_once_per_bar_close waits for the close');
  assert.equal(E.scriptHits(al, E.newState(), out!, 4, true)[0].message, 'went down');
  const v = E.barVars(up, bars, 2, 0, out);
  assert.equal(E.render('{{ticker}} {{exchange}} {{interval}} {{close}} {{plot_0}} {{nope}}', v), 'BTCUSDT BINANCE 1m 11 22 {{nope}}');

  const strat = `//@version=5
strategy("s")
if ta.crossover(close, 10)
    strategy.entry("L", strategy.long, comment = "go long")`;
  const r = runScript(strat, bars, opts);
  assert.equal(r.error, undefined);
  const s = alert({ source: { kind: 'script', script: strat, event: 'strategy' } }), st = E.newState();
  const hits = E.scriptHits(s, st, r.out!, 3, false);   // entry signalled on bar 2 fills at bar 3's open
  assert.equal(hits.length, 1);
  assert.equal(hits[0].vars['strategy.order.action'], 'buy');
  assert.equal(hits[0].message, 'go long');
  assert.equal(E.scriptHits(s, st, r.out!, 3, false).length, 0, 'a fill fires once across re-runs');
});

test('placeholders for exchange symbols', () => {
  const v = E.barVars(alert({ sym: 'BYBIT:BTC_USDT.P', tf: '1h' }), series([5]), 0, 0);
  assert.equal(E.render('{{ exchange }}:{{ticker}} {{interval}} {{time}}', v), `BYBIT:BTC_USDT.P 1h ${new Date(1_700_000_000_000).toISOString()}`);
});

test('input validation', async () => {
  process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-alerts-'));
  const { validateInput } = await import('./validate.ts');
  const ok = { sym: 'BTCUSDT', tf: '1h', source: { kind: 'price' }, condition: 'crossing', value: 100, frequency: 'once', channels: ['telegram', 'telegram'], message: 'hi' };
  const a = validateInput(ok);
  assert.deepEqual(a.channels, ['telegram']);
  assert.equal(a.active, true);
  assert.equal(validateInput({ ...ok, sym: 'BINANCE:ETHUSDT' }).sym, 'BINANCE:ETHUSDT');
  assert.equal(validateInput({ ...ok, sym: 'FX:EURUSD' }).sym, 'FX:EURUSD');
  assert.equal(validateInput({ ...ok, sym: 'BYBIT:BTC_USDT.P' }).sym, 'BYBIT:BTC_USDT.P');
  const bad = (patch: Record<string, unknown>, re: RegExp) => assert.throws(() => validateInput({ ...ok, ...patch }), re);
  bad({ sym: 'BTCUSDT/ETHUSDT' }, /symbol/);
  bad({ sym: 'NOPE:BTCUSDT' }, /exchange/);
  bad({ tf: '7x' }, /timeframe/);
  bad({ condition: 'up' }, /condition/);
  bad({ value: undefined }, /value/);
  bad({ condition: 'inside_channel' }, /two bounds/);
  bad({ frequency: 'hourly' }, /frequency/);
  bad({ channels: ['sms'] }, /channels/);
  bad({ webhook: { url: 'file:///etc/passwd' } }, /http/);
  bad({ extra: 1 }, /Unknown field/);
  bad({ expires: 1 }, /past/);
  bad({ autoStop: { count: 0, minutes: 3 } }, /autoStop/);
  bad({ source: { kind: 'indicator', script: 'indicator("x"\nplot(', plot: 0 } }, /Script error/);
  bad({ source: { kind: 'script', script: 'indicator("x")', event: 'alertcondition' } }, /no condition/);
  bad({ source: { kind: 'drawing', line: { type: 'trend', t1: 1, p1: 1, t2: 1, p2: 2 } } }, /differ/);
  bad({ condition: 'moving_up', value: -1 }, /non-negative/);
  const sc = validateInput({ ...ok, condition: undefined, value: undefined, source: { kind: 'script', script: 'indicator("x")\nalertcondition(close > 1, "a")', event: 'alertcondition', inputs: { len: 5 } } });
  assert.deepEqual(sc.source, { kind: 'script', script: 'indicator("x")\nalertcondition(close > 1, "a")', event: 'alertcondition', index: 0, inputs: { len: 5 } });
});

test('MQL scripts: Alert() calls and expert deals fire script alerts (compiled on the server from sources)', async () => {
  const { buildJob, runJob } = await import('../scripts.ts');
  const { NEW_MQL5_EA } = await import('../../src/mql/templates.ts');
  const wave = Array.from({ length: 200 }, (_, i) => bar(i, 100 + Math.sin(i / 6) * 10));
  const AL = `void OnTick() { if(iClose(_Symbol, PERIOD_CURRENT, 0) > 105) Alert("high ", iClose(_Symbol, PERIOD_CURRENT, 0)); }`;
  const code = (main: string, src: string) => ({ lang: 'mql5' as const, files: { [main]: src }, main, prec: 2 });

  const al = runJob(buildJob(code('A.mq5', AL), 'BTCUSDT', '1m'), wave, {});
  assert.equal(al.error, undefined);
  const i = wave.findIndex(b => b.close > 105);
  const a1 = alert({ source: { kind: 'script', script: AL, code: code('A.mq5', AL), event: 'alert' } });
  assert.match(E.scriptHits(a1, E.newState(), al.out!, i, false)[0]?.message ?? '', /^high /);

  const ea = runJob(buildJob(code('E.mq5', NEW_MQL5_EA), 'BTCUSDT', '1m'), wave, {});
  const deals = E.dealsOf(ea.out!)!;
  assert.ok(deals.length >= 2, `the EA trades (${deals.length})`);
  const a2 = alert({ source: { kind: 'script', script: NEW_MQL5_EA, code: code('E.mq5', NEW_MQL5_EA), event: 'strategy' } }), st = E.newState();
  const j = wave.findIndex(b => b.time === deals[0].time), hits = E.scriptHits(a2, st, ea.out!, j, false, wave[j].time);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].vars['strategy.order.action'], deals[0].type);
  assert.equal(E.scriptHits(a2, st, ea.out!, j, false, wave[j].time).length, 0, 'a deal fires once');
});

test('alert validation compiles MQL code and refuses compiled JS', async () => {
  const { validateInput } = await import('./validate.ts');
  const base = { sym: 'BTCUSDT', tf: '1m', frequency: 'every_time', channels: [], message: '', active: true };
  const ok = validateInput({ ...base, source: { kind: 'script', script: 'x', event: 'alert', code: { lang: 'mql5', files: { 'A.mq5': 'void OnTick() { Alert("x"); }' }, main: 'A.mq5', prec: 2 } } });
  assert.equal((ok.source as { code?: { lang: string } }).code?.lang, 'mql5');
  assert.throws(() => validateInput({ ...base, source: { kind: 'script', script: 'x', event: 'alert', code: { lang: 'mql5', files: { 'A.mq5': 'void OnTick( {' }, main: 'A.mq5' } } }), /Script error/);
  assert.throws(() => validateInput({ ...base, source: { kind: 'script', script: 'x', event: 'alert', code: { lang: 'mql5', files: { 'A.mq5': '' }, main: 'A.mq5', js: 'process.exit()' } } }), /not compiled/);
});

test('live wiring: script alerts run in the engine worker, once per closed bar, and fire', async t => {
  process.env.CT_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'ct-alerts-'));
  const I = await import('./index.ts');
  const { engineStop } = await import('../engine.ts');
  t.after(() => engineStop());
  let cb: ((b: ReturnType<typeof bar>[], closed: boolean) => void) | undefined;
  const fired: string[] = [];
  I.deps.watch = (_s, _tf, f) => { cb = f; return () => {} };
  I.deps.notify = async n => { fired.push(n.body); return [] };
  const closes = [9, 9, 11, 11, 9, 11, 12, 8, 11], bars = series(closes);
  const a = I.createAlert({ sym: 'BTCUSDT', tf: '1m', frequency: 'once_per_bar_close', channels: [], message: '', active: true,
    source: { kind: 'script', script: 'indicator("x")\nalertcondition(ta.crossover(close, 10), "Up", "up {{close}}")', event: 'alertcondition' } });
  for (let n = 2; n <= bars.length; n++) { cb!(bars.slice(0, n), true); await I.settled() }
  // crossovers at bars 2, 5 and 8; once_per_bar_close sees 2 and 5 when the next bar begins, 8 is still forming
  assert.deepEqual(fired, ['up 11', 'up 11']);

  const bad = I.createAlert({ sym: 'BTCUSDT', tf: '1m', frequency: 'every_time', channels: [], message: '', active: true,
    source: { kind: 'script', script: 'strategy("s")\nalert(str.tostring(nope))', event: 'alert' } });
  cb!(bars, true); await I.settled();
  const listed = (await (await import('../core/db.ts')).db.prepare('SELECT data FROM alerts WHERE id = ?').get(bad.id)) as { data: string };
  assert.match(JSON.parse(listed.data).stoppedReason, /script error.*nope/);
  void a;
});

test('alerts log import: history only, re-import skips duplicates, bad rows ignored', async () => {
  process.env.CT_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'ct-alerts-'));
  const I = await import('./index.ts');
  const rows = [{ at: 1_790_000_000_000, message: 'BINANCE:BTCUSDT — BTC up: Crossing 65,000' }, { at: 1_790_000_060_000, message: 'ETH down' }];
  assert.equal(I.importLog({ rows }), 2);
  assert.equal(I.importLog({ rows: [...rows, { at: 'x', message: 'bad' }, { at: 1, message: '  ' }] }), 0, 'nothing new');
  assert.throws(() => I.importLog({ rows: 'nope' }), /rows/);
});
