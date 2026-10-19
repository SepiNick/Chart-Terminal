// Runs optimisation and walk-forward off the UI thread. Stop = the page terminates the worker.
import { optimize, walkForward } from './optimize.ts';
import { makeEvaluate, type Job } from './runner.ts';
import type { Bar, OptimizeOptions, ParamSpec, WalkForwardOptions } from './types.ts';

export type WorkerMsg =
  | { type: 'optimize'; job: Job; bars: Bar[]; params: ParamSpec[]; base: Record<string, unknown>; opts: Omit<OptimizeOptions, 'onProgress' | 'shouldStop'> }
  | { type: 'wfa'; job: Job; bars: Bar[]; params: ParamSpec[]; base: Record<string, unknown>; opts: Omit<WalkForwardOptions, 'onProgress' | 'shouldStop'> };

self.onmessage = (e: MessageEvent<WorkerMsg>) => {
  const m = e.data, ev = makeEvaluate(m.job, m.bars);
  let last = 0;
  const progress = (done: number, total: number) => { const now = Date.now(); if (now - last > 150 || done === total) { last = now; postMessage({ type: 'progress', done, total }) } };
  try {
    const result = m.type === 'optimize'
      ? optimize(ev, m.bars, m.params, m.base, { ...m.opts, onProgress: progress })
      : walkForward(ev, m.bars, m.params, m.base, { ...m.opts, onProgress: progress });
    postMessage({ type: 'done', result });
  } catch (err) { postMessage({ type: 'error', msg: (err as Error).message }) }
};
