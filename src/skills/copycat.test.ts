import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregate, combineClasses, copyWeights, diff, infoTableName, listFilings, parseInfoTable, pickFiling, resolveTickers, TickerIndex, valueMultiplier } from './copycat.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/copycat.json', import.meta.url), 'utf8')) as { tickers: [string, string, string][]; cases: { sub: { filings: { recent: Record<string, string[]> } }; chosen: string; prior: string; amend: string[]; q: { index: { directory: { item: { name: string }[] } }; name: string; xml: string; filed: string; pos: unknown[][]; comb: unknown[][]; total: number }[]; diff: unknown[][]; weights: unknown[][] }[] };
// Golden values: trader-copycat's filing pick, info-table parsing, aggregation, ticker matching, class combining, diff and
// copy weights on real 13F-HRs (Berkshire Hathaway and Pershing Square, two quarters each) and SEC's full ticker list.
test('13F portfolios, tickers, changes and copy weights match the original', () => {
  const idx = new TickerIndex(d.tickers);
  for (const c of d.cases) {
    const fs = listFilings(c.sub), { chosen, amendments } = pickFiling(fs), prior = pickFiling(fs, { before: chosen.period }).chosen;
    assert.deepEqual([chosen.accession, prior.accession, amendments.map(a => a.accession)], [c.chosen, c.prior, c.amend]);
    const built = c.q.map(q => { assert.equal(infoTableName(q.index), q.name); const a = aggregate(parseInfoTable(q.xml, valueMultiplier(q.filed))); resolveTickers(a.positions, idx); return a });
    built.forEach((a, k) => {
      assert.deepEqual(a.positions.map(p => [p.cusip, p.put_call, p.value, p.shares, p.pct, p.ticker ?? null, p.ticker_source, p.check, p.name]), c.q[k].pos, `positions ${k}`);
      assert.deepEqual(combineClasses(a.positions.map(p => ({ ...p })), a.total).map(p => [p.cusips, p.pct, p.tickers ?? null]), c.q[k].comb.map(x => [x[0], x[1], x[2] ?? null]), `combined ${k}`);
    });
    assert.deepEqual(diff(built[0].positions, built[1].positions).map(x => [x.status, x.cusip, x.change, x.pct]), c.diff);
    assert.deepEqual(copyWeights(combineClasses(built[0].positions, built[0].total), { top: 10 }).weights.map(w => [w.ticker, w.weight, w.check]), c.weights);
  }
});
