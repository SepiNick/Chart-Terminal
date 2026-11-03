// crypto-regime-analyzer: a 0–100 crypto risk regime from six components with the original's weights and scoring —
// BTC trend structure, alt breadth, BTC dominance regime, perpetual funding, drawdown & volatility, momentum thrust.
// Data: Binance daily bars, CoinGecko top coins, the server's dominance history, funding from the derivatives route.
import { pct, type Ctx, type Result, type Skill } from './types.ts';

export interface Comp { score: number; available: boolean; signal: string }
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const sma = (c: number[], n: number) => mean(c.slice(-n));
const NA = (signal: string): Comp => ({ score: 50, available: false, signal });

export function btcTrend(c: number[]): Comp {
  if (c.length < 220) return NA('Need ≥ 220 daily closes');
  const price = c.at(-1)!, m50 = sma(c, 50), m200 = sma(c, 200), prev = mean(c.slice(-220, -20)), dir = m200 > prev ? 'rising' : m200 < prev ? 'falling' : 'flat';
  let base: number, s: string;
  if (price === m50 && m50 === m200) { base = 50; s = 'FLAT' }
  else if (price > m50 && m50 > m200) { base = 90; s = 'BULL STACK (price > 50DMA > 200DMA)' }
  else if (price > m200 && price <= m50 && m50 > m200) { base = 65; s = 'BULL PULLBACK' }
  else if (price <= m200 && price <= m50 && m50 > m200) { base = 55; s = 'STACK INTACT, PRICE BELOW' }
  else if (price > m50 && m50 <= m200) { base = 45; s = 'RECOVERY ATTEMPT' }
  else { base = 15; s = 'BEAR STACK (price < 50DMA < 200DMA)' }
  return { score: Math.max(0, Math.min(100, base + (dir === 'rising' ? 10 : dir === 'falling' ? -10 : 0))), available: true, signal: `${s}; 200DMA ${dir}` };
}
const pctAbove = (series: number[][], n: number) => { const ok = series.filter(c => c.length >= n); return { pct: ok.length ? (100 * ok.filter(c => c.at(-1)! > sma(c, n)).length) / ok.length : 0, counted: ok.length } };
export function altBreadth(alts: number[][]): Comp {
  const elig = alts.filter(c => c.length >= 200), p200 = pctAbove(elig, 200);
  if (p200.counted < 5) return NA(`Only ${p200.counted} alts with ≥ 200 days`);
  const p50 = pctAbove(elig, 50).pct, a = p200.pct;
  let s = a >= 80 ? 95 : a >= 65 ? 80 : a >= 50 ? 65 : a >= 35 ? 45 : a >= 20 ? 25 : 10;
  if (p50 >= a + 15) s += 5; else if (p50 <= a - 15) s -= 5;
  return { score: Math.max(0, Math.min(100, s)), available: true, signal: `${pct(a, 0)} of ${p200.counted} alts above 200DMA, ${pct(p50, 0)} above 50DMA` };
}
export function dominance(series: number[], btcUp: boolean): Comp {
  if (series.length < 31) return NA(`Need ≥ 31 days of dominance history (the server records one a day: ${series.length} so far)`);
  const cur = series.at(-1)!, ch = cur - series.at(-31)!, dir = ch > 0.5 ? 'rising' : ch < -0.5 ? 'falling' : 'flat';
  let s = btcUp ? (dir === 'falling' ? 90 : dir === 'rising' ? 65 : 75) : dir === 'rising' ? 30 : dir === 'falling' ? 10 : 25;
  if (cur >= 62 && !btcUp) s += 5; else if (cur <= 40 && btcUp) s -= 5;
  return { score: Math.max(0, Math.min(100, s)), available: true, signal: `BTC.D ${cur.toFixed(1)}% ${dir} over 30d, BTC trend ${btcUp ? 'up' : 'down'}` };
}
export function funding(rates: number[]): Comp {
  if (rates.length < 2) return NA('Need funding for ≥ 2 perpetuals');
  const a = mean(rates), [s, l] = a <= -0.0001 ? [80, 'WASHED OUT'] : a < 0 ? [65, 'SKEPTICAL'] : a <= 0.0001 ? [75, 'NEUTRAL'] : a <= 0.0003 ? [55, 'WARMING'] : a <= 0.0006 ? [30, 'CROWDED'] : [10, 'EUPHORIC'];
  return { score: s as number, available: true, signal: `${l}: average funding ${(a * 100).toFixed(4)}% (${(a * 3 * 365 * 100).toFixed(1)}%/yr)` };
}
const rvol = (c: number[], w: number) => { const r = c.slice(-w - 1).map((v, i, x) => (i ? v / x[i - 1] - 1 : NaN)).slice(1); if (r.length < 2) return 0; const m = mean(r); return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(365) };
export function drawdownVol(c: number[]): Comp {
  if (c.length < 365) return NA('Need ≥ 365 daily closes');
  const w = c.slice(-365), dd = 1 - w.at(-1)! / Math.max(...w);
  let s = dd <= 0.1 ? 90 : dd <= 0.2 ? 75 : dd <= 0.35 ? 55 : dd <= 0.5 ? 35 : dd <= 0.65 ? 20 : 10;
  const vols: number[] = [];
  for (let i = 30; i < w.length; i += 7) vols.push(rvol(w.slice(0, i + 1), 30));   // weekly stride, like the original
  const cur = rvol(w, 30), p = vols.length ? vols.filter(v => v <= cur).length / vols.length : 0.5;
  if (p <= 1 / 3) s += 10; else if (p >= 2 / 3) s -= 10;
  if (dd > 0.65 && p >= 2 / 3) s = Math.max(s, 15);
  return { score: Math.max(0, Math.min(100, s)), available: true, signal: `drawdown ${pct(dd * 100, 1)} from the 1y high; 30d volatility at the ${Math.round(p * 100)}th percentile` };
}
export function momentum(series: number[][]): Comp {
  const ok = series.filter(c => c.length >= 31);
  if (ok.length < 5) return NA('Need ≥ 5 coins with 31 days');
  const p = (100 * ok.filter(c => c.at(-1)! > c.at(-31)!).length) / ok.length, [s, l] = p >= 85 ? [90, 'BROAD THRUST'] : p >= 65 ? [75, 'POSITIVE'] : p >= 45 ? [55, 'MIXED'] : p >= 25 ? [35, 'WEAK'] : p >= 10 ? [20, 'BROADLY NEGATIVE'] : [35, 'WASHOUT (contrarian)'];
  return { score: s as number, available: true, signal: `${l}: ${pct(p, 0)} of ${ok.length} coins up over 30d` };
}
export const WEIGHTS = { btc_trend: 0.25, alt_breadth: 0.2, dominance: 0.15, funding: 0.15, drawdown_vol: 0.15, momentum_thrust: 0.1 };
export function composite(c: Record<keyof typeof WEIGHTS, Comp>) {
  const avail = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).filter(k => c[k].available), w = avail.reduce((s, k) => s + WEIGHTS[k], 0);
  if (avail.length < 4 || w < 0.65) return { score: null, zone: 'UNKNOWN' as const, availableWeight: w };
  const x = Math.max(0, Math.min(100, avail.reduce((s, k) => s + c[k].score * (WEIGHTS[k] / w), 0))) * 10, f = Math.floor(x);
  const score = (x - f === 0.5 ? (f % 2 ? f + 1 : f) : Math.round(x)) / 10;   // Python round(): half to even
  return { score, zone: score >= 80 ? 'RISK_ON' as const : score >= 40 ? 'NEUTRAL' as const : 'RISK_OFF' as const, availableWeight: w };
}

