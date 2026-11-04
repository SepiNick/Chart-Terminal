// A small pool of worker threads (engineworker.ts) that runs every server-side script: forward tests and script alerts.
// Callers name each compiled job with a `key`; a key always goes to the same worker (its compiled job lives there) and
// its sources travel to that worker only the first time. A hung or crashed script restarts only its own worker.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { Bar } from '../src/data.ts';
import type { Outputs } from '../src/pine/interp.ts';
import type { ScriptSource, SimpleFill } from './scripts.ts';
import type { WorkerReq } from './engineworker.ts';

export const RUN_TIMEOUT = 20_000;
/** Tunables; tests shorten the timeout. */
export const engineOpts = { timeoutMs: RUN_TIMEOUT };
const MAX_JOBS = 300;   // per worker
type Pending = { key: string; ok: (v: never) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Slot = { w: Worker | null; loaded: Set<string>; pending: Map<number, Pending> };
let slots: Slot[] = [], seq = 0;

/** CT_ENGINE_WORKERS, else min(4, cores - 1), at least 1. */
export function poolSize(): number {
  const env = Number(process.env.CT_ENGINE_WORKERS);
  return Math.max(1, Math.floor(env > 0 ? env : Math.min(4, availableParallelism() - 1)));
}
function pool(): Slot[] {
  if (!slots.length) slots = Array.from({ length: poolSize() }, () => ({ w: null, loaded: new Set<string>(), pending: new Map() }));
  return slots;
}
/** Which worker runs `key` (FNV-1a hash, stable for the process). */
export function slotOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) % pool().length;
}
/** Thread ids of the running workers (null = not started); for tests and diagnostics. */
export const engineThreads = () => pool().map(s => s.w?.threadId ?? null);

/** Kill one worker; only its pending calls fail with `msg`. The next call to it starts a fresh one. */
function restart(s: Slot, msg: string) {
  const w = s.w; if (!w) return;
  s.w = null; s.loaded.clear(); void w.terminate();
  for (const p of s.pending.values()) { clearTimeout(p.timer); p.fail(Error(msg)) }
  s.pending.clear();
}
/** Kill every worker; every pending call fails with `msg`. */
export function engineStop(msg = 'Stopped') { for (const s of slots) restart(s, msg) }

function workerOf(s: Slot): Worker {
  if (s.w) return s.w;
  // Bundled (desktop app) the worker sits next to the bundle as .js.
  const w = (s.w = new Worker(new URL(import.meta.url.endsWith('.ts') ? './engineworker.ts' : './engineworker.js', import.meta.url)));
  w.unref();
  w.on('message', (m: { n: number; value?: never; error?: string }) => {
    const p = s.pending.get(m.n); if (!p) return;
    s.pending.delete(m.n); clearTimeout(p.timer);
    if (m.error != null) { s.loaded.delete(p.key); p.fail(Error(m.error)) } else p.ok(m.value!);
  });
  w.on('error', e => { if (s.w === w) restart(s, `Engine worker crashed: ${e.message}`) });
  w.on('exit', () => { if (s.w === w) restart(s, 'Engine worker stopped') });
  return w;
}

interface EngineReq { key: string; source: ScriptSource; sym: string; tf: string; inputs: Record<string, unknown> }
function call<T>(op: 'fills' | 'out', x: EngineReq, bars: Bar[]): Promise<T> {
  const s = pool()[slotOf(x.key)], w = workerOf(s), n = ++seq, first = !s.loaded.has(x.key);
  if (first && s.loaded.size >= MAX_JOBS) { restart(s, 'Too many scripts; engine restarted'); return call(op, x, bars) }
  s.loaded.add(x.key);
  const ms = engineOpts.timeoutMs;
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => restart(s, `Script took longer than ${ms / 1000} s; the engine was restarted`), ms);
    s.pending.set(n, { key: x.key, ok: ok as (v: never) => void, fail, timer });
    w.postMessage({ n, op, key: x.key, source: first ? x.source : undefined, sym: x.sym, tf: x.tf, bars, inputs: x.inputs } satisfies WorkerReq);
  });
}
/** A strategy's fills on `bars` (throws the script's error). A run over the timeout restarts its worker (endless loops). */
export const engineFills = (x: EngineReq, bars: Bar[]) => call<SimpleFill[]>('fills', x, bars);
/** A script's outputs on `bars`; script errors come back as `error`, compile errors throw. */
export const engineOut = (x: EngineReq, bars: Bar[]) => call<{ out?: Outputs; error?: string }>('out', x, bars);
/** Drop a compiled job from its worker. */
export function engineForget(key: string) {
  const s = pool()[slotOf(key)];
  if (s.w && s.loaded.delete(key)) s.w.postMessage({ n: ++seq, op: 'forget', key } satisfies WorkerReq);
}
