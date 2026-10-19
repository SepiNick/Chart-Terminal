// Runtime contract shared by the interpreter (interp.ts) and the builtin library (lib/*.ts).
import type { Bar } from '../data.ts';

/**
 * Values: numbers (int/float), booleans, strings, colors (CSS strings like '#rrggbbaa' / 'rgba(...)'),
 * arrays (JS arrays, reference semantics), tuples ({ tuple: [...] }) and objects for drawings.
 * `na` is NaN for numeric contexts and null otherwise; use isNa() to test either.
 */
export type PineValue = number | boolean | string | null | PineValue[] | PineTuple | PineObject;
export interface PineTuple { tuple: PineValue[] }
export interface PineObject { type: string; [k: string]: unknown }

export const NA = NaN;
export const isNa = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
export const num = (v: PineValue | undefined): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : NaN);
export const bool = (v: PineValue | undefined): boolean => (typeof v === 'number' ? !Number.isNaN(v) && v !== 0 : !!v);
export const tuple = (...items: PineValue[]): PineTuple => ({ tuple: items });

export interface Ctx {
  /** Index of the bar being executed (0-based). */
  bar: number;
  bars: Bar[];
  /** Persistent per-call-site state, created on first use by this call site (and user-function call path). */
  state<T>(init: () => T): T;
  /** Seconds per bar of the chart timeframe. */
  tfSec: number;
  mintick: number;
  /** Report a runtime problem without stopping execution (shown in the Pine console). */
  warn(msg: string): void;
}

/**
 * A builtin function. Positional args come first in `args`; `named` holds name=value arguments.
 * Builtins that need history (ta.*) keep their own buffers via ctx.state(), receiving one value per bar.
 */
export type Builtin = (ctx: Ctx, args: PineValue[], named: Record<string, PineValue>) => PineValue;

/** Read an argument by position or name, with a default. */
export function arg(args: PineValue[], named: Record<string, PineValue>, i: number, name: string, def?: PineValue): PineValue {
  if (name in named) return named[name];
  if (i < args.length && args[i] !== undefined) return args[i];
  return def as PineValue;
}

/** Rolling window helper for ta.* implementations: push one value per bar, read the last n. */
export class Window {
  buf: number[] = [];
  push(v: number, keep: number) { this.buf.push(v); if (this.buf.length > keep) this.buf.shift() }
  last(n: number) { return this.buf.slice(-n) }
  get length() { return this.buf.length }
}
