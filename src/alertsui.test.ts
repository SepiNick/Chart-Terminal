import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawingLine, migrateOld, validateAlert, describeAlert, alertStatus, BUILTIN_PINE, type AlertForm } from './alertsui.ts';
import { INDICATORS } from './indicators.ts';
import { runScript } from './pine/engine.ts';
import type { Drawing } from './tools/types.ts';

const style = (x: Record<string, unknown> = {}) => ({ color: '#000', width: 1, dash: 'solid', fillColor: '', fillAlpha: 0, text: '', textColor: '', fontSize: 12, bold: false, italic: false, extendLeft: false, extendRight: false, ...x }) as Drawing['style'];
const dr = (id: number, type: string, pts: [number, number][], s = {}): Drawing => ({ id, type, pts: pts.map(([t, p]) => ({ t, p })), style: style(s) });

test('drawing → LineRef', () => {
  assert.deepEqual(drawingLine(dr(1, 'hline', [[100, 50]])), { line: { type: 'hline', price: 50 } });
  assert.deepEqual(drawingLine(dr(2, 'trend', [[200, 10], [100, 5]], { extendRight: true })),
    { line: { type: 'trend', t1: 100, p1: 5, t2: 200, p2: 10, extendLeft: true } }, 'reversed points swap the extend flags');
  assert.deepEqual(drawingLine(dr(3, 'ray', [[100, 1], [200, 2]], { extendRight: true }))?.line, { type: 'trend', t1: 100, p1: 1, t2: 200, p2: 2, extendRight: true });
  assert.equal(drawingLine(dr(4, 'trend', [[100, 1], [100, 2]])), null, 'vertical');
  assert.equal(drawingLine(dr(5, 'rect', [[100, 1], [200, 2]])), null, 'unsupported tool');
  const ch = drawingLine(dr(6, 'parallel', [[100, 10], [200, 20], [150, 25]]))!;
  assert.deepEqual(ch.line, { type: 'trend', t1: 100, p1: 20, t2: 200, p2: 30 }, 'upper edge offset by +10');
  assert.deepEqual(ch.line2, { type: 'trend', t1: 100, p1: 10, t2: 200, p2: 20 });
  const low = drawingLine(dr(7, 'parallel', [[100, 10], [200, 20], [150, 5]]))!;
  assert.equal((low.line as { p1: number }).p1, 10, 'third point below → base is the upper edge');
  assert.deepEqual(drawingLine(dr(8, 'flattop', [[100, 10], [200, 20], [150, 30]]))?.line2, { type: 'hline', price: 30 });
});

test('old alerts migrate to server inputs', () => {
  const drawings = { BTCUSDT: [dr(9, 'hline', [[1, 60000]])] };
  const r = migrateOld([
    { id: 1, sym: 'BTCUSDT', price: 65000, dir: 'up', on: true },
    { id: 2, sym: 'BTCUSDT', price: 60000, dir: 'down', on: false, drawingId: 9, note: 'Horizontal line' },
    { id: 3, sym: 'ETHUSDT', price: 3000, dir: 'down', on: true, drawingId: 42 },
    { id: 4, sym: 'X', price: NaN, dir: 'up', on: true },
  ], drawings, '1h');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { sym: 'BTCUSDT', tf: '1h', source: { kind: 'price' }, condition: 'crossing_up', value: 65000, frequency: 'once', expires: null, channels: ['popup'], active: true, message: '{{ticker}} crossing up 65000' });
  assert.deepEqual(r[1].source, { kind: 'drawing', drawingId: '9', line: { type: 'hline', price: 60000 } });
  assert.equal(r[1].condition, 'crossing_down'); assert.equal(r[1].active, false); assert.equal(r[1].name, 'Horizontal line'); assert.equal(r[1].value, undefined);
  assert.deepEqual(r[2].source, { kind: 'price' }, 'missing drawing falls back to its price');
  assert.equal(r[2].value, 3000);
  assert.deepEqual(migrateOld(null as never, {}, '1h'), []);
});

