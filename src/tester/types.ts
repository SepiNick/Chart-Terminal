// Shared contract for the Strategy Tester core (metrics, optimizer, walk-forward, Monte Carlo) and its runner/UI.
import type { Bar } from '../data.ts';
import type { TesterData } from '../pine/report.ts';

export type { TesterData } from '../pine/report.ts';
export type { Trade } from '../pine/strategy.ts';

/** Inclusive-exclusive range of bar indices into the full bar array: bars.slice(from, to). */
export interface BarRange { from: number; to: number }

/**
 * Run the strategy synchronously with the given inputs on bars.slice(range.from, range.to) and return its results.
 * Equity in the returned TesterData is per bar OF THAT SLICE. Implementations are pure and cheap enough to call
 * hundreds of times (they run in a Web Worker).
 */
export type Evaluate = (inputs: Record<string, unknown>, range: BarRange) => TesterData;

export interface ParamSpec {
  name: string;
  type: 'int' | 'float' | 'bool' | 'enum';
  min?: number; max?: number; step?: number;   // numeric ranges (inclusive)
  values?: (string | number | boolean)[];        // enum / explicit value lists
}

/** All 53 report metrics (TradingView Strategy Report groups: returns, risk-adjusted, trades, capital efficiency, run-up/drawdown). */
export type Metrics = Record<string, number>;
export interface MetricDef { key: string; label: string; group: 'Returns' | 'Risk-adjusted performance' | 'Trades' | 'Capital efficiency' | 'Run-ups and drawdowns'; format: 'money' | 'pct' | 'ratio' | 'int' | 'bars' | 'number'; higherIsBetter: boolean }

export interface OptimizeOptions {
  method: 'grid' | 'random' | 'genetic';
  objective: string;               // a Metrics key
  maximize: boolean;
  maxRuns: number;                 // cap on evaluations (grid stops early, random/genetic use it as budget)
  minTrades?: number;              // results with fewer closed trades are discarded
  range: BarRange;
  seed?: number;                   // deterministic RNG for random/genetic
  population?: number; generations?: number; mutation?: number;   // genetic knobs (sensible defaults)
  onProgress?: (done: number, total: number, best?: OptResult) => void;
  shouldStop?: () => boolean;
}
export interface OptResult { inputs: Record<string, unknown>; metrics: Metrics; score: number }

export interface WalkForwardOptions {
  windows: number;                 // number of IS/OOS segments
  isPct: number;                   // in-sample share of each window, e.g. 0.7
  anchored: boolean;               // anchored = IS always starts at range.from; rolling = sliding window
  optimize: Omit<OptimizeOptions, 'range' | 'onProgress' | 'shouldStop'>;
  range: BarRange;
  onProgress?: (segment: number, total: number) => void;
  shouldStop?: () => boolean;
}
export interface WalkForwardSegment { is: BarRange; oos: BarRange; best: Record<string, unknown>; isMetrics: Metrics; oosMetrics: Metrics }
export interface WalkForwardResult {
  segments: WalkForwardSegment[];
  oosEquity: { bar: number; value: number }[];   // stitched OOS equity (absolute bar indices), compounding from initial capital
  efficiency: number;                            // walk-forward efficiency: annualised OOS return / annualised IS return
  oosMetrics: Metrics;                           // metrics of all OOS trades combined
}

export interface MonteCarloOptions { runs: number; method: 'shuffle' | 'bootstrap'; ruinPct: number; seed?: number; skipPct?: number /* randomly drop this share of trades */ }
export interface MonteCarloResult {
  runs: number;
  finalEquity: { p5: number; p25: number; p50: number; p75: number; p95: number };
  maxDrawdownPct: { p5: number; p25: number; p50: number; p75: number; p95: number };
  riskOfRuin: number;                            // share of runs whose equity fell to (1 - ruinPct/100) × start or below
  paths: number[][];                             // up to 50 sampled equity paths (per trade) for plotting
  original: { finalEquity: number; maxDrawdownPct: number };
}

export type { Bar };
