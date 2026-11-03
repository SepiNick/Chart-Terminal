// stockbee-20pct-study: the daily 20% mover study — stocks up (or down) 20% over 5 sessions, classified by chart
// pattern, close quality and extension risk, scored for continuation quality and reversal risk, then followed for
// 1–20 days and grouped into cohorts that may become rule candidates. Research only; bars here are oldest first.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { stockUniverse, universeInputs } from './burst.ts';

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }
export const HORIZONS = [1, 3, 5, 10, 20];
const EPS = 1e-9, SURVIVOR = 'CURRENT_UNIVERSE_BACKFILL_SURVIVORSHIP_BIAS';
const chg = (c: number, p: number) => (p <= 0 ? 0 : (c / p - 1) * 100), spct = (n: number, d: number) => (d === 0 ? 0 : n / d * 100);
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const loc = (b: Bar) => (b.high <= b.low ? 50 : Math.max(0, Math.min(100, (b.close - b.low) / (b.high - b.low) * 100)));
export function median(v: number[]) { const s = v.filter(x => !Number.isNaN(x)).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null }
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

export interface Event {
  id: string; episode: string; sym: string; date: string; dir: 'UP' | 'DOWN'; dayIndex: number; ret: number; dayRet: number; gap: number; range: number; loc: number;
  dollarVol: number; volRatio: number; dist52h: number; prior20: number; prior50: number; baseLen: number; baseDepth: number;
  pattern: string; closeQuality: string; extension: string; flags: string[]; scores: { continuation: number; reversal: number; priority: number; dataQuality: number };
  labels: string[]; handoffs: Record<string, boolean>; outcomes: Record<string, Outcome | null>; catalyst: string;
}
export interface Outcome { status: 'MATURED' | 'PENDING'; close?: number; mfe?: number; mae?: number; dClose?: number; dMfe?: number; dMae?: number; tag?: string }