const EXCLUDE = new Set(['tether', 'usd-coin', 'dai', 'first-digital-usd', 'ethena-usde', 'usds', 'paypal-usd', 'true-usd', 'frax', 'binance-usd', 'usd1-wlfi', 'wrapped-bitcoin', 'wrapped-steth', 'staked-ether', 'weth', 'coinbase-wrapped-btc', 'wrapped-eeth', 'rocket-pool-eth', 'wrapped-beacon-eth', 'figure-heloc', 'blackrock-usd-institutional-digital-liquidity-fund']);
const LABELS: Record<string, string> = { btc_trend: 'BTC trend structure', alt_breadth: 'Alt breadth', dominance: 'BTC dominance regime', funding: 'Perpetual funding', drawdown_vol: 'Drawdown & volatility', momentum_thrust: 'Momentum thrust' };
export const cryptoRegimeSkill: Skill = {
  id: 'crypto-regime-analyzer', name: 'Crypto regime (0–100)', group: 'Market regime', from: 'crypto-regime-analyzer',
  desc: 'Crypto risk-on / neutral / risk-off score from six weighted components: BTC trend, alt breadth, dominance, funding, drawdown & volatility, 30-day momentum. Missing components are left out and the rest reweighted.',
  inputs: [{ key: 'topN', label: 'Universe: top coins by market cap', type: 'number', default: 20 }],
  async run(v, ctx: Ctx): Promise<Result> {
    const n = Math.max(5, Math.min(50, Number(v.topN) || 20));
    const coins = (await ctx.json<{ id: string; sym: string }[]>('/api/coins')).filter(c => !EXCLUDE.has(c.id)).slice(0, n);
    const closes = new Map<string, number[]>();
    let i = 0;
    await Promise.all(Array.from({ length: 5 }, async () => { while (i < coins.length) { const c = coins[i++]; try { closes.set(c.sym, (await ctx.bars(`${c.sym}USDT`, '1d')).map(b => b.close)) } catch { /* not on Binance: left out */ } } }));
    const btc = closes.get('BTC') ?? [], alts = [...closes].filter(([s]) => s !== 'BTC').map(([, c]) => c), trend = btcTrend(btc);
    await ctx.json('/api/global').catch(() => null);   // records today's dominance on the server
    const dom = await ctx.json<{ btc: number }[]>('/api/global/history').catch(() => []);
    const rates = (await Promise.all(['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].map(b => ctx.json<{ now: { rate: number } | null }>(`/api/derivs/funding?ex=binanceusdm&sym=${encodeURIComponent(`${b}/USDT:USDT`)}`).then(r => r.now?.rate ?? null, () => null)))).filter((x): x is number => x != null && Number.isFinite(x));
    const comps = { btc_trend: trend, alt_breadth: altBreadth(alts), dominance: dominance(dom.map(d => d.btc), trend.available && trend.score >= 60), funding: funding(rates), drawdown_vol: drawdownVol(btc), momentum_thrust: momentum([...closes.values()]) };
    const c = composite(comps);
    return {
      verdict: { label: c.score == null ? 'UNKNOWN: too few components' : `${c.zone.replace('_', ' ')} · ${c.score}`, tone: c.zone === 'RISK_ON' ? 'up' : c.zone === 'RISK_OFF' ? 'dn' : 'warn', detail: `${Math.round(c.availableWeight * 100)}% of the model weight available; ${closes.size} coins` },
      tables: [{ title: 'Components', cols: ['Component', 'Weight', 'Score', 'Reading'], rows: Object.entries(comps).map(([k, x]) => [LABELS[k], `${WEIGHTS[k as keyof typeof WEIGHTS] * 100}%`, x.available ? x.score : 'n/a', x.signal]) }],
      notes: ['Describes conditions; not a trade signal. The dominance component starts after the server has recorded 31 days.'],
    };
  },
};
