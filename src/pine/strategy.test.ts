import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broker, defaultProps } from './strategy.ts';

const bar = (i: number, o: number, h: number, l: number, c: number) => ({ time: i * 60, open: o, high: h, low: l, close: c, volume: 1 });
const run = (bars: ReturnType<typeof bar>[], script: (b: Broker, i: number) => void, props = {}) => {
  const br = new Broker(bars, defaultProps(props));
  bars.forEach((_, i) => { br.step(i); script(br, i) });
  return br;
};

test('market entry fills at next open, close fills at following open', () => {
  const bars = [bar(0, 10, 11, 9, 10), bar(1, 12, 13, 11, 12), bar(2, 15, 16, 14, 15)];
  const br = run(bars, (b, i) => { if (i === 0) b.entry(i, 'L', 'long', {}); if (i === 1) b.close(i, 'L') });
  assert.equal(br.trades.length, 1);
  assert.equal(br.trades[0].entryPrice, 12);
  assert.equal(br.trades[0].exitPrice, 15);
  assert.equal(br.trades[0].profit, 3);
});

test('entry in opposite direction reverses the position', () => {
  const bars = [bar(0, 10, 10, 10, 10), bar(1, 10, 10, 10, 10), bar(2, 8, 8, 8, 8), bar(3, 8, 8, 8, 8)];
  const br = run(bars, (b, i) => { if (i === 0) b.entry(i, 'L', 'long', {}); if (i === 1) b.entry(i, 'S', 'short', {}) });
  assert.equal(br.trades.length, 1);
  assert.equal(br.positionSize, -1);
  assert.equal(br.trades[0].profit, -2);
});

test('exit with profit/loss ticks: stop hit first when the path visits it first', () => {
  // open nearer the low => path O→L→H→C: the stop (below) is touched before the target (above)
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 106, 94, 101)];
  const br = run(bars, (b, i) => { if (i === 0) { b.entry(i, 'L', 'long', {}); b.exit(i, 'X', { fromEntry: 'L', profit: 500, loss: 300 }) } }, { mintick: 0.01 });
  assert.equal(br.trades.length, 1);
  assert.equal(br.trades[0].exitPrice, 97);
});

test('pyramiding limit and percent commission', () => {
  const bars = Array.from({ length: 5 }, (_, i) => bar(i, 10, 10, 10, 10));
  const br = run(bars, (b, i) => { if (i < 3) b.entry(i, 'L' + i, 'long', {}) }, { pyramiding: 2, commissionType: 'percent', commissionValue: 1 });
  assert.equal(br.open.length, 2);
  assert.ok(Math.abs(br.cash - (10000 - 0.2)) < 1e-9);
});

test('limit entry waits for price', () => {
  const bars = [bar(0, 10, 10, 10, 10), bar(1, 10, 10.5, 9.8, 10), bar(2, 10, 10, 9, 9.5)];
  const br = run(bars, (b, i) => { if (i === 0) b.entry(i, 'L', 'long', { limit: 9.5 }) });
  assert.equal(br.open.length, 1);
  assert.equal(br.open[0].price, 9.5);
  assert.equal(br.open[0].bar, 2);
});
