// Server-side forward tests (docs/phase5-contracts.md §6): run a chart strategy (Pine / MQL / NinjaScript job) on the
// live series and mirror each new strategy fill as a market order into the synced paper account (`acct` state key).
import { randomUUID } from 'node:crypto';
import { db, migration } from './core/db.ts';
import { route, broadcast, bad, HttpError } from './core/http.ts';
import { watchSeries, isExprSym, type Bar } from './core/bars.ts';
import { stateGet, stateSet } from './state.ts';
import { notify, type Channel } from './notify/index.ts';
import { validTf } from '../src/data.ts';
import { runScript } from '../src/pine/engine.ts';
import { runMql } from '../src/mql/engine.ts';
import { runNinjaScript } from '../src/ninja/engine.ts';
import type { Outputs } from '../src/pine/interp.ts';
import type { Job } from '../src/tester/runner.ts';
import { newAccount, placeOrder, type Account } from '../src/trading.ts';

migration('forward/1', `
  CREATE TABLE forward (id TEXT PRIMARY KEY, name TEXT NOT NULL, sym TEXT NOT NULL, tf TEXT NOT NULL, job TEXT NOT NULL, inputs TEXT NOT NULL,
    qty_mult REAL NOT NULL, channels TEXT NOT NULL, created INTEGER NOT NULL, start INTEGER, done TEXT NOT NULL DEFAULT '[]',
    fills INTEGER NOT NULL DEFAULT 0, last_run INTEGER, last_error TEXT);
  CREATE TABLE forward_log (n INTEGER PRIMARY KEY, fwd TEXT NOT NULL REFERENCES forward(id) ON DELETE CASCADE, at INTEGER NOT NULL,
    t INTEGER NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, px REAL NOT NULL, error TEXT);
  CREATE INDEX forward_log_fwd ON forward_log (fwd, n);`);

export interface ForwardInput { name: string; sym: string; tf: string; job: Job; inputs?: Record<string, unknown>; qtyMult: number; channels: Channel[] }
export interface ForwardInfo { id: string; name: string; sym: string; tf: string; qtyMult: number; channels: Channel[]; created: number; start: number | null; status: 'starting' | 'running' | 'error'; fills: number; lastRun: number | null; lastError: string | null }
export interface ForwardLog { at: number; t: number; side: 'buy' | 'sell'; qty: number; px: number; error: string | null }
type SimpleFill = { time: number; side: 'buy' | 'sell'; qty: number };

/** Swappable for tests (no network, fake clock). */
export const deps = { watch: watchSeries, now: () => Date.now(), notify, throttleMs: 2000 };

export const fillKey = (f: SimpleFill) => `${f.time}|${f.side}|${+f.qty.toFixed(8)}`;
/** Fills of any engine's outputs: Pine broker fills, MQL deals, NinjaScript executions (exposed as mqlDeals). */
export function fillsOf(out: Outputs | undefined): SimpleFill[] {
  const o = out as (Outputs & { mqlDeals?: { time: number; type: string; volume: number }[] }) | undefined;
  if (o?.broker) return o.broker.fills.map(f => ({ time: f.time, side: f.side, qty: f.qty }));
  return (o?.mqlDeals ?? []).filter(d => d.type === 'buy' || d.type === 'sell').map(d => ({ time: d.time, side: d.type as 'buy' | 'sell', qty: d.volume }));
}
/** Run a job on bars and return its fills; throws the script's error. */
export function runFills(job: Job, bars: Bar[], inputs: Record<string, unknown>): SimpleFill[] {
  if (job.kind === 'pine') {
    const r = runScript(job.src, bars, { ...job.opts, inputs: inputs as never });
    if (r.error) throw Error(r.error.msg);
    return fillsOf(r.out);
  }
  if (job.kind === 'mql') {
    const r = runMql(job.js, bars, { ...job.opts, inputs });
    if (r.error) throw Error(r.error);
    return fillsOf(r.out);
  }
  const r = runNinjaScript(job.cr, job.cls, bars, { ...job.opts, inputs });
  if (r.result.error) throw Error(r.result.error);
  return fillsOf(r.out);
}

