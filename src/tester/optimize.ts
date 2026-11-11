// Parameter optimisation (grid / random / genetic), walk-forward analysis and Monte Carlo on trades.
// Pure functions over an Evaluate callback, so they run unchanged in a Web Worker and in node tests.
import { metrics } from './metrics.ts';
import type {
  Bar, BarRange, Evaluate, Metrics, MonteCarloOptions, MonteCarloResult, OptimizeOptions, OptResult, ParamSpec,
  TesterData, Trade, WalkForwardOptions, WalkForwardResult, WalkForwardSegment,
} from './types.ts';

/** Small deterministic RNG (mulberry32). */
function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Every value a parameter can take. Numeric ranges are inclusive and snapped to the step. */
export function values(p: ParamSpec): (string | number | boolean)[] {
  if (p.values?.length) return p.values;
  if (p.type === 'bool') return [false, true];
  const min = p.min ?? 0, max = p.max ?? min, step = p.step || (p.type === 'int' ? 1 : (max - min) / 10 || 1);
  const out: number[] = [];
  for (let i = 0, v = min; v <= max + step * 1e-9 && i < 10000; v = min + ++i * step) out.push(p.type === 'int' ? Math.round(v) : +v.toFixed(10));
  return [...new Set(out)];
}

/** Score a run: the objective metric, or null if it has too few trades or is not a number. */
function score(m: Metrics, o: Pick<OptimizeOptions, 'objective' | 'maximize' | 'minTrades'>) {
  const v = m[o.objective];
  if (m.totalTrades < (o.minTrades ?? 1) || !Number.isFinite(v)) return null;
  return o.maximize ? v : -v;
}

/** Returns valid results, best first. */
export function optimize(evaluate: Evaluate, bars: Bar[], params: ParamSpec[], base: Record<string, unknown>, o: OptimizeOptions): OptResult[] {
  const doms = params.map(values), slice = bars.slice(o.range.from, o.range.to), rand = rng(o.seed);
  const seen = new Map<string, OptResult | null>(), results: OptResult[] = [];
  let best: OptResult | undefined, done = 0;
  const gridSize = doms.reduce((a, d) => a * d.length, 1);
  const total = o.method === 'grid' ? Math.min(gridSize, o.maxRuns) : Math.min(o.maxRuns, gridSize);
  const run = (genes: number[]): OptResult | null => {
    const key = genes.join(',');
    if (seen.has(key)) return seen.get(key)!;
    const inputs = { ...base };
    params.forEach((p, i) => { inputs[p.name] = doms[i][genes[i]] });
    let r: OptResult | null = null;
    try {
      const m = metrics(evaluate(inputs, o.range), slice), s = score(m, o);
      if (s != null) { r = { inputs, metrics: m, score: s }; results.push(r); if (!best || s > best.score) best = r }
    } catch { /* a parameter combination the script rejects is just skipped */ }
    seen.set(key, r); done++;
    o.onProgress?.(done, total, best);
    return r;
  };
  const stop = () => done >= total || !!o.shouldStop?.();

  if (o.method === 'grid') {
    const g = doms.map(() => 0);
    while (!stop()) {
      run(g);
      let k = 0;
      while (k < g.length && ++g[k] >= doms[k].length) g[k++] = 0;
      if (k === g.length) break;
    }
  } else if (o.method === 'random') {
    let misses = 0;
    while (!stop() && misses < 1000) { const key = doms.map(d => Math.floor(rand() * d.length)); if (seen.has(key.join(','))) misses++; else run(key) }
  } else {
    // Genetic: tournament selection, uniform crossover, per-gene mutation. Fitness = score (null = worst).
    const pop = o.population ?? 20, gens = o.generations ?? 20, mut = o.mutation ?? 0.15;
    const fit = (g: number[]) => run(g)?.score ?? -Infinity;
    let popn = Array.from({ length: pop }, () => doms.map(d => Math.floor(rand() * d.length)));
    for (let gen = 0; gen < gens && !stop(); gen++) {
      const scored = popn.map(g => ({ g, f: fit(g) })).sort((a, b) => b.f - a.f);
      const pick = () => { const a = scored[Math.floor(rand() * pop)], b = scored[Math.floor(rand() * pop)]; return a.f >= b.f ? a.g : b.g };
      const next = scored.slice(0, Math.max(1, Math.floor(pop / 10))).map(s => s.g);   // elitism
      while (next.length < pop) {
        const a = pick(), b = pick();
        next.push(a.map((x, i) => (rand() < mut ? Math.floor(rand() * doms[i].length) : rand() < 0.5 ? x : b[i])));
      }
      popn = next;
    }
  }
  return results.sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : 0));
}

/** IS/OOS segments over a range. OOS pieces are contiguous and cover the end of the range. */
export function wfaSegments(range: BarRange, windows: number, isPct: number, anchored: boolean) {
  const total = range.to - range.from, w = total / (isPct + windows * (1 - isPct)), isLen = Math.round(w * isPct), oosLen = (total - isLen) / windows;
  return Array.from({ length: windows }, (_, k) => {
    const oosFrom = range.from + isLen + Math.round(k * oosLen), oosTo = k === windows - 1 ? range.to : range.from + isLen + Math.round((k + 1) * oosLen);
    return { is: { from: anchored ? range.from : oosFrom - isLen, to: oosFrom }, oos: { from: oosFrom, to: oosTo } };
  });
}

