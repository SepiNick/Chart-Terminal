// Turn a chart's strategy (Pine, MQL expert or NinjaScript strategy) into an Evaluate function. A Job is plain
// data, so the same job can be posted to the tester worker.
import type { Bar } from '../data.ts';
import { findLibrary, runScript } from '../pine/engine.ts';
import type { RunOpts, ScriptInput } from '../pine/interp.ts';
import { fromBroker } from '../pine/report.ts';
import { runMql, tradesFromDeals, type MqlRun, type MqlRunOpts } from '../mql/engine.ts';
import { runNinjaScript } from '../ninja/engine.ts';
import type { NtCompileResult, NtRunOptions } from '../ninja/contract.ts';
import type { Evaluate, ParamSpec, TesterData } from './types.ts';

export type Job =
  | { kind: 'pine'; src: string; opts: Omit<RunOpts, 'inputs' | 'security' | 'library'>; libs?: string[]; sec?: Record<string, Bar[]> }   // libs/sec: import and request.security as data
  | { kind: 'mql'; js: string; opts: Omit<MqlRunOpts, 'inputs' | 'barsFor'> }
  | { kind: 'ninja'; cr: NtCompileResult; cls: string; opts: Omit<NtRunOptions, 'bars' | 'inputs'> };

const EMPTY: TesterData = { trades: [], equity: [], initialCapital: 10000, openPL: 0, openCount: 0 };

export function mqlTester(r: MqlRun, bars: Bar[]): TesterData | undefined {
  if (r.kind !== 'expert' || !r.broker) return undefined;
  return { trades: tradesFromDeals(r.broker.deals, bars.map(b => b.time)), equity: r.equity, initialCapital: r.initialBalance, openPL: r.broker.equity() - r.broker.balance(), openCount: r.broker.positions.length };
}

/** The same job on another symbol (price precision `prec` decimals). */
export function forSymbol(job: Job, symbol: string, prec: number): Job {
  const tick = 10 ** -prec;
  if (job.kind === 'pine') return { ...job, opts: { ...job.opts, symbol, mintick: tick } };
  if (job.kind === 'mql') return { ...job, opts: { ...job.opts, symbol: symbol.replace(/^[A-Z0-9]+:/, ''), digits: prec } };
  return { ...job, opts: { ...job.opts, symbol, tickSize: tick } };
}

/** Errors are thrown so the optimizer can skip that parameter set. */
export function makeEvaluate(job: Job, bars: Bar[]): Evaluate {
  return (inputs, range) => {
    const b = bars.slice(range.from, range.to);
    if (job.kind === 'pine') {
      const r = runScript(job.src, b, { ...job.opts, inputs: inputs as RunOpts['inputs'], ...(job.libs ? { library: (p: string) => findLibrary(p, job.libs) } : {}), security: (s, tf) => job.sec?.[`${s}|${tf}`] });
      if (r.error) throw new Error(r.error.msg);
      return r.out?.broker ? fromBroker(r.out.broker, b) : EMPTY;
    }
    if (job.kind === 'mql') {
      const r = runMql(job.js, b, { ...job.opts, inputs });
      if (r.error) throw new Error(r.error);
      return mqlTester(r, b) ?? EMPTY;
    }
    const r = runNinjaScript(job.cr, job.cls, b, { ...job.opts, inputs });
    if (r.result.error) throw new Error(r.result.error);
    return r.tester ?? EMPTY;
  };
}

/** Default optimisation ranges for a script's inputs: numeric ±50%..×2 around the current value, all options, both bools. */
export function paramSpecs(inputs: ScriptInput[]): ParamSpec[] {
  const out: ParamSpec[] = [];
  for (const i of inputs) {
    const v = i.value;
    if (i.options?.length) out.push({ name: i.id, type: 'enum', values: i.options as (string | number | boolean)[] });
    else if (i.type === 'bool') out.push({ name: i.id, type: 'bool' });
    else if ((i.type === 'int' || i.type === 'float' || i.type === 'price') && typeof v === 'number' && Number.isFinite(v)) {
      const int = i.type === 'int', lo = v > 0 ? v / 2 : v * 2 || -1, hi = v > 0 ? v * 2 : v / 2 || 1;
      const min = Math.max(i.min ?? -Infinity, int ? Math.max(1, Math.floor(lo)) : lo), max = Math.min(i.max ?? Infinity, int ? Math.ceil(hi) : hi);
      const step = i.step ?? (int ? Math.max(1, Math.round((max - min) / 10)) : +((max - min) / 10).toPrecision(2));
      out.push({ name: i.id, type: int ? 'int' : 'float', min, max, step });
    }
  }
  return out;
}
