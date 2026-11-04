// options-strategy-advisor: Black-Scholes(-Merton) prices and Greeks, historical volatility from the app's own bars,
// and P/L at expiry of common multi-leg strategies (max profit/loss, breakevens). Educational: no option quotes.
import { money, num, pct, type Skill } from './types.ts';

const cdf = (x: number) => { // Abramowitz–Stegun 7.1.26 via erf, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};
const pdf = (x: number) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);

export interface BsIn { S: number; K: number; T: number; r: number; sigma: number; q?: number }
/** Price and Greeks (vega and rho per 1 point, theta per day), like the original OptionPricer. */
export function bs(p: BsIn, type: 'call' | 'put') {
  const { S, K, T, r, sigma } = p, q = p.q ?? 0;
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) throw new Error('Price, strike, time and volatility must be positive');
  const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + sigma ** 2 / 2) * T) / (sigma * sq), d2 = d1 - sigma * sq, eq = Math.exp(-q * T), er = Math.exp(-r * T);
  const call = type === 'call', theta1 = (-S * pdf(d1) * sigma * eq) / (2 * sq);
  return {
    price: Math.max(0, call ? S * eq * cdf(d1) - K * er * cdf(d2) : K * er * cdf(-d2) - S * eq * cdf(-d1)),
    delta: call ? eq * cdf(d1) : eq * (cdf(d1) - 1),
    gamma: (eq * pdf(d1)) / (S * sigma * sq),
    vega: (S * eq * pdf(d1) * sq) / 100,
    theta: (call ? theta1 - r * K * er * cdf(d2) + q * S * cdf(d1) * eq : theta1 + r * K * er * cdf(-d2) - q * S * cdf(-d1) * eq) / 365,
    rho: (call ? K * T * er * cdf(d2) : -K * T * er * cdf(-d2)) / 100,
  };
}
/** Annualized close-to-close volatility of the last `window` returns (`periods` per year: 252 stocks, 365 crypto). */
export function histVol(closes: number[], window = 30, periods = 252) {
  const rs = closes.slice(-window - 1).map((c, i, a) => (i ? Math.log(c / a[i - 1]) : NaN)).slice(1);
  if (rs.length < 2) throw new Error('Not enough history for volatility');
  const m = rs.reduce((s, x) => s + x, 0) / rs.length;
  return Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (rs.length - 1) * periods);
}

export interface Leg { kind: 'call' | 'put' | 'stock'; side: 1 | -1; K?: number; qty: number }
const STRATEGIES: Record<string, (k: number[], S: number) => Leg[]> = {
  'Long call': k => [{ kind: 'call', side: 1, K: k[0], qty: 1 }],
  'Long put': k => [{ kind: 'put', side: 1, K: k[0], qty: 1 }],
  'Covered call': k => [{ kind: 'stock', side: 1, qty: 100 }, { kind: 'call', side: -1, K: k[0], qty: 1 }],
  'Protective put': k => [{ kind: 'stock', side: 1, qty: 100 }, { kind: 'put', side: 1, K: k[0], qty: 1 }],
  'Bull call spread': k => [{ kind: 'call', side: 1, K: k[0], qty: 1 }, { kind: 'call', side: -1, K: k[1], qty: 1 }],
  'Bear put spread': k => [{ kind: 'put', side: 1, K: k[1], qty: 1 }, { kind: 'put', side: -1, K: k[0], qty: 1 }],
  'Long straddle': k => [{ kind: 'call', side: 1, K: k[0], qty: 1 }, { kind: 'put', side: 1, K: k[0], qty: 1 }],
  'Long strangle': k => [{ kind: 'put', side: 1, K: k[0], qty: 1 }, { kind: 'call', side: 1, K: k[1], qty: 1 }],
  'Iron condor': k => [{ kind: 'put', side: 1, K: k[0], qty: 1 }, { kind: 'put', side: -1, K: k[1], qty: 1 }, { kind: 'call', side: -1, K: k[2], qty: 1 }, { kind: 'call', side: 1, K: k[3], qty: 1 }],
  'Call butterfly': k => [{ kind: 'call', side: 1, K: k[0], qty: 1 }, { kind: 'call', side: -1, K: k[1], qty: 2 }, { kind: 'call', side: 1, K: k[2], qty: 1 }],
};
const NEEDS: Record<string, number> = { 'Bull call spread': 2, 'Bear put spread': 2, 'Long strangle': 2, 'Iron condor': 4, 'Call butterfly': 3 };