/** Re-base a run of evaluate() on [from, to) to absolute bar indices. */
const shift = (t: Trade, by: number): Trade => ({ ...t, entryBar: t.entryBar + by, exitBar: t.exitBar + by });

export function walkForward(evaluate: Evaluate, bars: Bar[], params: ParamSpec[], base: Record<string, unknown>, o: WalkForwardOptions): WalkForwardResult {
  const segs = wfaSegments(o.range, o.windows, o.isPct, o.anchored);
  const segments: WalkForwardSegment[] = [], oosTrades: Trade[] = [], oosEquity: { bar: number; value: number }[] = [];
  let cap = 0, value = 0, isRate = 0, oosRate = 0;
  segs.forEach((s, k) => {
    if (o.shouldStop?.()) return;
    o.onProgress?.(k, segs.length);
    const best = optimize(evaluate, bars, params, base, { ...o.optimize, range: s.is })[0];
    if (!best) return;
    // OOS runs over IS+OOS so indicators are warmed up; only trades entered inside the OOS part count.
    // shortcut: equity of a position opened in IS and closed in OOS leaks into OOS returns; split the run if that matters.
    const warm: BarRange = { from: s.is.from, to: s.oos.to }, off = s.oos.from - warm.from;
    const d = evaluate(best.inputs, warm);
    if (!cap) value = cap = d.initialCapital;
    const eq = d.equity, trades = d.trades.filter(t => t.entryBar >= off);
    let prev = eq[off - 1] ?? d.initialCapital;
    for (let i = off; i < warm.to - warm.from; i++) { const v = eq[i] ?? prev; value *= prev ? v / prev : 1; prev = v; oosEquity.push({ bar: warm.from + i, value }) }
    oosTrades.push(...trades.map(t => shift(t, warm.from)));
    const oosData: TesterData = { trades: trades.map(t => shift(t, -off)), equity: eq.slice(off), initialCapital: d.initialCapital, openPL: 0, openCount: 0 };
    const oosMetrics = metrics(oosData, bars.slice(s.oos.from, s.oos.to));
    segments.push({ is: s.is, oos: s.oos, best: best.inputs, isMetrics: best.metrics, oosMetrics });
    isRate += best.metrics.netProfitPct / (s.is.to - s.is.from);
    oosRate += oosMetrics.netProfitPct / (s.oos.to - s.oos.from);
  });
  o.onProgress?.(segs.length, segs.length);
  const from = segs[0]?.oos.from ?? o.range.from, slice = bars.slice(from, o.range.to);
  const eqArr: (number | undefined)[] = new Array(slice.length);
  for (const e of oosEquity) eqArr[e.bar - from] = e.value;
  const oosMetrics = metrics({ trades: oosTrades.map(t => shift(t, -from)), equity: eqArr, initialCapital: cap || 10000, openPL: 0, openCount: 0 }, slice);
  return { segments, oosEquity, efficiency: isRate ? oosRate / isRate : 0, oosMetrics };
}

const pct = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 0;
const quantiles = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { p5: pct(s, 0.05), p25: pct(s, 0.25), p50: pct(s, 0.5), p75: pct(s, 0.75), p95: pct(s, 0.95) } };

/** Equity path per trade (start = capital) and its max drawdown in %. */
function path(profits: number[], cap: number) {
  const p = [cap];
  let peak = cap, dd = 0;
  for (const x of profits) { const v = p[p.length - 1] + x; p.push(v); peak = Math.max(peak, v); dd = Math.max(dd, peak > 0 ? ((peak - v) / peak) * 100 : 0) }
  return { p, dd };
}

/** Reshuffle or resample the closed trades to see how much of the result is luck of ordering. */
export function monteCarlo(trades: Trade[], cap: number, o: MonteCarloOptions): MonteCarloResult {
  const rand = rng(o.seed), base = trades.map(t => t.profit), ruin = cap * (1 - o.ruinPct / 100);
  const finals: number[] = [], dds: number[] = [], paths: number[][] = [];
  let ruined = 0;
  for (let r = 0; r < o.runs; r++) {
    let seq: number[];
    if (o.method === 'bootstrap') seq = base.map(() => base[Math.floor(rand() * base.length)]);
    else { seq = [...base]; for (let i = seq.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [seq[i], seq[j]] = [seq[j], seq[i]] } }
    if (o.skipPct) seq = seq.filter(() => rand() >= o.skipPct! / 100);
    const { p, dd } = path(seq, cap);
    finals.push(p[p.length - 1]); dds.push(dd);
    if (p.reduce((m, x) => Math.min(m, x), Infinity) <= ruin) ruined++;
    if (paths.length < 50) paths.push(p);
  }
  const orig = path(base, cap);
  return { runs: o.runs, finalEquity: quantiles(finals), maxDrawdownPct: quantiles(dds), riskOfRuin: o.runs ? ruined / o.runs : 0, paths, original: { finalEquity: orig.p[orig.p.length - 1], maxDrawdownPct: orig.dd } };
}
