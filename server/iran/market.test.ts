// The Iranian sources through market.ts: exchange list, markets, bars with Saturday weeks, tickers, Persian symbols.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['CT_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'ct-ir-'));
process.env['CT_NO_AUTOSTART'] = '1';
const { deps, clearCache } = await import('./http.ts');
const M = await import('../market.ts');
const { resetTse } = await import('./tse.ts');
const { validSym } = await import('../alerts/validate.ts');
const { IRAN } = await import('./index.ts');

const day = (d: number, c: number, y = c) => ({ dEven: d, priceFirst: c, priceMax: c + 10, priceMin: c - 10, pClosing: c, pDrCotVal: c, priceYesterday: y, zTotTran: 5, qTotTran5J: 100 });
beforeEach(() => { clearCache(); resetTse(); deps.sleep = async () => {}; deps.now = () => Date.UTC(2026, 10, 10) });

test('the three sources are registered and symbols may be Persian', () => {
  assert.deepEqual(Object.keys(IRAN), ['nobitex', 'tgju', 'tse']);
  assert.ok(M.SYM_RE.test('فولاد') && M.SYM_RE.test('ح.فولاد') && M.SYM_RE.test('BTCIRT') && !M.SYM_RE.test('a b') && !M.SYM_RE.test('x/y'));
  assert.equal(validSym('TSE:فولاد'), 'TSE:فولاد');
  assert.equal(validSym('NOBITEX:USDTIRT'), 'NOBITEX:USDTIRT');
  assert.throws(() => validSym('NOPE:USDTIRT'), /Unknown exchange/);
});

test('weekly TSE bars start on Saturday', async () => {
  // Sat 7 Nov … Wed 11 Nov 2026 is one Iranian week; Thu 5 and Fri 6 Nov belong to the previous one.
  const days = [20261104, 20261105, 20261107, 20261108, 20261109, 20261110].map((d, i) => day(d, 100 + i, i ? 99 + i : 100));
  deps.fetch = async url => new Response(JSON.stringify(url.includes('GetMarketWatch') ? { marketwatch: [] } : url.includes('GetClosingPriceInfo') ? { closingPriceInfo: null } : url.includes('Search') ? { instrumentSearch: [{ insCode: '35425587644337450', lVal18AFC: 'فولاد' }] } : { closingPriceDaily: days }));
  const w = (await M.bars('tse', 'فولاد', '1w', undefined, 10)).bars;
  assert.deepEqual(w.map(b => new Date(b.time * 1000).toISOString().slice(0, 10)), ['2026-11-07'], 'the week of Sat 7 Nov (the partial first bucket is dropped, as for every source)');
  assert.deepEqual([w[0].open, w[0].close], [102, 105], 'Sat 7 to Tue 10 Nov, not split on Monday');
  const mon = (await M.bars('tse', 'فولاد', '1M', undefined, 10)).bars;
  assert.equal(mon.length, 1, 'all inside Aban 1405');
});

test('data.aggregate keeps Monday weeks by default', async () => {
  const { aggregate } = await import('../../src/data.ts');
  const d = (iso: string) => Date.parse(iso) / 1000, bar = (t: number) => ({ time: t, open: 1, high: 2, low: 0, close: 1, volume: 1 });
  const bars = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map(x => bar(d(x)));
  assert.deepEqual(aggregate(bars, 604800).map(b => new Date(b.time * 1000).toISOString().slice(0, 10)), ['2026-11-02', '2026-11-09']);
  assert.deepEqual(aggregate(bars, 604800, 172800).map(b => new Date(b.time * 1000).toISOString().slice(0, 10)), ['2026-10-31', '2026-11-07']);
});

test('probeIran: one timed line per enabled source; a failure is reported, not thrown', async () => {
  const { probeIran } = await import('./probe.ts');
  deps.fetch = async url => {
    if (url.includes('nobitex') || url.includes('udf')) return new Response(JSON.stringify({ s: 'ok', t: [1_700_000_000], o: [1_600_000], h: [1_600_000], l: [1_600_000], c: [1_600_000], v: [1] }));
    throw Error('connection refused');
  };
  const r = await probeIran(['nobitex', 'tgju']);
  assert.deepEqual(r.map(x => [x.source, x.ok]), [['nobitex', true], ['tgju', false]]);
  assert.match(r[0].detail, /1 bars/);
  assert.match(r[1].detail, /connection refused/);
});
