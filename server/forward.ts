// Server-side forward tests (docs/phase5-contracts.md §6): run a chart strategy (Pine / MQL / NinjaScript job) on the
// live series and mirror each new strategy fill as a market order into the synced paper account (`acct` state key).
import { randomUUID } from 'node:crypto';
import { db, migration } from './core/db.ts';
import { route, broadcast, bad, HttpError } from './core/http.ts';
import { watchSeries, isExprSym, type Bar } from './core/bars.ts';
import { stateGet, stateSet } from './state.ts';
import { notify, type Channel } from './notify/index.ts';
import { validTf, tfSeconds } from '../src/data.ts';
import { runScript } from '../src/pine/engine.ts';
import { compileMql, runMql } from '../src/mql/engine.ts';
import { compileNinja, runNinjaScript } from '../src/ninja/engine.ts';
import type { Outputs } from '../src/pine/interp.ts';
import type { Job } from '../src/tester/runner.ts';
import { newAccount, placeOrder, type Account } from '../src/trading.ts';

migration('forward/1', `
  CREATE TABLE forward (id TEXT PRIMARY KEY, name TEXT NOT NULL, sym TEXT NOT NULL, tf TEXT NOT NULL, source TEXT NOT NULL, inputs TEXT NOT NULL,
    qty_mult REAL NOT NULL, channels TEXT NOT NULL, created INTEGER NOT NULL, start INTEGER, done TEXT NOT NULL DEFAULT '[]',
    fills INTEGER NOT NULL DEFAULT 0, last_run INTEGER, last_error TEXT);
  CREATE TABLE forward_log (n INTEGER PRIMARY KEY, fwd TEXT NOT NULL REFERENCES forward(id) ON DELETE CASCADE, at INTEGER NOT NULL,
    t INTEGER NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, px REAL NOT NULL, error TEXT);
  CREATE INDEX forward_log_fwd ON forward_log (fwd, n);`);

/** Script sources only — the server compiles them itself and never runs JS sent by a client. */
export interface ForwardSource { lang: 'pine' | 'mql4' | 'mql5' | 'ninja'; files: Record<string, string>; main: string; cls?: string; prec: number }
export interface ForwardInput { name: string; sym: string; tf: string; source: ForwardSource; inputs?: Record<string, unknown>; qtyMult: number; channels: Channel[] }
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

interface Row { id: string; name: string; sym: string; tf: string; source: string; inputs: string; qty_mult: number; channels: string; created: number; start: number | null; done: string; fills: number; last_run: number | null; last_error: string | null }
const running = new Map<string, () => void>(), jobs = new Map<string, Job>();

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
    const job = jobs.get(id);
    if (!job) throw Error('Not compiled');
    const step = freshFills(runFills(job, bars, JSON.parse(r.inputs)), r.start, new Set(JSON.parse(r.done)), last.time);
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

/** Compile the stored sources (never client-supplied JS) and start watching; a compile error is shown as the test's error. */
function run(r: Pick<Row, 'id' | 'sym' | 'tf' | 'source'>) {
  const { id, sym, tf } = r;
  try { jobs.set(id, buildJob(JSON.parse(r.source), sym, tf)) }
  catch (e) { db.prepare('UPDATE forward SET last_error = ? WHERE id = ?').run((e as Error).message, id); return }
  let lastRun = -Infinity;
  // ponytail: engines run synchronously on the server thread; move to a worker_thread if many tests make ticks lag.
  running.set(id, deps.watch(sym, tf, (bars, closed) => {
    const t = deps.now();
    if (!closed && t - lastRun < deps.throttleMs) return;
    lastRun = t;
    evaluate(id, bars);
  }));
}

