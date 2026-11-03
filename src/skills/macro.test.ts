import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, compositeOf, concentration, credit, equityBond, sectors, sizeFactor, yieldCurve, type Comp, type D, type K, type Rate } from './macro.ts';

const load = <T>(f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as T;
// Golden values: macro-regime-detector's six calculators, composite and classifier on sixteen synthetic markets
// (month-end closes only, which is all the monthly downsampling reads).
test('macro components, composite and regime match the original', () => {
  for (const [i, c] of load<{ h: Record<string, D[]>; rates: Rate[] | null; comps: Record<K, (number | string)[]>; composite: number; regime: string; confidence: string }[]>('macro.json').entries()) {
    const h = c.h, got: Record<K, Comp> = { concentration: concentration(h.RSP, h.SPY), yield_curve: yieldCurve(c.rates, h.SHY, h.TLT), credit_conditions: credit(h.HYG, h.LQD), size_factor: sizeFactor(h.IWM, h.SPY), equity_bond: equityBond(h.SPY, h.TLT), sector_rotation: sectors(h.XLY, h.XLP) };
    for (const k of Object.keys(c.comps) as K[]) assert.deepEqual([got[k].score, got[k].direction, ...(k === 'equity_bond' ? [got[k].corr] : [])], c.comps[k], `${i} ${k}`);
    const r = classify(got);
    assert.deepEqual([compositeOf(got), r.regime, r.confidence], [c.composite, c.regime, c.confidence], `case ${i}`);
  }
});
test('regime classification matches the original on 300 direction mixes', () => {
  for (const [i, x] of load<{ c: Record<K, { score: number; direction: string; data_available: boolean; correlation_regime?: string }>; want: unknown[] }[]>('macro_cls.json').entries()) {
    const c = Object.fromEntries(Object.entries(x.c).map(([k, v]) => [k, { score: v.score, direction: v.direction, available: v.data_available, corr: v.correlation_regime }])) as Record<K, Comp>;
    const r = classify(c);
    assert.deepEqual([r.regime, r.confidence, r.prob[0], r.from, r.to], x.want, `mix ${i}`);
  }
});
