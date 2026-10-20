// Server-side forward tests (docs/phase5-contracts.md §6): run a chart strategy (Pine / MQL / NinjaScript) on the live
// series and mirror each new strategy fill as a market order into the synced paper account (`acct` state key).
// Hybrid: while a browser shows the same strategy on the same chart it runs it and sends the fills (`forward.fills`),
// which takes the load off the server; otherwise the server runs it in the engine worker thread (engine.ts).
import { randomUUID } from 'node:crypto';
import { db, migration } from './core/db.ts';
import { route, broadcast, bad, HttpError, onWs } from './core/http.ts';
import { watchSeries, isExprSym, type Bar } from './core/bars.ts';
import { stateGet, stateSet } from './state.ts';
import { notify, type Channel } from './notify/index.ts';
import { validTf } from '../src/data.ts';
import { scriptSig } from '../src/scriptsig.ts';
import { newAccount, placeOrder, type Account } from '../src/trading.ts';
import { buildJob, runFills, fillsOf, type ScriptSource, type SimpleFill } from './scripts.ts';
import { engineFills, engineForget, engineStop } from './engine.ts';
import { validSource } from './scriptsource.ts';

export { buildJob, runFills, fillsOf };

migration('forward/1', `
  CREATE TABLE forward (id TEXT PRIMARY KEY, name TEXT NOT NULL, sym TEXT NOT NULL, tf TEXT NOT NULL, source TEXT NOT NULL, inputs TEXT NOT NULL,
    qty_mult REAL NOT NULL, channels TEXT NOT NULL, created INTEGER NOT NULL, start INTEGER, done TEXT NOT NULL DEFAULT '[]',
    fills INTEGER NOT NULL DEFAULT 0, last_run INTEGER, last_error TEXT);
  CREATE TABLE forward_log (n INTEGER PRIMARY KEY, fwd TEXT NOT NULL REFERENCES forward(id) ON DELETE CASCADE, at INTEGER NOT NULL,
    t INTEGER NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, px REAL NOT NULL, error TEXT);
  CREATE INDEX forward_log_fwd ON forward_log (fwd, n);`);

export type ForwardSource = ScriptSource;
export interface ForwardInput { name: string; sym: string; tf: string; source: ForwardSource; inputs?: Record<string, unknown>; qtyMult: number; channels: Channel[] }
/** runsIn: 'browser' while an open chart runs the strategy and sends the fills, else 'server'. sig: see src/scriptsig.ts. */
export interface ForwardInfo { id: string; name: string; sym: string; tf: string; qtyMult: number; channels: Channel[]; created: number; start: number | null; status: 'starting' | 'running' | 'error'; fills: number; lastRun: number | null; lastError: string | null; sig: string; runsIn: 'browser' | 'server' }
export interface ForwardLog { at: number; t: number; side: 'buy' | 'sell'; qty: number; px: number; error: string | null }
export interface RunReq { id: string; source: ForwardSource; sym: string; tf: string; inputs: Record<string, unknown> }

/** Run a test's strategy on `bars` in the engine worker. */
export const runInWorker = (x: RunReq, bars: Bar[]) => engineFills({ ...x, key: `fwd:${x.id}` }, bars);

/** Swappable for tests (no network, fake clock). */
export const deps = { watch: watchSeries, now: () => Date.now(), notify, throttleMs: 2000, run: runInWorker, leaseMs: 15_000 };

export const fillKey = (f: SimpleFill) => `${f.time}|${f.side}|${+f.qty.toFixed(8)}`;

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

interface Row { id: string; name: string; sym: string; tf: string; source: string; inputs: string; qty_mult: number; channels: string; created: number; start: number | null; done: string; fills: number; last_run: number | null; last_error: string | null }
const running = new Map<string, () => void>();
const leases = new Map<string, number>();   // id → when a browser last sent fills
const sigs = new Map<string, string>();
const sigOf = (r: Row) => { let s = sigs.get(r.id); if (!s) sigs.set(r.id, (s = scriptSig(JSON.parse(r.source), JSON.parse(r.inputs)))); return s };
const leased = (id: string) => deps.now() - (leases.get(id) ?? -Infinity) < deps.leaseMs;