/** Throws HttpError 400 when the sources don't compile, before anything is stored. */
export function create(x: ForwardInput): string {
  try { buildJob(x.source, x.sym, x.tf) } catch (e) { throw bad((e as Error).message) }
  const id = randomUUID(), source = JSON.stringify(x.source);
  db.prepare('INSERT INTO forward (id, name, sym, tf, source, inputs, qty_mult, channels, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, x.name, x.sym, x.tf, source, JSON.stringify(x.inputs ?? {}), x.qtyMult, JSON.stringify(x.channels), deps.now());
  run({ id, sym: x.sym, tf: x.tf, source });
  changed();
  return id;
}
export function remove(id: string): boolean {
  running.get(id)?.(); running.delete(id); jobs.delete(id);
  const ok = db.prepare('DELETE FROM forward WHERE id = ?').run(id).changes > 0;
  if (ok) changed();
  return ok;
}
export const log = (id: string, limit = 500): ForwardLog[] => db.prepare('SELECT at, t, side, qty, px, error FROM forward_log WHERE fwd = ? ORDER BY n DESC LIMIT ?').all(id, limit) as unknown as ForwardLog[];
export function resumeAll() { for (const r of rows()) if (!running.has(r.id)) run(r) }
export function stopAll() { running.forEach(s => s()); running.clear(); jobs.clear() }

/** Build the engine job on the server with the trusted compilers, mirroring ChartPane.testerJob. */
export function buildJob(s: ForwardSource, symbol: string, tf: string): Job {
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
/** Only source code is accepted: anything that looks like compiled JS (`job`, `js`, `cr` anywhere) is refused. */
function hasJsKey(v: unknown, depth = 0): boolean {
  if (!v || typeof v !== 'object' || depth > 20) return false;
  return Object.entries(v).some(([k, x]) => k === 'js' || k === 'cr' || k === 'job' || hasJsKey(x, depth + 1));
}
const LANGS = ['pine', 'mql4', 'mql5', 'ninja'];
function validSource(b: Record<string, unknown>): ForwardSource {
  if (hasJsKey(b)) throw bad('Send script sources, not compiled code');
  const { lang, files, main, cls, prec = 2 } = b as Partial<ForwardSource>;
  if (typeof lang !== 'string' || !LANGS.includes(lang)) throw bad('Bad lang');
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw bad('files required');
  const names = Object.keys(files);
  if (!names.length || names.length > 50) throw bad('1 to 50 files');
  let size = 0;
  for (const n of names) {
    if (!/^[^\u0000-\u001f]{1,120}$/.test(n) || typeof files[n] !== 'string') throw bad(`Bad file ${n.slice(0, 40)}`);
    size += n.length + files[n].length;
  }
  if (size > 1024 * 1024) throw bad('Sources larger than 1 MB');
  if (typeof main !== 'string' || !Object.hasOwn(files, main)) throw bad('main must name one of the files');
  if (cls != null && (typeof cls !== 'string' || !/^\w{1,100}$/.test(cls))) throw bad('Bad class name');
  if (!Number.isInteger(prec) || prec < 0 || prec > 12) throw bad('Bad precision');
  // Pine runs one file; keep only what the language uses.
  const own = lang === 'pine' ? [main] : names;
  return { lang: lang as ForwardSource['lang'], files: Object.fromEntries(own.map(n => [n, files[n]])), main, cls: cls ?? undefined, prec };
}

route('GET', '/api/forward', () => list());
route('POST', '/api/forward', c => ({ id: create(validate(c.body)) }));
route('DELETE', '/api/forward/:id', c => { if (!remove(c.params.id)) throw new HttpError(404, 'No such forward test') });
route('GET', '/api/forward/:id/log', c => {
  if (!db.prepare('SELECT 1 FROM forward WHERE id = ?').get(c.params.id)) throw new HttpError(404, 'No such forward test');
  return log(c.params.id, Math.min(2000, Math.max(1, Number(c.url.searchParams.get('limit')) || 500)));
});

if (!process.env.CT_NO_AUTOSTART) setImmediate(resumeAll);
