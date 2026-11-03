// pead-screener: Post-Earnings Announcement Drift. Earnings gap-ups (≥ 3%) in the last two weeks, rebuilt into
// weekly candles from the report day; the first red week after the gap is the setup, a green close above its high
// the breakout. Scored on setup quality (30%), breakout strength (25%), liquidity (25%) and risk/reward with the red
// week's low as stop (20%). The original's rules; earnings dates and timing from SEC 8-Ks. Bars newest first.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';
import { recentEarnings } from './earntrade.ts';

export interface PB { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface Wk { weekStart: string; year: number; week: number; open: number; high: number; low: number; close: number; volume: number; green: boolean; partial: boolean; days: number }
const D = (s: string) => new Date(`${s}T00:00:00Z`);
/** [ISO year, ISO week, ISO weekday]. */
export function iso(s: string): [number, number, number] {
  const d = D(s), wd = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - wd);
  const y = d.getUTCFullYear(), w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return [y, w, wd];
}
const monday = (y: number, w: number) => { const j4 = Date.UTC(y, 0, 4), wd = new Date(j4).getUTCDay() || 7; return new Date(j4 - (wd - 1) * 864e5 + (w - 1) * 7 * 864e5).toISOString().slice(0, 10) };
const r2 = (x: number) => pyRoundN(x, 2);
export function weekly(daily: PB[], earnings?: string): Wk[] {
  if (!daily.length) return [];
  const asc = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), ek = earnings ? iso(earnings) : null, groups = new Map<string, PB[]>();
  for (const d of asc) { const [y, w] = iso(d.date), k = `${y}-${String(w).padStart(2, '0')}`; if (ek && y === ek[0] && w === ek[1] && d.date < earnings!) continue; groups.set(k, [...(groups.get(k) ?? []), d]) }
  const li = iso(asc.at(-1)!.date), latestKey = `${li[0]}-${String(li[1]).padStart(2, '0')}`, latestPartial = li[2] < 5;
  return [...groups.keys()].sort().map(k => {
    const ds = groups.get(k)!, [y, w] = k.split('-').map(Number), o = ds[0].open, c = ds.at(-1)!.close;
    return { weekStart: monday(y, w), year: y, week: w, open: r2(o), high: r2(Math.max(...ds.map(x => x.high))), low: r2(Math.min(...ds.map(x => x.low))), close: r2(c), volume: ds.reduce((a, x) => a + (x.volume || 0), 0), green: c >= o, partial: (k === latestKey && latestPartial) || (!!ek && y === ek[0] && w === ek[1] && ds.length < 5), days: ds.length };
  }).reverse();
}
export function redCandle(w: Wk[], eIdx: number | null) {
  for (let i = 0; i < Math.min(eIdx ?? w.length - 1, w.length); i++) {
    const c = w[i]; if (c.green) continue;
    const rg = c.high - c.low, wick = rg > 0 ? (Math.min(c.open, c.close) - c.low) / rg * 100 : 0, sv: number[] = [];
    for (let j = Math.max(0, i - 2); j < Math.min(w.length, i + 3); j++) if (j !== i) sv.push(w[j].volume);
    const av = sv.length ? sv.reduce((a, b) => a + b, 0) / sv.length : 0;
    return { high: c.high, low: c.low, open: c.open, close: c.close, weekStart: c.weekStart, idx: i, wick: pyRoundN(wick, 1), volVsAvg: pyRoundN(sv.length ? (av > 0 ? c.volume / av : 1) : 1, 2) };
  }
  return null;
}
export function pattern(w: Wk[], earnings: string, watch = 5) {
  const [ey, ew] = iso(earnings), eIdx = w.findIndex(c => c.year === ey && c.week === ew), r = { weeks: 0, eIdx: eIdx < 0 ? null : eIdx, red: null as ReturnType<typeof redCandle>, breakout: false, stage: 'MONITORING' };
  if (!w.length) return r;
  r.weeks = eIdx >= 0 ? eIdx : Math.max(0, Math.floor((D(w[0].weekStart).getTime() - D(earnings).getTime()) / 864e5 / 7));
  if (r.weeks > watch) { r.stage = 'EXPIRED'; return r }
  r.red = redCandle(w, r.eIdx); if (!r.red) return r;
  const cur = w[0]; if (cur.green && cur.close > r.red.high) { r.breakout = true; r.stage = 'BREAKOUT' } else r.stage = 'SIGNAL_READY';
  return r;
}
export function gapPct(p: PB[], date: string, timing: string) {
  const i = p.findIndex(b => b.date === date); if (i < 0) return 0;
  let base: number, g: number;
  if ((timing || '').toLowerCase().trim() === 'bmo') { if (i + 1 >= p.length) return 0; base = p[i + 1].close; g = p[i].open } else { if (i - 1 < 0) return 0; base = p[i].close; g = p[i - 1].open }
  return !base ? 0 : r2((g / base - 1) * 100);
}
export function analyzePead(p: PB[], date: string, gap: number, price: number, watch = 5) {
  if (p.length < 5) return null;
  const w = weekly(p, date); if (!w.length) return null;
  const pt = pattern(w, date, watch);
  let setup = gap >= 10 ? 50 : gap >= 7 ? 40 : gap >= 5 ? 30 : gap >= 3 ? 20 : 10;
  setup += pt.stage === 'BREAKOUT' ? 50 : pt.stage === 'SIGNAL_READY' ? 40 + (pt.red && pt.red.wick > 30 ? 5 : 0) : pt.stage === 'MONITORING' ? (pt.weeks <= 2 ? 25 : 15) : 0;
  setup = Math.min(100, setup);
  let bo = { pct: 0, score: 0, vol: false };
  if (pt.red && pt.red.high > 0) {
    const pct = (price - pt.red.high) / pt.red.high * 100;
    if (pct > 0) { const prior = w.slice(1, Math.min(5, w.length)).map(c => c.volume).filter(v => v > 0), vol = w.length >= 2 && prior.length > 0 && w[0].volume > prior.reduce((a, b) => a + b, 0) / prior.length; bo = { pct: r2(pct), vol, score: pct >= 3 && vol ? 100 : pct >= 2 && vol ? 85 : pct >= 1 ? 70 : 55 } }
    else bo = { pct: r2(pct), score: 0, vol: false };
  }
  let liq = 15, adv = 0;
  if (p.length && price > 0) {
    const r20 = p.slice(0, 20), av = r20.reduce((a, d) => a + (d.volume || 0), 0) / r20.length, dv = r20.filter(d => d.volume > 0 && d.close > 0).map(d => d.volume * d.close);
    adv = dv.length ? dv.reduce((a, b) => a + b, 0) / dv.length : av * price;
    const n = [adv >= 25e6, av >= 1e6, price >= 10].filter(Boolean).length; liq = n === 3 ? (adv > 100e6 ? 100 : adv > 50e6 ? 85 : 70) : n === 2 ? 40 : 15;
  }
  let rr = { stop: 0, target: 0, risk: 0, ratio: 0, score: 25 };
  if (pt.red && price > 0 && pt.red.low > 0 && pt.red.low < price) { const risk = price - pt.red.low, ratio = 2; rr = { stop: r2(pt.red.low), target: r2(price + risk * 2), risk: r2(risk / price * 100), ratio: r2(ratio), score: ratio >= 3 ? 100 : ratio >= 2.5 ? 85 : ratio >= 2 ? 70 : ratio >= 1.5 ? 50 : 25 } }
  const score = pyRoundN(setup * 0.3 + bo.score * 0.25 + liq * 0.25 + rr.score * 0.2, 1);
  return { stage: pt.stage, weeks: pt.weeks, red: pt.red, setup, bo, liq, adv, rr, score, rating: score >= 85 ? 'Strong Setup' : score >= 70 ? 'Good Setup' : score >= 55 ? 'Developing' : 'Weak' };
}

