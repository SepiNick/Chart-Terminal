// pair-trade-screener: cointegrated stock pairs. Correlation ≥ 0.70, hedge ratio by OLS, Engle-Granger spread
// tested with the Augmented Dickey-Fuller test (statsmodels' adfuller: maxlag 1, constant, lag chosen by AIC,
// MacKinnon p-value and critical values), AR(1) half-life and the 90-day z-score: |z| > 2 → long/short the spread.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';

/** Standard normal CDF to ~1e-14: erf series near 0, erfc continued fraction in the tails. */
export function ncdf(x: number) {
  const z = Math.abs(x) / Math.SQRT2;
  let erfc: number;
  if (z < 3) { let t = z, s = z; for (let n = 1; n < 200; n++) { t *= -z * z / n; const d = t / (2 * n + 1); s += d; if (Math.abs(d) < 1e-17 * Math.abs(s)) break } erfc = 1 - 2 / Math.sqrt(Math.PI) * s }
  else { let f = z, C = z, D = 0; for (let n = 1; n < 300; n++) { const a = n / 2; D = z + a * D; D = 1 / D; C = z + a / C; const del = C * D; f *= del; if (Math.abs(del - 1) < 1e-16) break } erfc = Math.exp(-z * z) / Math.sqrt(Math.PI) / f }
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}
/** OLS by normal equations; returns coefficients, their t-values, SSR and n. */
function ols(y: number[], X: number[][]) {
  const n = y.length, k = X[0].length, A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0))), b = Array.from({ length: k }, (_, i) => X.reduce((s, r, t) => s + r[i] * y[t], 0));
  const inv = A.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => +(i === j))]);   // Gauss-Jordan inverse
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(inv[r][c]) > Math.abs(inv[p][c])) p = r; [inv[c], inv[p]] = [inv[p], inv[c]]; const d = inv[c][c]; for (let j = 0; j < 2 * k; j++) inv[c][j] /= d; for (let r = 0; r < k; r++) if (r !== c) { const f = inv[r][c]; for (let j = 0; j < 2 * k; j++) inv[r][j] -= f * inv[c][j] } }
  const Ai = inv.map(r => r.slice(k)), beta = Ai.map(r => r.reduce((s, v, j) => s + v * b[j], 0)), ssr = y.reduce((s, v, t) => s + (v - X[t].reduce((a, x, j) => a + x * beta[j], 0)) ** 2, 0), s2 = ssr / (n - k);
  return { beta, t: beta.map((v, i) => v / Math.sqrt(s2 * Ai[i][i])), ssr, n, k, aic: n * (Math.log(2 * Math.PI) + Math.log(ssr / n) + 1) + 2 * k };
}
const CRIT_C: number[][] = [[-3.43035, -6.5393, -16.786, -79.433], [-2.86154, -2.8903, -4.234, -40.04], [-2.56677, -1.5384, -2.809, 0]];
function mackinnonp(t: number) {
  if (t > 2.74) return 1; if (t < -18.83) return 0;
  const c = t <= -1.61 ? [2.1659, 1.4412, 3.8269 * 1e-2] : [1.7339, 9.3202 * 1e-1, -1.2745 * 1e-1, -1.0368 * 1e-2];
  return ncdf(c.reduce((s, v, i) => s + v * t ** i, 0));
}
/** statsmodels adfuller(x, maxlag=1, regression="c", autolag="AIC"). */
export function adf(x: number[], maxlag = 1) {
  const d = x.slice(1).map((v, i) => v - x[i]), rows = (L: number) => d.slice(L).map((_, r) => { const j = L + r; return { y: d[j], lev: x[j], lags: Array.from({ length: L }, (_, q) => d[j - 1 - q]) } });
  const full = rows(maxlag); let best = Infinity, bl = 0;
  for (let k = 2; k <= 2 + maxlag; k++) { const f = ols(full.map(r => r.y), full.map(r => [1, r.lev, ...r.lags].slice(0, k))); if (f.aic < best) { best = f.aic; bl = k } }
  const lag = bl - 2, rr = rows(lag), f = ols(rr.map(r => r.y), rr.map(r => [r.lev, ...r.lags.slice(0, lag), 1])), stat = f.t[0], n = rr.length;
  return { stat, p: mackinnonp(stat), lag, nobs: n, crit: CRIT_C.map(b => b[0] + b[1] / n + b[2] / n ** 2 + b[3] / n ** 3) };
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) };
function corr(a: number[], b: number[]) { const ma = mean(a), mb = mean(b); let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2 } return c / Math.sqrt(va * vb) }
function linreg(x: number[], y: number[]) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 } const slope = sxy / sxx; return { slope, intercept: my - slope * mx } }
function halfLife(s: number[]) { const f = ols(s.slice(1), s.slice(0, -1).map(v => [1, v])), phi = f.beta[1]; return phi >= 1 || phi <= 0 ? null : -Math.log(2) / Math.log(phi) }
function zNow(s: number[], w = 90) { const t = s.slice(-Math.min(w, s.length)), q = sd(t); return !Number.isFinite(q) || q === 0 ? null : (s.at(-1)! - mean(t)) / q }
export type Series = Map<string, number>;   // date → close
function align(a: Series, b: Series) { const ds = [...a.keys()].filter(d => b.has(d) && Number.isFinite(a.get(d)!) && Number.isFinite(b.get(d)!)).sort(); return [ds.map(d => a.get(d)!), ds.map(d => b.get(d)!), ds] as const }
function analyzePair(A: string, B: string, sa: Series, sb: Series, minCorr = 0.7) {
  const [a, b] = align(sa, sb); if (a.length < 100) return null;
  const c = corr(a, b); if (!Number.isFinite(c) || c < minCorr) return null;
  if (new Set(a).size < 2 || new Set(b).size < 2) return null;
  const { slope: beta } = linreg(b, a), spread = a.map((v, i) => v - beta * b[i]), t = adf(spread), coint = t.p < 0.05;
  const hl = coint ? halfLife(spread) : null, z = zNow(spread);
  return { pair: `${A}/${B}`, a: A, b: B, corr: pyRoundN(c, 4), beta: pyRoundN(beta, 4), p: pyRoundN(t.p, 4), stat: pyRoundN(t.stat, 4), crit5: pyRoundN(t.crit[1], 4), coint, halfLife: hl ? pyRoundN(hl, 1) : null, z: z != null ? pyRoundN(z, 2) : null, signal: z != null && z > 2 ? 'SHORT' : z != null && z < -2 ? 'LONG' : 'NONE', strength: t.p < 0.01 ? '★★★' : t.p < 0.05 ? '★★' : '☆' };
}
export function screenPairs(data: Map<string, Series>, minCorr = 0.7) {
  const syms = [...data.keys()], out: NonNullable<ReturnType<typeof analyzePair>>[] = [];
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) { const r = analyzePair(syms[i], syms[j], data.get(syms[i])!, data.get(syms[j])!, minCorr); if (r?.coint) out.push(r) }
  return out.sort((x, y) => x.p - y.p || Math.abs(y.z ?? 0) - Math.abs(x.z ?? 0));
}

