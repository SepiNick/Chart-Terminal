import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeValue } from './valuediv.ts';
import type { Annual } from './secfacts.ts';

type N = number | null;
const d = JSON.parse(readFileSync(new URL('./fixtures/valuediv.json', import.meta.url), 'utf8')) as { divs: { date: string; dividend: number }[]; inc: { revenue: number; eps: number; netIncome: number }[]; cf: { dividendsPaid: N; operatingCashFlow: N; capitalExpenditure: N; depreciationAndAmortization: N }; bs: { totalDebt: number; totalStockholdersEquity: number; totalCurrentAssets: number; totalCurrentLiabilities: number }; reit: boolean; roe: N; price: number; closes: number[]; want: unknown[] | null }[];
// Golden values: value-dividend-screener's filters and composite (its StockAnalyzer methods) on 300 synthetic stocks, as of 2026-11-03.
test('value dividend filters and composite match the original', () => {
  for (const [i, c] of d.entries()) {
    const a: Annual[] = c.inc.map((x, k) => ({ end: `y${k}`, revenue: x.revenue, netIncome: x.netIncome, eps: x.eps, totalDebt: k ? null : c.bs.totalDebt, equity: k ? null : c.bs.totalStockholdersEquity, currentAssets: k ? null : c.bs.totalCurrentAssets, currentLiabilities: k ? null : c.bs.totalCurrentLiabilities, dividendsPaid: k ? null : c.cf.dividendsPaid, ocf: k ? null : c.cf.operatingCashFlow, capex: k ? null : c.cf.capitalExpenditure, fcf: null, da: k ? null : c.cf.depreciationAndAmortization, shares: null }));
    const r = analyzeValue(a, c.divs, c.price, c.closes, '2026-11-03', c.reit, c.roe);
    assert.deepEqual(r && [r.rsi, r.yield, r.divCagr, r.st.years, r.ss, r.su.payout, r.su.coverage, r.su.sustainable, r.h.ok, r.q.score, r.score], c.want, `stock ${i}`);
  }
});
