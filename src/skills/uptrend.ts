// uptrend-analyzer: US market health 0–100 from the Uptrend Ratio Dashboard (share of ~2,800 stocks in an uptrend,
// overall and per sector): breadth, sector participation, cyclical-vs-defensive rotation, momentum, history; plus the
// original's warning penalties (late cycle, high spread, divergence).
import { pct, pyRound, pyRound1, type Ctx, type Skill } from './types.ts';

export interface URow { ratio: number | null; slope: number | null; trend: string }
export interface Sector { Sector: string; Ratio: number | null; Trend: string; Slope: number | null }
const f = (v: string | undefined) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
export const toURow = (r: Record<string, string>): URow => ({ ratio: f(r.ratio), slope: f(r.slope), trend: r.trend ?? '' });
export const toSector = (r: Record<string, string>): Sector => ({ Sector: r.Sector, Ratio: f(r.Ratio), Trend: r.Trend ?? '', Slope: f(r.Slope) });
const clamp = (x: number) => Math.max(0, Math.min(100, x));

export function breadth(rows: URow[]) {
  const l = rows.at(-1);
  if (!l || l.ratio == null) return { score: 50, available: false };
  const r = l.ratio, base = r >= 0.5 ? Math.min(100, 90 + ((r - 0.5) / 0.1) * 10) : r >= 0.37 ? 70 + ((r - 0.37) / 0.13) * 19 : r >= 0.25 ? 40 + ((r - 0.25) / 0.12) * 29 : r >= 0.097 ? 10 + ((r - 0.097) / 0.153) * 29 : Math.max(0, (r / 0.097) * 9);
  const adj = l.trend.toLowerCase() === 'up' && l.slope != null && l.slope > 0 ? 5 : l.trend.toLowerCase() === 'down' && l.slope != null && l.slope < 0 ? -5 : 0;
  return { score: pyRound(clamp(base + adj)), available: true };
}
export function participation(s: Sector[]) {
  if (!s.length) return { score: 50, available: false, spread: null as number | null };
  const up = s.filter(x => x.Trend.toLowerCase() === 'up').length, rs = s.map(x => x.Ratio).filter((x): x is number => x != null), spread = rs.length ? Math.max(...rs) - Math.min(...rs) : null;
  const count = up >= 10 ? 100 : up >= 8 ? 80 : up >= 6 ? 60 : up >= 4 ? 40 : up >= 2 ? 20 : 0;
  const sp = spread == null ? 50 : spread < 0.15 ? 100 : spread < 0.25 ? 100 - ((spread - 0.15) / 0.1) * 20 : spread < 0.35 ? 80 - ((spread - 0.25) / 0.1) * 20 : spread < 0.45 ? 60 - ((spread - 0.35) / 0.1) * 30 : Math.max(0, 30 - ((spread - 0.45) / 0.1) * 30);
  return { score: pyRound(clamp(count * 0.6 + sp * 0.4)), available: true, spread, up };
}
const CYC = ['Technology', 'Consumer Cyclical', 'Communication Services', 'Financial', 'Industrials'], DEF = ['Utilities', 'Consumer Defensive', 'Healthcare', 'Real Estate'], COM = ['Energy', 'Basic Materials'];
export function rotation(s: Sector[]) {
  const m = new Map(s.map(x => [x.Sector, x])), grp = (names: string[]) => names.map(n => m.get(n)?.Ratio).filter((x): x is number => x != null), avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  const c = avg(grp(CYC)), d = avg(grp(DEF)), k = avg(grp(COM));
  if (c == null || d == null) return { score: 50, available: false, late: false, divergence: false };
  const diff = c - d, base = diff > 0.15 ? Math.min(100, 90 + ((diff - 0.15) / 0.1) * 10) : diff > 0.05 ? 70 + ((diff - 0.05) / 0.1) * 19 : diff > -0.05 ? 45 + ((diff + 0.05) / 0.1) * 24 : diff > -0.15 ? 20 + ((diff + 0.15) / 0.1) * 24 : Math.max(0, 19 + ((diff + 0.15) / 0.1) * 19);
  const late = k != null && k > c && k > d, commodity = late ? (k! - Math.max(c, d) > 0.1 ? -10 : -5) : 0;
  const flagged = (names: string[]) => {
    const xs = names.map(n => m.get(n)).filter((x): x is Sector => !!x && x.Ratio != null);
    if (xs.length < 2) return false;
    const r = xs.map(x => x.Ratio!), mu = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / r.length);
    const t = xs.map(x => x.Trend.toLowerCase()), maj = t.filter(x => x === 'up').length >= t.filter(x => x === 'down').length ? 'up' : 'down';
    return sd > 0.08 || Math.max(...r) - Math.min(...r) > 0.2 || t.some(x => x && x !== maj);
  };
  const divergence = flagged(CYC) || flagged(DEF);
  return { score: pyRound(clamp(base + commodity + (divergence ? -5 : 0))), available: true, late, divergence, diff };
}
const ema = (v: number[], span = 3) => { const a = 2 / (span + 1), out = [v[0]]; for (let i = 1; i < v.length; i++) out.push(a * v[i] + (1 - a) * out[i - 1]); return v.length ? out : [] };
export function momentum(rows: URow[], s: Sector[]) {
  if (!rows.length) return { score: 50, available: false };
  const slopes = rows.map(r => r.slope).filter((x): x is number => x != null), sm = ema(slopes), eff = sm.at(-1) ?? rows.at(-1)!.slope;
  const ss = eff == null ? 50 : eff >= 0.02 ? Math.min(100, 95 + ((eff - 0.02) / 0.01) * 5) : eff >= 0.01 ? 75 + ((eff - 0.01) / 0.01) * 19 : eff >= 0 ? 55 + (eff / 0.01) * 19 : eff >= -0.01 ? 35 + ((eff + 0.01) / 0.01) * 19 : eff >= -0.02 ? 10 + ((eff + 0.02) / 0.01) * 24 : Math.max(0, 9 + ((eff + 0.02) / 0.01) * 9);
  const cls = (a: number) => (a > 0.005 ? 90 : a > 0.001 ? 75 : a > -0.001 ? 50 : a > -0.005 ? 25 : 10);
  const accel = (x: number[], w: number) => (x.length < w * 2 ? 50 : cls(x.slice(-w).reduce((a, b) => a + b, 0) / w - x.slice(-2 * w, -w).reduce((a, b) => a + b, 0) / w));
  const as = sm.length >= 20 ? accel(sm, 10) : accel(sm, 5);
  const bs = s.length ? (100 * s.filter(x => x.Slope != null && x.Slope > 0).length) / s.length : 50;
  return { score: pyRound(clamp(ss * 0.5 + as * 0.3 + bs * 0.2)), available: true };
}
export function history(rows: URow[]) {
  const r = rows.map(x => x.ratio).filter((x): x is number => x != null);
  if (r.length < 2) return { score: 50, available: false };
  const cur = r.at(-1)!, p = pyRound1(((r.filter(x => x < cur).length + r.filter(x => x === cur).length * 0.5) / r.length) * 100);
  return { score: pyRound(clamp(p)), available: true, percentile: p };
}
export const UWEIGHTS = { breadth: 0.3, participation: 0.25, rotation: 0.15, momentum: 0.2, history: 0.1 };
export function uptrendScore(scores: Record<keyof typeof UWEIGHTS, number>, warn: { late: boolean; spread: boolean; divergence: boolean }) {
  const raw = pyRound1((Object.keys(UWEIGHTS) as (keyof typeof UWEIGHTS)[]).reduce((s, k) => s + scores[k] * UWEIGHTS[k], 0));
  const flags = [warn.late && -5, warn.spread && -3, warn.divergence && -3].filter((x): x is number => typeof x === 'number');
  const penalty = flags.reduce((a, b) => a + b, 0) + (flags.length >= 2 ? 1 : 0), score = pyRound1(clamp(raw + penalty));
  const zone = score >= 80 ? 'Strong Bull' : score >= 60 ? 'Bull' : score >= 40 ? 'Neutral' : score >= 20 ? 'Cautious' : 'Bear';
  const exposure = score >= 80 ? '100%' : score >= 60 ? '80–100%' : score >= 40 ? '60–80%' : score >= 20 ? '30–60%' : '0–30%';
  return { raw, penalty, score, zone, exposure };
}

