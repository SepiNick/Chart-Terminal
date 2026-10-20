// Portfolio risk math, no DOM: log-return correlation between symbols, exposure of open positions, and clusters of
// correlated positions that stack risk in one direction.

export interface Pt { time: number; close: number }

/** Pearson correlation; null with fewer than 3 points or a flat series. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; cov += x * y; va += x * x; vb += y * y }
  return va > 0 && vb > 0 ? Math.max(-1, Math.min(1, cov / Math.sqrt(va * vb))) : null;
}

/** Correlation of log returns over the bar times both series have (returns are taken between common bars, so gaps
 *  in one series never pair a 1-bar return with a 3-bar return). */
export function correlation(a: Pt[], b: Pt[]): { r: number | null; n: number } {
  const mb = new Map(b.map(x => [x.time, x.close]));
  const ca: number[] = [], cb: number[] = [];
  for (const x of a) { const y = mb.get(x.time); if (y != null && x.close > 0 && y > 0) { ca.push(x.close); cb.push(y) } }
  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < ca.length; i++) { ra.push(Math.log(ca[i] / ca[i - 1])); rb.push(Math.log(cb[i] / cb[i - 1])) }
  return { r: pearson(ra, rb), n: ra.length };
}

export function correlationMatrix(series: Record<string, Pt[]>) {
  const syms = Object.keys(series);
  const r = syms.map(() => syms.map(() => null as number | null)), n = syms.map(() => syms.map(() => 0));
  for (let i = 0; i < syms.length; i++) for (let k = i; k < syms.length; k++) {
    const c = i === k ? { r: series[syms[i]].length > 3 ? 1 : null, n: Math.max(0, series[syms[i]].length - 1) } : correlation(series[syms[i]], series[syms[k]]);
    r[i][k] = r[k][i] = c.r; n[i][k] = n[k][i] = c.n;
  }
  return { syms, r, n };
}

const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'USD', 'EUR', 'GBP', 'JPY', 'TRY', 'BRL', 'IRT', 'BTC', 'ETH', 'BNB'];
export const STABLE = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'DAI', 'USD']);
/** Base and quote currency of a symbol: BTCUSDT, BINANCE:BTCUSDT, KUCOIN:BTC_USDT(.P), bybit:BTC/USDT:USDT. */
export function splitPair(sym: string): { base: string; quote: string } {
  const slash = sym.indexOf('/'), colon = sym.indexOf(':');
  const s = colon >= 0 && (slash < 0 || colon < slash) ? sym.slice(colon + 1) : sym;   // drop an exchange prefix
  if (s.includes('/')) { const [base, q] = s.split('/'); return { base, quote: q.split(':')[0] } }
  // The app's CCXT symbols: BASE_QUOTE, plus .P (perpetual) / .F<date> (future) suffixes.
  if (s.includes('_')) { const [base, q] = s.replace(/\.[PF]\w*$/, '').split('_'); return { base, quote: q } }
  const q = QUOTES.find(x => s.endsWith(x) && s.length > x.length);
  return q ? { base: s.slice(0, -q.length), quote: q } : { base: s, quote: '?' };
}

export interface PosIn {
  sym: string; qty: number;       // signed: < 0 is short
  avg: number; px: number;        // entry and current price
  stop?: number;
  fx?: number;                    // quote currency → account currency (1 for USD stablecoins)
}
export interface PosRow extends PosIn { base: string; quote: string; notional: number; pct: number; risk: number | null; r: number | null }
export interface Leg { key: string; net: number; gross: number; netPct: number; grossPct: number }

/** Net/gross exposure per asset and per quote currency, largest position and open risk to the stops. */
export function exposure(pos: PosIn[], equity: number) {
  const pc = (v: number) => (equity > 0 ? (v / equity) * 100 : 0);
  const rows: PosRow[] = pos.filter(p => p.qty).map(p => {
    const fx = p.fx ?? 1, notional = p.qty * p.px * fx;
    // what is lost from here if the stop is hit (0 once the stop locks in profit), and that in units of the initial risk
    const risk = p.stop == null ? null : Math.max(0, (p.px - p.stop) * p.qty * fx);
    const initial = p.stop == null ? 0 : Math.abs(p.avg - p.stop) * Math.abs(p.qty) * fx;
    return { ...p, ...splitPair(p.sym), notional, pct: pc(notional), risk, r: risk != null && initial > 0 ? risk / initial : null };
  });
  const legs = (key: (r: PosRow) => string, sign: number) => {
    const m = new Map<string, { net: number; gross: number }>();
    for (const r of rows) { const k = key(r), v = m.get(k) ?? { net: 0, gross: 0 }; v.net += sign * r.notional; v.gross += Math.abs(r.notional); m.set(k, v) }
    return [...m].map(([k, v]): Leg => ({ key: k, ...v, netPct: pc(v.net), grossPct: pc(v.gross) })).sort((a, b) => b.gross - a.gross);
  };
  const gross = rows.reduce((s, r) => s + Math.abs(r.notional), 0), net = rows.reduce((s, r) => s + r.notional, 0);
  const largest = rows.reduce<PosRow | null>((m, r) => (!m || Math.abs(r.notional) > Math.abs(m.notional) ? r : m), null);
  const known = rows.filter(r => r.risk != null);
  return {
    rows, gross, net, grossPct: pc(gross), netPct: pc(net), largest,
    byAsset: legs(r => r.base, 1),
    byQuote: legs(r => r.quote, -1),   // a long BTCUSDT is short USDT
    risk: known.reduce((s, r) => s + r.risk!, 0), riskPct: pc(known.reduce((s, r) => s + r.risk!, 0)),
    riskR: known.reduce((s, r) => s + (r.r ?? 0), 0), noStop: rows.filter(r => r.risk == null).map(r => r.sym),
  };
}

/** Groups of ≥2 positions whose correlation (|r| ≥ threshold) makes them one bet in one direction:
 *  same direction and positively correlated, or opposite directions and negatively correlated. */
export function stacks(rows: Pick<PosRow, 'sym' | 'qty' | 'notional' | 'risk'>[], corr: (a: string, b: string) => number | null, threshold = 0.7) {
  const parent = rows.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const minR = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) for (let k = i + 1; k < rows.length; k++) {
    const r = corr(rows[i].sym, rows[k].sym);
    if (r == null || Math.abs(r) < threshold || Math.sign(rows[i].qty) * Math.sign(rows[k].qty) * Math.sign(r) <= 0) continue;
    const a = find(i), b = find(k);
    const m = Math.min(minR.get(a) ?? 1, minR.get(b) ?? 1, Math.abs(r));
    if (a !== b) parent[b] = a;
    minR.set(a, m);
  }
  const groups = new Map<number, typeof rows>();
  rows.forEach((x, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), x]) });
  return [...groups].filter(([, g]) => g.length > 1).map(([root, g]) => ({
    syms: g.map(x => x.sym), legs: g.map(x => `${x.sym} ${x.qty > 0 ? 'long' : 'short'}`), minCorr: minR.get(root) ?? threshold,
    notional: g.reduce((s, x) => s + Math.abs(x.notional), 0),
    risk: g.some(x => x.risk == null) ? null : g.reduce((s, x) => s + x.risk!, 0),
  }));
}
