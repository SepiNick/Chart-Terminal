// Server-side alert engine. See docs/phase5-contracts.md §5.
//   GET /api/alerts → Alert[]          POST /api/alerts AlertInput → Alert
//   PUT /api/alerts/:id (partial)      DELETE /api/alerts/:id
//   GET /api/alerts/log?limit=&alert=  DELETE /api/alerts/log
//   WS ← { type: 'alerts', alerts } after every change, { type: 'alert.fired', log } per fire.
// Evaluation logic lives in evaluate.ts (pure); this file keeps alerts in SQLite + memory and wires them to watchSeries.
// Alerts belong to a user: rows are in that user's database, memory is a registry per user, and every message goes to
// that user's sockets only. Market series stay shared: one watcher per (symbol, timeframe) serves all owners.
// Public mode never loads the script engine; only price and drawing alerts exist there.
import { randomUUID } from 'node:crypto';
import type { Alert, AlertLog, Channel } from '../../src/alerttypes.ts';
import { tfSeconds, type Bar } from '../../src/data.ts';
import { scriptSig } from '../../src/scriptsig.ts';
import type { ScriptSource } from '../scripts.ts';
import type { Outputs } from '../../src/pine/interp.ts';
import { soleUser, userDb, userMigration } from '../core/userdb.ts';
import { HttpError, bad, broadcastTo, route } from '../core/http.ts';
import { isPublic } from '../core/mode.ts';
import { limits } from '../core/quota.ts';
import { watchSeries } from '../core/bars.ts';
import { notify } from '../notify/index.ts';
import * as E from './evaluate.ts';
import { validateInput } from './validate.ts';

const eng = isPublic ? null : await import('../engine.ts');
const U = isPublic ? await import('../core/users.ts') : null;

userMigration('alerts/1', `
  CREATE TABLE alerts (id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE alert_log (id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL, at INTEGER NOT NULL, message TEXT NOT NULL, price REAL, deliveries TEXT NOT NULL);
`);
const RUN_EVERY = 2000;
const over = (msg: string) => (isPublic ? new HttpError(429, msg) : bad(msg));   // quota errors: 429 on the public server, 400 as before on a private one

// userId → id → alert. Loaded when first needed (a private server: user 1 at start; a public one: users who have active alerts).
const regs = new Map<number, Map<string, Alert>>();
const owner = new WeakMap<Alert, number>();
const uidOf = (a: Alert) => owner.get(a)!;
const states = new Map<string, E.EvalState>();   // `${uid}:${alertId}`
function reg(uid: number): Map<string, Alert> {
  let m = regs.get(uid);
  if (!m) {
    regs.set(uid, (m = new Map()));
    for (const r of userDb(uid).prepare('SELECT data FROM alerts ORDER BY created').all() as { data: string }[]) { const a = JSON.parse(r.data) as Alert; owner.set(a, uid); m.set(a.id, a) }
  }
  return m;
}
// After a restart, lastFired keeps once_per_bar / once_per_minute from repeating within the same bar / minute.
const stateOf = (a: Alert) => {
  const k = `${uidOf(a)}:${a.id}`;
  let s = states.get(k);
  if (!s) {
    states.set(k, (s = E.newState()));
    if (a.lastFired) { const sec = tfSeconds(a.tf); s.lastFireAt = a.lastFired; s.firedBar = Math.floor(a.lastFired / 1000 / sec) * sec }
  }
  return s;
};

