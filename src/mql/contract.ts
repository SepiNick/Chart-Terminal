// Contract between the MQL compiler (compiler/*), the runtime library (lib/*, trade/*) and the engine (engine.ts).
// Clean-room implementation from the public MQL4/MQL5 documentation; no MetaQuotes code or files are used.
import type { Bar } from '../data.ts';

export type Dialect = 'mql4' | 'mql5';

/**
 * Compiled program. The compiler emits the BODY of a JS function with signature
 *   (rt: Rt, MqlArray: typeof MqlArray, ref: typeof makeRef, MqlError: typeof MqlError) => CompiledProgram
 * Globals become `let` bindings inside that body; event handlers are returned by name.
 */
export interface CompiledProgram {
  handlers: Partial<Record<Handler, (...args: unknown[]) => unknown>>;
  inputs: InputDef[];
  /** #property directives, e.g. { strict: true, indicator_chart_window: true, indicator_buffers: 3, indicator_color1: 0xff0000, indicator_label1: 'MA' } */
  props: Record<string, string | number | boolean>;
  /** Assign an input/extern variable before OnInit. */
  setInput(name: string, value: unknown): void;
}
type Handler = 'OnInit' | 'OnDeinit' | 'OnTick' | 'OnCalculate' | 'OnStart' | 'OnTimer' | 'OnTrade' | 'OnTradeTransaction' | 'OnChartEvent' | 'OnTester' | 'OnBookEvent' | 'init' | 'deinit' | 'start';
interface InputDef { name: string; type: string; def: unknown; comment?: string; group?: string; options?: { name: string; value: number }[] }

export interface CompileResult { ok: boolean; js?: string; errors: Diagnostic[]; warnings: Diagnostic[]; dialect: Dialect }
export interface Diagnostic { file: string; line: number; col: number; msg: string }

/**
 * Generated code conventions (the compiler MUST follow these; the runtime relies on them):
 * - Any identifier not declared by the program resolves to `rt.<name>` (functions, constants, predefined variables like
 *   Bid, Ask, Point, Digits, Bars, _Symbol, _Period, _LastError, and MQL4 predefined series Open/High/Low/Close/Time/Volume).
 * - Builtin struct/class types (MqlTradeRequest, MqlTradeResult, MqlTick, MqlRates, MqlDateTime, CTrade, CPositionInfo, …)
 *   are constructed with `new rt.<Type>()` when a variable of that type is declared (value semantics for structs: the
 *   compiler copies with `rt.__copy(x)` on assignment/pass-by-value; classes are reference types).
 * - Every array (user, builtin parameter, predefined series) is an MqlArray; indexing compiles to .get(i) / .set(i, v).
 * - Scalar out-parameters of builtins (listed in OUT_PARAMS as 'Name/arity' → arg indices) are passed as Ref objects
 *   ({ v }) and written back by the compiler after the call. User functions with `T &x` scalar params also use Ref.
 * - Integer semantics: int/long/short/char/uint/... values are truncated on assignment, `/` between integers truncates,
 *   `%` is integer remainder; bool is JS boolean; string concatenation uses `+`; datetime is seconds (number); color is a
 *   BGR integer (C'r,g,b' and clrXxx constants).
 * - Runtime errors that MQL treats as critical (array out of range, zero divide, invalid pointer) throw MqlError.
 */
export class MqlError extends Error {
  code: number;
  constructor(msg: string, code = 0) { super(msg); this.code = code }
}
export interface Ref<T = unknown> { v: T }
export const makeRef = <T>(v: T): Ref<T> => ({ v });

/** MQL array: dynamic or fixed, optionally indexed as a series (index 0 = newest element). */
export class MqlArray<T = unknown> {
  data: T[];
  series = false;
  fixed = false;
  fill: T;
  constructor(size = 0, fill: T = 0 as T, fixed = false) { this.data = Array.from({ length: size }, () => fill); this.fill = fill; this.fixed = fixed }
  private idx(i: number): number {
    const n = this.data.length, k = this.series ? n - 1 - i : i;
    if (!(i >= 0 && i < n) || !Number.isInteger(i)) throw new MqlError(`array out of range (index ${i}, size ${n})`, 4002);
    return k;
  }
  get(i: number): T { return this.data[this.idx(i)] }
  set(i: number, v: T): T { this.data[this.idx(i)] = v; return v }
  get size() { return this.data.length }
  /** ArrayResize semantics: returns new size, or -1 for fixed arrays. */
  resize(n: number, reserve = 0): number {
    void reserve;
    if (this.fixed) return -1;
    if (n < this.data.length) this.data.length = Math.max(0, n);
    else while (this.data.length < n) this.data.push(this.fill);
    return this.data.length;
  }
}

