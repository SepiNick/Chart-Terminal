// Order-flow model, no DOM: trades → footprint cells per bar, delta/CVD, imbalances, big prints; order-book history for the heatmap.
// t in seconds (ms precision); buy = aggressive buyer; bar = time of the activity bar (tick/range/…) it belongs to, if any
export interface Print { t: number; px: number; qty: number; buy: boolean; bar?: number }
export interface Cell { bid: number; ask: number; n: number }                 // bid = sold into the bid (sell aggressor), ask = bought at the ask
export interface FBar {
  time: number; cells: Map<number, Cell>;      // key = bin index (price / row)
  buy: number; sell: number; trades: number; hi: number; lo: number;
  cvdOpen: number; cvdHigh: number; cvdLow: number; cvdClose: number; maxDelta: number; minDelta: number;
}
export interface BookSnap { t: number; bids: [number, number][]; asks: [number, number][] }

/** A "nice" row size giving roughly `rows` rows across a typical bar range. */
export function autoRow(ranges: number[], rows = 24, tick = 0): number {
  const r = ranges.filter(x => x > 0).sort((a, b) => a - b), med = r.length ? r[Math.floor(r.length / 2)] : 0;
  if (!med) return tick || 1;
  const raw = med / rows, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  const step = (n < 1.5 ? 1 : n < 2.25 ? 2 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * p;
  return Math.max(step, tick);
}
export const binOf = (px: number, row: number) => Math.floor(px / row + 1e-9);

/**
 * Merge prints from the same taker order: same time (to the ms), side and consecutive arrival.
 * Exchanges split one market order into one print per resting order it hit; ATAS calls the merged view Smart Tape.
 */
export function aggregatePrints(ps: Print[]): Print[] {
  const out: Print[] = [];
  for (const p of ps) {
    const l = out.at(-1);
    if (l && l.buy === p.buy && Math.abs(l.t - p.t) < 0.0005) { l.px = (l.px * l.qty + p.px * p.qty) / (l.qty + p.qty); l.qty += p.qty }
    else out.push({ ...p });
  }
  return out;
}

export class Footprint {
  bars = new Map<number, FBar>();
  prints: Print[] = [];               // raw history (capped) so the row size can change
  from = Infinity;                    // earliest print time covered
  private cvd = 0;
  tfSec: number; row: number; private cap: number;
  constructor(tfSec: number, row: number, cap = 400_000) { this.tfSec = tfSec; this.row = row; this.cap = cap }

  private bucket(t: number) { const a = this.tfSec % 604800 === 0 ? 345600 : 0; return Math.floor((t - a) / this.tfSec) * this.tfSec + a }

  /** Add prints in time order (older history may be added later through `prepend`). */
  add(ps: Print[]) {
    for (const p of ps) { this.prints.push(p); this.apply(p) }
    if (ps.length) this.from = Math.min(this.from, ps[0].t);
    if (this.prints.length > this.cap) this.rebuild(this.row, this.prints.slice(-Math.floor(this.cap * 0.8)));
  }
  /** Older prints arrived (backfill): rebuild so CVD stays continuous. */
  prepend(ps: Print[]) {
    if (!ps.length) return;
    const last = ps.at(-1)!.t;
    this.rebuild(this.row, [...ps, ...this.prints.filter(p => p.t > last)]);
  }
  rebuild(row: number, prints = this.prints) {
    this.row = row; this.bars.clear(); this.cvd = 0; this.prints = [];
    this.from = prints[0]?.t ?? Infinity;
    for (const p of prints) { this.prints.push(p); this.apply(p) }
  }
  private apply(p: Print) {
    const time = p.bar ?? this.bucket(p.t);
    let b = this.bars.get(time);
    if (!b) { b = { time, cells: new Map(), buy: 0, sell: 0, trades: 0, hi: p.px, lo: p.px, cvdOpen: this.cvd, cvdHigh: this.cvd, cvdLow: this.cvd, cvdClose: this.cvd, maxDelta: 0, minDelta: 0 }; this.bars.set(time, b) }
    const k = binOf(p.px, this.row), c = b.cells.get(k) ?? { bid: 0, ask: 0, n: 0 };
    if (p.buy) { c.ask += p.qty; b.buy += p.qty; this.cvd += p.qty } else { c.bid += p.qty; b.sell += p.qty; this.cvd -= p.qty }
    c.n++; b.cells.set(k, c); b.trades++;
    b.hi = Math.max(b.hi, p.px); b.lo = Math.min(b.lo, p.px);
    b.cvdClose = this.cvd; b.cvdHigh = Math.max(b.cvdHigh, this.cvd); b.cvdLow = Math.min(b.cvdLow, this.cvd);
    const d = b.buy - b.sell; b.maxDelta = Math.max(b.maxDelta, d); b.minDelta = Math.min(b.minDelta, d);
  }
}

export interface BarStats { delta: number; volume: number; poc: number; vah: number; val: number; maxCell: number }
/**
 * Point of control (first row with the most volume) and value area: grow from the POC towards the larger neighbour until
 * `pct` of the volume is inside. `rows` = [bin, volume] sorted by bin.
 */
export function valueArea(rows: [number, number][], pct = 0.7): { poc: number; vah: number; val: number } {
  const total = rows.reduce((a, r) => a + r[1], 0);
  let i = 0;
  rows.forEach((r, j) => { if (r[1] > rows[i][1]) i = j });
  let lo = i, hi = i, inside = rows[i]?.[1] ?? 0;
  while (inside < total * pct && (lo > 0 || hi < rows.length - 1)) {
    const down = lo > 0 ? rows[lo - 1][1] : -1, up = hi < rows.length - 1 ? rows[hi + 1][1] : -1;
    if (up >= down) inside += rows[++hi][1]; else inside += rows[--lo][1];
  }
  const poc = rows[i]?.[0] ?? 0;
  return { poc, vah: rows[hi]?.[0] ?? poc, val: rows[lo]?.[0] ?? poc };
}
/** Point of control and 70% value area of one footprint bar (bin indices). */
export function barStats(b: FBar): BarStats {
  const rows = [...b.cells].sort((x, y) => x[0] - y[0]);
  let maxCell = 0;
  for (const [, c] of rows) maxCell = Math.max(maxCell, c.bid, c.ask);
  return { delta: b.buy - b.sell, volume: b.buy + b.sell, maxCell, ...valueArea(rows.map(([k, c]) => [k, c.bid + c.ask])) };
}

export interface Imbalance { bin: number; side: 'buy' | 'sell'; stacked: boolean }
/**
 * Diagonal imbalances, the way footprint traders read them: buying at price P is compared with selling one row lower
 * (ask[P] vs bid[P-1]); selling at P with buying one row higher. `stack` consecutive same-side rows form a stacked imbalance.
 */
export function imbalances(b: FBar, ratio = 3, stack = 3, minVol = -1): Imbalance[] {
  const out: Imbalance[] = [];
  // Against an empty opposite cell the ratio is infinite, so only count it when the volume itself is meaningful (≥ the bar's average cell).
  if (minVol < 0) { const cs = [...b.cells.values()]; minVol = cs.reduce((a, c) => a + Math.max(c.bid, c.ask), 0) / (cs.length || 1) }
  for (const [k, c] of b.cells) {
    const below = b.cells.get(k - 1)?.bid ?? 0, above = b.cells.get(k + 1)?.ask ?? 0;
    if (c.ask > 0 && (below > 0 ? c.ask >= ratio * below : c.ask >= minVol)) out.push({ bin: k, side: 'buy', stacked: false });
    if (c.bid > 0 && (above > 0 ? c.bid >= ratio * above : c.bid >= minVol)) out.push({ bin: k, side: 'sell', stacked: false });
  }
  for (const side of ['buy', 'sell'] as const) {
    const ks = out.filter(x => x.side === side).map(x => x.bin).sort((a, z) => a - z);
    let run: number[] = [];
    const flush = () => { if (run.length >= stack) out.forEach(x => { if (x.side === side && run.includes(x.bin)) x.stacked = true }); run = [] };
    for (const k of ks) { if (run.length && k !== run.at(-1)! + 1) flush(); run.push(k) }
    flush();
  }
  return out;
}

/** Big prints by notional; `minNotional` 0 = automatic (top 0.5% of the last prints, at least 10×median). */
export function bigPrints(ps: Print[], minNotional = 0): Print[] {
  let th = minNotional;
  if (!th) {
    const n = ps.map(p => p.px * p.qty).sort((a, b) => a - b);
    th = n.length ? Math.max(n[Math.floor(n.length * 0.995)] ?? 0, (n[Math.floor(n.length / 2)] ?? 0) * 10) : Infinity;
  }
  return ps.filter(p => p.px * p.qty >= th);
}

export type ClusterMetric = 'volume' | 'delta' | 'bid' | 'ask' | 'trades';
export interface ClusterHit { time: number; bin: number; value: number }
const cellValue = (c: Cell, m: ClusterMetric) => m === 'volume' ? c.bid + c.ask : m === 'delta' ? c.ask - c.bid : m === 'bid' ? c.bid : m === 'ask' ? c.ask : c.n;
/**
 * Cluster Search: footprint cells whose metric lies in [min, max] (delta compares its absolute value; the hit keeps the sign).
 * `min` 0 = automatic: the top 1% of the cells in `bars`, so the window the caller passes decides what "unusual" means.
 */
export function clusterSearch(bars: FBar[], metric: ClusterMetric, min = 0, max = Infinity): ClusterHit[] {
  const all = bars.flatMap(b => [...b.cells].map(([bin, c]) => ({ time: b.time, bin, value: cellValue(c, metric) })));
  if (!all.length) return [];
  if (!(min > 0)) { const v = all.map(h => Math.abs(h.value)).sort((a, b) => a - b); min = Math.max(v[Math.floor(v.length * 0.99)], 1e-12) }
  return all.filter(h => Math.abs(h.value) >= min && Math.abs(h.value) <= max);
}

/** `side` = the passive side that absorbed: 'buy' = resting bids soaked up aggressive selling at the low (bullish). */
export interface Absorption { time: number; bin: number; side: 'buy' | 'sell'; vol: number }
/**
 * Absorption: heavy aggressive volume (≥ `mult` × the average cell of `bars`, and 1.5× the other side) at a bar's extreme
 * (within `edge` rows), after which the next `look` bars never trade through that row. The last bar is never reported:
 * nothing has confirmed it yet. `bars` sorted by time.
 */
export function absorption(bars: FBar[], row: number, mult = 3, look = 2, edge = 1): Absorption[] {
  let vol = 0, n = 0;
  for (const b of bars) for (const c of b.cells.values()) { vol += c.bid + c.ask; n++ }
  const th = (vol / (n || 1)) * mult, out: Absorption[] = [];
  bars.forEach((b, i) => {
    const next = bars.slice(i + 1, i + 1 + look);
    if (!next.length) return;
    const lo = binOf(b.lo, row), hi = binOf(b.hi, row);
    const nextLo = Math.min(...next.map(x => binOf(x.lo, row))), nextHi = Math.max(...next.map(x => binOf(x.hi, row)));
    let buy: Absorption | null = null, sell: Absorption | null = null;
    for (const [k, c] of b.cells) {
      if (k <= lo + edge && c.bid >= th && c.bid >= 1.5 * c.ask && nextLo >= k && (!buy || c.bid > buy.vol)) buy = { time: b.time, bin: k, side: 'buy', vol: c.bid };
      if (k >= hi - edge && c.ask >= th && c.ask >= 1.5 * c.bid && nextHi <= k && (!sell || c.ask > sell.vol)) sell = { time: b.time, bin: k, side: 'sell', vol: c.ask };
    }
    if (buy) out.push(buy);
    if (sell) out.push(sell);
  });
  return out;
}

/** Order-book history for the liquidity heatmap: one snapshot per `every` seconds, kept for `keep` seconds. */
export class BookHistory {
  snaps: BookSnap[] = [];
  last: BookSnap | null = null;
  private every: number; private keep: number; private slot = -Infinity;
  constructor(every = 1, keep = 4 * 3600) { this.every = every; this.keep = keep }
  push(s: BookSnap) {
    this.last = s;
    // Within one slot the newest snapshot wins, but the slot keeps its start time.
    if (this.snaps.length && s.t - this.slot < this.every) { this.snaps[this.snaps.length - 1] = s; return }
    this.snaps.push(s); this.slot = s.t;
    while (this.snaps.length && s.t - this.snaps[0].t > this.keep) this.snaps.shift();
  }
  /** Largest resting size in the history, for colour scaling (ignores the top 1% so one wall doesn't wash out the rest). */
  scale(): number {
    const v = this.snaps.flatMap(s => [...s.bids, ...s.asks].map(l => l[1])).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length * 0.99)] || v.at(-1)! : 1;
  }
}
