import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deps, clearCache } from './http.ts';
import * as S from './tse.ts';

// Replies are reconstructed from third-party descriptions of TSETMC, not captured from the live service. The
// instrument names below are typical shapes, so classify() is checked on shapes, not on a verified list.
const day = (d: number, o: number, h: number, l: number, c: number, y: number, tr = 100, vol = 1000) => ({ dEven: d, priceFirst: o, priceMax: h, priceMin: l, pClosing: c, pDrCotVal: c + 1, priceYesterday: y, zTotTran: tr, qTotTran5J: vol });
let calls: string[] = [];
const serve = (f: (url: string) => unknown) => { deps.fetch = async url => { calls.push(url); return new Response(JSON.stringify(f(url))) } };
beforeEach(() => { clearCache(); S.resetTse(); calls = []; deps.sleep = async () => {}; deps.now = () => Date.UTC(2026, 10, 4); delete process.env['CT_TSE_ADJUST']; delete process.env['CT_TSE_CLOSE'] });

test('normSym: Arabic letters, digits, joiners and spaces', () => {
  assert.equal(S.normSym('فولاد'), 'فولاد');
  assert.equal(S.normSym('كيان'), 'کیان');
  assert.equal(S.normSym('ح . فولاد'), 'ح.فولاد');
  assert.equal(S.normSym('اخزا۰۰۸'), 'اخزا008');
  assert.equal(S.normSym('شاخص کل'), 'شاخص_کل');
  assert.equal(S.normSym('وبملت‌'), 'وبملت');
});

test('classify: stocks, funds, bonds and sukuk, rights, futures, options, commodity certificates, indices', () => {
  const c = S.classify;
  assert.equal(c('فولاد', 'فولاد مبارکه اصفهان'), 'stock');
  assert.equal(c('وبملت', 'بانک ملت'), 'stock');
  assert.equal(c('فولادح', 'ح . فولاد مبارکه اصفهان'), 'right');
  assert.equal(c('عیار', 'صندوق س. طلا-عیار-سهامی'), 'etf');
  assert.equal(c('آوا', 'صندوق س.درآمد ثابت آوای ماهان', 'صندوق سرمایه گذاری قابل معامله'), 'etf');
  assert.equal(c('اخزا008', 'اسناد خزانه-م۸بودجه۹۹-۰۰۰۸۱۸'), 'bond');
  assert.equal(c('اراد0204', 'اجاره دولت آپرورش-سپرده', 'اوراق اجاره'), 'bond');
  assert.equal(c('صکوک123', 'صکوک اجاره شستا'), 'bond');
  assert.equal(c('مرابحه عام دولت', 'مرابحه عام دولت۳-ش.خ ۰۰۰۳'), 'bond');
  assert.equal(c('x', 'یک شرکت', 'اوراق مشارکت'), 'bond');
  assert.equal(c('سکه1405', 'قرارداد آتی سکه طلا سررسید دی'), 'futures');
  assert.equal(c('سلف1', 'سلف موازی استاندارد نفت خام'), 'futures');
  assert.equal(c('ضفلا2011', 'اختیار خ. فولاد-8000-1405/09/14'), 'option');
  assert.equal(c('شمش', 'گواهی سپرده کالایی شمش طلا'), 'commodity');
  assert.equal(c('شاخص کل', 'شاخص کل بورس'), 'index');
  assert.equal(c('كيان', 'ك‌یان'), 'stock', 'Arabic letters do not confuse it');
});

test('parseMarketWatch: names, types, last price, change basis; bad rows dropped', () => {
  const rows = S.parseMarketWatch({ marketwatch: [
    { insCode: '35425587644337450', lva: 'فولاد', lvc: 'فولاد مبارکه اصفهان', pcl: 4000, py: 3900, mv: 5e9 },
    { insCode: '1234567890123', lva: 'اخزا008', lvc: 'اسناد خزانه-م۸بودجه۹۹', pcl: 800000, py: 800000 },
    { insCode: 'abc', lva: 'x' }, { insCode: '999999999999999', lva: '' },
  ] });
  assert.deepEqual(rows.map(r => [r.instr.sym, r.instr.type, r.last, r.yesterday]), [['فولاد', 'stock', 4000, 3900], ['اخزا008', 'bond', 800000, 800000]]);
  assert.throws(() => S.parseMarketWatch({}), /unexpected market list/);
});

test('dailyToBar: closing price vs last trade, days without trades dropped', () => {
  assert.equal(S.dailyToBar(day(20261103, 100, 110, 95, 105, 100))!.close, 105);
  process.env['CT_TSE_CLOSE'] = 'last';
  assert.equal(S.dailyToBar(day(20261103, 100, 110, 95, 105, 100))!.close, 106);
  assert.equal(S.dailyToBar(day(20261103, 0, 0, 0, 105, 100, 0)), null);
  assert.equal(S.dailyToBar({ dEven: 'x', pClosing: 5, priceMax: 5, priceMin: 5, zTotTran: 1 }), null);
});