const list = (uid: number) => [...reg(uid).values()];
/** Alerts of every enabled user (a disabled or deleted account's alerts are paused). */
function* everyAlert(): Generator<Alert> {
  for (const [uid, m] of regs) if (!U || U.isActive(uid)) yield* m.values();
}
const save = (a: Alert) => userDb(uidOf(a)).prepare('INSERT INTO alerts (id, data, created) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(a.id, JSON.stringify(a), a.created);
function changed(uid: number) {
  broadcastTo(uid, { type: 'alerts', alerts: list(uid) });
  U?.setAlertsHint(uid, list(uid).some(a => a.active));
  sync();
}
function stop(a: Alert, reason: string) { a.active = false; a.stoppedReason = reason; save(a); changed(uidOf(a)) }

// ---------- live series: one watchSeries per (sym, tf) that an active alert needs ----------
/** Swappable for tests (no network, scripts on this thread). */
export const deps = {
  watch: watchSeries, notify, now: () => Date.now(),
  run: (eng?.engineOut ?? (async () => { throw Error('Script alerts are not available on this server') })) as typeof import('../engine.ts').engineOut,
};
/** Script runs per (script, inputs, precision) on one series: one in flight, the latest bars queued behind it. */
interface ScriptState { at: number; busy: boolean; queued?: { bars: Bar[]; closed: boolean } }
const watchers = new Map<string, { stop: () => void; scripts: Map<string, ScriptState> }>();

function sync() {
  const need = new Set<string>();
  for (const a of everyAlert()) if (a.active) need.add(`${a.sym}|${a.tf}`);
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
  for (const a of [...everyAlert()]) {
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
/** Alerts with the same script and inputs share each run (only within one owner: the key carries the user). Pine's mintick follows the series' precision. */
function keyOf(a: Alert, prec: number) {
  const x = a as Alert & { source: { script: string; code?: ScriptSource; inputs?: Record<string, unknown> } };
  let s = sigs.get(a);
  if (!s) sigs.set(a, (s = scriptSig(sourceOf(x, 0), x.source.inputs)));
  return `alert:${uidOf(a)}:${s}|${a.sym}|${a.tf}|${x.source.code ? '' : prec}`;
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
  const users = () => [...everyAlert()].filter(a => a.active && a.sym === sym && a.tf === tf && isScript(a) && keyOf(a, prec) === key);
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
  const uid = uidOf(a), keep = limits(uid).alertLog;
  const vars = { ...E.barVars(a, bars, i, now, out), ...extra };
  const message = E.render(a.message.trim() ? a.message : scriptMsg ?? `{{ticker}} {{interval}}: ${describe(a)} at {{close}}`, vars);
  a.lastFired = now; a.fireCount++;
  const auto = E.recordFire(st, bars[i].time, now, a.autoStop);
  if (a.frequency === 'once') a.active = false;
  if (auto) { a.active = false; a.stoppedReason = auto }
  // The new state and its log row are one transaction; people are told only after it committed, and the popup / log do not
  // wait for the slowest channel (telegram, email, webhook): their results arrive later as 'alert.delivered'.
  const d = userDb(uid);
  let id = 0;
  const channels = [...new Set<Channel>(['popup', ...a.channels])], price = bars[i].close;
  d.exec('BEGIN');
  try {
    save(a);
    id = Number(d.prepare('INSERT INTO alert_log (alert_id, at, message, price, deliveries) VALUES (?, ?, ?, ?, ?)').run(a.id, now, message, price, '[]').lastInsertRowid);
    if (id % 100 === 0) d.prepare('DELETE FROM alert_log WHERE id <= ?').run(id - keep);
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e }
  changed(uid);
  broadcastTo(uid, { type: 'alert.fired', log: { id, alertId: a.id, at: now, message, price, deliveries: [] } satisfies AlertLog });
  const webhook = a.webhook && channels.includes('webhook') ? { url: a.webhook.url, body: a.webhook.body ? E.render(a.webhook.body, { ...vars, message }) : message } : undefined;
  deps.notify({ userId: uid, title: `${a.name || a.sym} alert`, body: message, channels, sound: true, webhook, data: { alertId: a.id, sym: a.sym, tf: a.tf, price, url: `/?symbol=${encodeURIComponent(a.sym)}&tf=${encodeURIComponent(a.tf)}` } })
    .catch(e => [{ channel: 'popup' as Channel, ok: false, error: String((e as Error).message ?? e) }])
    .then(deliveries => {
      userDb(uid).prepare('UPDATE alert_log SET deliveries = ? WHERE id = ?').run(JSON.stringify(deliveries), id);   // fetched now: the handle may have been closed meanwhile
      broadcastTo(uid, { type: 'alert.delivered', id, alertId: a.id, deliveries });
    })
    .catch(e => console.error(`[alerts] log ${a.id}: ${(e as Error).message}`));   // the account may have been deleted meanwhile
}

// Expire alerts even when their market is quiet; forget accounts that no longer exist.
setInterval(() => {
  const now = Date.now();
  for (const a of [...everyAlert()]) if (a.active && E.expired(a, now)) stop(a, 'expired');
  if (U) for (const uid of [...regs.keys()]) if (!U.userExists(uid)) { regs.delete(uid); sync() }
}, 15_000).unref();

// ---------- routes ----------
const inputOf = ({ id: _i, created: _c, fireCount: _f, lastFired: _l, stoppedReason: _s, ...rest }: Alert) => rest;
const get = (uid: number, id: string) => { const a = reg(uid).get(id); if (!a) throw new HttpError(404, 'No such alert'); return a };
const keyOfSeries = (a: Alert) => `${a.sym}|${a.tf}`;
/** Public mode: how many distinct (symbol, timeframe) series the alerts may watch, per user and on the whole server. */
function checkWatch(uid: number, mine: Alert[]) {
  if (!isPublic) return;
  const L = limits(uid), own = new Set(mine.filter(a => a.active).map(keyOfSeries));
  if (own.size > L.watchUser) throw over(`Your active alerts may watch at most ${L.watchUser} different markets/timeframes`);
  const all = new Set<string>(own);
  for (const [u, m] of regs) if (u !== uid) for (const a of m.values()) if (a.active) all.add(keyOfSeries(a));
  if (all.size > L.watchServer) throw over('This server is watching as many markets as it can right now. Try again later');
}

route('GET', '/api/alerts', c => list(c.user.id));
export function createAlert(body: unknown, uid = soleUser()): Alert {
  const m = reg(uid), max = limits(uid).alerts;
  if (m.size >= max) throw over(isPublic ? `Limit reached: at most ${max} alerts` : `At most ${max} alerts`);
  const a: Alert = { ...validateInput(body), id: randomUUID(), created: Date.now(), fireCount: 0 };
  checkWatch(uid, [...m.values(), a]);
  owner.set(a, uid); m.set(a.id, a); save(a); changed(uid);
  return a;
}
route('POST', '/api/alerts', c => createAlert(c.body, c.user.id));
route('GET', '/api/alerts/log', c => {
  const limit = Math.min(Math.max(Number(c.url.searchParams.get('limit')) || 200, 1), 1000), alert = c.url.searchParams.get('alert');
  const rows = (alert
    ? c.db.prepare('SELECT * FROM alert_log WHERE alert_id = ? ORDER BY id DESC LIMIT ?').all(alert, limit)
    : c.db.prepare('SELECT * FROM alert_log ORDER BY id DESC LIMIT ?').all(limit)) as { id: number; alert_id: string; at: number; message: string; price: number | null; deliveries: string }[];
  return rows.map((r): AlertLog => ({ id: r.id, alertId: r.alert_id, at: r.at, message: r.message, ...(r.price === null ? {} : { price: r.price }), deliveries: JSON.parse(r.deliveries) }));
});
route('DELETE', '/api/alerts/log', c => { c.db.exec('DELETE FROM alert_log') });
/** Past fires from another app's export (TradingView's alerts log): history only, nothing is re-armed. Re-importing skips rows already there. */
export function importLog(body: unknown, uid = soleUser()): number {
  const rows = (body as { rows?: unknown } | undefined)?.rows, keep = limits(uid).alertLog, cap = isPublic ? keep : 20_000;
  if (!Array.isArray(rows) || rows.length > cap) throw bad(`rows: up to ${cap} entries`);
  const d = userDb(uid), ins = d.prepare("INSERT INTO alert_log (alert_id, at, message, price, deliveries) SELECT 'tradingview', ?, ?, NULL, '[]' WHERE NOT EXISTS (SELECT 1 FROM alert_log WHERE alert_id = 'tradingview' AND at = ? AND message = ?)");
  let n = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows as { at?: unknown; message?: unknown }[]) {
      if (typeof r?.at !== 'number' || !Number.isFinite(r.at) || typeof r.message !== 'string' || !r.message.trim()) continue;
      const msg = r.message.slice(0, 1000);
      n += Number(ins.run(r.at, msg, r.at, msg).changes);
    }
    if (isPublic) d.prepare('DELETE FROM alert_log WHERE id <= (SELECT MAX(id) FROM alert_log) - ?').run(keep);
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e }
  return n;
}
route('POST', '/api/alerts/log/import', c => ({ added: importLog(c.body, c.user.id) }), { limit: isPublic ? 1024 * 1024 : 8 * 1024 * 1024 });
route('PUT', '/api/alerts/:id', c => {
  const uid = c.user.id, old = get(uid, c.params.id);
  if (!c.body || typeof c.body !== 'object' || Array.isArray(c.body)) throw bad('Body must be an object');
  const a: Alert = { id: old.id, created: old.created, fireCount: old.fireCount, ...(old.lastFired ? { lastFired: old.lastFired } : {}), ...validateInput({ ...inputOf(old), ...c.body }) };
  if (!a.active && !old.active) a.stoppedReason = old.stoppedReason;   // still paused/stopped: keep why
  checkWatch(uid, [...list(uid).filter(x => x.id !== a.id), a]);
  owner.set(a, uid); reg(uid).set(a.id, a); states.delete(`${uid}:${a.id}`); save(a); changed(uid);
  return a;
});
route('DELETE', '/api/alerts/:id', c => {
  const uid = c.user.id;
  get(uid, c.params.id);
  reg(uid).delete(c.params.id); states.delete(`${uid}:${c.params.id}`);
  userDb(uid).prepare('DELETE FROM alerts WHERE id = ?').run(c.params.id);
  changed(uid);
});

/** An account was removed in this process: stop its alerts. */
function dropUserAlerts(uid: number) { regs.delete(uid); for (const k of [...states.keys()]) if (k.startsWith(uid + ':')) states.delete(k); sync() }
U?.onRemoved(dropUserAlerts);

if (isPublic) { for (const uid of U!.usersWithAlerts()) try { reg(uid) } catch (e) { console.error(`[alerts] user ${uid}: ${(e as Error).message}`) } }
else reg(1);
sync();   // resume watching active alerts after a restart
