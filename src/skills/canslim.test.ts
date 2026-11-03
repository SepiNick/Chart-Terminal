import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aScore, cScore, composite, iScore, lScore, mScore, nScore, sScore, type Stmt } from './canslim.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/canslim.json', import.meta.url), 'utf8')) as { bench: number[]; cases: { q: Stmt[]; a: Stmt[]; quote: { price: number; yearHigh: number; volume: number; avgVolume: number }; closes: number[]; vols: number[]; own: number | null; spn: number[]; mprice: number; vix: number | null; want: [Record<string, number>, number | null, number | null, number | null, number | null, string, number, string, string, string[]] }[] };
// Golden values: canslim-screener's seven calculators, phase-3 composite and thresholds on 150 synthetic stocks.
test('CANSLIM components, composite and recommendation match the original', () => {
  for (const [i, c] of d.cases.entries()) {
    const C = cScore(c.q), A = aScore(c.a), N = nScore(c.quote), hist = c.closes.map((x, k) => ({ close: x, volume: c.vols[k] })).reverse().slice(0, 90), S = sScore(hist), L = lScore(c.closes, d.bench), I = iScore(c.own), M = mScore(c.mprice, c.spn, c.vix);
    const sc = { C: C.score, A: A.score, N: N.score, S: S.score, L: L.score, I, M: M.score }, k = composite(sc);
    assert.deepEqual([sc, C.eps, A.cagr, N.dist, L.rank, M.trend, k.score, k.rating, k.rec, [...k.failed].sort()], c.want, `stock ${i}`);
  }
});
