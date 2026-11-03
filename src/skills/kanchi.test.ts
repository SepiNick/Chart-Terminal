import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entryRow, finalVerdict, type Pay } from './kanchi.ts';

type N = number | null;
const d = JSON.parse(readFileSync(new URL('./fixtures/kanchi.json', import.meta.url), 'utf8')) as { price: number; hist: Pay[]; ys: number[]; floor: N; asof: string; lastdiv: N; fin: { sector: string | null; gaap_eps: N; adjusted_eps: N; adjusted_eps_source: string; fcf_per_share: N; completed_merger_within_4q: boolean } | null; scan: string | null; want: unknown[] }[];
// Golden values: kanchi-dividend-sop's build_entry_row (dividend basis, Step 1, payout safety, event cap, verdict) on 300 cases.
test('Kanchi entry rows match the original', () => {
  for (const [i, c] of d.entries()) {
    const r = entryRow({ price: c.price, history: c.hist, yields5y: c.ys, floor: c.floor, asOf: c.asof, lastDiv: c.lastdiv, scan: c.scan ? { result: c.scan } : undefined,
      fin: c.fin && { sector: c.fin.sector, dividend: null, gaapEps: c.fin.gaap_eps, adjEps: c.fin.adjusted_eps, adjSource: c.fin.adjusted_eps_source, fcfPs: c.fin.fcf_per_share, merger: c.fin.completed_merger_within_4q } });
    assert.deepEqual([r.signal, r.dividend == null ? null : Math.round(r.dividend * 1e4) / 1e4, r.cur, r.avg, r.target, r.buy, r.drop, r.step1, r.step1Reason, r.safety?.verdict ?? null, r.verdict, r.t1, r.why, r.blockers, r.b?.cadence ?? null, r.b?.fwdYield ?? null],
      c.want.map((x, k) => (k === 7 || k === 8 || k === 9 || k === 14 || k === 15 ? x ?? null : x)), `case ${i}`);
  }
  assert.deepEqual(finalVerdict({ step1: 'HOLD-REVIEW', safety: 'PASS', cap: null, t1: false, blockers: [] }), ['CONDITIONAL-PASS', false, ['dividend_freeze_income_cash_cow']]);
});