test('adjust: a capital increase (reference price below the previous close) scales the history', () => {
  const mk = (time: number, close: number, yesterday: number) => ({ time, open: close, high: close, low: close, close, volume: 10, yesterday });
  // 10% bonus-share style gap: day 3 starts from a base of 900 although day 2 closed at 1000.
  const out = S.adjust([mk(1, 1000, 1000), mk(2, 1000, 1000), mk(3, 950, 900), mk(4, 990, 950)]);
  assert.deepEqual(out.map(b => Math.round(b.close)), [900, 900, 950, 990]);
  assert.equal(out[0].volume, 10, 'volume untouched');
  // noise below 0.05% and absurd ratios are ignored
  assert.deepEqual(S.adjust([mk(1, 1000, 1000), mk(2, 1001, 1000.2)]).map(b => b.close), [1000, 1001]);
  assert.deepEqual(S.adjust([mk(1, 1000, 1000), mk(2, 1001, 1)]).map(b => b.close), [1000, 1001]);
});

const MW = { marketwatch: [{ insCode: '35425587644337450', lva: 'فولاد', lvc: 'فولاد مبارکه اصفهان', pcl: 4000, py: 3900, mv: 5e9 }] };
test('bars: symbol by name, ascending, adjusted, live bar replaces the unfinished day, weeks left to the caller', async () => {
  serve(url => url.includes('GetMarketWatch') ? MW
    : url.includes('GetClosingPriceDailyList/35425587644337450') ? { closingPriceDaily: [day(20261103, 4000, 4100, 3950, 4050, 4000), day(20261102, 3900, 4020, 3880, 4000, 3900), day(20261101, 0, 0, 0, 0, 0, 0)] }
    : url.includes('GetClosingPriceInfo') ? { closingPriceInfo: day(20261104, 4050, 4200, 4040, 4150, 4050) } : (() => { throw Error('unexpected ' + url) })());
  const r = await S.tseBars('فولاد', '1d', undefined, 100);
  assert.equal(r.base, '1d');
  assert.deepEqual(r.bars.map(b => [b.time / 86400, b.close]), [[Date.UTC(2026, 10, 2) / 86400000, 4000], [Date.UTC(2026, 10, 3) / 86400000, 4050], [Date.UTC(2026, 10, 4) / 86400000, 4150]]);
  assert.deepEqual((await S.tseBars('35425587644337450', '1d')).bars.length, 3, 'numeric insCode works without the list');
  await assert.rejects(S.tseBars('فولاد', '1h'), /daily data only/);
  await assert.rejects(S.tseBars('فولاد', '15m'), /daily data only/);
});

test('bars: an unlisted name is looked up by search; unknown names throw; months are Jalali', async () => {
  serve(url => url.includes('GetMarketWatch') ? { marketwatch: [] } : url.includes('GetInstrumentSearch') ? { instrumentSearch: [{ insCode: '777777777777777', lVal18AFC: 'کیان', lVal30: 'کیان' }, { insCode: '888888888888888', lVal18AFC: 'کیانح', lVal30: 'ح . کیان' }] }
    : url.includes('GetClosingPriceDailyList') ? { closingPriceDaily: [day(20261022, 10, 12, 9, 11, 10), day(20261102, 11, 14, 10, 13, 11), day(20261103, 13, 15, 12, 14, 13)] } : { closingPriceInfo: null });
  await assert.rejects(S.tseBars('ناشناس', '1d'), /Unknown symbol/);
  const m = await S.tseBars('کیان', '1M', undefined, 10);
  assert.equal(m.base, '1M');
  assert.deepEqual(m.bars.map(b => [b.time, b.high, b.close]), [[Date.UTC(2026, 8, 23) / 1000, 12, 11], [Date.UTC(2026, 9, 23) / 1000, 15, 14]]);
  assert.ok(calls.some(u => u.includes(encodeURIComponent('کیان'))), 'the search term is URL-encoded');
});

test('index history becomes bars; markets list has indices first and typed rows; tickers carry change %', async () => {
  serve(url => url.includes('Index/GetIndexB2History/32097828799138957') ? { indexB2: [{ dEven: 20261103, xNivInuClMresIbs: 2_100_000, xNivInuPhMresIbs: 2_110_000, xNivInuPbMresIbs: 2_080_000 }, { dEven: 20261102, xNivInuClMresIbs: 2_090_000, xNivInuPhMresIbs: 2_095_000, xNivInuPbMresIbs: 2_070_000 }] } : MW);
  const r = await S.tseBars('شاخص کل', '1d');
  assert.deepEqual(r.bars.map(b => [b.open, b.close]), [[2_090_000, 2_090_000], [2_090_000, 2_100_000]]);
  const m = await S.tseMarkets();
  assert.deepEqual(m.slice(0, 3).map(x => x.type), ['index', 'index', 'index']);
  assert.ok(m.some(x => x.sym === 'فولاد' && x.type === 'stock'));
  const t = await S.tseTickers();
  assert.equal(t[0].sym, 'فولاد'); assert.ok(Math.abs(t[0].change - 2.5641) < 0.001);
});

test('a source that answers with something else fails loudly, and the last good list survives an outage', async () => {
  serve(() => MW);
  assert.equal((await S.tseMarkets()).filter(x => x.type === 'stock').length, 1);
  deps.fetch = async () => { throw Error('connection refused') };
  deps.now = () => Date.UTC(2026, 10, 4) + 3600_000;
  assert.equal((await S.tseMarkets()).filter(x => x.type === 'stock').length, 1, 'stale list is served');
  clearCache(); S.resetTse();
  deps.fetch = async () => new Response('<html>blocked</html>');
  assert.equal((await S.tseMarkets()).length, 3, 'only the built-in indices when nothing is reachable');
  await assert.rejects(S.tseBars('35425587644337450', '1d'), /page instead of JSON/);
});
