// Compile and run chart scripts on the server (Pine, MQL4/5, NinjaScript) from their sources only. Shared by forward
// tests (through the engine worker, worker.ts) and script alerts. Pure: no database, no network.
import { tfSeconds, type Bar } from '../src/data.ts';
import { runScript } from '../src/pine/engine.ts';
import { compileMql, runMql } from '../src/mql/engine.ts';
import { compileNinja, runNinjaScript } from '../src/ninja/engine.ts';
import type { Outputs } from '../src/pine/interp.ts';
import type { Job } from '../src/tester/runner.ts';
import type { ScriptSource } from '../src/alerttypes.ts';

export type { ScriptSource };
export type SimpleFill = { time: number; side: 'buy' | 'sell'; qty: number };

/** Build the engine job with the trusted compilers, mirroring ChartPane.testerJob. Throws on compile errors. */
export function buildJob(s: ScriptSource, symbol: string, tf: string): Job {
  const tfSec = tfSeconds(tf), tick = 10 ** -s.prec, main = s.files[s.main];
  if (s.lang === 'pine') return { kind: 'pine', src: main, opts: { symbol, tf, tfSec, mintick: tick } };
  const err = (e?: { file: string; line: number; msg: string }) => Error(e ? `${e.file}(${e.line}): ${e.msg}` : 'Compilation failed');
  if (s.lang === 'mql4' || s.lang === 'mql5') {
    const cr = compileMql(s.main, s.files);
    if (!cr.ok || !cr.js) throw err(cr.errors[0]);
    return { kind: 'mql', js: cr.js, opts: { dialect: cr.dialect, symbol: symbol.replace(/^[A-Z0-9]+:/, ''), tfSec, digits: s.prec, spreadPoints: 0 } };
  }
  const cr = compileNinja(s.files);
  if (!cr.ok || !cr.js) throw err(cr.errors[0]);
  const cls = s.cls ?? main.match(/class\s+(\w+)\s*:\s*(?:[\w.]*\.)?(Indicator|Strategy)\b/)?.[1];
  if (!cls || !cr.classes.some(c => c.name === cls)) throw Error('No Indicator or Strategy class in this file');
  return { kind: 'ninja', cr, cls, opts: { symbol, tfSec, tickSize: tick, pointValue: 1, initialCapital: 10000, commissionPerContract: 0 } };
}

/** Run a job; script errors come back as `error`, never thrown. */
export function runJob(job: Job, bars: Bar[], inputs: Record<string, unknown>): { out?: Outputs; error?: string } {
  if (job.kind === 'pine') {
    const r = runScript(job.src, bars, { ...job.opts, inputs: inputs as never });
    return r.error ? { error: `line ${r.error.line}: ${r.error.msg}` } : { out: r.out };
  }
  if (job.kind === 'mql') {
    const r = runMql(job.js, bars, { ...job.opts, inputs });
    return r.error ? { error: r.error } : { out: r.out };
  }
  const r = runNinjaScript(job.cr, job.cls, bars, { ...job.opts, inputs });
  return r.result.error ? { error: r.result.error } : { out: r.out };
}

/** Fills of any engine's outputs: Pine broker fills, MQL deals, NinjaScript executions (exposed as mqlDeals). */
export function fillsOf(out: Outputs | undefined): SimpleFill[] {
  const o = out as (Outputs & { mqlDeals?: { time: number; type: string; volume: number }[] }) | undefined;
  if (o?.broker) return o.broker.fills.map(f => ({ time: f.time, side: f.side, qty: f.qty }));
  return (o?.mqlDeals ?? []).filter(d => d.type === 'buy' || d.type === 'sell').map(d => ({ time: d.time, side: d.type as 'buy' | 'sell', qty: d.volume }));
}

/** Run a job on bars and return its fills; throws the script's error. */
export function runFills(job: Job, bars: Bar[], inputs: Record<string, unknown>): SimpleFill[] {
  const r = runJob(job, bars, inputs);
  if (r.error) throw Error(r.error);
  return fillsOf(r.out);
}
