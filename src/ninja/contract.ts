// Contract between the C# compiler (compiler/*), the NinjaScript runtime (runtime/*) and the app.
// Clean-room implementation from the public NinjaTrader 8 help guide (ninjatrader.com/support/helpGuides/nt8) and the
// C# language reference; no NinjaTrader assemblies or source files are used.
import type { Bar } from '../data.ts';
import type { Trade } from '../pine/strategy.ts';

export interface Diagnostic { file: string; line: number; col: number; msg: string }

/** User-facing parameter, from properties marked [NinjaScriptProperty] (Display/Range attributes give name/group/order/limits). */
export interface NtInput {
  name: string; type: string; def?: unknown; displayName: string; group: string; order: number;
  min?: number; max?: number; options?: string[];                 // options for user enum types
}
export interface NtClassInfo { name: string; base: string; kind: 'indicator' | 'strategy' | 'other'; inputs: NtInput[] }

export interface NtCompileOptions {
  /** Names the runtime provides globally (static classes/enums/functions such as Math, Brushes, Draw, State, Calculate,
   *  MarketPosition, PlotStyle, DashStyleHelper, CalculationMode, Series, List, Dictionary, DateTime, TimeSpan, Print …).
   *  The compiler resolves identifiers in this order: locals/params → members of user classes (incl. user base classes)
   *  → these globals (as rt.<Name>) → otherwise an inherited NinjaScript member (this.<Name>). */
  globals: string[];
}
export interface NtCompileResult { ok: boolean; js?: string; classes: NtClassInfo[]; errors: Diagnostic[]; warnings: Diagnostic[] }

/**
 * Generated code conventions (the compiler MUST follow these; the runtime relies on them):
 * - `js` is the BODY of a function (rt, ref) => Record<string, Function> returning every compiled class by simple name.
 * - User classes deriving from Indicator / Strategy (any namespace) extend rt.Indicator / rt.Strategy; other unresolved
 *   bases extend rt.<Base>. NinjaTrader's auto-generated "partial class Indicator/Strategy/MarketAnalyzerColumn" cache
 *   regions are ignored; instead, calling a user indicator by name from another script (e.g. `MyInd(14)[0]`) compiles to
 *   this.MyInd(14) and the runtime resolves it from the classes registered in the same compilation.
 * - Element access `x[i]` compiles to rt.__get(x, i) and assignment to rt.__set(x, i, v) (compound ops expand to both),
 *   so the runtime can dispatch: Series/ISeries → bars-ago indexing, arrays, List, Dictionary, string chars.
 * - Each class gets a static `__inputs: NtInput[]` (properties with [NinjaScriptProperty]) and a static `__name`.
 * - Auto-properties become fields; properties with bodies become getters/setters; constructors map to JS constructors
 *   calling super() first. Overloaded methods are mangled by arity/type like the MQL compiler.
 * - Integer semantics (int/long/short/byte… truncation on assignment and integer `/`), `out`/`ref` args as Ref objects
 *   (`{ v }`) written back after the call, string interpolation and string.Format via rt.__fmt, C# casts via rt.__cast,
 *   `is`/`as`, ?: and ?? operators, `var` inference, foreach over arrays/List/Dictionary (KeyValuePair with Key/Value).
 * - Unsupported constructs (LINQ query syntax, events/delegates beyond simple Action/Func lambdas, unsafe code,
 *   OnRender custom rendering) produce a diagnostic error with line/col — never silently wrong code.
 */
export type Rt = Record<string, unknown>;

/** What the runtime returns after running one indicator or strategy over the chart's bars. */
export interface NtResult {
  kind: 'indicator' | 'strategy';
  name: string;
  overlay: boolean;                       // IsOverlay
  plots: { name: string; color: string; width: number; style: 'line' | 'bar' | 'dot' | 'hash' | 'square' | 'triangleUp' | 'triangleDown' | 'cross' | 'block'; values: number[]; colors: (string | null)[] }[];
  lines: { name: string; value: number; color: string }[];   // AddLine
  draws: { type: 'line' | 'ray' | 'hline' | 'vline' | 'rect' | 'text' | 'arrowUp' | 'arrowDown' | 'dot' | 'triangleUp' | 'triangleDown' | 'diamond' | 'square'; tag: string; t1: number; p1: number; t2?: number; p2?: number; color: string; text?: string }[];
  backColors: (string | null)[];          // BackBrush per bar
  barColors: (string | null)[];           // BarBrush per bar
  logs: { bar: number; msg: string }[];   // Print / Log
  alerts?: { bar: number; msg: string }[];   // Alert() calls
  // strategies
  trades?: Trade[];
  equity?: number[];
  executions?: { time: number; price: number; qty: number; side: 'buy' | 'sell'; name: string }[];
  initialCapital?: number;
  openPL?: number;
  openCount?: number;
  error?: string;
}

export interface NtRunOptions {
  bars: Bar[];
  symbol: string;
  tfSec: number;
  tickSize: number;
  pointValue: number;                     // currency per 1.0 price move per contract
  initialCapital: number;
  commissionPerContract: number;
  inputs?: Record<string, unknown>;
  /** Extra data series for AddDataSeries(...): return bars for (symbol, tfSec) or [] when unavailable. */
  barsFor?: (symbol: string, tfSec: number) => Bar[];
}
