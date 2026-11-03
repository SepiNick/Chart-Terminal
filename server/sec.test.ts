import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-sec-'));
process.env.CT_NO_AUTOSTART = '1';
const S = await import('./sec.ts');

test('SEC: ticker lookup, gzip, request spacing, cache and strict path validation', async () => {
  const urls: string[] = [], times: number[] = [];
  S.deps.gap = 40;
  S.deps.fetch = async (url: string) => { urls.push(url); times.push(Date.now()); const body = url.endsWith('company_tickers.json') ? { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC /DE/' } } : { url }; return new Response(gzipSync(JSON.stringify(body))) };
  assert.equal(await S.cikOf('aapl'), '0000320193');
  assert.equal(await S.cikOf('brk.b'), '0001067983');
  assert.equal(await S.cikOf('320193'), '0000320193');
  await assert.rejects(S.cikOf('ZZZZ'), /No SEC filer/);
  await assert.rejects(S.cikOf('../x'), /ticker or a CIK/);
  const [a, b] = await Promise.all([S.facts('AAPL'), S.submissions('AAPL')]);
  assert.deepEqual([a, b], [{ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json' }, { url: 'https://data.sec.gov/submissions/CIK0000320193.json' }]);
  assert.ok(times.at(-1)! - times.at(-2)! >= 35, 'requests are spaced');
  const n = urls.length; await S.facts('AAPL'); assert.equal(urls.length, n, 'cached');
  assert.throws(() => S.frame('us-gaap', 'Eps/../x', 'USD', 'CY2025Q1'), /Bad frame/);
  assert.throws(() => S.frame('us-gaap', 'EarningsPerShareDiluted', 'USD-per-shares', 'CY2025Q5'), /Bad frame/);
  await assert.rejects(S.filingFile('320193', '0000320193-25-000001', '../secret'), /Bad filing path/);
  assert.deepEqual(await S.filingFile('320193', '0000320193-25-000001', 'index.json'), { url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/index.json' });
});
