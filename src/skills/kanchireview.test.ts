import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, taxRow } from './kanchireview.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/kanchireview.json', import.meta.url), 'utf8')) as { q: { h: Record<string, unknown>; want: unknown[] }[]; tax: { t: Record<string, string | number | null>; want: unknown[] }[] };
// Golden values: kanchi-dividend-review-monitor's evaluate_holding and the tax sheet's classify_holding on 400 inputs each.
test('review triggers and tax classification match the originals', () => {
  for (const [i, c] of d.q.entries()) { const e = evaluate(c.h); assert.deepEqual([e.ticker, e.status, e.actions, e.findings.map(f => [f.trigger, f.status])], c.want, `holding ${i}`) }
  for (const [i, c] of d.tax.entries()) { const r = taxRow({ ticker: String(c.t.ticker), instrument: String(c.t.instrument_type), account: String(c.t.account_type), security: String(c.t.security_type), holdDays: c.t.hold_days_in_window as number | null }); assert.deepEqual([r.t, r.i, r.a, r.d, r.cls, r.loc, r.note], c.want, `tax ${i}`) }
});
