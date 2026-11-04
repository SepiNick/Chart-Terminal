// stockbee-setup-fluency-trainer: a model book of past Momentum Burst candidates. The burst screener is replayed on
// each of the last sessions; every non-rejected setup gets the original's setup tags and 3- and 5-day outcomes
// (forward return, MFE, MAE, stop hit → STRONG_WINNER / WORKED / FAILED_* / NEUTRAL), then cohorts by rating,
// trigger and tag, with promote or downgrade candidates. Study material, not signals.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { burst, stockUniverse, toB, universeInputs, type B } from './burst.ts';

const r2 = (x: number) => pyRoundN(x, 2);
export interface Rec { id: string; sym: string; date: string; trigger: string; tags: string[]; rating: string; score: number; entry: number; stop: number; outcomes: Record<string, Out>; overall: string; matured: boolean }
interface Out { matured: boolean; fwd?: number; mfe?: number; mae?: number; stopHit?: boolean; tag?: string }
/** The original's tags, read from the rounded fields a screener report carries. */
interface Cand { t: { tags: string[]; loc: number; v1: number }; soft: string[]; reasons: string[]; rating: string; b: { width: number; days: number; dry: boolean }; risk: number; breakdown: boolean; streak: number }
function setupTags(r: Cand) {
  const t = new Set<string>([...r.t.tags, ...r.soft.map(x => `soft_${x}`), ...r.reasons.map(x => `reject_${x}`)]);
  if (r.rating) t.add(`rating_${r.rating.replace('+', 'plus').replace('-', 'minus')}`);
  const cl = r2(r.t.loc), vr = r2(r.t.v1), bw = r2(r.b.width), rk = r2(r.risk);
  if (cl >= 85) t.add('close_near_high'); else if (cl < 50) t.add('weak_close_location');
  if (vr >= 3) t.add('high_volume_expansion'); else if (vr > 0 && vr < 1.2) t.add('thin_volume_confirmation');
  if (bw > 0 && bw <= 8) t.add('tight_base'); else if (bw >= 15) t.add('wide_base');
  if (r.b.days >= 3 && r.b.days <= 20) t.add('controlled_3_to_20_day_base'); else if (r.b.days > 30) t.add('long_base');
  if (rk > 0 && rk <= 3) t.add('compact_risk'); else if (rk >= 6) t.add('wide_risk');
  if (r.b.dry) t.add('volume_dry_up'); if (r.breakdown) t.add('recent_4pct_breakdown'); if (r.streak >= 3) t.add('three_days_up_before_trigger');
  return [...t].sort();
}
const outcomeTag = (f: number, mfe: number, mae: number, stop: boolean) => stop ? 'FAILED_STOP' : mfe >= 12 || f >= 8 ? 'STRONG_WINNER' : mfe >= 6 || f >= 4 ? 'WORKED' : f <= -2 ? 'FAILED_FADE' : mae <= -5 && f < 2 ? 'CHOPPY_FAILURE' : 'NEUTRAL';
/** `asc` is oldest first. */
function window(rec: Pick<Rec, 'date' | 'entry' | 'stop'>, asc: B[], h: number): Out {
  if (rec.entry <= 0) return { matured: false };
  const fut = asc.filter(b => b.date > rec.date); if (fut.length < h) return { matured: false };
  const w = fut.slice(0, h), c = w.at(-1)!, f = (c.close / rec.entry - 1) * 100, mfe = (Math.max(...w.map(b => b.high)) / rec.entry - 1) * 100, mae = (Math.min(...w.map(b => b.low)) / rec.entry - 1) * 100;
  const stopHit = rec.stop > 0 && w.some(b => b.low <= rec.stop);
  return { matured: true, fwd: r2(f), mfe: r2(mfe), mae: r2(mae), stopHit, tag: outcomeTag(f, mfe, mae, stopHit) };
}
/** Replay the burst screen on each of the last `n` sessions (`desc` newest first). */
export function replay(sym: string, desc: B[], n: number, gate: 'allowed' | 'neutral' | 'restrictive' = 'neutral', win = 80): Rec[] {
  const asc = [...desc].reverse(), out: Rec[] = [];
  for (let k = Math.min(n, desc.length - 1); k >= 0; k--) {
    const r = burst(desc.slice(k, k + win), gate);
    if (r.state === 'REJECTED' || !('t' in r) || !r.t) continue;
    const rec = { id: `stockbee_mb:${sym}:${r.date}:${r.t.primary}`, sym, date: r.date, trigger: r.t.primary, tags: setupTags(r as Cand), rating: r.rating, score: r.score, entry: r2(r.entry), stop: r2(r.stop), outcomes: {} as Record<string, Out>, overall: 'PENDING', matured: false };
    for (const h of [3, 5]) rec.outcomes[`${h}d`] = window(rec, asc, h);
    rec.overall = rec.outcomes['5d'].matured ? rec.outcomes['5d'].tag! : 'PENDING'; rec.matured = rec.overall !== 'PENDING';
    out.push(rec);
  }
  return out;
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 };
function summarize(recs: Rec[]) {
  const m = recs.filter(r => r.matured), n = m.length;
  if (!n) return { n: 0, pending: recs.length, win: null as number | null, fail: null as number | null, strong: null as number | null, stop: null as number | null, avg3: null as number | null, avg5: null as number | null, med5: null as number | null, mfe5: null as number | null, mae5: null as number | null };
  const pc = (k: number) => pyRoundN(k / n * 100, 1), v = (h: string, f: 'fwd' | 'mfe' | 'mae') => m.map(r => r.outcomes[h]?.[f]).filter((x): x is number => x != null);
  const r3 = v('3d', 'fwd'), r5 = v('5d', 'fwd'), f5 = v('5d', 'mfe'), a5 = v('5d', 'mae'), o = (x: number[], fn: (x: number[]) => number) => (x.length ? r2(fn(x)) : null);
  return { n, pending: recs.length - n, win: pc(m.filter(r => r.overall === 'WORKED' || r.overall === 'STRONG_WINNER').length), fail: pc(m.filter(r => r.overall.startsWith('FAILED') || r.overall === 'CHOPPY_FAILURE').length), strong: pc(m.filter(r => r.overall === 'STRONG_WINNER').length), stop: pc(m.filter(r => r.outcomes['5d']?.stopHit).length), avg3: o(r3, mean), avg5: o(r5, mean), med5: o(r5, med), mfe5: o(f5, mean), mae5: o(a5, mean) };
}
export function cohorts(recs: Rec[], by: 'rating' | 'trigger' | 'tags', min = 3) {
  const g = new Map<string, Rec[]>();
  for (const r of recs) for (const k of by === 'tags' ? (r.tags.length ? r.tags : ['untagged']) : [String(r[by] || 'unknown')]) g.set(k, [...(g.get(k) ?? []), r]);
  const rows = [...g].map(([k, v]) => ({ group: k, ...summarize(v) })).filter(x => x.n >= min);
  rows.sort((a, b) => (b.avg5 ?? -999) - (a.avg5 ?? -999) || (b.win ?? -999) - (a.win ?? -999));   // stable, like Python's reverse sort
  return rows.map(x => ({ ...x, action: x.n >= 5 && (x.win ?? 0) >= 60 && (x.avg5 ?? 0) >= 2 && (x.mae5 ?? 0) > -5 ? 'promote' : x.n >= 5 && ((x.fail ?? 0) >= 50 || (x.avg5 ?? 0) <= -1) ? 'downgrade_or_filter' : '' }));
}