export const pairsSkill: Skill = {
  id: 'pair-trade-screener', name: 'Pair trades (cointegration)', group: 'Screeners', from: 'pair-trade-screener',
  desc: 'Market-neutral pairs: correlated stocks (≥ 0.70) whose OLS spread is cointegrated (ADF p < 0.05), with hedge ratio, half-life and the 90-day z-score — beyond ±2 the spread is stretched (short the rich leg, long the cheap one). Give a sector or your own symbols.',
  inputs: [
    { key: 'sector', label: 'Sector', type: 'select', options: ['Technology', 'Finance', 'Health Care', 'Energy', 'Industrials', 'Consumer Discretionary', 'Consumer Staples', 'Utilities', 'Real Estate', 'Basic Materials', 'Telecommunications'], default: 'Technology' },
    { key: 'max', label: 'Largest stocks in the sector', type: 'number', default: 30, hint: 'pairs grow as n²' },
    { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
    { key: 'minCorr', label: 'Minimum correlation', type: 'number', default: 0.7 },
  ],
  async run(v, ctx: Ctx) {
    const custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    const syms = custom.length >= 2 ? [...new Set(custom)] : (await ctx.json<Stock[]>('/api/us-stocks')).filter(s => s.sector === String(v.sector) && s.cap >= 2e9).slice(0, Math.min(60, Math.max(2, Number(v.max) || 30))).map(s => s.sym);
    const bars = await barsMany(ctx, syms), data = new Map<string, Series>();
    for (const [s, b] of bars) if (b.length >= 250) data.set(s, new Map(b.slice(-730).map(k => [new Date(k.time * 1000).toISOString().slice(0, 10), k.close])));
    if (data.size < 2) throw new Error('Need at least two stocks with 250+ days of history');
    const res = screenPairs(data, Number(v.minCorr) || 0.7), live = res.filter(r => r.signal !== 'NONE');
    return {
      verdict: { label: `${res.length} cointegrated pairs · ${live.length} with a signal`, tone: live.length ? 'up' : 'muted', detail: `${data.size} stocks, ${data.size * (data.size - 1) / 2} pairs tested.` },
      tables: [{ title: 'Cointegrated pairs', cols: ['Pair', 'Strength', 'p-value', 'ADF', '5% crit', 'Correlation', 'Hedge ratio β', 'Half-life (days)', 'z-score', 'Signal'], rows: res.slice(0, 50).map(r => [r.pair, r.strength, r.p, r.stat, r.crit5, r.corr, r.beta, r.halfLife ?? '–', r.z ?? '–', r.signal === 'SHORT' ? `short ${r.a} / long ${r.b}` : r.signal === 'LONG' ? `long ${r.a} / short ${r.b}` : '']) }],
      notes: ['Spread = A − β·B. Size the legs dollar-neutral by β (e.g. $5,000 in A and β × $5,000 in B); exit near z = 0, and re-test cointegration before trading — relationships break. Closes are split-adjusted only.', 'No order is placed.'],
    };
  },
};