const info = (r: Row): ForwardInfo => ({ id: r.id, name: r.name, sym: r.sym, tf: r.tf, qtyMult: r.qty_mult, channels: JSON.parse(r.channels), created: r.created, start: r.start, status: r.last_error ? 'error' : r.start == null ? 'starting' : 'running', fills: r.fills, lastRun: r.last_run, lastError: r.last_error, sig: sigOf(r), runsIn: leased(r.id) ? 'browser' : 'server' });
const rows = () => db.prepare('SELECT * FROM forward ORDER BY created').all() as unknown as Row[];
const rowOf = (id: string) => db.prepare('SELECT * FROM forward WHERE id = ?').get(id) as Row | undefined;
export const list = () => rows().map(info);
const changed = () => broadcast({ type: 'forward', list: list() });

/** Mirror the new ones among `fills` (from the worker or a browser); `last` is the series' latest bar. */
function apply(id: string, fills: SimpleFill[], last: { time: number; close: number }) {
  const r = rowOf(id); if (!r) return;
  const now = deps.now();
  const step = freshFills(fills, r.start, new Set(JSON.parse(r.done)), last.time);
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
}
function fail(id: string, msg: string) {
  const r = rowOf(id); if (!r) return;
  db.prepare('UPDATE forward SET last_run = ?, last_error = ? WHERE id = ?').run(deps.now(), msg, id);
  if (msg !== r.last_error) changed();
}

// One run in flight per test; bars that arrive meanwhile are kept (latest only) and run right after.
const busy = new Map<string, Bar[] | null>(), inflight = new Set<Promise<void>>();
/** Resolves once no server run is in flight (tests). */
export async function settled() { while (inflight.size) await Promise.all(inflight) }
function schedule(id: string, bars: Bar[]) {
  if (busy.has(id)) { busy.set(id, bars.slice()); return }
  const r = rowOf(id), last = bars.at(-1);
  if (!r || !last) return;
  busy.set(id, null);
  const p: Promise<void> = deps.run({ id, source: JSON.parse(r.source), sym: r.sym, tf: r.tf, inputs: JSON.parse(r.inputs) }, bars)
    .then(f => { if (!leased(id)) apply(id, f, { time: last.time, close: last.close }) }, e => fail(id, (e as Error).message || String(e)))
    .finally(() => { inflight.delete(p); const q = busy.get(id); busy.delete(id); if (q && running.has(id)) schedule(id, q) });
  inflight.add(p);
}

function run(r: Pick<Row, 'id' | 'sym' | 'tf'>) {
  const { id, sym, tf } = r;
  let lastRun = -Infinity;
  running.set(id, deps.watch(sym, tf, (bars, closed) => {
    const t = deps.now();
    if (leased(id)) return;   // an open chart runs it
    if (leases.delete(id)) changed();   // that browser went away: the server takes over
    if (!closed && t - lastRun < deps.throttleMs) return;
    lastRun = t;
    schedule(id, bars);
  }));
}

// A browser that shows this strategy (same sources, inputs, symbol and interval: same `sig`) hands in its fills.
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function browserFills(id: string, sig: unknown, fills: unknown, last: unknown): boolean {
  const r = rowOf(id), l = last as { time?: unknown; close?: unknown } | null;
  if (!r || sig !== sigOf(r) || !Array.isArray(fills) || fills.length > 5000 || !l || !finite(l.time) || !finite(l.close) || l.close <= 0) return false;
  if (!fills.every(f => f && finite(f.time) && (f.side === 'buy' || f.side === 'sell') && finite(f.qty) && f.qty > 0)) return false;
  const was = leased(id);
  leases.set(id, deps.now());
  apply(id, (fills as SimpleFill[]).map(f => ({ time: f.time, side: f.side, qty: f.qty })), { time: l.time, close: l.close });
  if (!was) changed();
  return true;
}
onWs('forward.fills', (_c, m) => { browserFills(String(m.id ?? ''), m.sig, m.fills, m.last) });

