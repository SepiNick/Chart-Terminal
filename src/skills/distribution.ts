// ibd-distribution-day-monitor: IBD distribution days on QQQ and SPY (close down ≥ 0.2% on higher volume), each
// active for 25 sessions unless price later rises 5% above its close; d5/d15/d25 clusters → NORMAL / CAUTION / HIGH /
// SEVERE, combined across both indexes, with the TQQQ and QQQ exposure policy. History is newest first, like the original.
import { pct, type Ctx, type Skill } from './types.ts';

export interface Row { date: string; high: number; close: number; volume: number }
export interface DD { date: string; age: number; close: number; change: number; status: 'active' | 'invalidated' | 'expired' }

export function distributionDays(h: Row[], minDecline = -0.002, expire = 25, gain = 0.05): DD[] {
  const out: DD[] = [];
  for (let i = 0; i < h.length - 1; i++) {
    const t = h[i], y = h[i + 1];
    if (![t.close, t.volume, y.close, y.volume].every(v => v > 0)) continue;
    const ch = t.close / y.close - 1;
    if (!(ch <= minDecline + 1e-12 && t.volume > y.volume)) continue;
    // invalidated when a later session (within the expiry) trades 5% above the distribution day's close
    const thr = t.close * (1 + gain);
    let inv = false;
    for (let e = i - 1; e >= Math.max(i - expire, 0); e--) if (h[e].high > 0 && h[e].high >= thr) { inv = true; break }
    out.push({ date: t.date, age: i, close: t.close, change: ch, status: inv ? 'invalidated' : i > expire ? 'expired' : 'active' });
  }
  return out;
}
const active = (dd: DD[], maxAge: number) => dd.filter(d => d.status === 'active' && d.age <= maxAge).length;
function classify(d5: number, d15: number, d25: number, belowMa: boolean | null) {
  if (d25 >= 6 || d15 >= 4 || (belowMa === true && d25 >= 5)) return 'SEVERE';
  if (d25 >= 5 || d15 >= 3 || d5 >= 2) return 'HIGH';
  return d25 >= 3 ? 'CAUTION' : 'NORMAL';
}
const ORDER = ['NORMAL', 'CAUTION', 'HIGH', 'SEVERE'];
export function combine(qqq: string, spy: string) {
  if (qqq === 'SEVERE' || spy === 'SEVERE') return 'SEVERE';
  if (qqq === 'HIGH' || (qqq === 'NORMAL' && spy === 'HIGH') || (qqq === 'CAUTION' && (spy === 'CAUTION' || spy === 'HIGH'))) return 'HIGH';
  return ORDER[Math.max(ORDER.indexOf(qqq), ORDER.indexOf(spy))];
}
/** Newest-first closes: EMA seeded with the SMA of the oldest `n`, like calc_ema. */
const emaNF = (c: number[], n: number) => { if (c.length < n) return c.reduce((a, b) => a + b, 0) / c.length; const r = [...c].reverse(); let e = r.slice(0, n).reduce((a, b) => a + b, 0) / n; const k = 2 / (n + 1); for (const p of r.slice(n)) e = p * k + e * (1 - k); return e };
export function analyzeIndex(h: Row[]) {
  const dd = distributionDays(h), c = h.map(x => x.close);
  const belowMa = c.length >= 50 ? !(c[0] > emaNF(c, 21)) && !(c[0] > c.slice(0, 50).reduce((a, b) => a + b, 0) / 50) : null;
  const d5 = active(dd, 5), d15 = active(dd, 15), d25 = active(dd, 25);
  return { dd, d5, d15, d25, belowMa, risk: classify(d5, d15, d25, belowMa) };
}
const POLICY: Record<string, Record<string, [string, number, number | null]>> = {
  TQQQ: { NORMAL: ['Hold / follow the base strategy', 100, null], CAUTION: ['Avoid new adds', 75, 7], HIGH: ['Reduce exposure', 50, 5], SEVERE: ['Close TQQQ or hedge', 25, 3] },
  QQQ: { NORMAL: ['Hold / follow the base strategy', 100, null], CAUTION: ['Avoid new adds', 100, 8], HIGH: ['Reduce exposure', 75, 6], SEVERE: ['Reduce exposure or hedge', 50, 5] },
};

const rows = (b: { time: number; high: number; close: number; volume: number }[]): Row[] => b.slice(-85).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), high: x.high, close: x.close, volume: x.volume }));
export const distributionSkill: Skill = {
  id: 'ibd-distribution-day-monitor', name: 'IBD distribution days', group: 'Market regime', from: 'ibd-distribution-day-monitor',
  desc: 'Institutional selling on QQQ and SPY: distribution days (down ≥ 0.2% on higher volume) active for 25 sessions unless price rises 5% above them; d5/d15/d25 clusters give NORMAL → SEVERE and a TQQQ/QQQ exposure policy. Not an order.',
  inputs: [{ key: 'instrument', label: 'Exposure policy for', type: 'select', options: ['TQQQ', 'QQQ'], default: 'TQQQ' }, { key: 'stop', label: 'Base trailing stop %', type: 'number', default: 10 }],
  async run(v, ctx: Ctx) {
    const [q, s] = await Promise.all([ctx.bars('FX:QQQ', '1d'), ctx.bars('FX:SPY', '1d')]).then(x => x.map(rows));
    const Q = analyzeIndex(q), S = analyzeIndex(s), risk = combine(Q.risk, S.risk), inst = String(v.instrument) === 'QQQ' ? 'QQQ' : 'TQQQ', [action, target, cap] = POLICY[inst][risk], base = Number(v.stop) || 10;
    const line = (n: string, a: ReturnType<typeof analyzeIndex>) => [n, a.risk, a.d5, a.d15, a.d25, a.belowMa == null ? '–' : a.belowMa ? 'below both' : 'above one'];
    return {
      verdict: { label: risk, tone: risk === 'NORMAL' ? 'up' : risk === 'CAUTION' ? 'warn' : 'dn', detail: `${inst}: ${action}, target exposure ${target}%, trailing stop ${cap == null ? base : Math.min(base, cap)}%` },
      tables: [{ title: 'Indexes', cols: ['Index', 'Risk', 'd5', 'd15', 'd25', '21EMA / 50SMA'], rows: [line('QQQ', Q), line('SPY', S)] },
        { title: 'Distribution days (QQQ)', cols: ['Date', 'Sessions ago', 'Change', 'Status'], rows: Q.dd.filter(d => d.age <= 30).map(d => [d.date, d.age, pct(d.change * 100), d.status]) }],
      notes: ['Recommendation only; no order is placed.'],
    };
  },
};
