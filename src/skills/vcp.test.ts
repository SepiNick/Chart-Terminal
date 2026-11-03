import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, composite, entryReady, preFilter, rankRS, relativeStrength, stale, trendTemplate, type H, type Quote } from './vcp.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/vcp.json', import.meta.url), 'utf8')) as { spx: H[]; cases: { h: H[]; q: Quote; pf: number; stale: boolean; tt_raw: number; a: unknown[] }[]; final: Record<string, [number, string, number, boolean]> };
// Golden values: vcp-screener's analyze_stock, RS ranking, composite rating and entry_ready on 40 synthetic stocks
// (30 built as bases with shrinking pullbacks, 10 random walks).
test('VCP analysis, ranking and ratings match the original', () => {
  const res = d.cases.map((c, k) => {
    const a = analyze(c.h, c.q, d.spx), v = a.v;
    assert.deepEqual([v.score, v.valid, v.contractions.map(x => [x.hi, x.li, x.depth]), v.pivot, a.vol.score, a.vol.dryUp, a.pv.score, a.pv.risk, a.state, a.type, a.tt.score, a.rs.score, a.rs.weighted], c.a, `stock ${k}`);
    assert.equal(preFilter(c.q) ?? 0, c.pf, `prefilter ${k}`); assert.equal(stale(c.h), c.stale); assert.equal(trendTemplate(c.h, c.q, relativeStrength(c.h, d.spx).rank).raw, c.tt_raw);
    return [`S${k}`, a] as const;
  });
  const rk = rankRS(Object.fromEntries(res.map(([s, a]) => [s, a.rs.weighted])));
  for (const [s, a] of res) {
    a.scores.rs = rk[s].score;
    const c = composite(a.scores, a.v.valid, a.state, a.v.wideLoose);
    assert.deepEqual([c.score, c.rating, rk[s].pct, entryReady(a)], d.final[s], s);
  }
});
