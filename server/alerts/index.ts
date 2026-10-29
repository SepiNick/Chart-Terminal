// [agent: alerts] Server-side alert engine. See docs/phase5-contracts.md §5.
//   GET /api/alerts → Alert[]          POST /api/alerts AlertInput → Alert
//   PUT /api/alerts/:id (partial)      DELETE /api/alerts/:id
//   GET /api/alerts/log?limit=&alert=  DELETE /api/alerts/log
//   WS ← { type: 'alerts', alerts } after every change, { type: 'alert.fired', log } per fire.
// Evaluation logic lives in evaluate.ts (pure); this file keeps alerts in SQLite + memory and wires them to watchSeries.
import { randomUUID } from 'node:crypto';
import type { Alert, AlertLog, Channel } from '../../src/alerttypes.ts';
import { tfSeconds, type Bar } from '../../src/data.ts';
import { scriptSig } from '../../src/scriptsig.ts';
import type { ScriptSource } from '../scripts.ts';
import { engineOut } from '../engine.ts';
import type { Outputs } from '../../src/pine/interp.ts';
import { db, migration } from '../core/db.ts';
import { HttpError, bad, broadcast, route } from '../core/http.ts';
import { watchSeries } from '../core/bars.ts';
import { notify } from '../notify/index.ts';
import * as E from './evaluate.ts';
import { validateInput } from './validate.ts';

migration('alerts/1', `
  CREATE TABLE alerts (id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE alert_log (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL, at INTEGER NOT NULL, message TEXT NOT NULL, price REAL, deliveries TEXT NOT NULL);
`);
const MAX_ALERTS = 500, LOG_KEEP = 5000, RUN_EVERY = 2000;

const alerts = new Map<string, Alert>();
for (const r of db.prepare('SELECT data FROM alerts ORDER BY created').all() as { data: string }[]) { const a = JSON.parse(r.data) as Alert; alerts.set(a.id, a) }
const states = new Map<string, E.EvalState>();
// After a restart, lastFired keeps once_per_bar / once_per_minute from repeating within the same bar / minute.
const stateOf = (a: Alert) => {
  let s = states.get(a.id);
  if (!s) {
    states.set(a.id, (s = E.newState()));
    if (a.lastFired) { const sec = tfSeconds(a.tf); s.lastFireAt = a.lastFired; s.firedBar = Math.floor(a.lastFired / 1000 / sec) * sec }
  }
  return s;
};

