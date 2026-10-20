// One worker thread (engineworker.ts) that runs every server-side script: forward tests and script alerts.
// Callers name each compiled job with a `key`; its sources travel to the worker only the first time.
import { Worker } from 'node:worker_threads';
import type { Bar } from '../src/data.ts';
import type { Outputs } from '../src/pine/interp.ts';
import type { ScriptSource, SimpleFill } from './scripts.ts';
import type { WorkerReq } from './engineworker.ts';

export const RUN_TIMEOUT = 20_000;
const MAX_JOBS = 300;
let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { key: string; ok: (v: never) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const loaded = new Set<string>();   // keys the current worker has compiled

/** Kill the worker; every pending call fails with `msg`. The next call starts a fresh one. */
export function engineStop(msg = 'Stopped') {
  const w = worker; if (!w) return;
  worker = null; loaded.clear(); void w.terminate();
  for (const p of pending.values()) { clearTimeout(p.timer); p.fail(Error(msg)) }
  pending.clear();
}
function workerOf(): Worker {
  if (worker) return worker;
  // ponytail: one worker runs everything in turn; a pool if many heavy scripts make each other late.
  const w = (worker = new Worker(new URL('./engineworker.ts', import.meta.url)));
  w.unref();
  w.on('message', (m: { n: number; value?: never; error?: string }) => {
    const p = pending.get(m.n); if (!p) return;
    pending.delete(m.n); clearTimeout(p.timer);
    if (m.error != null) { loaded.delete(p.key); p.fail(Error(m.error)) } else p.ok(m.value!);
  });
  w.on('error', e => { if (worker === w) engineStop(`Engine worker crashed: ${e.message}`) });
  w.on('exit', () => { if (worker === w) engineStop('Engine worker stopped') });
  return w;
}

export interface EngineReq { key: string; source: ScriptSource; sym: string; tf: string; inputs: Record<string, unknown> }
function call<T>(op: 'fills' | 'out', x: EngineReq, bars: Bar[]): Promise<T> {
  const w = workerOf(), n = ++seq, first = !loaded.has(x.key);
  if (first && loaded.size >= MAX_JOBS) { engineStop('Too many scripts; engine restarted'); return call(op, x, bars) }
  loaded.add(x.key);
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => engineStop(`Script took longer than ${RUN_TIMEOUT / 1000} s; the engine was restarted`), RUN_TIMEOUT);
    pending.set(n, { key: x.key, ok: ok as (v: never) => void, fail, timer });
    w.postMessage({ n, op, key: x.key, source: first ? x.source : undefined, sym: x.sym, tf: x.tf, bars, inputs: x.inputs } satisfies WorkerReq);
  });
}
/** A strategy's fills on `bars` (throws the script's error). A run over RUN_TIMEOUT restarts the worker (endless loops). */
export const engineFills = (x: EngineReq, bars: Bar[]) => call<SimpleFill[]>('fills', x, bars);
/** A script's outputs on `bars`; script errors come back as `error`, compile errors throw. */
export const engineOut = (x: EngineReq, bars: Bar[]) => call<{ out?: Outputs; error?: string }>('out', x, bars);
/** Drop a compiled job from the worker. */
export function engineForget(key: string) { if (worker && loaded.delete(key)) worker.postMessage({ n: ++seq, op: 'forget', key } satisfies WorkerReq) }