export const uptrendSkill: Skill = {
  id: 'uptrend-analyzer', name: 'US uptrend ratio (0–100)', group: 'Market regime', from: 'uptrend-analyzer',
  desc: 'Share of ~2,800 US stocks in an uptrend, overall and in 11 sectors: breadth, sector participation, cyclical-vs-defensive rotation, momentum and history, with warning penalties and an exposure band. Data: Uptrend Ratio Dashboard (public).',
  inputs: [],
  async run(_v, ctx: Ctx) {
    const d = await ctx.json<{ all: Record<string, string>[]; sectors: Record<string, string>[] }>('/api/uptrend'), rows = d.all.map(toURow), sec = d.sectors.map(toSector);
    const b = breadth(rows), p = participation(sec), r = rotation(sec), m = momentum(rows, sec), h = history(rows);
    const s = uptrendScore({ breadth: b.score, participation: p.score, rotation: r.score, momentum: m.score, history: h.score }, { late: r.late, spread: p.spread != null && p.spread > 0.4, divergence: r.divergence });
    return {
      verdict: { label: `${s.zone} · ${s.score}`, tone: s.score >= 60 ? 'up' : s.score >= 40 ? 'warn' : 'dn', detail: `equity exposure ${s.exposure}${s.penalty ? `; warning penalty ${s.penalty}` : ''}` },
      kpis: [{ label: 'Uptrend ratio', value: pct((rows.at(-1)?.ratio ?? NaN) * 100, 1) }, { label: 'Sectors in uptrend', value: `${p.up ?? '–'} / ${sec.length}` }, { label: 'Cyclical − defensive', value: r.diff != null ? pct(r.diff * 100, 1) : '–' }],
      tables: [{ title: 'Components', cols: ['Component', 'Weight', 'Score'], rows: [['Market breadth', '30%', b.score], ['Sector participation', '25%', p.score], ['Sector rotation', '15%', r.score], ['Momentum', '20%', m.score], ['Historical context', '10%', h.score]] },
        { title: 'Sectors', cols: ['Sector', 'Uptrend ratio', 'Trend', 'Slope'], rows: [...sec].sort((a, z) => (z.Ratio ?? 0) - (a.Ratio ?? 0)).map(x => [x.Sector, x.Ratio != null ? pct(x.Ratio * 100, 1) : '–', x.Trend, x.Slope?.toFixed(4) ?? '–']) }],
      notes: [r.late ? 'Late-cycle warning: commodities lead both groups.' : '', r.divergence ? 'Divergence inside the cyclical or defensive group.' : ''].filter(Boolean),
    };
  },
};