/**
 * Pure step: given the fills of the latest run, return the ones to mirror (time ≥ start, not seen before) and the
 * updated seen-set. The first run (start == null) only records the start bar and what the backtest already filled.
 */
export function freshFills(fills: SimpleFill[], start: number | null, done: Set<string>, startBar: number) {
  if (start == null) return { start: startBar, fresh: [] as SimpleFill[], done: new Set(fills.map(fillKey)) };
  // ponytail: fills are keyed by time/side/size like the browser version; a live-bar fill that a re-run moves would be mirrored twice.
  const fresh = fills.filter(f => f.time >= start && !done.has(fillKey(f)));
  const next = new Set([...done].filter(k => +k.split('|')[0] >= start));   // keys before the start can never match again
  fresh.forEach(f => next.add(fillKey(f)));
  return { start, fresh, done: next };
}

/** Market order on the shared paper account at `px`; returns the error text or null. */
export function mirror(sym: string, f: SimpleFill, qty: number, px: number, ts: number): string | null {
  const a = stateGet<Account>('acct')?.value ?? newAccount();
  const err = placeOrder(a, { sym, side: f.side, type: 'market', qty }, px, ts);
  if (!err) stateSet('acct', a);
  return err;
}

interface Row { id: string; name: string; sym: string; tf: string; job: string; inputs: string; qty_mult: number; channels: string; created: number; start: number | null; done: string; fills: number; last_run: number | null; last_error: string | null }
const running = new Map<string, () => void>();

const info = (r: Row): ForwardInfo => ({ id: r.id, name: r.name, sym: r.sym, tf: r.tf, qtyMult: r.qty_mult, channels: JSON.parse(r.channels), created: r.created, start: r.start, status: r.last_error ? 'error' : r.start == null ? 'starting' : 'running', fills: r.fills, lastRun: r.last_run, lastError: r.last_error });
const rows = () => db.prepare('SELECT * FROM forward ORDER BY created').all() as unknown as Row[];
export const list = () => rows().map(info);
const changed = () => broadcast({ type: 'forward', list: list() });

