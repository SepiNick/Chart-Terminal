// Compact definition helper for the built-in indicators (each becomes an Indicator subclass with NT-style parameters/plots).
import { Indicator, NinjaScriptBase } from '../base.ts';
import { Brushes } from '../brushes.ts';
import { NtSeries } from '../series.ts';

export type S = any;
export interface Def {
  p?: Record<string, unknown>;                       // parameters in NT's positional order, with defaults
  plots: (string | [prop: string, name?: string, style?: string])[];
  overlay?: boolean;
  lines?: [number, string][];
  init?: (s: S) => void;                            // State.DataLoaded
  bar: (s: S) => void;                              // OnBarUpdate
  m?: Record<string, (this: S, ...a: any[]) => unknown>;
}
export const REG: Record<string, any> = {};
const COLORS = ['DodgerBlue', 'Orange', 'Crimson', 'MediumSeaGreen', 'Goldenrod', 'Orchid', 'Gray'];

export function def(name: string, d: Def) {
  const C = class extends Indicator {
    OnStateChange() {
      if (this.State === 'SetDefaults') {
        this.Name = name; this.IsOverlay = !!d.overlay; this.BarsRequiredToPlot = 0;
        for (const [k, v] of Object.entries(d.p ?? {})) this[k] = v;
        d.plots.forEach((p, i) => { const [prop, nm, st] = typeof p === "string" ? [p, p] : p; this.AddPlot(Brushes[COLORS[i % COLORS.length]], st ?? "Line", nm ?? prop) });
        for (const [v, n] of d.lines ?? []) this.AddLine(Brushes.DarkGray, v, n);
      } else if (this.State === 'DataLoaded') d.init?.(this);
    }
    OnBarUpdate() { d.bar(this) }
  };
  Object.defineProperty(C, 'name', { value: name });
  (C as any).__params = Object.keys(d.p ?? {});
  d.plots.forEach((p, i) => {
    const prop = typeof p === 'string' ? p : p[0];
    if (prop !== name && !(prop in NinjaScriptBase.prototype)) Object.defineProperty(C.prototype, prop, { get() { return this.Values[i] }, configurable: true });
  });
  for (const [k, f] of Object.entries(d.m ?? {})) (C.prototype as any)[k] = function (this: S, ...a: any[]) { this.__runTo(this.__ctx.cur); return f.apply(this, a) };
  REG[name] = C;
  return C;
}

// small numeric helpers over series (barsAgo windows)
export const ser = (s: S) => new NtSeries(s);
export const n = (s: S, period: number) => Math.min(period, s.CurrentBar + 1);
export const sum = (x: NtSeries, len: number) => { let t = 0; for (let k = 0; k < len; k++) t += x.get(k); return t };
export const max = (x: NtSeries, len: number) => { let t = -Infinity; for (let k = 0; k < len; k++) t = Math.max(t, x.get(k)); return t };
export const min = (x: NtSeries, len: number) => { let t = Infinity; for (let k = 0; k < len; k++) t = Math.min(t, x.get(k)); return t };
export const v = (x: S, k = 0): number => (x instanceof NtSeries ? x.get(k) : x.Values[0].get(k));
export const put = (s: S, x: number, plot = 0) => s.Values[plot].set(0, x);
export const ema = (s: S, x: number, prev: NtSeries, period: number) => (s.CurrentBar === 0 ? x : x * (2 / (1 + period)) + (1 - 2 / (1 + period)) * prev.get(1));