// ---------- sector-analyst: same data, sector ranking and the cycle phase it suggests ----------
const PHASES: Record<string, { leaders: string[]; laggards: string[] }> = {
  early: { leaders: ['Technology', 'Consumer Cyclical', 'Industrials', 'Financial'], laggards: ['Utilities', 'Consumer Defensive', 'Healthcare'] },
  mid: { leaders: ['Technology', 'Industrials', 'Consumer Cyclical', 'Energy'], laggards: ['Utilities', 'Consumer Defensive'] },
  late: { leaders: ['Energy', 'Basic Materials', 'Healthcare'], laggards: ['Technology', 'Consumer Cyclical', 'Industrials'] },
  recession: { leaders: ['Utilities', 'Consumer Defensive', 'Healthcare'], laggards: ['Technology', 'Consumer Cyclical', 'Industrials', 'Financial'] },
};
/** Which phase's leaders rank high and laggards low (and trend that way): 40% leaders, 30% laggards, 30% trends. */
export function cyclePhase(s: Sector[]) {
  const ok = s.filter(x => x.Ratio != null).sort((a, b) => b.Ratio! - a.Ratio!), n = ok.length;
  if (!n) return { phase: 'unknown', confidence: 'low', scores: {} as Record<string, number> };
  const top = new Set(ok.slice(0, Math.floor(n / 2) + 1).map(x => x.Sector)), bottom = new Set(ok.slice(Math.floor(n / 2)).map(x => x.Sector)), trend = new Map(ok.map(x => [x.Sector, x.Trend.toLowerCase()]));
  const scores: Record<string, number> = {};
  for (const [k, p] of Object.entries(PHASES)) {
    let hit = 0, tot = 0;
    for (const x of p.leaders) if (trend.has(x)) { tot++; if (trend.get(x) === 'up') hit++ }
    for (const x of p.laggards) if (trend.has(x)) { tot++; if (trend.get(x) === 'down') hit++ }
    scores[k] = pyRound1((p.leaders.filter(x => top.has(x)).length / p.leaders.length * 0.4 + p.laggards.filter(x => bottom.has(x)).length / p.laggards.length * 0.3 + (tot ? hit / tot : 0) * 0.3) * 100);
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]), gap = sorted[0][1] - (sorted[1]?.[1] ?? 0);
  return { phase: sorted[0][0], confidence: gap > 20 ? 'high' : gap > 10 ? 'moderate' : 'low', scores };
}
export const sectorSkill: Skill = {
  id: 'sector-analyst', name: 'US sector rotation', group: 'Market regime', from: 'sector-analyst',
  desc: 'Ranks the 11 US sectors by their share of stocks in an uptrend, flags overbought (> 37%) and oversold (< 9.7%) sectors, scores cyclical vs defensive risk appetite, and estimates the economic-cycle phase the leadership suggests.',
  inputs: [],
  async run(_v, ctx: Ctx) {
    const sec = (await ctx.json<{ sectors: Record<string, string>[] }>('/api/uptrend')).sectors.map(toSector).filter(x => x.Ratio != null);
    const r = rotation(sec), c = cyclePhase(sec), regime = r.score >= 90 ? 'strong risk-on' : r.score >= 70 ? 'risk-on' : r.score >= 45 ? 'balanced' : r.score >= 20 ? 'defensive tilt' : 'strong risk-off';
    return {
      verdict: { label: `${regime} · ${r.score}`, tone: r.score >= 70 ? 'up' : r.score >= 45 ? 'warn' : 'dn', detail: `cycle phase: ${c.phase} (${c.confidence} confidence)` },
      kpis: Object.entries(c.scores).map(([k, s]) => ({ label: `${k} phase fit`, value: s })),
      tables: [{ title: 'Sectors by uptrend ratio', cols: ['#', 'Sector', 'Ratio', 'Trend', 'Zone'], rows: [...sec].sort((a, b) => b.Ratio! - a.Ratio!).map((x, i) => [i + 1, x.Sector, pct(x.Ratio! * 100, 1), x.Trend, x.Ratio! > 0.37 ? 'overbought' : x.Ratio! < 0.097 ? 'oversold' : '']) }],
      notes: [r.late ? 'Late-cycle warning: commodities lead both groups.' : '', r.divergence ? 'Divergence inside the cyclical or defensive group.' : ''].filter(Boolean),
    };
  },
};