const list = () => [...alerts.values()];
const save = (a: Alert) => db.prepare('INSERT INTO alerts (id, data, created) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(a.id, JSON.stringify(a), a.created);
function changed() { broadcast({ type: 'alerts', alerts: list() }); sync() }
function stop(a: Alert, reason: string) { a.active = false; a.stoppedReason = reason; save(a); changed() }

// ---------- live series: one watchSeries per (sym, tf) that an active alert needs ----------
/** Swappable for tests (no network, scripts on this thread). */
export const deps = { watch: watchSeries, notify, run: engineOut, now: () => Date.now() };
/** Script runs per (script, inputs, precision) on one series: one in flight, the latest bars queued behind it. */
interface ScriptState { at: number; busy: boolean; queued?: { bars: Bar[]; closed: boolean } }
const watchers = new Map<string, { stop: () => void; scripts: Map<string, ScriptState> }>();

function sync() {
  const need = new Set(list().filter(a => a.active).map(a => `${a.sym}|${a.tf}`));
  for (const [k, w] of watchers) if (!need.has(k)) { w.stop(); watchers.delete(k) }
  for (const k of need) if (!watchers.has(k)) {
    const [sym, tf] = k.split('|'), w = { stop: () => {}, scripts: new Map<string, ScriptState>() };
    watchers.set(k, w);
    w.stop = deps.watch(sym, tf, (bars, closed) => onBars(sym, tf, w.scripts, bars, closed));
  }
}

const safe = (a: Alert, f: () => void) => { try { f() } catch (e) { console.error(`[alerts] ${a.id}: ${(e as Error).message}`) } };
const isScript = (a: Alert): a is Alert & { source: Extract<Alert['source'], { script: string }> } => a.source.kind === 'indicator' || a.source.kind === 'script';

function onBars(sym: string, tf: string, scripts: Map<string, ScriptState>, bars: Bar[], closed: boolean) {
  const now = deps.now(), prec = digits(bars), keys = new Set<string>();
  for (const a of list()) {
    if (!a.active || a.sym !== sym || a.tf !== tf) continue;
    if (isScript(a)) keys.add(keyOf(a, prec)); else safe(a, () => evaluate(a, bars, closed, now));
  }
  for (const k of keys) request(sym, tf, scripts, k, prec, bars, closed);
}

const digits = (bars: Bar[]) => {
  let d = 0;
  for (const b of bars.slice(-50)) { const s = String(b.close); d = Math.max(d, s.includes('e-') ? 8 : s.split('.')[1]?.length ?? 0) }
  return Math.min(d, 8);
};
/** What runs: Pine source or MQL / NinjaScript sources (compiled by the server, never client JS). */
const sourceOf = (a: Alert & { source: { script: string; code?: ScriptSource } }, prec: number): ScriptSource =>
  a.source.code ?? { lang: 'pine', files: { 'main.pine': a.source.script }, main: 'main.pine', prec };
const sigs = new WeakMap<Alert, string>();
/** Alerts with the same script and inputs share each run. Pine's mintick follows the series' precision. */
function keyOf(a: Alert, prec: number) {
  const x = a as Alert & { source: { script: string; code?: ScriptSource; inputs?: Record<string, unknown> } };
  let s = sigs.get(a);
  if (!s) sigs.set(a, (s = scriptSig(sourceOf(x, 0), x.source.inputs)));
  return `alert:${s}|${a.sym}|${a.tf}|${x.source.code ? '' : prec}`;
}

/**
 * Run a script in the engine worker: fresh on every bar close, else at most every RUN_EVERY ms while the bar forms.
 * When it answers, every alert using that script is evaluated on the bars it ran on.
 */
function request(sym: string, tf: string, scripts: Map<string, ScriptState>, key: string, prec: number, bars: Bar[], closed: boolean) {
  let s = scripts.get(key);
  if (!s) scripts.set(key, (s = { at: -Infinity, busy: false }));
  if (s.busy) { s.queued = { bars: bars.slice(), closed: closed || !!s.queued?.closed }; return }
  if (!closed && deps.now() - s.at < RUN_EVERY) return;
  const users = () => list().filter(a => a.active && a.sym === sym && a.tf === tf && isScript(a) && keyOf(a, prec) === key);
  const a0 = users()[0] as (Alert & { source: { script: string; code?: ScriptSource; inputs?: Record<string, unknown> } }) | undefined;
  if (!a0) { scripts.delete(key); return }
  s.busy = true; s.at = deps.now();
  const snap = bars.slice(), st = s;
  const p = deps.run({ key, source: sourceOf(a0, prec), sym, tf, inputs: a0.source.inputs ?? {} }, snap)
    .catch(e => ({ error: (e as Error).message || String(e) }) as { out?: Outputs; error?: string })
    .then(r => { const now = deps.now(); for (const a of users()) safe(a, () => evaluate(a, snap, closed, now, r)) })
    .finally(() => {
      inflight.delete(p); st.busy = false;
      const q = st.queued; st.queued = undefined;
      if (q && scripts.get(key) === st) request(sym, tf, scripts, key, prec, q.bars, q.closed);
    });
  inflight.add(p);
}
const inflight = new Set<Promise<void>>();
/** Resolves once no script run is in flight (tests). */
export async function settled() { while (inflight.size) await Promise.all(inflight) }

/** `r`: the script's run on these bars (indicator / script sources only). */
function evaluate(a: Alert, bars: Bar[], closed: boolean, now: number, r?: { out?: Outputs; error?: string }) {
  if (E.expired(a, now)) return stop(a, 'expired');
  const i = E.pick(a.frequency, bars, closed);
  if (i === null) return;
  const st = stateOf(a), src = a.source, closedMode = a.frequency === 'once_per_bar_close';
  let out: Outputs | undefined;
  if (src.kind === 'indicator' || src.kind === 'script') {
    if (!r) return;
    if (r.error) return stop(a, `script error: ${r.error}`);
    out = r.out!;
  }
  if (src.kind === 'script') {
    if (src.event === 'strategy' && !out!.broker && !E.dealsOf(out!)) return stop(a, 'script is not a strategy');
    for (const h of E.scriptHits(a, st, out!, i, closedMode, bars[i].time)) {
      if (!a.active) break;
      if (E.frequencyAllows(a.frequency, st, bars[i].time, now)) fire(a, st, bars, i, now, out, h.message, h.vars);
    }
    return;
  }
  let values: number[];
  if (src.kind === 'indicator') {
    const p = out!.plots[src.plot];
    if (!p) return stop(a, `script has no plot #${src.plot}`);
    values = p.values;
  } else values = bars.map(b => b.close);
  const tNow = closedMode ? bars[i].time : now / 1000, tPrev = closedMode ? bars[i - 1]?.time : undefined;
  if (E.evalLevel(a, st, values, i, tNow, tPrev) && E.frequencyAllows(a.frequency, st, bars[i].time, now)) fire(a, st, bars, i, now, out);
}

const describe = (a: Alert) => a.source.kind === 'script' ? 'script alert'
  : `${a.source.kind === 'indicator' ? 'plot_' + a.source.plot : 'price'} ${a.condition!.replace(/_/g, ' ')}${a.source.kind === 'drawing' ? ' line' : a.value !== undefined ? ' ' + a.value + (a.value2 !== undefined ? '–' + a.value2 : '') : ''}`;

function fire(a: Alert, st: E.EvalState, bars: Bar[], i: number, now: number, out?: Outputs, scriptMsg?: string, extra: Record<string, string> = {}) {
  const vars = { ...E.barVars(a, bars, i, now, out), ...extra };
  const message = E.render(a.message.trim() ? a.message : scriptMsg ?? `{{ticker}} {{interval}}: ${describe(a)} at {{close}}`, vars);
  a.lastFired = now; a.fireCount++;
  const auto = E.recordFire(st, bars[i].time, now, a.autoStop);
  if (a.frequency === 'once') a.active = false;
  if (auto) { a.active = false; a.stoppedReason = auto }
  save(a); changed();
  const channels = [...new Set<Channel>(['popup', ...a.channels])], price = bars[i].close;
  const webhook = a.webhook && channels.includes('webhook') ? { url: a.webhook.url, body: a.webhook.body ? E.render(a.webhook.body, { ...vars, message }) : message } : undefined;
  deps.notify({ title: `${a.name || a.sym} alert`, body: message, channels, sound: true, webhook, data: { alertId: a.id, sym: a.sym, tf: a.tf, price, url: `/?symbol=${encodeURIComponent(a.sym)}&tf=${encodeURIComponent(a.tf)}` } })
    .catch(e => [{ channel: 'popup' as Channel, ok: false, error: String((e as Error).message ?? e) }])
    .then(deliveries => {
      const r = db.prepare('INSERT INTO alert_log (alert_id, at, message, price, deliveries) VALUES (?, ?, ?, ?, ?)').run(a.id, now, message, price, JSON.stringify(deliveries));
      const id = Number(r.lastInsertRowid);
      if (id % 100 === 0) db.prepare('DELETE FROM alert_log WHERE id <= ?').run(id - LOG_KEEP);
      const log: AlertLog = { id, alertId: a.id, at: now, message, price, deliveries };
      broadcast({ type: 'alert.fired', log });
    });
}

// Expire alerts even when their market is quiet.
setInterval(() => { const now = Date.now(); for (const a of list()) if (a.active && E.expired(a, now)) stop(a, 'expired') }, 15_000).unref();

// ---------- routes ----------
const inputOf = ({ id: _i, created: _c, fireCount: _f, lastFired: _l, stoppedReason: _s, ...rest }: Alert) => rest;
const get = (id: string) => { const a = alerts.get(id); if (!a) throw new HttpError(404, 'No such alert'); return a };

route('GET', '/api/alerts', () => list());
export function createAlert(body: unknown): Alert {
  if (alerts.size >= MAX_ALERTS) throw bad(`At most ${MAX_ALERTS} alerts`);
  const a: Alert = { ...validateInput(body), id: randomUUID(), created: Date.now(), fireCount: 0 };
  alerts.set(a.id, a); save(a); changed();
  return a;
}
route('POST', '/api/alerts', c => createAlert(c.body));
route('GET', '/api/alerts/log', c => {
  const limit = Math.min(Math.max(Number(c.url.searchParams.get('limit')) || 200, 1), 1000), alert = c.url.searchParams.get('alert');
  const rows = (alert
    ? db.prepare('SELECT * FROM alert_log WHERE alert_id = ? ORDER BY id DESC LIMIT ?').all(alert, limit)
    : db.prepare('SELECT * FROM alert_log ORDER BY id DESC LIMIT ?').all(limit)) as { id: number; alert_id: string; at: number; message: string; price: number | null; deliveries: string }[];
  return rows.map((r): AlertLog => ({ id: r.id, alertId: r.alert_id, at: r.at, message: r.message, ...(r.price === null ? {} : { price: r.price }), deliveries: JSON.parse(r.deliveries) }));
});
route('DELETE', '/api/alerts/log', () => { db.exec('DELETE FROM alert_log') });
/** Past fires from another app's export (TradingView's alerts log): history only, nothing is re-armed. Re-importing skips rows already there. */
export function importLog(body: unknown): number {
  const rows = (body as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows) || rows.length > 20_000) throw bad('rows: up to 20000 entries');
  const ins = db.prepare("INSERT INTO alert_log (alert_id, at, message, price, deliveries) SELECT 'tradingview', ?, ?, NULL, '[]' WHERE NOT EXISTS (SELECT 1 FROM alert_log WHERE alert_id = 'tradingview' AND at = ? AND message = ?)");
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows as { at?: unknown; message?: unknown }[]) {
      if (typeof r?.at !== 'number' || !Number.isFinite(r.at) || typeof r.message !== 'string' || !r.message.trim()) continue;
      const msg = r.message.slice(0, 1000);
      n += Number(ins.run(r.at, msg, r.at, msg).changes);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return n;
}
route('POST', '/api/alerts/log/import', c => ({ added: importLog(c.body) }), { limit: 8 * 1024 * 1024 });
route('PUT', '/api/alerts/:id', c => {
  const old = get(c.params.id);
  if (!c.body || typeof c.body !== 'object' || Array.isArray(c.body)) throw bad('Body must be an object');
  const a: Alert = { id: old.id, created: old.created, fireCount: old.fireCount, ...(old.lastFired ? { lastFired: old.lastFired } : {}), ...validateInput({ ...inputOf(old), ...c.body }) };
  if (!a.active && !old.active) a.stoppedReason = old.stoppedReason;   // still paused/stopped: keep why
  alerts.set(a.id, a); states.delete(a.id); save(a); changed();
  return a;
});
route('DELETE', '/api/alerts/:id', c => {
  get(c.params.id);
  alerts.delete(c.params.id); states.delete(c.params.id);
  db.prepare('DELETE FROM alerts WHERE id = ?').run(c.params.id);
  changed();
});

sync();   // resume watching active alerts after a restart