/** Legs priced at S; P/L at expiry per share-equivalent (option legs × 100 like the original). */
export function analyzeStrategy(name: string, strikes: number[], p: Omit<BsIn, 'K'>) {
  const need = NEEDS[name] ?? 1;
  if (strikes.length < need || strikes.some(k => !(k > 0))) throw new Error(`${name} needs ${need} strike${need > 1 ? 's' : ''}, lowest first`);
  const k = [...strikes].sort((a, b) => a - b), legs = STRATEGIES[name](k, p.S);
  const priced = legs.map(l => (l.kind === 'stock' ? { ...l, price: p.S, g: { delta: 1, gamma: 0, vega: 0, theta: 0, rho: 0 } } : (() => { const g = bs({ ...p, K: l.K! }, l.kind); return { ...l, price: g.price, g } })()));
  const mult = (l: Leg) => (l.kind === 'stock' ? l.qty : l.qty * 100);
  const cost = priced.reduce((s, l) => s + l.side * l.price * mult(l), 0);   // > 0 debit, < 0 credit
  const payoff = (x: number) => priced.reduce((s, l) => s + l.side * mult(l) * (l.kind === 'stock' ? x : l.kind === 'call' ? Math.max(0, x - l.K!) : Math.max(0, l.K! - x)), 0) - cost;
  const greeks = (['delta', 'gamma', 'vega', 'theta', 'rho'] as const).map(g => [g, priced.reduce((s, l) => s + l.side * mult(l) * l.g[g], 0)] as const);
  // P/L is piecewise linear in the price: kinks at the strikes; check 0, every strike, and far beyond for unboundedness.
  const pts = [0, ...k, k.at(-1)! * 10];
  const vals = pts.map(payoff), slopeUp = payoff(k.at(-1)! * 10 + 1) - vals.at(-1)!;
  const maxProfit = slopeUp > 1e-9 ? Infinity : Math.max(...vals), maxLoss = Math.min(...vals);
  const be: number[] = [];
  for (let i = 1; i < pts.length; i++) { const a = vals[i - 1], b = vals[i]; if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) be.push(pts[i - 1] + ((0 - a) * (pts[i] - pts[i - 1])) / (b - a)) }
  const grid = [0.7, 0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.3].map(f => [money(p.S * f), money(payoff(p.S * f))]);
  return { legs: priced, cost, maxProfit, maxLoss, breakevens: be, greeks, grid };
}

export const optionsSkill: Skill = {
  id: 'options-strategy-advisor', name: 'Options strategy simulator', group: 'Options & futures', from: 'options-strategy-advisor',
  desc: 'Black-Scholes prices and Greeks for a strategy (covered call, spreads, straddle, iron condor…) with volatility from the chart history: cost, max profit/loss, breakevens, P/L at expiry. Theoretical values, not quotes.',
  inputs: [
    { key: 'symbol', label: 'Underlying (price and volatility)', type: 'symbol', default: 'BTCUSDT' },
    { key: 'strategy', label: 'Strategy', type: 'select', options: Object.keys(STRATEGIES), default: 'Bull call spread' },
    { key: 'strikes', label: 'Strikes, lowest first', type: 'text', default: '', hint: 'empty = around the current price' },
    { key: 'days', label: 'Days to expiry', type: 'number', default: 30 },
    { key: 'iv', label: 'Volatility % (empty = 30-day historical)', type: 'number', optional: true },
    { key: 'rate', label: 'Risk-free rate %', type: 'number', default: 4 },
    { key: 'div', label: 'Dividend yield %', type: 'number', default: 0 },
  ],
  async run(v, ctx) {
    const sym = String(v.symbol || '').trim().toUpperCase(), bars = await ctx.bars(sym, '1d');
    if (bars.length < 32) throw new Error(`Not enough daily history for ${sym}`);
    const S = bars.at(-1)!.close, crypto = !/^FX:|^MT5:/.test(sym), hv = histVol(bars.map(b => b.close), 30, crypto ? 365 : 252);
    const ivIn = num(v.iv, 'Volatility', { optional: true, min: 0.1 }), sigma = Number.isFinite(ivIn) ? ivIn / 100 : hv;
    const name = String(v.strategy), need = NEEDS[name] ?? 1, step = S * 0.05;
    let strikes = String(v.strikes ?? '').split(/[\s,]+/).filter(Boolean).map(x => num(x, 'Strike', { min: 0 }));
    if (!strikes.length) strikes = need === 1 ? [S] : need === 2 ? [S, S + step] : need === 3 ? [S - step, S, S + step] : [S - 2 * step, S - step, S + step, S + 2 * step];
    const a = analyzeStrategy(name, strikes.map(k => +k.toPrecision(6)), { S, T: num(v.days, 'Days', { min: 1 }) / 365, r: num(v.rate, 'Rate') / 100, sigma, q: num(v.div, 'Dividend') / 100 });
    const inf = (x: number) => (Number.isFinite(x) ? money(x) : 'unlimited');
    return {
      verdict: { label: `${name}: ${a.cost >= 0 ? 'debit' : 'credit'} ${money(Math.abs(a.cost))}`, tone: 'muted', detail: `${sym} ${money(S)}, volatility ${pct(sigma * 100, 1)}${Number.isFinite(ivIn) ? '' : ' (historical)'}` },
      kpis: [{ label: 'Max profit', value: inf(a.maxProfit), tone: 'up' }, { label: 'Max loss', value: inf(a.maxLoss), tone: 'dn' }, { label: 'Breakevens', value: a.breakevens.map(money).join(' / ') || '–' }, ...a.greeks.map(([g, x]) => ({ label: g, value: x.toFixed(g === 'gamma' ? 4 : 2) }))],
      tables: [
        { title: 'Legs (per contract of 100)', cols: ['Leg', 'Strike', 'Qty', 'Theoretical price'], rows: a.legs.map(l => [`${l.side > 0 ? 'Long' : 'Short'} ${l.kind}`, l.K ? money(l.K) : '–', l.qty, money(l.price)]) },
        { title: 'P/L at expiry', cols: ['Price', 'P/L'], rows: a.grid },
      ],
      notes: ['Theoretical Black-Scholes values from historical volatility, not market quotes; real premiums include the volatility the market expects.'],
    };
  },
};
