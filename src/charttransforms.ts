// DOM-free chart-type transforms (testable in Node). charttypes.ts re-exports everything here.
import type { Bar } from './data.ts';
import { atr, heikin } from './indicators.ts';

export type ChartType = 'bars' | 'candles' | 'hollow' | 'volcandles' | 'line' | 'linemarkers' | 'step' | 'area' | 'hlcarea' | 'baseline'
  | 'columns' | 'highlow' | 'ha' | 'renko' | 'linebreak' | 'kagi' | 'pnf' | 'range';

export const CHART_TYPES: { id: ChartType; name: string; priceBased: boolean; group: 'time' | 'price' }[] = ([
  ['bars', 'Bars'], ['candles', 'Candles'], ['hollow', 'Hollow candles'], ['volcandles', 'Volume candles'], ['line', 'Line'],
  ['linemarkers', 'Line with markers'], ['step', 'Step line'], ['area', 'Area'], ['hlcarea', 'HLC area'], ['baseline', 'Baseline'],
  ['columns', 'Columns'], ['highlow', 'High-low'], ['ha', 'Heikin Ashi'],
  ['renko', 'Renko'], ['linebreak', 'Line break'], ['kagi', 'Kagi'], ['pnf', 'Point & figure'], ['range', 'Range'],
] as [ChartType, string][]).map(([id, name], i) => ({ id, name, priceBased: i > 12, group: i > 12 ? 'price' : 'time' }));
export const isPriceBased = (t: ChartType) => CHART_TYPES.find(x => x.id === t)!.priceBased;

export interface TypeOpts {
  boxSize?: number | 'atr'; // renko/pnf box, kagi reversal amount; 'atr' = last ATR(atrLength) of the source bars
  atrLength?: number;
  reversal?: number; // pnf reversal in boxes
  lineBreak?: number; // line break: number of lines a reversal must exceed
  range?: number; // range bars size (defaults to the ATR box)
  source?: 'close' | 'hl'; // pnf price source
  upColor: string; downColor: string; lineColor: string;
  colorByPrevClose?: boolean;
  baseValue?: number; // baseline level price (createMainSeries uses 0 if unset; pass e.g. the first visible close)
}
export const typeDefaults = (p: Partial<TypeOpts> = {}): TypeOpts => ({
  boxSize: 'atr', atrLength: 14, reversal: 3, lineBreak: 3, source: 'close',
  upColor: '#089981', downColor: '#f23645', lineColor: '#2962ff', colorByPrevClose: false, ...p,
});

/**
 * Synthetic bar with optional render hints:
 * - kagi: `yang` = thick line at the end of the segment; `flip` = price where thickness changed inside it (before it: the opposite).
 * - pnf: `pnf` column kind ('X' rising / 'O' falling), `boxes` count, `box` size; rows run from low to high in `box` steps.
 */
export interface XBar extends Bar { yang?: boolean; flip?: number; pnf?: 'X' | 'O'; boxes?: number; box?: number }

/** Resolve a box/range size: positive number as-is, else last ATR, else mean bar range, else 1% of price. */
export function resolveBox(bars: Bar[], v: number | 'atr' | undefined, len = 14): number {
  if (typeof v === 'number' && v > 0) return v;
  const a = atr(bars, Math.min(len, Math.max(bars.length, 1))).at(-1);
  if (a) return a;
  const m = bars.reduce((s, b) => s + b.high - b.low, 0) / (bars.length || 1);
  return m || Math.abs(bars[0]?.close ?? 0) * 0.01 || 1;
}

// Price-based outputs need strictly increasing time: a brick takes its source bar's time, or prev+1s if that's taken
// (several bricks from one source bar get +1, +2… seconds).
const nextT = (out: Bar[], t: number) => Math.max(t, (out.at(-1)?.time ?? -Infinity) + 1);
const brick = (out: XBar[], t: number, open: number, close: number, volume: number, x: Partial<XBar> = {}) =>
  out.push({ time: nextT(out, t), open, close, high: Math.max(open, close), low: Math.min(open, close), volume, ...x });

/** Renko (close source): a brick forms per full box beyond the last brick; reversing needs 2 boxes (past the brick's open). */
function renko(bars: Bar[], box: number): XBar[] {
  const out: XBar[] = [];
  if (!bars.length) return out;
  let hi = bars[0].close, lo = hi, vol = 0;
  for (const b of bars) {
    vol += b.volume;
    while (b.close >= hi + box) { brick(out, b.time, hi, hi + box, vol); vol = 0; lo = hi; hi += box }
    while (b.close <= lo - box) { brick(out, b.time, lo, lo - box, vol); vol = 0; hi = lo; lo -= box }
  }
  return out;
}

/** Line break: new line when close beats the last line; reversal only when close breaks the extreme of the last N lines. */
function lineBreak(bars: Bar[], n: number): XBar[] {
  const out: XBar[] = [];
  let vol = 0;
  for (const b of bars) {
    vol += b.volume;
    const last = out.at(-1);
    if (!last) { if (b.close !== b.open) { brick(out, b.time, b.open, b.close, vol); vol = 0 } continue }
    const up = last.close > last.open, win = out.slice(-n);
    const hi = up ? last.high : Math.max(...win.map(x => x.high)), lo = up ? Math.min(...win.map(x => x.low)) : last.low;
    if (b.close > hi) { brick(out, b.time, last.high, b.close, vol); vol = 0 }
    else if (b.close < lo) { brick(out, b.time, last.low, b.close, vol); vol = 0 }
  }
  return out;
}