export const fluencySkill: Skill = {
  id: 'stockbee-setup-fluency-trainer', name: 'Setup fluency model book (Stockbee)', group: 'Screeners', from: 'stockbee-setup-fluency-trainer',
  desc: 'A Momentum Burst model book: replays the burst screen over recent sessions, follows every setup for 3 and 5 days (return, MFE, MAE, stop hit) and shows which ratings, triggers and setup tags worked or failed — with promote / downgrade candidates to review.',
  inputs: [...universeInputs(150), { key: 'sessions', label: 'Sessions to replay', type: 'number', default: 60 }, { key: 'group', label: 'Cohorts by', type: 'select', options: ['tags', 'rating', 'trigger'], default: 'tags' }],
  async run(v, ctx: Ctx) {
    const { bars } = await stockUniverse(ctx, v, { max: 150 }), n = Math.max(5, Math.min(250, Number(v.sessions) || 60));
    const recs = [...bars].flatMap(([s, b]) => replay(s, toB(b, n + 90), n)), all = summarize(recs), by = (String(v.group) || 'tags') as 'tags', co = cohorts(recs, by);
    const f = (x: number | null, s = '%') => (x == null ? '–' : `${x}${s}`);
    return {
      verdict: { label: `${recs.length} setups · ${all.n} matured`, tone: (all.avg5 ?? 0) > 0 ? 'up' : 'dn', detail: all.n ? `Win rate ${f(all.win)}, failures ${f(all.fail)}, stop hit ${f(all.stop)}, average 5-day return ${f(all.avg5)}.` : 'No matured setups yet.' },
      tables: [
        { title: `Cohorts by ${by}`, cols: ['Group', 'n', 'Win', 'Fail', 'Strong', 'Stop hit', 'Avg 3d', 'Avg 5d', 'Median 5d', 'Avg MFE', 'Avg MAE', 'Review'], rows: co.map(c => [c.group, c.n, f(c.win), f(c.fail), f(c.strong), f(c.stop), f(c.avg3), f(c.avg5), f(c.med5), f(c.mfe5), f(c.mae5), c.action]) },
        { title: 'Recent setups', cols: ['Symbol', 'Date', 'Trigger', 'Rating', 'Score', 'Entry', 'Stop', '3d', '5d', 'Outcome'], rows: [...recs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 80).map(r => [r.sym, r.date, r.trigger, r.rating, r.score, r.entry, r.stop, r.outcomes['3d'].matured ? `${r.outcomes['3d'].fwd}%` : '…', r.outcomes['5d'].matured ? `${r.outcomes['5d'].fwd}%` : '…', r.overall]) },
      ],
      notes: ['Entry = the burst day\'s close, stop = its low. Promote = ≥ 5 cases, ≥ 60% wins, ≥ 2% average 5-day return and MAE above −5%; downgrade = ≥ 50% failures or ≤ −1% average. Review the examples before changing rules.', 'A learning loop, not trade signals.'],
    };
  },
};