export function pattern(dir: string, cl: number, gap: number, ret: number, d52: number, vr: number, p20: number) {
  if (dir === 'DOWN') return cl >= 65 ? 'DOWN_GAP_REVERSAL_CANDIDATE' : Math.abs(ret) >= 35 && cl <= 25 ? 'STRUCTURAL_BREAKDOWN' : 'BREAKDOWN_EVENT';
  if (gap >= 8 && cl >= 75 && vr >= 2) return 'GAP_AND_GO';
  if (d52 >= -5 && cl >= 70 && vr >= 1.5) return 'BASE_BREAKOUT';
  if (ret >= 50 && cl < 55) return 'CLIMAX_EXTENSION';
  if (cl < 45) return 'FAILED_BREAKOUT';
  return p20 > 40 ? 'EXTENDED_MOMENTUM' : 'MOMENTUM_EVENT';
}
const closeQuality = (cl: number, dir: string) => dir === 'UP' ? (cl >= 80 ? 'STRONG_CLOSE' : cl >= 55 ? 'MID_CLOSE' : 'WEAK_CLOSE') : cl <= 20 ? 'WEAK_CLOSE_DOWN' : cl <= 45 ? 'MID_CLOSE_DOWN' : 'REVERSAL_CLOSE';
const extension = (r: number, p: number, cl: number) => { const s = (r >= 60 ? 2 : r >= 35 ? 1 : 0) + (p >= 50 ? 2 : p >= 25 ? 1 : 0) + (cl < 45 ? 1 : 0); return s >= 4 ? 'HIGH' : s >= 2 ? 'MODERATE' : 'LOW' };
const CATALYST: Record<string, number> = { EARNINGS_REVALUATION: 24, GUIDANCE_RAISE: 24, 'M&A': 22, CONTRACT_ORDER: 18, FDA_CLINICAL: 14, ANALYST_UPGRADE: 12, SHORT_SQUEEZE: 8, THEME_SYMPATHY: 14, NO_CLEAR_NEWS: 3, LOW_FLOAT_SPECULATION: 0, CAPITAL_STRUCTURE: 0 };
export function score(dir: string, cat: string, dv: number, vr: number, cl: number, d52: number, pat: string, ext: string, flags: string[]) {
  const cq = CATALYST[cat] ?? 5, liq = Math.min(15, Math.trunc(dv / 20e6 * 10)), vol = Math.min(10, Math.trunc(vr * 3)), close = Math.trunc((dir === 'UP' ? cl : 100 - cl) / 100 * 15);
  const setup = pat === 'BASE_BREAKOUT' || pat === 'GAP_AND_GO' ? 12 : pat.includes('MOMENTUM') ? 8 : 3, high = dir === 'DOWN' ? 5 : d52 >= -5 ? 10 : 4;
  const pen = ({ LOW: 0, MODERATE: -5, HIGH: -12 } as Record<string, number>)[ext] ?? -5, dq = Math.max(0, 100 - flags.length * 15);
  const cont = Math.max(0, Math.min(100, cq + liq + vol + close + setup + high + Math.trunc(dq / 100 * 10) + pen));
  let rev = (['NO_CLEAR_NEWS', 'LOW_FLOAT_SPECULATION', 'CAPITAL_STRUCTURE'].includes(cat) ? 25 : 0) + (ext === 'HIGH' ? 25 : ext === 'MODERATE' ? 12 : 0) + (dir === 'UP' && cl < 50 ? 25 : 0) + (dv < 20e6 ? 15 : 0);
  if (flags.length) rev += Math.min(20, flags.length * 8);
  const pri = Math.max(0, Math.min(100, cont + 20 - Math.floor(Math.abs(50 - rev) / 3)));
  return { continuation: cont, reversal: Math.min(100, rev), priority: pri, dataQuality: dq };
}
export interface Opts { lookback: number; minRet: number; minPrice: number; minDollar: number; down: boolean; gap: number; extraFlags: string[] }
export const STUDY_DEFAULTS: Opts = { lookback: 5, minRet: 20, minPrice: 5, minDollar: 20e6, down: false, gap: 5, extraFlags: [] };
/** Events as of `asOf` (each symbol's last bar on or before it; null = latest). */
export function detect(prices: Record<string, Bar[]>, asOf: string | null, o: Opts, existing: Event[] = []) {
  const out: Event[] = [];
  for (const sym of Object.keys(prices).sort()) {
    const bars = prices[sym]; if (!bars.length) continue;
    let idx = bars.length - 1;
    if (asOf != null) { idx = -1; for (let i = 0; i < bars.length; i++) if (Date.parse(bars[i].date) <= Date.parse(asOf)) idx = i; if (idx < 0) continue }
    if (idx < o.lookback) continue;
    const c = bars[idx], lb = bars[idx - o.lookback], pv = idx > 0 ? bars[idx - 1] : lb, ret = chg(c.close, lb.close);
    const dir = ret + EPS >= o.minRet ? 'UP' : o.down && ret - EPS <= -o.minRet ? 'DOWN' : null;
    if (!dir || c.close < o.minPrice) continue;
    const dv = c.close * c.volume; if (dv < o.minDollar) continue;
    const h20 = bars.slice(Math.max(0, idx - 20), idx), h252 = bars.slice(Math.max(0, idx - 252), idx + 1), av20 = avg(h20.map(b => b.volume)), adv20 = avg(h20.map(b => b.close * b.volume)), vr = av20 ? c.volume / av20 : 0;
    const d52 = chg(c.close, h252.length ? Math.max(...h252.map(b => b.high)) : c.high);
    const p20 = idx >= 21 ? chg(pv.close, bars[Math.max(0, idx - 21)].close) : 0, p50 = idx >= 51 ? chg(pv.close, bars[Math.max(0, idx - 51)].close) : 0;
    const cl = loc(c), range = spct(c.high - c.low, pv.close), gap = chg(c.open, pv.close), pat = pattern(dir, cl, gap, ret, d52, vr, p20), cq = closeQuality(cl, dir), ext = extension(Math.abs(ret), Math.abs(p20), cl);
    const flags: string[] = [];
    if (bars.length < 260) flags.push('SHORT_HISTORY_LT_260_BARS');
    if (adv20 && adv20 < 5e6) flags.push('LOW_AVG_DOLLAR_VOLUME');
    if (c.volume <= 0) flags.push('MISSING_VOLUME');
    if (Math.abs(ret) > 200) flags.push('EXTREME_MOVE_CHECK_SPLIT_OR_CORPORATE_ACTION');
    if (idx > 0 && (c.open > pv.close * 4 || c.open < pv.close * 0.25)) flags.push('POSSIBLE_SPLIT_OR_SPECIAL_DISTRIBUTION');
    for (const f of o.extraFlags) if (!flags.includes(f)) flags.push(f);
    const cat = 'NO_CLEAR_NEWS', sc = score(dir, cat, dv, vr, cl, d52, pat, ext, flags), all = [...existing, ...out];
    const near = all.filter(r => r.sym === sym && r.dir === dir && days(r.date, c.date) <= o.gap).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const episode = near.length ? near[0].episode : `${sym}:${c.date}:${dir}`, ds = [...new Set([c.date, ...all.filter(r => r.episode === episode && r.sym === sym && r.dir === dir).map(r => r.date)])].sort();
    let base = 0; for (const b of bars.slice(Math.max(0, idx - 80), idx).reverse()) { if (b.close < c.close * 0.75) break; base++ }
    const seg = bars.slice(Math.max(0, idx - 50), idx), hi = seg.length ? Math.max(...seg.map(b => b.high)) : 0, depth = seg.length ? spct(hi - Math.min(...seg.map(b => b.low)), hi) : 0;
    const labels = [dir, pat, cq]; if (ext !== 'LOW') labels.push(`${ext}_EXTENSION_RISK`);
    labels.push(sc.continuation >= 75 ? 'A_REVALUATION_OR_HIGH_QUALITY_EVENT' : sc.continuation >= 60 ? 'B_MOMENTUM_EVENT' : sc.reversal >= 65 ? 'D_LOW_QUALITY_OR_REVERSAL_RISK' : 'C_STUDY_ONLY');
    out.push({
      id: `${sym}:${c.date}:${dir}:${o.lookback}D`, episode, sym, date: c.date, dir, dayIndex: ds.indexOf(c.date) + 1, ret, dayRet: chg(c.close, pv.close), gap, range, loc: cl, dollarVol: dv, volRatio: vr, dist52h: d52, prior20: p20, prior50: p50, baseLen: base, baseDepth: depth,
      pattern: pat, closeQuality: cq, extension: ext, flags, scores: sc, labels, catalyst: cat, outcomes: Object.fromEntries(HORIZONS.map(h => [`${h}d`, null])),
      handoffs: { stockbee_episodic_pivot: dir === 'UP' && (pat === 'GAP_AND_GO' || pat === 'BASE_BREAKOUT'), pead_screener: false, theme_detector: sc.priority >= 80, edge_candidate_agent: sc.priority >= 85, parabolic_short_watch: dir === 'UP' && sc.reversal >= 70 },
    });
  }
  return out;
}
const r4 = (x: number | null) => (x == null ? null : pyRoundN(x, 4));
export function outcomeTag(dir: string, cr: number, dc: number, dm: number, da: number, h: number) {
  if (dir === 'UP') return dc >= 8 || dm >= 12 ? 'STRONG_CONTINUATION' : dc >= 4 || dm >= 6 ? 'CONTINUED' : cr <= -4 ? 'FAILED_FADE' : da <= -8 && dc < 2 ? 'CHOPPY_FAILURE' : 'NEUTRAL';
  return dc >= 8 || dm >= 12 ? 'STRONG_BREAKDOWN_CONTINUATION' : dc >= 4 || dm >= 6 ? 'BREAKDOWN_CONTINUED' : cr >= 6 ? 'REVERSAL_BOUNCE' : h >= 5 && cr >= 3 ? 'PARTIAL_REVERSAL' : 'NEUTRAL';
}
export function outcomes(e: Event, bars: Bar[], hs = HORIZONS) {
  const idx = bars.findIndex(b => b.date === e.date); if (idx < 0) return e;
  const entry = bars[idx].close, o: Record<string, Outcome | null> = { ...e.outcomes };
  for (const h of hs) {
    if (idx + h >= bars.length) { o[`${h}d`] = { status: 'PENDING' }; continue }
    const f = bars.slice(idx + 1, idx + h + 1), hi = Math.max(...f.map(b => b.high)), lo = Math.min(...f.map(b => b.low)), cr = chg(bars[idx + h].close, entry), mfe = chg(hi, entry), mae = chg(lo, entry);
    const [dc, dm, da] = e.dir === 'DOWN' ? [-cr, spct(entry - lo, entry), spct(entry - hi, entry)] : [cr, mfe, mae];
    o[`${h}d`] = { status: 'MATURED', close: r4(cr)!, mfe: r4(mfe)!, mae: r4(mae)!, dClose: r4(dc)!, dMfe: r4(dm)!, dMae: r4(da)!, tag: outcomeTag(e.dir, cr, dc, dm, da, h) };   // stored rounded, as the original's records are
  }
  return { ...e, outcomes: o };
}
export function cohorts(evs: Event[], minSample = 10, h = 5) {
  const key = `${h}d`, g = new Map<string, { k: (string)[]; items: Event[] }>();
  for (const e of evs) { const o = e.outcomes[key]; if (!o || o.status !== 'MATURED') continue; const k = [e.dir, e.catalyst, e.pattern, e.closeQuality], ks = JSON.stringify(k); g.set(ks, { k, items: [...(g.get(ks)?.items ?? []), e] }) }
  const cmp = (a: string[], b: string[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0 };
  return [...g.values()].sort((a, b) => b.items.length - a.items.length || cmp(a.k, b.k)).map(({ k, items }) => {
    const dr = items.map(e => e.outcomes[key]!.dClose!), win = pyRoundN(dr.filter(x => x > 0).length / dr.length, 4), med = r4(median(dr)), mae = r4(median(items.map(e => e.outcomes[key]!.dMae!)));
    const rule = items.length >= minSample && med != null ? (win >= 0.58 && med >= 2 ? 'candidate_for_review' : win <= 0.42 && med <= -2 ? 'avoid_or_fade_study' : null) : null;
    const tags: Record<string, number> = {}; for (const e of items) tags[e.outcomes[key]!.tag!] = (tags[e.outcomes[key]!.tag!] ?? 0) + 1;
    return { group: k, n: items.length, win, med, medClose: r4(median(items.map(e => e.outcomes[key]!.close!))), medMfe: r4(median(items.map(e => e.outcomes[key]!.dMfe!))), mae, tags, symbols: [...new Set(items.map(e => e.sym))].sort().slice(0, 10), rule };
  });
}
/** Scan every session in the last `n` (deduplicated by record id, the last scan wins as upsert does), then add outcomes. */
export function backfill(prices: Record<string, Bar[]>, n: number, o: Opts) {
  const dates = [...new Set(Object.values(prices).flatMap(b => b.slice(-n).map(x => x.date)))].sort(), evs: Event[] = [];
  for (const d of dates) evs.push(...detect(prices, d, { ...o, extraFlags: [SURVIVOR] }, evs));
  const by = new Map<string, Event>(); for (const e of evs) by.set(e.id, e);
  return [...by.values()].map(e => outcomes(e, prices[e.sym]));
}

const toBar = (b: { time: number; open: number; high: number; low: number; close: number; volume: number }[]): Bar[] => b.filter(x => Math.min(x.open, x.high, x.low, x.close) > 0).map(x => ({ date: new Date(x.time * 1000).toISOString().slice(0, 10), open: x.open, high: x.high, low: x.low, close: x.close, volume: Math.trunc(x.volume) }));
export const study20Skill: Skill = {
  id: 'stockbee-20pct-study', name: '20% mover study (Stockbee)', group: 'Screeners', from: 'stockbee-20pct-study',
  desc: 'Stocks that moved 20% in 5 sessions: today\'s movers with pattern, close quality, extension risk and continuation/reversal scores, plus a backfill that follows past movers 1–20 days and groups them into cohorts (with rule candidates for review). A model book for research, not signals.',
  inputs: [...universeInputs(500), { key: 'backfill', label: 'Backfill sessions', type: 'number', default: 120, hint: '0 = today only' }, { key: 'down', label: 'Include −20% movers', type: 'bool', default: false }],
  async run(v, ctx: Ctx) {
    const { names, bars } = await stockUniverse(ctx, v, { max: 500 }), prices = Object.fromEntries([...bars].map(([s, b]) => [s, toBar(b)])), o = { ...STUDY_DEFAULTS, down: v.down === true };
    const today = detect(prices, null, o).sort((a, b) => b.scores.priority - a.scores.priority), n = Math.max(0, Math.min(400, Number(v.backfill) || 0));
    const past = n ? backfill(prices, n, o) : [], co = cohorts(past);
    const o5 = past.map(e => e.outcomes['5d']).filter((x): x is Outcome => x?.status === 'MATURED');
    return {
      verdict: { label: `${today.length} movers today · ${past.length} in the last ${n} sessions`, tone: today.length ? 'up' : 'muted', detail: o5.length ? `5-day directional win rate ${(o5.filter(x => x.dClose! > 0).length / o5.length * 100).toFixed(0)}% on ${o5.length} matured events.` : `${bars.size} stocks scanned.` },
      tables: [
        { title: 'Today\'s 20% movers', cols: ['Symbol', 'Name', '5-day', 'Day', 'Pattern', 'Close', 'Extension', 'Continuation', 'Reversal risk', 'Priority', 'Label'], rows: today.slice(0, 60).map(e => [e.sym, names.get(e.sym)?.name ?? '', `${e.ret.toFixed(1)}%`, `${e.dayRet.toFixed(1)}%`, e.pattern, e.closeQuality, e.extension, e.scores.continuation, e.scores.reversal, e.scores.priority, e.labels.at(-1)!]) },
        { title: 'Cohorts (5-day outcome)', cols: ['Direction', 'Pattern', 'Close', 'n', 'Win rate', 'Median', 'Median MFE', 'Median MAE', 'Rule'], rows: co.slice(0, 30).map(c => [c.group[0], c.group[2], c.group[3], c.n, `${(c.win * 100).toFixed(0)}%`, c.med == null ? '–' : `${c.med.toFixed(2)}%`, c.medMfe == null ? '–' : `${c.medMfe.toFixed(2)}%`, c.mae == null ? '–' : `${c.mae.toFixed(2)}%`, c.rule ?? '']) },
        { title: 'Past movers', cols: ['Symbol', 'Date', 'Dir', '5-day', 'Pattern', '1d', '5d', '20d', '5d outcome'], rows: [...past].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 80).map(e => { const f = (k: string) => { const x = e.outcomes[k]; return x?.status === 'MATURED' ? `${x.dClose!.toFixed(1)}%` : '…' }; return [e.sym, e.date, e.dir, `${e.ret.toFixed(1)}%`, e.pattern, f('1d'), f('5d'), f('20d'), e.outcomes['5d']?.tag ?? 'pending'] }) },
      ],
      notes: ['Catalysts are not classified here (no news feed), so every event is NO_CLEAR_NEWS; the backfill uses today\'s universe, which carries survivorship bias. A cohort becomes a rule candidate at ≥ 10 events with ≥ 58% wins and a ≥ 2% median, or an avoid/fade study at ≤ 42% and ≤ −2%.', 'Research and model book only — no buy or sell signals.'],
    };
  },
};
