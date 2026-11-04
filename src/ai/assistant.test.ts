import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartContext, extractCode, journalContext, pineError, rsi, writePine, type Msg } from './assistant.ts';
import type { Bar } from '../data.ts';

const bars: Bar[] = Array.from({ length: 260 }, (_, i) => { const c = 100 + 10 * Math.sin(i / 15) + i * 0.05; return { time: 1.7e9 + i * 86400, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1000 + (i % 7) * 100 } });
test('chart context carries the app-computed numbers', () => {
  const t = chartContext({ symbol: 'BTCUSDT', tf: '1d', bars, prec: 2, indicators: ['RSI'] });
  assert.match(t, /Symbol BTCUSDT, timeframe 1d, 260 bars/);
  assert.match(t, /SMA20 [\d.]+, SMA50 [\d.]+, SMA200 [\d.]+/);
  assert.match(t, /RSI14 [\d.]+/); assert.match(t, /Indicators on the chart: RSI\./);
  assert.equal(t.split('\n').length, 7 + 20);
  assert.match(chartContext({ symbol: 'X', tf: '1h', bars: [], prec: 2 }), /no bars loaded/);
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), 100);
});
test('journal context: totals, setups, mistakes and recent trades', () => {
  const t = journalContext([{ sym: 'A', dir: 'long', openTime: 1.7e9, closeTime: 1.7e9 + 9, net: 50, r: 1, status: 'closed', setup: 'breakout' }, { sym: 'B', dir: 'short', openTime: 1.7e9, closeTime: 1.7e9 + 9, net: -25, r: -0.5, status: 'closed', setup: 'breakout', mistakes: ['early'] }, { sym: 'C', dir: 'long', openTime: 1.7e9, net: 0, status: 'open' }]);
  assert.match(t, /2 closed trades: win rate 50\.0%, net 25\.00, average win 50\.00, average loss -25\.00, average R 0\.25/);
  assert.match(t, /breakout: 2 trades, win rate 50%/); assert.match(t, /early: 1 trades/);
  assert.equal(journalContext([]), 'The journal has no closed trades yet.');
});
test('code extraction and the Pine check-and-retry loop', async () => {
  assert.equal(extractCode('x\n```js\nlet a\n```\n```pine\nplot(close)\n```'), 'plot(close)\n');
  assert.equal(extractCode('no code'), null);
  const good = '//@version=5\nindicator("MA")\nplot(ta.sma(close, 20))\n', bad = '//@version=5\nindicator("MA")\nplot(ta.sma(close, 20)\n', runtimeBad = '//@version=5\nindicator("X")\nplot(ta.nosuchfn(close))\n';
  assert.equal(pineError(good, bars), null); assert.ok(pineError(bad)); assert.equal(pineError(runtimeBad), null, 'syntax only without bars'); assert.equal(pineError(runtimeBad, bars)?.kind, 'runtime');
  const asked: Msg[][] = [], replies = [`Here:\n\`\`\`pine\n${bad}\`\`\``, `Fixed:\n\`\`\`pine\n${runtimeBad}\`\`\``, `\`\`\`pine\n${good}\`\`\``];
  const r = await writePine(async m => { asked.push([...m]); return replies[asked.length - 1] }, 'a 20 SMA', { bars });
  assert.deepEqual([r.ok, r.attempts, r.code], [true, 3, good]);
  assert.match(asked[1].at(-1)!.content, /syntax error at line/); assert.match(asked[2].at(-1)!.content, /runtime error/);
  const f = await writePine(async () => 'sorry', 'x', { tries: 2 }); assert.deepEqual([f.ok, f.error], [false, 'no code block in the answer']);
});
