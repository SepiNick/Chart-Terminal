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
