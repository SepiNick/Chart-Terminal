// residual-edge-analyzer: is a strategy's return real edge or just baseline exposure? OLS of strategy returns on
// baseline returns (e.g. BTC, ETH) with Newey–West (HAC) errors, residual edge ratio, rolling alpha stability, and the
// original's four statuses. Strategy returns: the journal's daily P&L ÷ account, or a pasted series.
import { num, pct, type Ctx, type Skill } from './types.ts';

/** Gauss–Jordan inverse of a small symmetric matrix; throws when singular. */
function inverse(m: number[][]): number[][] {
  const n = m.length, a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-14) throw new Error('Baseline returns are collinear or constant');
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c]; for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j] }
  }
  return a.map(r => r.slice(n));
}
const mul = (a: number[][], b: number[][]) => a.map(r => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)) };
export const hacLags = (n: number) => Math.max(0, Math.floor(4 * (n / 100) ** (2 / 9)));

/** Intercept OLS with Newey–West covariance (small-sample correction n/(n−k)), like the original fit_regression. */
export function fit(y: number[], xs: number[][], lags?: number) {
  const n = y.length, k = xs.length + 1;
  if (xs.some(c => c.length !== n)) throw new Error('All series need the same length');
  if (n <= k) throw new Error('Too few observations');
  const X = y.map((_, i) => [1, ...xs.map(c => c[i])]), XtX = X[0].map((_, a) => X[0].map((_, b) => X.reduce((s, r) => s + r[a] * r[b], 0))), inv = inverse(XtX);
  const Xty = X[0].map((_, a) => X.reduce((s, r, i) => s + r[a] * y[i], 0)), beta = inv.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const fitted = X.map(r => r.reduce((s, v, j) => s + v * beta[j], 0)), res = y.map((v, i) => v - fitted[i]);
  const L = Math.min(Math.max(0, lags ?? hacLags(n)), n - 1), meat = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += res[i] ** 2 * X[i][a] * X[i][b];
  for (let l = 1; l <= L; l++) { const w = 1 - l / (L + 1); for (let i = l; i < n; i++) { const p = res[i] * res[i - l]; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += w * p * (X[i][a] * X[i - l][b] + X[i - l][a] * X[i][b]) } }
  const cov = mul(mul(inv, meat.map(r => r.map(v => (v * n) / Math.max(1, n - k)))), inv), se = cov.map((r, i) => Math.sqrt(Math.max(0, r[i])));
  const my = mean(y), ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0), r2 = ssTot ? 1 - res.reduce((s, v) => s + v * v, 0) / ssTot : 0;
  return { alpha: beta[0], betas: beta.slice(1), t: se.map((s, i) => (s ? beta[i] / s : null)), r2, residVol: sd(res), lags: L, n };
}

export const THRESH = { r2Explained: 0.75, weakEdge: 0.5, edgeMin: 0.75, tMin: 2, rollingPos: 0.6, minWindows: 12 };
export function residualEdge(y: number[], xs: number[][], af = 252, window = 63, minObs = 60) {
  const effMin = Math.max(minObs, 10 * (xs.length + 1));
  if (y.length < effMin) return { status: 'INSUFFICIENT_EVIDENCE' as const, reasons: [`${y.length} observations, ${effMin} needed`] };
  const f = fit(y, xs), edge = f.residVol ? (f.alpha * af) / (f.residVol * Math.sqrt(af)) : null, tA = f.t[0];
  // rolling refits: each window's annualized alpha; fails closed with too few windows
  let rolling: { windows: number; positive: number } | null = null, rollReason = '';
  if (window < Math.max(20, 5 * (xs.length + 1))) rollReason = 'rolling window too short for this model';
  else if (y.length < window + THRESH.minWindows - 1) rollReason = `only ${Math.max(0, y.length - window + 1)} rolling windows fit; ${THRESH.minWindows} required`;
  else {
    let pos = 0, wins = 0;
    for (let e = window; e <= y.length; e++) { const w = fit(y.slice(e - window, e), xs.map(c => c.slice(e - window, e))); wins++; if (w.alpha > 0) pos++ }
    rolling = { windows: wins, positive: pos / wins };
  }
  const reasons: string[] = [];
  let status: 'RESIDUAL_EDGE' | 'BASELINE_EXPLAINED' | 'RESIDUAL_FRAGILE';
  if (!rolling) { status = 'RESIDUAL_FRAGILE'; reasons.push(`Rolling stability unavailable: ${rollReason}`) }
  else if (edge != null && tA != null && edge >= THRESH.edgeMin && tA >= THRESH.tMin && rolling.positive >= THRESH.rollingPos) { status = 'RESIDUAL_EDGE'; reasons.push('Alpha, residual edge ratio and rolling stability clear the thresholds') }
  else if (f.r2 >= THRESH.r2Explained && (edge == null || Math.abs(edge) <= THRESH.weakEdge) && (tA == null || Math.abs(tA) < THRESH.tMin)) { status = 'BASELINE_EXPLAINED'; reasons.push('The baselines explain most of the variation and the residual edge is weak') }
  else { status = 'RESIDUAL_FRAGILE'; reasons.push('Residual evidence does not clear every robustness threshold'); if (rolling.positive < THRESH.rollingPos) reasons.push('Rolling alpha is positive in too few windows') }
  return { status, reasons, fit: f, edge, annAlpha: f.alpha * af, rolling };
}

