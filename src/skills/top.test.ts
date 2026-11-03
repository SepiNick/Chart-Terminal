import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { breadth, composite, distribution, dynamicBasket, leaders, rotation, sentiment, technical, type Comp, type H, type Term } from './top.ts';

interface C { sp: H[]; nq: H[]; etfs: Record<string, H[]>; sec: Record<string, H[]>; in: [number | null, number | null, number, number | null, number | null, Term | null, number | null]; basket: string[]; scores: Record<Comp, number>; avail: Partial<Record<Comp, boolean>>; composite: number; zone: string }
const d = JSON.parse(readFileSync(new URL('./fixtures/top.json', import.meta.url), 'utf8')) as { cases: C[]; extra: [number, string] };
// Golden values: market-top-detector's six calculators and composite scorer on twelve synthetic markets.
test('market top components and composite match the original', () => {
  for (const [i, c] of d.cases.entries()) {
    const q = Object.fromEntries(Object.entries(c.etfs).map(([s, h]) => [s, { price: h[0].close, yearHigh: Math.max(...h.map(x => x.high)) }]));
    const basket = dynamicBasket(q);
    assert.deepEqual(basket, c.basket, `basket ${i}`);
    const [p200, p50, dist, vix, pc, term, md] = c.in, l = leaders(Object.fromEntries(basket.map(s => [s, q[s]])), c.etfs, basket), r = rotation(c.sec), b = breadth(p200, p50, dist), s = sentiment(vix, pc, term, md);
    const got = { distribution_days: distribution(c.sp, c.nq).score, leading_stocks: l.score, defensive_rotation: r.score, breadth_divergence: b.score, index_technical: technical(c.sp, c.nq).score, sentiment: s.score };
    assert.deepEqual(got, c.scores, `case ${i}`);
    assert.deepEqual({ leading_stocks: l.available, defensive_rotation: r.available, breadth_divergence: b.available, sentiment: s.available }, c.avail, `avail ${i}`);
    const k = composite(got, c.avail);
    assert.deepEqual([k.score, k.zone], [c.composite, c.zone], `composite ${i}`);
  }
  const x = composite({ distribution_days: 90, leading_stocks: 40, defensive_rotation: 85, breadth_divergence: 50, index_technical: 30, sentiment: 20 }, { breadth_divergence: false });
  assert.deepEqual([x.score, x.zone], d.extra);
});