/** Throws HttpError 400 when the sources don't compile, before anything is stored. */
export function create(x: ForwardInput): string {
  try { buildJob(x.source, x.sym, x.tf) } catch (e) { throw bad((e as Error).message) }
  const id = randomUUID(), source = JSON.stringify(x.source);
  db.prepare('INSERT INTO forward (id, name, sym, tf, source, inputs, qty_mult, channels, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, x.name, x.sym, x.tf, source, JSON.stringify(x.inputs ?? {}), x.qtyMult, JSON.stringify(x.channels), deps.now());
  run({ id, sym: x.sym, tf: x.tf });
  changed();
  return id;
}
export function remove(id: string): boolean {
  running.get(id)?.(); running.delete(id); leases.delete(id); sigs.delete(id);
  engineForget(`fwd:${id}`);
  const ok = db.prepare('DELETE FROM forward WHERE id = ?').run(id).changes > 0;
  if (ok) changed();
  return ok;
}
export const log = (id: string, limit = 500): ForwardLog[] => db.prepare('SELECT at, t, side, qty, px, error FROM forward_log WHERE fwd = ? ORDER BY n DESC LIMIT ?').all(id, limit) as unknown as ForwardLog[];
export function resumeAll() { for (const r of rows()) if (!running.has(r.id)) run(r) }
export function stopAll() { running.forEach(s => s()); running.clear(); leases.clear(); engineStop() }

const CHANNELS: Channel[] = ['popup', 'push', 'telegram', 'email', 'webhook'];
export function validate(b: unknown): ForwardInput {
  const x = b as Partial<ForwardInput> | undefined;
  if (!x || typeof x !== 'object') throw bad('Body required');
  const name = typeof x.name === 'string' ? x.name.trim().slice(0, 100) : '';
  if (!name) throw bad('Name required');
  if (typeof x.sym !== 'string' || !/^([A-Z0-9]+:)?[A-Za-z0-9_.\-/]{1,40}$/.test(x.sym) || isExprSym(x.sym)) throw bad('Bad symbol');
  if (typeof x.tf !== 'string' || !validTf(x.tf)) throw bad('Bad interval');
  const source = validSource(b as Record<string, unknown>);
  if (x.inputs != null && (typeof x.inputs !== 'object' || Array.isArray(x.inputs))) throw bad('Bad inputs');
  const qtyMult = Number(x.qtyMult ?? 1);
  if (!(qtyMult > 0 && qtyMult < 1e9)) throw bad('Size multiplier must be positive');
  const channels = Array.isArray(x.channels) ? x.channels : [];
  if (channels.some(c => !CHANNELS.includes(c))) throw bad('Bad channel');
  return { name, sym: x.sym, tf: x.tf, source, inputs: x.inputs ?? {}, qtyMult, channels: [...new Set(channels)] };
}
route('GET', '/api/forward', () => list());
route('POST', '/api/forward', c => ({ id: create(validate(c.body)) }));
route('DELETE', '/api/forward/:id', c => { if (!remove(c.params.id)) throw new HttpError(404, 'No such forward test') });
route('GET', '/api/forward/:id/log', c => {
  if (!db.prepare('SELECT 1 FROM forward WHERE id = ?').get(c.params.id)) throw new HttpError(404, 'No such forward test');
  return log(c.params.id, Math.min(2000, Math.max(1, Number(c.url.searchParams.get('limit')) || 500)));
});

if (!process.env.CT_NO_AUTOSTART) setImmediate(resumeAll);
