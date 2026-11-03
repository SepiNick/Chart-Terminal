import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-md-'));
process.env.CT_NO_AUTOSTART = '1';
const M = await import('./marketdata.ts');

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Bitcoin tops $100k &amp; more]]></title><link>https://example.com/a</link><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Ether ETF flows</title><link>https://example.com/b</link><pubDate>Wed, 28 Oct 2026 11:00:00 GMT</pubDate></item>
<item><title>bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('parseRss keeps title, http(s) link and time; drops other links', () => {
  const r = M.parseRss(RSS, 'X');
  assert.deepEqual(r.map(x => x.title), ['Bitcoin tops $100k & more', 'Ether ETF flows']);
  assert.equal(r[0].t, Date.parse('Wed, 28 Oct 2026 10:00:00 GMT'));
});

test('news: all feeds merged newest first, filtered per symbol, stale copy when upstream fails', async () => {
  let up = true, now = 0;
  M.deps.now = () => now;
  M.deps.fetch = async (url: string) => { if (!up) throw Error('down'); return new Response(url.includes('coindesk') ? RSS : '<rss></rss>') };
  const all = await M.news();
  assert.deepEqual(all.map(x => x.title), ['Ether ETF flows', 'Bitcoin tops $100k & more']);
  assert.deepEqual((await M.news('BTC,Bitcoin')).map(x => x.link), ['https://example.com/a']);
  up = false; now += 3600_000;
  assert.equal((await M.news()).length, 2, 'stale copy served');
  await assert.rejects(M.dex('a;b'), /token symbol/);
});

test('treasury yields from FRED and the Nasdaq stock universe: parsed, filtered, largest first', async () => {
  M.deps.now = () => 9e15;
  M.deps.fetch = async (url: string) => new Response(url.includes('fred')
    ? 'observation_date,DGS10,DGS2\n2014-12-31,2.17,0.67\n2026-10-29,4.98,4.61\n2026-10-30,,\n2026-11-02,4.94,4.56\n'
    : JSON.stringify({ data: { rows: [
      { symbol: 'AAA', name: 'Aaa Inc. Common Stock', lastsale: '$10.50', pctchange: '-1.5%', volume: '1000', marketCap: '5000000.00', sector: 'Technology', industry: 'Software', country: 'United States' },
      { symbol: 'BBB', name: 'Bbb Corp', lastsale: '$99.00', pctchange: '2%', volume: '20', marketCap: '9000000000.00', sector: '', industry: '', country: 'United States' },
      { symbol: 'CC^W', name: 'Warrant', lastsale: '$1', pctchange: '0%', volume: '1', marketCap: '', sector: '', industry: '', country: '' },
    ] } }));
  assert.deepEqual(await M.treasury(), [{ date: '2026-10-29', year10: 4.98, year2: 4.61 }, { date: '2026-11-02', year10: 4.94, year2: 4.56 }]);
  const s = await M.usStocks();
  assert.deepEqual(s.map(x => [x.sym, x.name, x.sector, x.cap, x.price, x.chg]), [['BBB', 'Bbb Corp', 'Unknown', 9e9, 99, 2], ['AAA', 'Aaa Inc.', 'Technology', 5e6, 10.5, -1.5]]);
});
