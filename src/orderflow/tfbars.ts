// Bars that close on activity instead of the clock, built from prints: tick (`100T`), range (`R10`), reversal (`REV5`)
// and delta (`D500`). Pure: data.ts uses the parser for its interval helpers, source.ts feeds the builder.
import type { Bar } from '../data.ts';
import type { Print } from './model.ts';

type OfKind = 'T' | 'R' | 'REV' | 'D' | 'time';
export interface OfTf { kind: OfKind; n: number }

/** `100T` = 100 prints, `R10` = 10 of price, `REV5` = 5 ticks (minimum price steps) against the bar, `D500` = |delta| 500. */
export function parseOfTf(tf: string): OfTf | null {
  const s = tf.trim().toUpperCase(), t = s.match(/^(\d+)T$/), m = s.match(/^(REV|R|D)(\d+(?:\.\d+)?)$/);
  const spec: OfTf | null = t ? { kind: 'T', n: +t[1] } : m ? { kind: m[1] as OfKind, n: +m[2] } : null;
  return spec && spec.n > 0 && (spec.kind === 'R' || spec.kind === 'D' || Number.isInteger(spec.n)) ? spec : null;
}
export const ofTfName = (s: OfTf) => (s.kind === 'T' ? `${s.n}T` : `${s.kind}${s.n}`);
export const ofTfLabel = (s: OfTf) => ({ T: `${s.n} ticks`, R: `Range ${s.n}`, REV: `Reversal ${s.n} ticks`, D: `Delta ${s.n}`, time: `${s.n}s` })[s.kind];

/**
 * Incremental bar builder. Activity bars take the time of their first print, pushed to previous + 1 s when that is taken
 * (several bars can start in one second); `time` bars are plain clock buckets (weeks start on Monday, like the footprint).
 */
export class BarBuilder {
  bars: Bar[] = [];
  private spec: OfTf; private tick: number;
  private n = 0; private delta = 0; private dir = 0;   // prints, delta and direction (reversal bars) of the forming bar
  constructor(spec: OfTf, tick = 0) { this.spec = spec; this.tick = tick }

  /** Add one print (in time order); returns the time of the bar it went into. */
  push(p: Print): number {
    let b = this.bars.at(-1);
    if (!b || this.closes(b, p)) {
      b = { time: this.timeOf(p.t, b), open: p.px, high: p.px, low: p.px, close: p.px, volume: 0 };
      this.bars.push(b); this.n = 0; this.delta = 0; this.dir = 0;
    }
    b.high = Math.max(b.high, p.px); b.low = Math.min(b.low, p.px); b.close = p.px; b.volume += p.qty;
    this.n++; this.delta += p.buy ? p.qty : -p.qty;
    if (!this.dir && b.close !== b.open) this.dir = Math.sign(b.close - b.open);
    return b.time;
  }
  /** Does print `p` start a new bar? */
  private closes(b: Bar, p: Print): boolean {
    const { kind, n } = this.spec;
    switch (kind) {
      case 'T': return this.n >= n;
      case 'D': return Math.abs(this.delta) >= n;
      case 'R': return Math.max(b.high, p.px) - Math.min(b.low, p.px) > n + 1e-9;   // a range bar never spans more than n
      case 'REV': { const r = n * (this.tick || 1) - 1e-9; return this.dir > 0 ? p.px <= b.high - r : this.dir < 0 ? p.px >= b.low + r : false }
      default: return this.bucket(p.t) !== b.time;
    }
  }
  private bucket(t: number) { const sec = this.spec.n, a = sec % 604800 === 0 ? 345600 : 0; return Math.floor((t - a) / sec) * sec + a }
  private timeOf(t: number, prev?: Bar) { return this.spec.kind === 'time' ? this.bucket(t) : Math.max(Math.floor(t), (prev?.time ?? -Infinity) + 1) }
}

export function buildBars(ps: Print[], spec: OfTf, tick = 0): Bar[] {
  const b = new BarBuilder(spec, tick);
  for (const p of ps) b.push(p);
  return b.bars;
}
