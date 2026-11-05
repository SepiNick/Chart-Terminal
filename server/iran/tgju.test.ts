import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deps, clearCache } from './http.ts';
import * as G from './tgju.ts';

// Reconstructed from third-party descriptions of the table, not captured from the live service.
const rows = [
  ['1,650,000', '1,640,000', '1,660,000', '1,655,000', '5,000', '0.3%', '2026-11-03', '1405/08/12'],
  ['<span>1,630,000</span>', '1,620,000', '1,650,000', '<span class="high">1,650,000</span>', '20,000', '1.2%', '2026-11-02', '1405/08/11'],
  ['0', '0', '0', '0', '0', '0%', '2026-11-01', '1405/08/10'],
  ['1,600,000', '1,590,000', '1,620,000', '1,610,000', '', '', '', '1405/07/30'],
];
beforeEach(() => { clearCache(); deps.sleep = async () => {}; deps.now = () => Date.UTC(2026, 10, 4); deps.fetch = async () => new Response(JSON.stringify({ data: rows })) });

test('rows become Toman daily bars, newest-first order is fixed, empty rows dropped, Jalali date used when needed', async () => {
  const { bars, base } = await G.tgjuBars('USD', '1d');
  assert.equal(base, '1d');
  assert.deepEqual(bars.map(b => b.close), [161000, 165000, 165500]);
  assert.equal(bars[2].time, Date.UTC(2026, 10, 3) / 1000);
  assert.equal(bars[0].time, Date.UTC(2026, 9, 22) / 1000, '1405/07/30 = 22 Oct 2026');
  assert.deepEqual(bars[2], { time: Date.UTC(2026, 10, 3) / 1000, open: 165000, high: 166000, low: 164000, close: 165500, volume: 0 });
});

test('dollar-quoted items are not divided; months are Jalali months; intraday is refused; unknown symbol throws', async () => {
  assert.equal((await G.tgjuBars('ONS', '1d')).bars.at(-1)!.close, 1_655_000);
  const m = (await G.tgjuBars('USD', '1M')).bars;
  assert.equal((await G.tgjuBars('USD', '1M')).base, '1M');
  assert.deepEqual(m.map(b => [b.time, b.close]), [[Date.UTC(2026, 8, 23) / 1000, 161000], [Date.UTC(2026, 9, 23) / 1000, 165500]], 'Mehr starts 23 Sep, Aban 23 Oct 2026')
  await assert.rejects(G.tgjuBars('USD', '1h'), /daily prices only/);
  await assert.rejects(G.tgjuBars('XYZ', '1d'), /Unknown symbol/);
  deps.fetch = async () => new Response(JSON.stringify({ nope: 1 }));
  clearCache();
  await assert.rejects(G.tgjuBars('USD', '1d'), /unexpected table reply/);
});

test('markets list carries Persian names and types', () => {
  const m = G.tgjuMarkets();
  assert.ok(m.some(x => x.sym === 'USD' && x.name === 'دلار آزاد' && x.type === 'currency'));
  assert.ok(m.some(x => x.sym === 'SEKKEH' && x.type === 'coin'));
  assert.equal(m.find(x => x.sym === 'ONS')!.quote, 'USD');
});

test('tickers: latest price and day change for every item; one failing item does not hide the rest; all failing throws', async () => {
  let n = 0;
  deps.fetch = async url => { n++; if (url.includes('/geram18?')) throw Error('down'); return new Response(JSON.stringify({ data: rows })) };
  const t = await G.tgjuTickers();
  assert.equal(t.length, Object.keys(G.TGJU_ITEMS).length - 1);
  const usd = t.find(x => x.sym === 'USD')!;
  assert.equal(usd.last, 165500);
  assert.ok(Math.abs(usd.change - ((165500 - 165000) / 165000) * 100) < 1e-9);
  assert.equal(t.find(x => x.sym === 'ONS')!.last, 1_655_000, 'dollar-quoted items are not divided');
  clearCache();
  deps.fetch = async () => { throw Error('blocked') };
  await assert.rejects(G.tgjuTickers(), /blocked/);
});
