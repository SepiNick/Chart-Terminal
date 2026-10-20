// One of the engine pool's worker threads for server-side scripts (forward tests and script alerts): compiles and runs them off the main thread
// so a slow script can't stall HTTP, WebSocket and the rest. engine.ts sends a job's sources once, then only bars.
import { parentPort } from 'node:worker_threads';
import { buildJob, runFills, runJob, type ScriptSource } from './scripts.ts';
import type { Bar } from '../src/data.ts';
import type { Job } from '../src/tester/runner.ts';

/** op 'fills': the strategy's fills (forward tests); 'out': the whole Outputs or the error (alerts). */
export type WorkerReq =
  | { n: number; op: 'fills' | 'out'; key: string; source?: ScriptSource; sym: string; tf: string; bars: Bar[]; inputs: Record<string, unknown> }
  | { n: number; op: 'forget'; key: string };

const jobs = new Map<string, Job>();
parentPort?.on('message', (m: WorkerReq) => {
  if (m.op === 'forget') { jobs.delete(m.key); return }
  try {
    if (m.source) jobs.set(m.key, buildJob(m.source, m.sym, m.tf));
    const job = jobs.get(m.key);
    if (!job) throw Error('Sources missing');
    parentPort!.postMessage({ n: m.n, value: m.op === 'fills' ? runFills(job, m.bars, m.inputs) : runJob(job, m.bars, m.inputs) });
  } catch (e) { parentPort!.postMessage({ n: m.n, error: (e as Error).message || String(e) }) }
});
