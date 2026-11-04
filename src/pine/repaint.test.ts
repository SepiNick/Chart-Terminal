import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRepaint, repaintSummary } from './repaint.ts';
import type { Bar } from '../data.ts';

const bars: Bar[] = Array.from({ length: 400 }, (_, i) => { const c = 100 + Math.sin(i / 7) * 5 + Math.sin(i / 23) * 9 + i * 0.02; return { time: 1_700_000_000 + i * 3600, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 10 + (i % 9) } });
const opts = { symbol: 'TEST', tf: '1h', tfSec: 3600, mintick: 0.01 };

test('an ordinary indicator is stable', () => {
  const r = checkRepaint('//@version=5\nindicator("sma")\nplot(ta.sma(close, 20))\nplot(ta.rsi(close, 14))\nbgcolor(close > open ? color.new(color.green, 80) : na)', bars, opts);
  assert.equal(r.verdict, 'stable', JSON.stringify(r.mismatches.slice(0, 2)));
  assert.ok(r.checked >= 5);
  assert.match(repaintSummary(r), /passed/);
});

test('request.security with lookahead_on (the classic) is caught, and without lookahead it is stable', () => {
  const on = checkRepaint('//@version=5\nindicator("peek")\nplot(request.security(syminfo.tickerid, "240", close, lookahead = barmerge.lookahead_on))', bars, opts);
  assert.equal(on.verdict, 'repaints');
  assert.match(repaintSummary(on), /repaints.*lookahead_on/s);
  const off = checkRepaint('//@version=5\nindicator("ok")\nplot(request.security(syminfo.tickerid, "240", close))', bars, opts);
  assert.equal(off.verdict, 'stable', JSON.stringify(off.mismatches.slice(0, 2)));
});

test('an other-symbol feed is cut at the same point, so a leak through it is caught too', () => {
  const eth = bars.map(b => ({ ...b, time: b.time - (b.time % 14400), close: b.close * 2 })).filter((b, i, a) => i === 0 || b.time !== a[i - 1].time);
  const sec = (s: string) => (s === 'ETHUSDT' ? eth : undefined);
  const r = checkRepaint('//@version=5\nindicator("x")\nplot(request.security("ETHUSDT", "240", close, lookahead = barmerge.lookahead_on))', bars, { ...opts, security: sec });
  assert.equal(r.verdict, 'repaints');
});

test('errors and short data are reported, not thrown', () => {
  assert.equal(checkRepaint('plot(', bars, opts).verdict, 'error');
  assert.equal(checkRepaint('//@version=5\nindicator("a")\nplot(close)', bars.slice(0, 40), opts).verdict, 'too-short');
});