/**
 * Kagi (close source): the line extends while price moves its way and turns when price reverses by `rev`.
 * Thickness: yang (thick) once a line rises above the previous shoulder (prior up-line top); yin once it falls below the prior waist.
 */
function kagi(bars: Bar[], rev: number): XBar[] {
  const out: XBar[] = [];
  if (!bars.length) return out;
  const start = bars[0].close;
  let shoulder = Infinity, waist = -Infinity, yang = true, cur: XBar | null = null;
  for (const b of bars) {
    const c = b.close;
    if (!cur) {
      if (Math.abs(c - start) < rev) continue;
      yang = c > start; brick(out, b.time, start, c, b.volume, { yang }); cur = out.at(-1)!; continue;
    }
    const up = cur.close > cur.open;
    if (up ? c > cur.close : c < cur.close) { cur.close = c; cur.volume += b.volume }
    else if (Math.abs(c - cur.close) >= rev) {
      if (up) shoulder = cur.close; else waist = cur.close;
      brick(out, b.time, cur.close, c, b.volume, { yang }); cur = out.at(-1)!;
    } else { cur.volume += b.volume; continue }
    cur.high = Math.max(cur.open, cur.close); cur.low = Math.min(cur.open, cur.close);
    const nowUp = cur.close > cur.open;
    if (nowUp && !yang && cur.close > shoulder) { yang = cur.yang = true; cur.flip = shoulder }
    if (!nowUp && yang && cur.close < waist) { yang = cur.yang = false; cur.flip = waist }
  }
  return out;
}

/**
 * Point & figure on a box grid (rows = price/box). X column extends when a new box is reached upward, flips to O when price
 * falls `rev` boxes below its top (O starts one box below); O mirrors. 'hl' source: extension tested on high/low first, then reversal.
 */
function pnf(bars: Bar[], box: number, rev: number, hl: boolean): XBar[] {
  const out: XBar[] = [], e = 1e-9;
  if (!bars.length) return out;
  const r0 = Math.round(bars[0].close / box);
  let top = r0, bot = r0, x = true, started = false;
  const set = (c: XBar) => Object.assign(c, { open: (x ? bot : top) * box, close: (x ? top : bot) * box, high: top * box, low: bot * box, pnf: x ? 'X' : 'O', boxes: top - bot + 1, box });
  for (const b of bars) {
    const hr = Math.floor((hl ? b.high : b.close) / box + e), lr = Math.ceil((hl ? b.low : b.close) / box - e);
    let fresh = true;
    if (!started) {
      if (hr >= r0 + 1) { x = true; bot = r0 + 1; top = hr }
      else if (lr <= r0 - 1) { x = false; top = r0 - 1; bot = lr }
      else continue;
      started = true;
    }
    else if (x && hr > top) { top = hr; fresh = false }
    else if (!x && lr < bot) { bot = lr; fresh = false }
    else if (x && lr <= top - rev) { x = false; top--; bot = lr }
    else if (!x && hr >= bot + rev) { x = true; bot++; top = hr }
    else { out.at(-1)!.volume += b.volume; continue }
    if (fresh) brick(out, b.time, 0, 0, b.volume); else out.at(-1)!.volume += b.volume;
    set(out.at(-1)!);
  }
  return out;
}

/** Range bars: a bar closes once its high-low span reaches `r`; overshoots spawn extra full-range bars. Intrabar path O→L→H→C (up bar) or O→H→L→C. */
function rangeBars(bars: Bar[], r: number): XBar[] {
  const out: XBar[] = [];
  if (!bars.length) return out;
  let o = bars[0].open, h = o, l = o, vol = 0, t = bars[0].time;
  for (const b of bars) {
    vol += b.volume;
    for (const p of b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close]) {
      while (p >= l + r || p <= h - r) {
        const c = p >= l + r ? l + r : h - r;
        out.push({ time: nextT(out, t), open: o, high: Math.max(h, c), low: Math.min(l, c), close: c, volume: vol });
        vol = 0; t = b.time; o = h = l = c;
      }
      h = Math.max(h, p); l = Math.min(l, p);
    }
  }
  out.push({ time: nextT(out, t), open: o, high: h, low: l, close: bars.at(-1)!.close, volume: vol }); // forming bar
  return out;
}

export function transformBars(type: ChartType, bars: Bar[], o: TypeOpts): XBar[] {
  const box = () => resolveBox(bars, o.boxSize, o.atrLength);
  switch (type) {
    case 'ha': return heikin(bars);
    case 'renko': return renko(bars, box());
    case 'linebreak': return lineBreak(bars, Math.max(1, o.lineBreak ?? 3));
    case 'kagi': return kagi(bars, box());
    case 'pnf': return pnf(bars, box(), Math.max(1, o.reversal ?? 3), o.source === 'hl');
    case 'range': return rangeBars(bars, resolveBox(bars, o.range, o.atrLength));
    default: return bars;
  }
}