function evaluate(id: string, bars: Bar[]) {
  const r = db.prepare('SELECT * FROM forward WHERE id = ?').get(id) as Row | undefined;
  const last = bars.at(-1);
  if (!r || !last) return;
  const now = deps.now();
  let err: string | null = null;
  try {
    const step = freshFills(runFills(JSON.parse(r.job), bars, JSON.parse(r.inputs)), r.start, new Set(JSON.parse(r.done)), last.time);
    for (const f of step.fresh) {
      const qty = +(f.qty * r.qty_mult).toFixed(8);
      const e = qty > 0 ? mirror(r.sym, f, qty, last.close, now / 1000) : 'Size is 0 after the multiplier';
      db.prepare('INSERT INTO forward_log (fwd, at, t, side, qty, px, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, now, f.time, f.side, qty, last.close, e);
      if (!e) deps.notify({
        title: `${r.name} forward test`, body: `${f.side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${r.sym} at ${last.close} (paper)`,
        channels: [...new Set<Channel>(['popup', ...(JSON.parse(r.channels) as Channel[])])],
        data: { forwardId: id, sym: r.sym, tf: r.tf, side: f.side, qty, price: last.close, url: `/?${new URLSearchParams({ symbol: r.sym, tf: r.tf })}` },
      }).catch(() => {});
    }
    const mirrored = step.fresh.length;
    db.prepare('UPDATE forward SET start = ?, done = ?, fills = fills + ?, last_run = ?, last_error = NULL WHERE id = ?').run(step.start, JSON.stringify([...step.done]), mirrored, now, id);
    if (mirrored || r.start == null || r.last_error) changed();
  } catch (e) {
    err = (e as Error).message || String(e);
    db.prepare('UPDATE forward SET last_run = ?, last_error = ? WHERE id = ?').run(now, err, id);
    if (err !== r.last_error) changed();
  }
}

function run(id: string, sym: string, tf: string) {
  let lastRun = -Infinity;
  // ponytail: engines run synchronously on the server thread; move to a worker_thread if many tests make ticks lag.
  running.set(id, deps.watch(sym, tf, (bars, closed) => {
    const t = deps.now();
    if (!closed && t - lastRun < deps.throttleMs) return;
    lastRun = t;
    evaluate(id, bars);
  }));
}

export function create(x: ForwardInput): string {
  const id = randomUUID();
  db.prepare('INSERT INTO forward (id, name, sym, tf, job, inputs, qty_mult, channels, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, x.name, x.sym, x.tf, JSON.stringify(x.job), JSON.stringify(x.inputs ?? {}), x.qtyMult, JSON.stringify(x.channels), deps.now());
  run(id, x.sym, x.tf);
  changed();
  return id;
}
export function remove(id: string): boolean {
  running.get(id)?.(); running.delete(id);
  const ok = db.prepare('DELETE FROM forward WHERE id = ?').run(id).changes > 0;
  if (ok) changed();
  return ok;
}
export const log = (id: string, limit = 500): ForwardLog[] => db.prepare('SELECT at, t, side, qty, px, error FROM forward_log WHERE fwd = ? ORDER BY n DESC LIMIT ?').all(id, limit) as unknown as ForwardLog[];
export function resumeAll() { for (const r of rows()) if (!running.has(r.id)) run(r.id, r.sym, r.tf) }
export function stopAll() { running.forEach(s => s()); running.clear() }

const CHANNELS: Channel[] = ['popup', 'push', 'telegram', 'email', 'webhook'];
function validate(b: unknown): ForwardInput {
  const x = b as Partial<ForwardInput> | undefined;
  if (!x || typeof x !== 'object') throw bad('Body required');
  const name = typeof x.name === 'string' ? x.name.trim().slice(0, 100) : '';
  if (!name) throw bad('Name required');
  if (typeof x.sym !== 'string' || !/^([A-Z0-9]+:)?[A-Za-z0-9_.\-/]{1,40}$/.test(x.sym) || isExprSym(x.sym)) throw bad('Bad symbol');
  if (typeof x.tf !== 'string' || !validTf(x.tf)) throw bad('Bad interval');
  const j = x.job as Job | undefined;
  const okJob = j && typeof j === 'object' && typeof j.opts === 'object' && j.opts !== null &&
    (j.kind === 'pine' ? typeof j.src === 'string' : j.kind === 'mql' ? typeof j.js === 'string' : j.kind === 'ninja' ? typeof j.cls === 'string' && typeof j.cr?.js === 'string' : false);
  if (!okJob) throw bad('Bad job');
  if (x.inputs != null && (typeof x.inputs !== 'object' || Array.isArray(x.inputs))) throw bad('Bad inputs');
  const qtyMult = Number(x.qtyMult ?? 1);
  if (!(qtyMult > 0 && qtyMult < 1e9)) throw bad('Size multiplier must be positive');
  const channels = Array.isArray(x.channels) ? x.channels : [];
  if (channels.some(c => !CHANNELS.includes(c))) throw bad('Bad channel');
  return { name, sym: x.sym, tf: x.tf, job: j!, inputs: x.inputs ?? {}, qtyMult, channels: [...new Set(channels)] };
}

route('GET', '/api/forward', () => list());
route('POST', '/api/forward', c => ({ id: create(validate(c.body)) }));
route('DELETE', '/api/forward/:id', c => { if (!remove(c.params.id)) throw new HttpError(404, 'No such forward test') });
route('GET', '/api/forward/:id/log', c => {
  if (!db.prepare('SELECT 1 FROM forward WHERE id = ?').get(c.params.id)) throw new HttpError(404, 'No such forward test');
  return log(c.params.id, Math.min(2000, Math.max(1, Number(c.url.searchParams.get('limit')) || 500)));
});

if (!process.env.CT_NO_AUTOSTART) setImmediate(resumeAll);
