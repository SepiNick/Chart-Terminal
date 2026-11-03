import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dividendGrowth, growth, health, payout, rsi, score, type DS } from './divgrowth.ts';
import type { Annual } from './secfacts.ts';

type N = number | null;
const d = JSON.parse(readFileSync(new URL('./fixtures/divgrowth.json', import.meta.url), 'utf8')) as { prices: number[]; rsi: N; divs: { date: string; dividend: number }[]; dg: unknown[]; reit: boolean; inc: { netIncome: N; revenue: number; eps: number }[]; cf: { dividendsPaid: N; freeCashFlow: N; netIncome: N; depreciationAndAmortization: N }[]; bs: { totalDebt: number; totalStockholdersEquity: number; totalCurrentAssets: number; totalCurrentLiabilities: number }[]; po: unknown[]; h: unknown[]; gm: unknown[]; sd: DS; sc: number }[];
const ann = (c: (typeof d)[number]): Annual[] => c.inc.map((x, i) => ({ end: `y${i}`, revenue: x.revenue, netIncome: i === 0 ? null : x.netIncome, eps: x.eps, totalDebt: null, equity: null, currentAssets: null, currentLiabilities: null, dividendsPaid: null, ocf: null, capex: null, fcf: null, da: null, shares: null }));
// Golden values: dividend-growth-pullback-screener's RSI, dividend growth, payout, health, growth and score on 200 cases (year 2026).
test('dividend growth pieces match the original', () => {
  for (const [i, c] of d.entries()) {
    assert.equal(rsi(c.prices), c.rsi, `rsi ${i}`);
    const g = dividendGrowth(c.divs, 2026); assert.deepEqual(g ? [g.cagr, g.consistent, g.latest, g.streak] : [null, false, null, 0], c.dg, `div ${i}`);
    const cf = c.cf[0], a: Annual[] = [{ end: 'x', revenue: null, netIncome: c.reit ? cf.netIncome : c.inc[0].netIncome, eps: null, totalDebt: null, equity: null, currentAssets: null, currentLiabilities: null, dividendsPaid: cf.dividendsPaid, ocf: null, capex: null, fcf: cf.freeCashFlow, da: cf.depreciationAndAmortization, shares: null }];
    const p = payout(a, c.reit); assert.deepEqual([p.payout, p.fcfPayout, p.fcfCoverage, p.sustainable], c.po, `payout ${i}`);
    const b = c.bs[0], h = health({ ...a[0], totalDebt: b.totalDebt, equity: b.totalStockholdersEquity, currentAssets: b.totalCurrentAssets, currentLiabilities: b.totalCurrentLiabilities });
    assert.deepEqual([h.de, h.cr, h.healthy], c.h, `health ${i}`);
    const gr = growth(ann(c)); assert.deepEqual([gr.rev, gr.eps], c.gm, `growth ${i}`);
    assert.equal(score(c.sd), c.sc, `score ${i}`);
  }
});