export const peadSkill: Skill = {
  id: 'pead-screener', name: 'Post-earnings drift (PEAD)', group: 'Fundamentals', from: 'pead-screener',
  desc: 'Post-Earnings Announcement Drift: earnings gap-ups of the last weeks, watched on weekly candles for the first red week and the green breakout above it, with entry, stop (red week low) and 2R target. Reporters and timing from SEC 8-Ks.',
  inputs: [
    { key: 'days', label: 'Reported in the last N days', type: 'number', default: 14 }, { key: 'minGap', label: 'Minimum gap %', type: 'number', default: 3 },
    { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 300 }, { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
  ],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean), all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), names = new Map(all.map(s => [s.sym, s.name]));
    const syms = custom.length ? custom : all.filter(s => s.cap >= 500e6).slice(0, Math.min(800, Math.max(10, Number(v.universe) || 300))).map(s => s.sym), minGap = Number(v.minGap) || 3;
    const ev = await recentEarnings(ctx, syms, Math.max(1, Math.min(60, Number(v.days) || 14))), bars = await barsMany(ctx, [...ev.keys()]);
    const res = [...ev].flatMap(([s, e]) => { const b = bars.get(s); if (!b) return []; const p: PB[] = b.slice(-90).reverse().map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume })); const g = gapPct(p, e.date, e.timing); if (Math.abs(g) < minGap) return []; const a = analyzePead(p, e.date, g, p[0].close); return a ? [{ s, e, g, a, price: p[0].close }] : [] }).sort((x, y) => y.a.score - x.a.score);
    return {
      verdict: { label: `${res.filter(r => r.a.stage === 'BREAKOUT').length} breakouts · ${res.filter(r => r.a.stage === 'SIGNAL_READY').length} red-week setups · ${res.length} gappers`, tone: res.some(r => r.a.stage === 'BREAKOUT') ? 'up' : 'muted', detail: `${syms.length} stocks checked for earnings 8-Ks.` },
      tables: [{ title: 'PEAD candidates', cols: ['Symbol', 'Name', 'Reported', 'Gap', 'Stage', 'Weeks', 'Rating', 'Score', 'Red week high', 'Stop', 'Target (2R)', 'Risk', 'ADV $M'], rows: res.map(r => [r.s, names.get(r.s) ?? '', `${r.e.date} ${r.e.timing.toUpperCase()}`, `${r.g}%`, r.a.stage, r.a.weeks, r.a.rating, r.a.score, r.a.red?.high ?? '–', r.a.rr.stop || '–', r.a.rr.target || '–', r.a.rr.risk ? `${r.a.rr.risk}%` : '–', (r.a.adv / 1e6).toFixed(0)]) }],
      notes: ['Watch window 5 weeks after the report. Breakout = a green week closing above the red week\'s high. Not an order.'],
    };
  },
};
