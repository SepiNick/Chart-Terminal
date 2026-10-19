import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, symbols, combine, isExpr } from './symmath.ts';
import { aggregate, parseTf } from './data.ts';

const bar = (time: number, o: number, h: number, l: number, c: number) => ({ time, open: o, high: h, low: l, close: c, volume: 1 });

test('parses precedence, power and unary minus', () => {
  const n = parse('2*BTCUSDT-ETHUSDT^2/(1+1)');
  assert.deepEqual(symbols(n), ['BTCUSDT', 'ETHUSDT']);
  const r = combine(n, { BTCUSDT: [bar(1, 10, 10, 10, 10)], ETHUSDT: [bar(1, 4, 4, 4, 4)] });
  assert.equal(r[0].close, 2 * 10 - 16 / 2);
  assert.equal(combine(parse('-BTCUSDT+30'), { BTCUSDT: [bar(1, 10, 10, 10, 10)] })[0].close, 20);
});
test('ratio aligns on common times and keeps high/low consistent', () => {
  const r = combine(parse('A/B'), { A: [bar(1, 10, 12, 8, 11), bar(2, 11, 11, 11, 11)], B: [bar(2, 2, 4, 1, 2), bar(3, 1, 1, 1, 1)] });
  assert.equal(r.length, 1);
  assert.equal(r[0].time, 2);
  assert.ok(r[0].high >= r[0].low);
});
test('rejects garbage', () => {
  assert.throws(() => parse('A/'));
  assert.throws(() => parse('A;B'));
  assert.equal(isExpr('BTCUSDT'), false);
  assert.equal(isExpr('BTCUSDT/ETHUSDT'), true);
});
test('interval parsing and weekly aggregation anchored to Monday', () => {
  assert.equal(parseTf('15'), '15m');
  assert.equal(parseTf('4H'), '4h');
  assert.equal(parseTf('1M'), '1M');
  assert.equal(parseTf('x'), null);
  const monday = Date.UTC(2026, 9, 12) / 1000; // 2026-10-12 is a Monday
  const days = Array.from({ length: 9 }, (_, i) => bar(monday - 86400 + i * 86400, i, i + 1, i - 1, i));
  const w = aggregate(days, 604800);
  assert.equal(w[1].time, monday);
  assert.equal(w[1].open, 1);
});