const form = (x: Partial<AlertForm> = {}): AlertForm => ({ name: '', sym: 'btcusdt', tf: '1h', source: { kind: 'price' }, condition: 'crossing', value: '65000', value2: '', bars: '1', frequency: 'once', expires: '', message: 'hi', channels: [], webhookUrl: '', webhookBody: '', ...x });
const err = (f: AlertForm) => { const r = validateAlert(f, 1_000); return 'error' in r ? r.error : '' };

test('alert form validation', () => {
  const ok = validateAlert(form({ channels: ['telegram', 'popup', 'telegram'] }));
  assert.ok('input' in ok);
  assert.deepEqual(ok.input, { sym: 'BTCUSDT', tf: '1h', source: { kind: 'price' }, condition: 'crossing', value: 65000, frequency: 'once', channels: ['popup', 'telegram'], message: 'hi', active: true, expires: null });
  assert.match(err(form({ sym: 'BTC USDT' })), /symbol/);
  assert.match(err(form({ tf: '7x' })), /interval/);
  assert.match(err(form({ value: '' })), /value/);
  assert.match(err(form({ message: '  ' })), /message/);
  assert.match(err(form({ condition: 'moving_up_pct' as const, source: { kind: 'drawing', line: { type: 'hline', price: 1 } } })), /condition/);
  const chan = validateAlert(form({ condition: 'inside_channel', value: '200', value2: '100' }));
  assert.ok('input' in chan && chan.input.value === 100 && chan.input.value2 === 200, 'bounds are sorted');
  assert.match(err(form({ condition: 'inside_channel', value2: '' })), /bounds/);
  assert.match(err(form({ condition: 'moving_up', value: '5', bars: '1.5' })), /Bars/);
  assert.match(err(form({ expires: '1970-01-01T00:00' })), /future/);
  assert.match(err(form({ channels: ['webhook'], webhookUrl: 'ftp://x' })), /http/);
  const hook = validateAlert(form({ channels: ['webhook'], webhookUrl: 'https://h.example/x', webhookBody: '{"a":1}' }));
  assert.ok('input' in hook && hook.input.webhook?.url === 'https://h.example/x' && hook.input.webhook.body === '{"a":1}');
  const script = validateAlert(form({ source: { kind: 'script', script: 's', event: 'alert' }, condition: undefined, value: '' }));
  assert.ok('input' in script && script.input.condition === undefined && script.input.value === undefined);
  const draw = validateAlert(form({ source: { kind: 'drawing', line: { type: 'hline', price: 1 } }, value: '' }));
  assert.ok('input' in draw && draw.input.value === undefined, 'drawing alerts take their level from the line');
});

test('describe + status', () => {
  assert.equal(describeAlert({ source: { kind: 'price' }, condition: 'crossing_up', value: 65000 }), 'Price · Crossing up 65000');
  assert.equal(describeAlert({ source: { kind: 'price' }, condition: 'moving_up_pct', value: 2, bars: 3 }), 'Price · Moving up % 2% in 3 bars');
  assert.equal(alertStatus({ active: false, stoppedReason: 'expired' }), 'stopped');
  assert.equal(alertStatus({ active: false }), 'paused');
});

test('built-in indicators as Pine match the chart plots', () => {
  const bars = Array.from({ length: 300 }, (_, i) => { const c = 100 + Math.sin(i / 9) * 5; return { time: 1_700_000_000 + i * 3600, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 100 + i } });
  for (const [k, src] of Object.entries(BUILTIN_PINE)) {
    const r = runScript(src, bars, { symbol: 'BTCUSDT', tf: '1h', tfSec: 3600, mintick: 0.01 });
    assert.ok(r.out, `${k}: ${r.error?.msg}`);
    const want = Object.entries(INDICATORS[k].calc(bars));
    assert.equal(r.out!.plots.length, want.length, k);
    want.forEach(([, v], i) => { const a = r.out!.plots[i].values.at(-1)!, b = v.at(-1)!; assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${k} plot ${i}: ${a} vs ${b}`) });
  }
});