/** Everything the runtime library needs from the engine. */
export interface Env {
  dialect: Dialect;
  /** Chronological bars of the chart symbol/timeframe (index 0 = oldest). */
  bars: Bar[];
  /** Index (into bars) of the bar currently being processed; Bars/series indexing is relative to it (shift 0 = this bar). */
  cur(): number;
  /** Current tick price (backtests feed O/H/L/C ticks per bar; live feeds real prices). */
  price(): number;
  symbol: string;
  tfSec: number;
  digits: number;
  point: number;
  spreadPoints: number;
  /** Server time (seconds) of the current tick. */
  now(): number;
  /** Bars of another timeframe/symbol for iMA(..., timeframe, ...) etc. Returns chronological bars or [] if unavailable. */
  barsFor(symbol: string, tfSec: number): Bar[];
  log(level: 'print' | 'alert' | 'comment' | 'error', msg: string): void;
  /** Chart objects created via ObjectCreate & co. */
  objects: Map<string, ChartObject>;
  /** Indicator buffers bound with SetIndexBuffer, by index. */
  buffers: Map<number, { arr: MqlArray<number>; kind: 'data' | 'color' | 'calc' }>;
  /** Per-plot properties (PlotIndexSetInteger/SetIndexStyle, etc.), by plot index. */
  plots: Map<number, PlotProps>;
  /** Indicator-level properties (IndicatorSetString/Integer/Double, levels, digits, short name). */
  indicator: { shortName?: string; digits?: number; levels: { value: number; color?: number; style?: number }[]; min?: number; max?: number };
  stop(): void;
  /** Simulated account for the trade module (rt.__broker is created from this). */
  account: {
    balance: number; leverage: number; hedging: boolean; currency: string; contractSize: number; commissionPerLot: number; minLot: number; lotStep: number; maxLot: number; stopLevelPoints: number;
    /** Daily swap in points per lot (charged at 00:00 server time on open positions); swap3Day = weekday with triple swap (default 3, Wednesday). */
    swapLong?: number; swapShort?: number; swap3Day?: number;
  };
  /** Sandboxed in-memory file system of the run (FileOpen & co.), shared with iCustom programs; never the real disk. */
  files?: Map<string, string>;
}

/**
 * The trade module (trade/index.ts) must expose, on rt.__broker, at least:
 *   onTick(bid: number, ask: number, time: number): void   — engine calls on every tick BEFORE OnTick: fills pending orders, SL/TP, stop-outs
 *   positions / orders / deals: arrays describing open positions, pending orders and the deal history (with time, price, volume, type, profit)
 *   balance(): number, equity(): number
 */
export interface BrokerView {
  onTick(bid: number, ask: number, time: number): void;
  balance(): number; equity(): number;
  positions: { ticket: number; type: 'buy' | 'sell'; volume: number; price: number; sl: number; tp: number; time: number; magic: number; comment: string; symbol: string }[];
  orders: { ticket: number; type: string; volume: number; price: number; sl: number; tp: number; time: number; magic: number; comment: string; symbol: string }[];
  deals: { ticket: number; order: number; position: number; time: number; type: 'buy' | 'sell'; entry: 'in' | 'out' | 'inout'; volume: number; price: number; profit: number; commission: number; swap: number; magic: number; comment: string; symbol: string }[];
}
export interface PlotProps { type?: number; color?: number[]; width?: number; style?: number; label?: string; begin?: number; shift?: number; arrow?: number; empty?: number; show?: boolean }
export interface ChartObject { name: string; type: number; window: number; time: number[]; price: number[]; props: Record<string, unknown> }

/** The runtime object passed to compiled code: builtin functions, constants, predefined variables, struct/class ctors. */
export type Rt = Record<string, unknown>;

/** A runtime module installs its members onto rt. */
export type Install = (rt: Rt, env: Env) => void;

/** Builtin functions with scalar out-parameters: 'Name/arity' → indices of Ref arguments. */
export type OutParams = Record<string, number[]>;