/** Daily returns keyed by UTC day from bars. */
const dailyReturns = (bars: { time: number; close: number }[]) => new Map(bars.slice(1).map((b, i) => [new Date(b.time * 1000).toISOString().slice(0, 10), b.close / bars[i].close - 1]));

export const residualSkill: Skill = {
  id: 'residual-edge-analyzer', name: 'Residual edge (alpha vs baseline)', group: 'Journal & review', from: 'residual-edge-analyzer',
  desc: 'Separates a strategy\'s daily returns into baseline exposure (e.g. BTC, ETH) and residual alpha: OLS with Newey–West errors, residual edge ratio and rolling stability. Strategy returns from the journal (daily P&L ÷ account) or pasted.',
  inputs: [
    { key: 'source', label: 'Strategy returns', type: 'select', options: ['Journal daily P&L', 'Pasted (date,return per line)'], default: 'Journal daily P&L' },
    { key: 'pasted', label: 'Pasted returns', type: 'symbols', optional: true, hint: '2026-01-02,0.004 per line (decimal returns)' },
    { key: 'account', label: 'Account (journal)', type: 'number', optional: true },
    { key: 'baselines', label: 'Baseline symbols', type: 'text', default: 'BTCUSDT' },
    { key: 'af', label: 'Periods per year', type: 'number', default: 365 },
    { key: 'window', label: 'Rolling window (days)', type: 'number', default: 63 },
  ],
  async run(v, ctx: Ctx) {
    let strat = new Map<string, number>();
    if (String(v.source).startsWith('Pasted')) {
      for (const line of String(v.pasted ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) { const [d, r] = line.split(/[,;\s]+/); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Bad date: ${d}`); strat.set(d, num(r, `Return on ${d}`)) }
    } else {
      const acct = num(v.account, 'Account', { optional: true }), eq = Number.isFinite(acct) && acct > 0 ? acct : ctx.account().equity;
      for (const t of ctx.trades()) if (t.status === 'closed' && t.closeTime) { const d = new Date(t.closeTime * 1000).toISOString().slice(0, 10); strat.set(d, (strat.get(d) ?? 0) + t.net / eq) }
    }
    const syms = String(v.baselines ?? '').split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase());
    if (!syms.length) throw new Error('Give at least one baseline symbol');
    const base = await Promise.all(syms.map(async s => dailyReturns(await ctx.bars(s, '1d'))));
    const days = [...base[0].keys()].filter(d => base.every(b => b.has(d))).sort();
    if (!String(v.source).startsWith('Pasted')) { const first = [...strat.keys()].sort()[0]; strat = new Map(days.filter(d => !first || d >= first).map(d => [d, strat.get(d) ?? 0])) }   // a day without closed trades is a 0% day
    const used = days.filter(d => strat.has(d)), y = used.map(d => strat.get(d)!), xs = base.map(b => used.map(d => b.get(d)!));
    const r = residualEdge(y, xs, num(v.af, 'Periods per year', { min: 1 }), num(v.window, 'Window', { min: 0 }));
    if (r.status === 'INSUFFICIENT_EVIDENCE') return { verdict: { label: 'Insufficient evidence', tone: 'muted', detail: r.reasons.join('; ') } };
    return {
      verdict: { label: r.status.replace(/_/g, ' '), tone: r.status === 'RESIDUAL_EDGE' ? 'up' : r.status === 'BASELINE_EXPLAINED' ? 'warn' : 'dn', detail: r.reasons.join('; ') },
      kpis: [{ label: 'Annualized alpha', value: pct(r.annAlpha * 100) }, { label: 'Alpha t (HAC)', value: r.fit!.t[0]?.toFixed(2) ?? '–' }, { label: 'Residual edge ratio', value: r.edge?.toFixed(2) ?? '–' }, { label: 'R²', value: r.fit!.r2.toFixed(3) },
        ...syms.map((s, i) => ({ label: `β ${s}`, value: r.fit!.betas[i].toFixed(3) })), { label: 'Rolling alpha > 0', value: r.rolling ? `${pct(r.rolling.positive * 100, 0)} of ${r.rolling.windows}` : '–' }, { label: 'Days', value: r.fit!.n }],
      notes: ['Statistics describe the past sample; they do not promise future edge.'],
    };
  },
};
