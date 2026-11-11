// Exchange TESTNET accounts on the server (docs/phase6-contracts.md, src/broker/types.ts).
//   Accounts CRUD with encrypted keys, the guardian check, guarded orders, server-side emulation (trailing, OCO,
//   brackets, missing stop kinds) and a poll loop that pushes { type: 'broker', account, state } over WS.
// Keys never leave this module except into the adapter: not in responses, logs or error messages (scrub()).
import { createHash, randomUUID } from 'node:crypto';
import type { BrokerAccount, BrokerOrder, BrokerState, GuardianItem, GuardianReport, OrderPatch, OrderReq } from '../../src/broker/types.ts';
import { DEFAULT_GUARD } from '../../src/broker/types.ts';
import { db, migration } from '../core/db.ts';
import { secretDel, secretGet, secretHas, secretSet } from '../core/secrets.ts';
import { HttpError, bad, broadcastTo, route } from '../core/http.ts';
import type { Adapter, Native } from './adapter.ts';
import { parseSym } from './adapter.ts';
import { ccxtAdapter } from './ccxtx.ts';
import { nobitexAdapter } from './nobitex.ts';
import { mt5Adapter } from './mt5.ts';
import { arm, sendKind, step, type Trigger } from './emulate.ts';
import { breakerHit, checkOrder, guardItems, utcDay, type OrderCtx } from './risk.ts';
import { scrub } from './safety.ts';
import { KUCOIN_MSG, checkBracket, validAccount, validAccountPatch, validGuard, validOrder, validPatch } from './validate.ts';

migration('brokers/1', `
  CREATE TABLE broker_accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL, meta TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE broker_day (account TEXT NOT NULL, day TEXT NOT NULL, equity REAL NOT NULL, PRIMARY KEY (account, day));
  CREATE TABLE broker_emu (id TEXT PRIMARY KEY, account TEXT NOT NULL, data TEXT NOT NULL);
`);


/** lastEq: equity at the last good poll, persisted, so the first poll after a restart still sees the loss since the day began. */
interface Meta { syms: string[]; trippedDay?: string; okStatus?: 'active' | 'tripped' | 'pending'; lastEq?: { day: string; eq: number; at: number } }
interface Row { acct: BrokerAccount; meta: Meta }
/** A server-emulated order: `trigger` waits for a price and then sends `send`; `bracket` waits for its entry to fill. */
export interface Emu {
  id: string; account: string; kind: 'trigger' | 'bracket' | 'cleanup'; order: BrokerOrder;   // cleanup: a native peer stop whose cancel failed, retried each pass
  trig?: Trigger; send?: Native; what?: string;
  oco?: string;                              // trigger legs of one OCO group cancel each other
  peer?: { id: string; sym: string };        // native order of the same OCO group (a bracket's exchange-side stop)
  parent?: string; parentSym?: string;       // bracket: the entry order (native id, or an emu id until it fires)
  tries?: number;
  legQty?: number;                           // bracket: entry qty whose TP/SL are already out (partial fills)
  legging?: { from: number; to: number };   // bracket: TP/SL for this qty range are being placed (a crash resumes here, same ids)
}

const rows = new Map<string, Row>();
for (const r of db.prepare('SELECT data, meta FROM broker_accounts ORDER BY created').all() as { data: string; meta: string }[]) {
  const acct = JSON.parse(r.data) as BrokerAccount;
  rows.set(acct.id, { acct, meta: JSON.parse(r.meta) });
}
const emus = new Map<string, Emu>();
for (const r of db.prepare('SELECT data FROM broker_emu').all() as { data: string }[]) { const e = JSON.parse(r.data) as Emu; emus.set(e.id, e) }

const saveRow = (r: Row) => db.prepare('INSERT INTO broker_accounts (id, data, meta, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, meta = excluded.meta').run(r.acct.id, JSON.stringify(r.acct), JSON.stringify(r.meta), deps.now());
const saveEmu = (e: Emu) => { emus.set(e.id, e); db.prepare('INSERT INTO broker_emu (id, account, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(e.id, e.account, JSON.stringify(e)) };
const dropEmu = (id: string) => { emus.delete(id); db.prepare('DELETE FROM broker_emu WHERE id = ?').run(id) };
const emusOf = (account: string) => [...emus.values()].filter(e => e.account === account);

const SECRET_KEYS = ['apiKey', 'secret', 'passphrase'] as const;
const secretName = (id: string, k: string) => `broker:${id}:${k}`;
const secretsOf = (id: string) => SECRET_KEYS.map(k => secretGet(secretName(id, k)));
const keysOf = (id: string) => ({ apiKey: secretGet(secretName(id, 'apiKey')) ?? '', secret: secretGet(secretName(id, 'secret')) ?? '', passphrase: secretGet(secretName(id, 'passphrase')) ?? undefined });

function makeAdapter(a: BrokerAccount, k: ReturnType<typeof keysOf>): Adapter {
  if (a.broker === 'kucoin') throw Error(KUCOIN_MSG);
  if (a.broker === 'nobitex') return nobitexAdapter(k.apiKey);
  if (a.broker === 'mt5') return mt5Adapter(k.apiKey);   // the bridge token
  if (a.broker === 'paper') throw Error('The paper account lives in the browser');
  return ccxtAdapter(a.broker, a.market, k);
}
/** Swappable for tests (fake exchanges, a fixed clock). */
export const deps = { adapter: makeAdapter, now: () => Date.now(), pollMs: 30_000 };

/** Deterministic exchange client order id (32 hex) for something the server places, so a retry finds the order it already sent. */
const cid = (...p: (string | number)[]) => createHash('sha256').update(p.join('|')).digest('hex').slice(0, 32);
const UNKNOWN = /unknown order|order does not exist|no such order|not found|already (?:filled|canceled|cancelled|closed)|-2011|-2013|110001|51400|51401|51402/i;
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Place; if the call fails (a timeout may have sent it anyway) look the order up by clientId before giving up. lookupFirst: a resume after a crash. */
async function placeOnce(ad: Adapter, n: Native, lookupFirst = false): Promise<BrokerOrder> {
  const look = () => (n.clientId && ad.find ? ad.find(n.clientId, n.sym).catch(() => null) : Promise.resolve(null));
  if (lookupFirst) { const f = await look(); if (f) return f }
  try { return await ad.place(n) } catch (e) { const f = await look(); if (f) return f; throw e }
}

// ---------- runtime per account ----------
interface Rt { ad: Adapter | null; state: BrokerState | null; json: string; errors: number; timer?: ReturnType<typeof setTimeout>; unwatch?: () => void; busy?: Promise<BrokerState>; next?: Promise<BrokerState>; prices: Map<string, number>; pxAt: Map<string, number>; seq: number; dirty: boolean; stale: Set<string>; deleted?: boolean }
const rts = new Map<string, Rt>();
const rt = (id: string) => { let r = rts.get(id); if (!r) rts.set(id, (r = { ad: null, state: null, json: '', errors: 0, prices: new Map(), pxAt: new Map(), seq: 0, dirty: false, stale: new Set() })); return r };

function rowOf(id: string): Row { const r = rows.get(id); if (!r) throw new HttpError(404, 'Unknown account'); return r }
const fail = (id: string, e: unknown) => (e instanceof HttpError ? e : new HttpError(502, scrub(e, secretsOf(id))));
function adapterOf(id: string): Adapter {
  const r = rt(id);
  if (!r.ad) { try { r.ad = deps.adapter(rowOf(id).acct, keysOf(id)) } catch (e) { throw new HttpError(400, scrub(e, secretsOf(id))) } }
  return r.ad;
}
function dropAdapter(id: string) { const r = rt(id); r.unwatch?.(); r.unwatch = undefined; r.ad?.close(); r.ad = null }

// shortcut: an MT5 account must be in USD (another currency shows no equity, so every order is refused); read it from /account if needed.
const mainQuote = (a: BrokerAccount) => (a.broker === 'nobitex' ? 'IRT' : a.broker === 'mt5' ? 'USD' : 'USDT');
/** Same instrument? BTCUSDT, BINANCE:BTCUSDT and BYBIT:BTC_USDT all mean BTC/USDT. */
const keyOf = (sym: string) => { try { const p = parseSym(sym); return `${p.base}/${p.quote}` } catch { return sym } };
const same = (a: string, b: string) => keyOf(a) === keyOf(b);

function setStatus(row: Row, status: BrokerAccount['status'], error?: string) {
  const was = row.acct.status;
  row.acct.status = status;
  if (error) row.acct.error = error; else delete row.acct.error;
  saveRow(row);
  // The breaker trips (and errors happen) inside the poll loop: tell open apps, not only the next GET.
  if (was !== status) announce();
}
/** Every open app (any device) gets the account list after a change. */
function announce() { broadcastTo(1, { type: 'broker.accounts', accounts: listAccounts() }) }
/** Passed a guardian check in this run and has an exchange state: it may hold positions that need watching. */
const live = (id: string) => !!rts.get(id)?.state;
// A demoted (pending) account that is live keeps polling, so its emulated stops still fire on open positions.
const polls = (a: BrokerAccount) => a.status === 'active' || a.status === 'tripped' || a.status === 'error' || (a.status === 'pending' && live(a.id));

/**
 * Equity in quote currency `q`: its balance, plus every other asset held at its last price in `q` (spot), plus
 * unrealised PnL (futures). Assets with no `q` market (never priced) are left out.
 */
function equityIn(q: string, row: Row, st: Pick<BrokerState, 'balances' | 'positions'>, prices: Map<string, number>) {
  const bal = (a: string) => { const b = st.balances.find(x => x.asset === a); return b ? b.free + b.locked : 0 };
  let e = bal(q);
  if (row.acct.market === 'futures') return rt(row.acct.id).ad?.upnlInBalance ? e : e + st.positions.filter(p => keyOf(p.sym).endsWith(`/${q}`)).reduce((s, p) => s + (p.upnl ?? 0), 0);
  const px = new Map<string, number>();
  for (const sym of row.meta.syms) { const p = parseSym(sym), v = prices.get(sym); if (p.quote === q && v) px.set(p.base, v) }
  for (const b of st.balances) { if (b.asset === q) continue; const v = px.get(b.asset) ?? prices.get(`${b.asset}${q}`); if (v) e += (b.free + b.locked) * v }
  return e;
}
/**
 * Today's start-of-day equity; recorded when given and there is none yet (else only read). The equity of the last poll of an
 * earlier day (persisted, so it survives a restart) wins over the current one: a loss while the server was down still counts.
 */
function dayStart(id: string, equity?: number, meta?: Meta) {
  const day = utcDay(deps.now());
  if (equity !== undefined) {
    const l = meta?.lastEq;
    if (l && l.day < day && l.eq > 0 && deps.now() - l.at < 36 * 3600_000) equity = l.eq;
    db.prepare('INSERT OR IGNORE INTO broker_day (account, day, equity) VALUES (?, ?, ?)').run(id, day, equity);
  }
  return (db.prepare('SELECT equity FROM broker_day WHERE account = ? AND day = ?').get(id, day) as { equity: number } | undefined)?.equity;
}

const isStopKind = (k: string) => k === 'stop' || k === 'stop_limit' || k === 'trailing_stop';
/** The UI's view of the exchange's orders: TP/SL of pending brackets and OCO links filled in. */
function annotate(id: string, orders: BrokerOrder[]): BrokerOrder[] {
  const es = emusOf(id);
  return orders.map(o => {
    const b = es.find(e => e.kind === 'bracket' && e.parent === o.id), p = es.find(e => e.peer?.id === o.id);
    return { ...o, ...(b?.order.tp ? { tp: b.order.tp } : {}), ...(b?.order.sl ? { sl: b.order.sl } : {}), ...(p?.oco ? { ocoGroup: p.oco } : {}), ...(b?.order.error ? { error: b.order.error } : {}) };
  });
}
function emuView(id: string): BrokerOrder[] {
  const es = emusOf(id);
  return es.filter(e => e.kind === 'trigger').map(e => {
    const b = es.find(x => x.kind === 'bracket' && x.parent === e.id);
    return { ...e.order, ...(b?.order.tp ? { tp: b.order.tp } : {}), ...(b?.order.sl ? { sl: b.order.sl } : {}) };
  });
}

function publish(id: string, st: BrokerState) {
  const r = rt(id), json = JSON.stringify({ ...st, updated: 0 });
  r.state = st;
  if (json !== r.json) { r.json = json; broadcastTo(1, { type: 'broker', account: id, state: st }) }
}

/** Poll the exchange once: balances, positions, open orders, fills; run emulation; enforce the breaker; push on change. */
export function refresh(id: string): Promise<BrokerState> {
  const r = rt(id);
  // One poll at a time; callers arriving during a poll share one follow-up poll (they may need data newer than it).
  if (r.busy) return (r.next ??= r.busy.catch(() => {}).then(() => { r.next = undefined; return refresh(id) }));
  r.busy = locked(id, () => poll(id)).finally(() => { r.busy = undefined });
  return r.busy;
}
/**
 * Polls and order operations of one account run one at a time: an emulation pass never lands inside a cancel+replace
 * or a close, so a bracket is never legged twice, re-parented under a running pass, or dropped while its entry rests.
 * Inside the lock call poll(), never refresh() (it would wait for the lock it is in).
 */
const locks = new Map<string, Promise<unknown>>();
function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const p = (locks.get(id) ?? Promise.resolve()).then(fn);
  locks.set(id, p.catch(() => {}));
  return p;
}
class Superseded extends Error {}
/** A poll that hangs must not hold the account lock: after deps.pollMs the caller gets an error and the next poll takes over. */
function poll(id: string): Promise<BrokerState> {
  const r = rt(id);
  let t: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, no) => { t = setTimeout(() => { r.errors++; r.dirty = true; no(new HttpError(504, 'The exchange did not answer in time')) }, deps.pollMs); t.unref?.() });
  return Promise.race([pollNow(id), late]).finally(() => clearTimeout(t));
}
/** Inside the lock, after an order operation: refresh the state the next guard check reads (and wait for it). */
const settle = async (id: string) => { try { await poll(id) } catch { rt(id).dirty = true } };
async function pollNow(id: string): Promise<BrokerState> {
  const row = rowOf(id), r = rt(id), ad = adapterOf(id), now = deps.now(), my = ++r.seq;
  const live = () => { if (my !== r.seq) throw new Superseded('superseded by a newer poll') };
  try {
    const [balances, positions, open] = await Promise.all([ad.balances(), ad.positions(), ad.openOrders()]);
    const fills = row.meta.syms.length ? (await ad.fills(row.meta.syms)).sort((a, b) => b.ts - a.ts).slice(0, 100) : [];
    live();
    // Prices: symbols with something emulated waiting, and spot holdings of traded symbols (for equity).
    const want = new Set<string>([...emusOf(id).filter(e => e.kind === 'trigger').map(e => e.order.sym), ...(row.acct.market === 'spot' ? row.meta.syms : [])]);
    for (const s of want) {
      try { r.prices.set(s, await ad.price(s)); r.stale.delete(s) }
      catch (e) { r.stale.add(s); console.warn(`[brokers] ${id}: price of ${s} failed, its last price is stale: ${scrub(e, secretsOf(id))}`) }
    }
    live();
    for (const p of positions) if (p.mark) r.prices.set(p.sym, p.mark);
    const q = mainQuote(row.acct), traded = new Set(row.meta.syms.map(s => parseSym(s)).filter(p => p.quote === q).map(p => p.base));
    const others = row.acct.market === 'spot' ? balances.filter(b => b.asset !== q && !traded.has(b.asset) && b.free + b.locked > 0).map(b => `${b.asset}${q}`) : [];
    const equity = equityIn(q, row, { balances, positions }, r.prices);
    // The day's start equity is taken only once every coin held has been priced (or failed once): a coin priced later
    // would otherwise look like a gain and hide a loss of the same size.
    const priced = others.every(s => r.prices.has(s)), today = utcDay(now);
    const start = dayStart(id, priced ? equity : undefined, row.meta);
    if (priced && Number.isFinite(equity) && (row.meta.lastEq?.eq !== equity || row.meta.lastEq.day !== today)) { row.meta.lastEq = { day: today, eq: equity, at: now }; saveRow(row) }
    // Back to the real status as soon as the exchange answers: the emulation below must not run (and reject) under 'error'.
    if (row.acct.status === 'error') setStatus(row, row.meta.okStatus ?? 'active');
    if (row.acct.status === 'tripped' && row.meta.trippedDay !== today) setStatus(row, 'active');
    let st: BrokerState = { account: id, balances, positions, orders: [], fills, equity, dayStartEquity: start, updated: now };
    r.state = { ...st, orders: open };
    const fired = await tickEmus(id, ad, open, r.prices);
    // Other coins held (spot) count toward equity: priced after the emulation pass (stops first), at most once a minute;
    // a failed price keeps the last one.
    for (const s of others) {
      if (now - (r.pxAt.get(s) ?? -Infinity) < 60_000) continue;
      r.pxAt.set(s, now);
      try { r.prices.set(s, await ad.price(s)) } catch (e) { if (!r.prices.has(s)) r.prices.set(s, NaN); console.warn(`[brokers] ${id}: price of ${s} failed (equity keeps its last price): ${scrub(e, secretsOf(id))}`) }
    }

    live();
    if (row.acct.status === 'active' && breakerHit(row.acct.guard, equity, start)) await trip(row);
    else if (row.acct.status === 'tripped') await cancelOpening(row);   // every pass: a cancel that failed is tried again
    st = { ...st, orders: [...annotate(id, (rt(id).state?.orders ?? open).filter(o => o.status === 'open')), ...emuView(id)] };
    r.errors = 0; r.dirty = false;
    publish(id, st);
    if (fired) schedule(id, 300);
    return st;
  } catch (e) {
    if (e instanceof Superseded) throw e;   // a newer poll owns the state now
    const msg = scrub(e, secretsOf(id));
    r.errors++;
    // Return to the real status after the error: a demoted (pending) account must never come back as active unchecked.
    if (row.acct.status !== 'error' && polls(row.acct)) { row.meta.okStatus = row.acct.status === 'tripped' || row.acct.status === 'pending' ? row.acct.status : 'active'; setStatus(row, 'error', msg) }
    console.error(`[brokers] ${id}: ${msg}`);
    throw new HttpError(502, msg);
  }
}
async function trip(row: Row) { row.meta.trippedDay = utcDay(deps.now()); setStatus(row, 'tripped'); await cancelOpening(row) }
/**
 * A tripped account takes no new risk: resting orders that would open or add are canceled. Exits stay: reduce-only
 * orders, SL/TP legs and orders on the other side of the position — an emulated one of any size (fire() cuts it to the
 * position), a native one only if it is a stop (dropping a stop is the worse failure) or no bigger than the position.
 */
async function cancelOpening(row: Row) {
  const id = row.acct.id, ad = adapterOf(id);
  const exit = (sym: string, side: 'buy' | 'sell', reduceOnly?: boolean, nativeQty?: number, kind?: string) => {
    const c = ctxFor(row, sym, side, 0);
    if (c.spot) return side === 'sell';
    if (reduceOnly) return true;
    const against = c.pos !== 0 && (side === 'buy') !== (c.pos > 0);
    return against && (nativeQty === undefined || isStopKind(kind ?? '') || nativeQty <= Math.abs(c.pos) + 1e-12);
  };
  for (const e of emusOf(id)) {
    if (e.kind !== 'trigger' || e.order.status !== 'open' || e.what?.startsWith('bracket') || exit(e.send!.sym, e.send!.side, e.send!.reduceOnly)) continue;
    reject(e, 'Canceled: circuit breaker tripped');
    for (const b of emusOf(id)) if (b.parent === e.id) dropEmu(b.id);
  }
  for (const o of rt(id).state?.orders ?? []) {
    if (o.status !== 'open' || o.id.startsWith('emu:') || exit(o.sym, o.side, o.reduceOnly, o.qty - o.filled, o.kind)) continue;
    // Its bracket stays: a fill that happened before the cancel still gets its SL on the next pass.
    try { await ad.cancel(o.id, o.sym, isStopKind(o.kind)); o.status = 'canceled' }
    catch (err) { console.error(`[brokers] ${id}: breaker cancel failed (retried next pass): ${scrub(err, secretsOf(id))}`) }
  }
}

// ---------- emulation ----------
const describe = (e: Pick<Emu, 'what' | 'trig'>) => `Emulated by the server (${e.what}): fires when price ${e.trig!.dir === 'up' ? 'rises to' : 'falls to'} ${+e.trig!.at.toPrecision(10)}`;

function addTrigger(account: string, o: Omit<OrderReq, 'tp' | 'sl' | 'ocoWith'>, px: number, what: string, extra: Partial<Emu> = {}): Emu {
  const now = deps.now(), trig = arm(o, px), id = extra.id ?? `emu:${randomUUID()}`;
  const send: Native = { sym: o.sym, side: o.side, kind: sendKind(o.kind), qty: o.qty, ...(o.kind === 'stop_limit' || o.kind === 'limit' ? { price: o.price } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}), ...(o.clientId ? { clientId: o.clientId } : {}) };
  const e: Emu = {
    id, account, kind: 'trigger', trig, send, what, ...extra,
    order: {
      id, sym: o.sym, side: o.side, kind: o.kind, qty: o.qty, filled: 0, status: 'open', created: now, updated: now,
      ...(o.price !== undefined ? { price: o.price } : {}), ...(o.kind !== 'limit' ? { stopPrice: trig.at } : {}),
      ...(o.trail ? { trail: o.trail } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}), ...(extra.oco ? { ocoGroup: extra.oco } : {}),
    },
  };
  e.order.error = describe(e);
  saveEmu(e);
  return e;
}
function addBracket(account: string, parent: BrokerOrder, tp?: number, sl?: number, legQty?: number, legging?: Emu['legging']) {
  const id = `emu:${randomUUID()}`;
  saveEmu({ id, account, kind: 'bracket', parent: parent.id, parentSym: parent.sym, ...(legQty ? { legQty } : {}), ...(legging ? { legging } : {}), order: { ...parent, id, ...(tp ? { tp } : {}), ...(sl ? { sl } : {}) } });
}

/** Exit orders once the entry filled: SL on the exchange where it holds stops (survives a server restart), TP emulated; OCO-linked. */
// Every id below derives from (bracket, qty range): placing the same legs again after a crash finds what is already out.
async function placeLegs(account: string, ad: Adapter, b: Emu, qty: number, from: number) {
  const side = b.order.side === 'buy' ? 'sell' : 'buy', sym = b.order.sym, { tp, sl } = b.order;
  const key = `${b.id}|${from}`, oco = tp && sl ? cid('oco', key) : undefined, slId = `emu:${cid('sl', key)}`, tpId = `emu:${cid('tp', key)}`;
  let peer: Emu['peer'];
  if (sl && !emus.has(slId)) {
    let err = '';
    if (ad.native.has('stop')) {
      try { const o = await placeOnce(ad, { sym, side, kind: 'stop', qty, stopPrice: sl, reduceOnly: true, clientId: cid('sl', key) }, true); peer = { id: o.id, sym: o.sym } }
      catch (e) { err = ` — the exchange refused the native stop (${scrub(e, secretsOf(account))})` }
    }
    if (!peer) { const e = addTrigger(account, { sym, side, kind: 'stop', qty, stopPrice: sl, reduceOnly: true }, sl, 'bracket stop loss', { id: slId, oco }); if (err) { e.order.error += err; saveEmu(e) } }
  }
  if (tp && !emus.has(tpId)) addTrigger(account, { sym, side, kind: 'limit', qty, price: tp, reduceOnly: true }, tp, 'bracket take profit', { id: tpId, oco, ...(peer ? { peer } : {}) });
}
/** Legs for the entry qty up to `to`. The range is persisted first and committed (legQty) only after the legs are out: a crash resumes it. */
async function leg(account: string, ad: Adapter, b: Emu, to: number) {
  const from = b.legging?.from ?? b.legQty ?? 0;
  to = b.legging?.to ?? to;
  if (to - from > 1e-12) { b.legging = { from, to }; saveEmu(b); await placeLegs(account, ad, b, to - from, from); b.legQty = to }
  delete b.legging; saveEmu(b);
}

/** One emulation pass. Returns true when something was sent (so the loop polls again soon). */
async function tickEmus(account: string, ad: Adapter, open: BrokerOrder[], prices: Map<string, number>): Promise<boolean> {
  let fired = false;
  const isOpen = (id: string) => open.some(o => o.id === id);
  for (const e of emusOf(account)) {
    if (!emus.has(e.id)) continue;   // canceled by an OCO sibling earlier in this pass
    if (e.kind === 'cleanup') {
      try { await ad.cancel(e.peer!.id, e.peer!.sym, true); dropEmu(e.id) }
      catch (err) { if (UNKNOWN.test(msgOf(err))) dropEmu(e.id); else console.warn(`[brokers] ${account}: peer stop cancel failed (retried next pass): ${scrub(err, secretsOf(account))}`) }
      continue;
    }
    if (e.kind === 'bracket') {
      if (e.parent!.startsWith('emu:')) { if (!emus.has(e.parent!)) dropEmu(e.id); continue }
      if (e.legging) { await leg(account, ad, e, e.legging.to); fired = true }   // a crash or failure left the legs half out
      let p = open.find(o => o.id === e.parent);
      if (!p) try { p = await ad.order(e.parent!, e.parentSym!) }
      catch (err) {
        // Retried every pass; after 5 failures the entry shows why its TP/SL are not out yet (never silently unprotected).
        e.tries = (e.tries ?? 0) + 1;
        if (e.tries >= 5) { e.order.error = `TP/SL not placed yet: cannot read the entry order (${scrub(err, secretsOf(account))}) — still retrying`; saveEmu(e) }
        continue;
      }
      // A partial fill gets its SL/TP now, for the part that filled; the rest follows as it fills.
      const rest = p.filled - (e.legQty ?? 0);
      if (p.status === 'open') {
        if (rest > 1e-12) { await leg(account, ad, e, p.filled); fired = true }   // a failure keeps the marker: retried next pass
        continue;
      }
      if (rest > 1e-12) await leg(account, ad, e, p.filled);
      dropEmu(e.id);   // only after the legs are out
      fired = true;
      continue;
    }
    if (e.order.status !== 'open') continue;
    if (e.peer && !isOpen(e.peer.id)) {
      // The exchange-side partner is gone: filled → this leg is void; canceled by the user → this leg stays on its own.
      const p = await ad.order(e.peer.id, e.peer.sym, true).catch(() => null);
      if (p?.status === 'filled' || (p && p.filled > 0)) { dropEmu(e.id); continue }
      if (p) { delete e.peer; saveEmu(e) }
    }
    const px = prices.get(e.order.sym);
    if (px === undefined) continue;
    if (rt(account).stale.has(e.order.sym)) {   // the price feed is failing: say so instead of silently trusting the old price
      if (!/price is stale/.test(e.order.error ?? '')) { e.order.error = `${describe(e)} — price is stale (feed failing)`; saveEmu(e) }
      continue;
    }
    if (/price is stale/.test(e.order.error ?? '')) { e.order.error = describe(e); saveEmu(e) }
    const at = e.trig!.at;
    if (!step(e.trig!, px)) {
      if (e.trig!.at !== at) { e.order.stopPrice = e.trig!.at; e.order.error = describe(e); e.order.updated = deps.now(); saveEmu(e) }
      continue;
    }
    fired = (await fire(account, ad, e, px)) || fired;
  }
  return fired;
}

async function fire(account: string, ad: Adapter, e: Emu, px: number): Promise<boolean> {
  const row = rowOf(account), send: Native = { ...e.send! };
  // Always checked: a genuinely reducing order passes inside checkOrder (decided from the position, not the flag,
  // so a spot "reduce-only" buy can't skip the cap or a tripped breaker). Its OCO siblings aren't counted as pending.
  // Bracket legs were sized from the fill they protect; any other trigger needs stop cover when it fires (its qty may have grown).
  const sl = emusOf(account).find(b => b.kind === 'bracket' && b.parent === e.id)?.order.sl;
  const ctx = ctxFor(row, send.sym, send.side, send.price ?? px, !!e.what?.startsWith('bracket'), o => o.id === e.id || (!!e.oco && emus.get(o.id)?.oco === e.oco));
  // Spot: never sell more than is held (fees, partial fills, a stop sized for coins that never came) — the exchange would refuse it.
  // (Free coins only: coins locked by another resting sell can't be sold until it is canceled.)
  if (ctx.spot && send.side === 'sell') { send.qty = Math.min(send.qty, ctx.spotFree ?? ctx.pos); if (!(send.qty > 0)) { reject(e, ctx.pos > 0 ? 'Not sent: the coins are locked by another resting sell order — cancel it to free them' : 'Not sent: nothing left to sell'); return false } }
  let v = checkOrder({ ...send, ...(sl ? { sl } : {}) }, ctx);
  // An exit against the position that would also flip it (and may not): it still goes out, cut to the position, reduce-only.
  if (!v.ok && !ctx.spot && ctx.pos !== 0 && (send.side === 'buy') !== (ctx.pos > 0)) {
    send.qty = Math.min(send.qty, Math.abs(ctx.pos)); send.reduceOnly = true;
    v = checkOrder(send, ctx);
  }
  if (!v.ok) { reject(e, `Not sent: ${v.reason}`); if (v.trip) await trip(row); return false }
  try {
    // Same clientId on every try; looked up first, so a send that got through before a crash/timeout is not sent twice.
    const o = await placeOnce(ad, { ...send, clientId: send.clientId ?? cid('emu', e.id) }, true);
    noteSent(account, o, send);   // the next trigger of this pass sees this one in the position and pending orders
    if (e.oco) for (const s of emusOf(account)) if (s.oco === e.oco && s.id !== e.id) dropEmu(s.id);
    for (const b of emusOf(account)) if (b.kind === 'bracket' && b.parent === e.id) { b.parent = o.id; b.parentSym = o.sym; saveEmu(b) }
    if (e.peer) {
      // Only "already gone" is fine; any other failure is kept and retried (a stop left behind could fire later).
      try { await ad.cancel(e.peer.id, e.peer.sym, true) }
      catch (err) { if (!UNKNOWN.test(msgOf(err))) saveEmu({ id: `emu:cl:${e.id}`, account, kind: 'cleanup', peer: e.peer, order: { ...e.order, status: 'canceled' } }) }
    }
    dropEmu(e.id);
    return true;
  } catch (err) {
    e.tries = (e.tries ?? 0) + 1;
    const why = scrub(err, secretsOf(account));
    // A stop is never dropped silently: after 5 failed sends it stays visible as rejected with the reason.
    if (e.tries >= 5) reject(e, `Sending failed 5 times: ${why}`);
    else { e.order.error = `${describe(e)} — sending failed (${e.tries}/5): ${why}`; saveEmu(e) }
    return false;
  }
}
/** Fold an order we just sent into the cached state (fills move the position, resting orders count as pending). */
function noteSent(id: string, o: BrokerOrder, n: Native) {
  const r = rt(id), st = r.state;
  if (!st) return;
  const filled = o.status === 'filled' ? o.filled || n.qty : o.filled, d = (n.side === 'buy' ? 1 : -1) * filled;
  let positions = st.positions, balances = st.balances;
  if (d) {
    if (rowOf(id).acct.market === 'futures') {
      const p = positions.find(x => same(x.sym, n.sym));
      positions = p ? positions.map(x => (x === p ? { ...x, qty: x.qty + d } : x)).filter(x => x.qty) : [...positions, { sym: n.sym, qty: d, entry: n.price ?? r.prices.get(n.sym) ?? 0 }];
    } else {
      const base = parseSym(n.sym).base, b = balances.find(x => x.asset === base);
      balances = b ? balances.map(x => (x === b ? { ...x, free: x.free + d } : x)) : [...balances, { asset: base, free: Math.max(0, d), locked: 0 }];
    }
  }
  r.state = { ...st, positions, balances, orders: o.status === 'open' ? [...st.orders, o] : st.orders };
}
function reject(e: Emu, why: string) { e.order.status = 'rejected'; e.order.error = `${e.what}: ${why}`; e.order.updated = deps.now(); saveEmu(e) }

// ---------- guard ----------
function ctxFor(row: Row, sym: string, side: 'buy' | 'sell', price: number, skipStop = false, exclude: (o: BrokerOrder) => boolean = () => false): OrderCtx {
  const r = rt(row.acct.id), st = r.state, p = parseSym(sym);
  const balances = st?.balances ?? [], positions = st?.positions ?? [];
  const b = balances.find(x => x.asset === p.base);
  const pos = row.acct.market === 'futures' ? positions.filter(x => same(x.sym, sym)).reduce((s, x) => s + x.qty, 0) : b ? b.free + b.locked : 0;
  // An existing stop protects what this order opens or adds to when it sits on the other side (an OCO group counts once).
  const all = [...new Map([...(st?.orders ?? []), ...emuView(row.acct.id)].map(o => [o.id, o])).values()].filter(o => same(o.sym, sym) && o.status === 'open');
  const cover = new Map<string, number>();
  for (const o of all) if (isStopKind(o.kind) && o.side !== side) { const k = o.ocoGroup ?? o.id; cover.set(k, Math.max(cover.get(k) ?? 0, o.qty - o.filled)) }
  const adds = all.filter(o => o.side === side && !o.reduceOnly && !exclude(o)), es = emusOf(row.acct.id);
  const ownSl = (o: BrokerOrder) => es.some(b => b.kind === 'bracket' && b.parent === o.id && b.order.sl);
  const prices = new Map(r.prices); prices.set(sym, price);
  return {
    status: row.acct.status, guard: row.acct.guard, spot: row.acct.market === 'spot', pos, spotFree: b?.free ?? 0, price,
    equity: equityIn(p.quote, { ...row, meta: { ...row.meta, syms: [...new Set([...row.meta.syms, sym])] } }, { balances, positions }, prices),
    dayEquity: st?.equity ?? 0, dayStart: st?.dayStartEquity, skipStop,
    stopQty: [...cover.values()].reduce((s, q) => s + q, 0),
    pending: adds.reduce((s, o) => s + o.qty - o.filled, 0),
    pendingNoSl: adds.filter(o => !ownSl(o)).reduce((s, o) => s + o.qty - o.filled, 0),
  };
}

// ---------- operations (exported for tests; the routes below call these) ----------
export const listAccounts = (): BrokerAccount[] => [...rows.values()].map(r => r.acct);

export function createAccount(x: unknown): BrokerAccount {
  const a = validAccount(x, DEFAULT_GUARD);
  const id = randomUUID();
  secretSet(secretName(id, 'apiKey'), a.apiKey);
  if (a.secret) secretSet(secretName(id, 'secret'), a.secret);
  if (a.passphrase) secretSet(secretName(id, 'passphrase'), a.passphrase);
  const acct: BrokerAccount = { id, broker: a.broker, label: a.label, market: a.market, testnet: true, status: 'pending', guard: a.guard, hasPassphrase: secretHas(secretName(id, 'passphrase')) };
  const row = { acct, meta: { syms: [] } };
  rows.set(id, row); saveRow(row); announce();
  return acct;
}

export function updateAccount(id: string, x: unknown): BrokerAccount {
  const row = rowOf(id), p = validAccountPatch(x);
  if (p.label) row.acct.label = p.label;
  if (p.guard) {
    row.acct.guard = validGuard(p.guard, row.acct.guard);
    // Loosening the guard below what the guardian requires takes the account out of trading until it is checked again.
    if (row.acct.status !== 'pending' && guardItems(row.acct.guard, null).some(i => i.id !== 'withdraw' && !i.ok)) setStatus(row, 'pending');   // keeps polling: see polls()
  }
  saveRow(row); announce();
  return row.acct;
}

/** Waits for the account's running operations, cancels what rests on the exchange (best effort), then forgets the account. */
export async function deleteAccount(id: string) {
  rowOf(id);
  rt(id).deleted = true; stop(id);
  await locked(id, async () => {
    try {
      const ad = adapterOf(id);
      await Promise.race([
        (async () => { for (const o of await ad.openOrders()) await ad.cancel(o.id, o.sym, isStopKind(o.kind)).catch(() => {}) })(),
        new Promise<void>(res => setTimeout(res, deps.pollMs).unref?.()),
      ]);
    } catch (e) { console.error(`[brokers] ${id}: resting orders not canceled on delete: ${scrub(e, secretsOf(id))}`) }
    dropAdapter(id);
  });
  rts.delete(id);
  for (const k of SECRET_KEYS) secretDel(secretName(id, k));
  for (const e of emusOf(id)) dropEmu(e.id);
  db.prepare('DELETE FROM broker_emu WHERE account = ?').run(id);
  db.prepare('DELETE FROM broker_day WHERE account = ?').run(id);
  db.prepare('DELETE FROM broker_accounts WHERE id = ?').run(id);
  rows.delete(id); announce();
}

export const check = (id: string) => locked(id, () => checkNow(id));
async function checkNow(id: string): Promise<GuardianReport> {
  const row = rowOf(id), items: GuardianItem[] = [];
  dropAdapter(id);
  let ad: Adapter | null = null;
  try { ad = adapterOf(id); items.push({ id: 'testnet', label: 'Exchange host is a testnet / sandbox / demo host', ok: true, detail: ad.hosts.join(', ') }) }
  catch (e) { items.push({ id: 'testnet', label: 'Exchange host is a testnet / sandbox / demo host', ok: false, detail: (e as Error).message }) }
  let canWithdraw: boolean | null = null, keyOk = false;
  if (ad) {
    try { await ad.balances(); keyOk = true } catch (e) { items.push({ id: 'key', label: 'API key works (balance fetch)', ok: false, detail: scrub(e, secretsOf(id)) }) }
    if (keyOk) {
      items.push({ id: 'key', label: 'API key works (balance fetch)', ok: true });
      canWithdraw = await ad.canWithdraw().catch(() => null);
    }
  } else items.push({ id: 'key', label: 'API key works (balance fetch)', ok: false, detail: 'Not tried: no testnet connection' });
  items.push(...guardItems(row.acct.guard, canWithdraw));
  const ok = items.every(i => i.ok);
  if (ok) { if (row.acct.status === 'pending' || row.acct.status === 'error') setStatus(row, 'active'); start(id) }
  else { setStatus(row, 'pending'); if (!live(id)) stop(id) }
  return { ok, items };
}

// A pending account that is live still reaches the guard, which lets only reducing / closing orders through.
const activeRow = (id: string) => { const row = rowOf(id); if (row.acct.status === 'pending' && !live(id)) throw bad('Account is pending: run the guardian check first'); return row };
async function fresh(id: string) { const r = rt(id); if (!r.state || r.dirty || deps.now() - r.state.updated > 10_000) await poll(id); return r.state! }   // inside the lock
function track(row: Row, sym: string) { if (!row.meta.syms.includes(sym)) { row.meta.syms.push(sym); saveRow(row) } }

export async function getState(id: string): Promise<BrokerState> {
  // A pending account has no verified testnet connection yet: an empty state, no exchange call.
  if (rowOf(id).acct.status === 'pending' && !live(id)) return { account: id, balances: [], positions: [], orders: [], fills: [], updated: deps.now() };
  return rt(id).state ?? refresh(id);
}

export const placeOrder = (id: string, x: unknown) => locked(id, () => place(id, x));
async function place(id: string, x: unknown): Promise<BrokerOrder> {
  const row = activeRow(id), o = validOrder(x), ad = adapterOf(id);
  if (o.clientId) {   // a retry of an order already accepted (here or on the exchange) returns it instead of sending it again
    const dup = [...emus.values()].find(e => e.account === id && e.kind === 'trigger' && e.send?.clientId === o.clientId);
    if (dup) return dup.order;
    const found = ad.find ? await ad.find(o.clientId, o.sym).catch(() => null) : null;
    if (found) return found;
  }
  await fresh(id);
  let px: number;
  try { px = await ad.price(o.sym) } catch (e) { throw fail(id, e) }
  rt(id).prices.set(o.sym, px);
  const entry = o.price ?? o.stopPrice ?? px;
  checkBracket(o, entry);
  for (const leg of o.ocoWith ? [o, o.ocoWith] : [o]) {
    const v = checkOrder(leg, ctxFor(row, leg.sym, leg.side, leg.price ?? leg.stopPrice ?? px));
    if (!v.ok) { if (v.trip) await trip(row); throw bad(v.reason) }
  }
  track(row, o.sym);
  let placed: BrokerOrder;
  if (o.ocoWith) {
    const oco = randomUUID();
    placed = addTrigger(id, o, px, 'OCO leg', { oco }).order;
    addTrigger(id, o.ocoWith, px, 'OCO leg', { oco });
  } else if (o.kind === 'trailing_stop' || ((o.kind === 'stop' || o.kind === 'stop_limit') && !ad.native.has(o.kind))) {
    placed = addTrigger(id, o, px, o.kind === 'trailing_stop' ? 'trailing stop' : o.kind === 'stop' ? 'stop' : 'stop-limit').order;
  } else {
    const n: Native = { sym: o.sym, side: o.side, kind: o.kind as Native['kind'], qty: o.qty, ...(o.price !== undefined ? { price: o.price } : {}), ...(o.stopPrice !== undefined ? { stopPrice: o.stopPrice } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}), clientId: o.clientId ?? cid('ord', randomUUID()) };
    try { placed = await placeOnce(ad, n) } catch (e) { throw fail(id, e) }
  }
  if (o.tp || o.sl) { addBracket(id, placed, o.tp, o.sl); placed = { ...placed, ...(o.tp ? { tp: o.tp } : {}), ...(o.sl ? { sl: o.sl } : {}) } }
  await settle(id);   // the next guard check must see this order
  return placed;
}

export const cancelOrder = (id: string, oid: string) => locked(id, () => cancel(id, oid));
async function cancel(id: string, oid: string) {
  activeRow(id);
  const e = emus.get(oid);
  if (e && e.account === id) {
    const gone = emusOf(id).filter(s => s.id === oid || (e.oco && s.oco === e.oco) || s.parent === oid);
    keepsStop(id, gone.filter(s => s.kind === 'trigger' && s.order.status === 'open').map(s => s.order));
    for (const s of gone) dropEmu(s.id);
    await settle(id);
    return;
  }
  const st = await fresh(id), o = st.orders.find(x => x.id === oid);
  if (!o) throw new HttpError(404, 'Unknown or already closed order');
  keepsStop(id, [o]);
  const ad = adapterOf(id);
  try { await ad.cancel(oid, o.sym, isStopKind(o.kind)) } catch (err) { throw fail(id, err) }
  // Whatever filled before the cancel gets its SL/TP now; if the order can't be read, its bracket stays for the next pass.
  const fin = await ad.order(oid, o.sym, isStopKind(o.kind)).catch(() => null);
  if (fin && fin.status !== 'open') for (const b of emusOf(id)) if (b.kind === 'bracket' && b.parent === oid) { await leg(id, ad, b, fin.filled); dropEmu(b.id) }   // dropped only after its legs are out
  for (const t of emusOf(id)) if (t.peer?.id === oid) { delete t.peer; saveEmu(t) }
  await settle(id);
}

/** requireStop: a cancel may not leave the position less covered by stops than its size (move the stop or close instead). */
function keepsStop(id: string, gone: BrokerOrder[]) {
  const row = rowOf(id);
  if (!row.acct.guard.requireStop) return;
  for (const o of gone) {
    if (!isStopKind(o.kind)) continue;
    const c = ctxFor(row, o.sym, o.side === 'buy' ? 'sell' : 'buy', 0);   // the stops on o's side, the position they protect
    const left = c.stopQty - gone.filter(g => same(g.sym, o.sym) && g.side === o.side && isStopKind(g.kind)).reduce((s, g) => s + g.qty - g.filled, 0);
    const against = c.spot ? o.side === 'sell' && c.pos > 0 : c.pos !== 0 && (o.side === 'buy') !== (c.pos > 0);
    if (against && left < Math.abs(c.pos) * (1 - 1e-9)) throw bad('This stop protects the open position and a stop-loss is required: move it, or close the position, instead of canceling it');
  }
}
function setBracket(id: string, parent: BrokerOrder, p: OrderPatch) {
  const b = emusOf(id).find(e => e.kind === 'bracket' && e.parent === parent.id);
  const tp = p.tp === undefined ? b?.order.tp : p.tp ?? undefined, sl = p.sl === undefined ? b?.order.sl : p.sl ?? undefined;
  checkBracket({ side: parent.side, tp, sl }, parent.price ?? parent.stopPrice ?? rt(id).prices.get(parent.sym) ?? (tp && sl ? (tp + sl) / 2 : tp ?? sl ?? 0));
  if (b) dropEmu(b.id);
  if (tp || sl) addBracket(id, parent, tp, sl, b?.legQty, b?.legging);
}

export const modifyOrder = (id: string, oid: string, x: unknown) => locked(id, () => modify(id, oid, x));
async function modify(id: string, oid: string, x: unknown): Promise<BrokerOrder> {
  const row = activeRow(id), p = validPatch(x), ad = adapterOf(id);
  // Only an active account that doesn't require stops may drop an SL (demoting is exactly how requireStop gets turned off).
  if (p.sl === null && (row.acct.guard.requireStop || row.acct.status !== 'active')) throw bad('A stop-loss is required on this account: move the SL instead of removing it');
  const e = emus.get(oid);
  if (e && e.account === id && e.kind === 'trigger') {
    if (e.order.status !== 'open') throw bad('This order is no longer open');
    const k = e.order.kind;
    if (k === 'trailing_stop' && (p.price !== undefined || p.stopPrice !== undefined)) throw bad('A trailing stop moves by itself: change it by canceling and placing a new one');
    if (p.qty !== undefined) { e.order.qty = e.send!.qty = p.qty }
    if (p.stopPrice !== undefined) { if (k !== 'stop' && k !== 'stop_limit') throw bad('This order has no stop price'); e.trig!.at = e.order.stopPrice = p.stopPrice }
    if (p.price !== undefined) {
      if (k !== 'limit' && k !== 'stop_limit') throw bad('This order has no limit price');
      e.order.price = e.send!.price = p.price;
      if (k === 'limit') e.trig!.at = p.price;
    }
    e.order.updated = deps.now(); e.order.error = describe(e); saveEmu(e);
    if (p.tp !== undefined || p.sl !== undefined) setBracket(id, e.order, p);
    await settle(id);
    return emuView(id).find(o => o.id === oid)!;
  }
  const st = await fresh(id), o = st.orders.find(z => z.id === oid);
  if (!o || o.id.startsWith('emu:')) throw new HttpError(404, 'Unknown or already closed order');
  if (p.tp !== undefined || p.sl !== undefined) setBracket(id, o, p);
  if (p.price === undefined && p.stopPrice === undefined && p.qty === undefined) { await settle(id); return { ...o, ...(p.tp != null ? { tp: p.tp } : {}), ...(p.sl != null ? { sl: p.sl } : {}) } }
  if (p.price !== undefined && o.kind !== 'limit' && o.kind !== 'stop_limit') throw bad('This order has no limit price');
  if (p.stopPrice !== undefined && o.kind !== 'stop' && o.kind !== 'stop_limit') throw bad('This order has no stop price');
  if (o.kind === 'market' || o.kind === 'trailing_stop') throw bad('This order cannot be modified');
  const n: Native = { sym: o.sym, side: o.side, kind: o.kind, qty: p.qty ?? o.qty - o.filled, ...(o.kind === 'limit' || o.kind === 'stop_limit' ? { price: p.price ?? o.price } : {}), ...(o.stopPrice !== undefined || p.stopPrice !== undefined ? { stopPrice: p.stopPrice ?? o.stopPrice } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}) };
  // Re-check the whole order: a bigger qty or a price moved toward the market both change its notional.
  const bsl = emusOf(id).find(b => b.kind === 'bracket' && b.parent === oid)?.order.sl;
  const v = checkOrder({ side: o.side, qty: n.qty, reduceOnly: o.reduceOnly, ...(bsl ? { sl: bsl } : {}) }, ctxFor(row, o.sym, o.side, n.price ?? n.stopPrice ?? rt(id).prices.get(o.sym) ?? 0, false, z => z.id === o.id));
  if (!v.ok) { if (v.trip) await trip(row); throw bad(v.reason) }
  let out: BrokerOrder;
  const brackets = emusOf(id).filter(b => b.kind === 'bracket' && b.parent === oid);
  if (ad.canEdit && ad.edit && o.kind === 'limit') {
    try { out = await ad.edit(oid, n) } catch (err) { throw fail(id, err) }
  } else if (isStopKind(o.kind)) {
    // A stop is replaced new-first: the position is never without one. If the exchange refuses a second stop (spot: the old one
    // locks the coins) an emulated copy covers the gap until the old one is gone; it stays if the native retry also fails.
    n.clientId = cid('mod', oid, JSON.stringify(n));
    let emu: Emu | undefined;
    try { out = await placeOnce(ad, n) }
    catch (err) {
      const why = scrub(err, secretsOf(id));
      emu = addTrigger(id, { sym: n.sym, side: n.side, kind: o.kind as 'stop' | 'stop_limit', qty: n.qty, ...(n.price !== undefined ? { price: n.price } : {}), ...(n.stopPrice !== undefined ? { stopPrice: n.stopPrice } : {}), ...(n.reduceOnly ? { reduceOnly: true } : {}) }, n.stopPrice ?? n.price ?? 0, 'stop (moved)');
      emu.order.error += ` — the exchange refused the replacement (${why})`; saveEmu(emu);
      out = emu.order;
    }
    try { await ad.cancel(oid, o.sym, true) }
    catch (err) {
      if (emu) dropEmu(emu.id); else await ad.cancel(out.id, out.sym, true).catch(() => {});   // undo: one stop, the old one
      throw fail(id, err);
    }
    if (emu) {   // the old stop is gone and its coins are free: try the native one again, else the emulated stop stays
      try { out = await placeOnce(ad, { ...n, clientId: cid('mod2', oid, JSON.stringify(n)) }); dropEmu(emu.id) } catch { /* emulated stop stays */ }
    }
  } else {
    // Cancel + replace, sized from what is really left. If the replacement fails the user must know nothing rests any more.
    try { await ad.cancel(oid, o.sym, isStopKind(o.kind)) } catch (err) { throw fail(id, err) }
    let old: BrokerOrder;
    try { old = await ad.order(oid, o.sym, isStopKind(o.kind)) }
    catch (err) { await settle(id); throw new HttpError(502, `The old order was canceled, but its fills could not be read, so no replacement was placed: ${scrub(err, secretsOf(id))}`) }
    if (p.qty === undefined) n.qty = o.qty - old.filled;
    if (!(n.qty > 0)) { await settle(id); throw bad('The order filled completely before it could be modified') }
    n.clientId = cid('mod', oid, JSON.stringify(n));
    try { out = await placeOnce(ad, n) }
    catch (err) { await settle(id); throw new HttpError(502, `The old order was canceled but its replacement failed, so nothing rests now: ${scrub(err, secretsOf(id))}`) }
  }
  // A new order id gets brackets of its own. The old brackets stay on the old order: the next pass legs its last fills and drops them.
  if (out.id !== oid) for (const b of brackets) addBracket(id, out, b.order.tp, b.order.sl);
  for (const t of emusOf(id)) if (t.peer?.id === oid) { t.peer = { id: out.id, sym: out.sym }; saveEmu(t) }
  await settle(id);
  return annotate(id, [out])[0];
}

export const closePosition = (id: string, x: unknown) => locked(id, () => close(id, x));
async function close(id: string, x: unknown) {
  const row = activeRow(id);
  const sym = (x && typeof x === 'object' && typeof (x as { sym?: unknown }).sym === 'string') ? (x as { sym: string }).sym : '';
  if (!/^(?:[A-Z0-9]{2,30}:)?[A-Z0-9_.]{1,40}$/.test(sym)) throw bad('Bad symbol');
  const st = await poll(id), ad = adapterOf(id), spot = row.acct.market !== 'futures';
  // Native stops on this symbol: on spot they lock the coins (so the position is free + locked, and they must go first).
  const stops = st.orders.filter(o => o.status === 'open' && !o.id.startsWith('emu:') && same(o.sym, sym) && isStopKind(o.kind));
  let qty: number;
  if (!spot) qty = st.positions.filter(p => same(p.sym, sym)).reduce((s, p) => s + p.qty, 0);
  else {
    const b = st.balances.find(z => z.asset === parseSym(sym).base);
    qty = (b?.free ?? 0) + Math.min(b?.locked ?? 0, stops.filter(o => o.side === 'sell').reduce((t, o) => t + o.qty - o.filled, 0));
  }
  if (!qty) throw bad('No position in this symbol');
  const posSym = spot ? sym : st.positions.find(p => same(p.sym, sym))!.sym;
  const freed: BrokerOrder[] = [];
  if (spot) for (const o of stops.filter(z => z.side === 'sell')) {
    try { await ad.cancel(o.id, o.sym, true); freed.push(o) }
    catch (err) { await restore(ad, freed); throw fail(id, err) }
  }
  try { await placeOnce(ad, { sym: posSym, side: qty > 0 ? 'sell' : 'buy', kind: 'market', qty: Math.abs(qty), reduceOnly: true, clientId: cid('close', id, posSym, qty, randomUUID()) }) }
  catch (e) { await restore(ad, freed); throw fail(id, e) }   // the stops that were lifted for it go back
  // Closed. Only now do the exits that belonged to the position go (an entry that still rests keeps its bracket for what fills
  // later: what filled so far was just closed, so it counts as legged), and the native stops left behind are canceled.
  const orphans = new Map<string, BrokerOrder | { id: string; sym: string }>(spot ? [] : stops.filter(o => o.reduceOnly).map(o => [o.id, o]));
  for (const e of emusOf(id)) {
    if (!same(e.order.sym, sym)) continue;
    const parent = e.kind === 'bracket' ? st.orders.find(o => o.id === e.parent && o.status === 'open') : undefined;
    if (parent) { delete e.legging; e.legQty = parent.filled; saveEmu(e) }
    else if (e.kind === 'bracket' || e.send?.reduceOnly) { if (e.peer) orphans.set(e.peer.id, e.peer); dropEmu(e.id) }
  }
  for (const o of orphans.values()) await ad.cancel(o.id, o.sym, true).catch(err => { if (!UNKNOWN.test(msgOf(err))) console.warn(`[brokers] ${id}: stop left behind after close: ${scrub(err, secretsOf(id))}`) });
  await settle(id);
}
/** Put back stops that were lifted for a close that then failed (best effort, same clientId so a retry finds it). */
async function restore(ad: Adapter, gone: BrokerOrder[]) {
  for (const o of gone) await placeOnce(ad, { sym: o.sym, side: o.side, kind: o.kind as Native['kind'], qty: o.qty - o.filled, ...(o.price !== undefined ? { price: o.price } : {}), ...(o.stopPrice !== undefined ? { stopPrice: o.stopPrice } : {}), reduceOnly: true, clientId: cid('restore', o.id) }).catch(() => {});
}

// ---------- loop ----------
function nextDelay(id: string) {
  const r = rt(id);
  if (r.errors) return Math.min(60_000, 3000 * 2 ** Math.min(r.errors, 5));
  return emusOf(id).some(e => e.order.status === 'open') ? 2000 : 5000;
}
function schedule(id: string, ms: number) {
  const r = rt(id);
  if (r.timer) clearTimeout(r.timer);
  const row = rows.get(id);
  if (!row || r.deleted || !polls(row.acct) || process.env.CT_NO_AUTOSTART) return;
  r.timer = setTimeout(async () => { await refresh(id).catch(() => {}); schedule(id, nextDelay(id)) }, ms);
  r.timer.unref?.();
}
function start(id: string) {
  schedule(id, 0);
  const r = rt(id);
  if (!r.unwatch && !process.env.CT_NO_AUTOSTART) { try { r.unwatch = adapterOf(id).watch?.(() => schedule(id, 200)) } catch {} }
}
function stop(id: string) { const r = rt(id); if (r.timer) clearTimeout(r.timer); r.timer = undefined; r.unwatch?.(); r.unwatch = undefined }
for (const r of rows.values()) {
  if (polls(r.acct)) start(r.acct.id);
  // A demoted account that may hold positions: one refresh makes it live again, then it polls like before the restart.
  // (Only accounts that traded have tracked symbols, and trading needs a passed check: never-checked ones stay locked.)
  else if (r.acct.status === 'pending' && (emusOf(r.acct.id).length || r.meta.syms.length) && !process.env.CT_NO_AUTOSTART) refresh(r.acct.id).then(() => start(r.acct.id), () => {});
}

// ---------- routes (all need a login) ----------
route('GET', '/api/broker/accounts', () => listAccounts());
route('POST', '/api/broker/accounts', c => createAccount(c.body), { limit: 16 * 1024 });
route('PUT', '/api/broker/accounts/:id', c => updateAccount(c.params.id, c.body), { limit: 16 * 1024 });
route('DELETE', '/api/broker/accounts/:id', async c => { await deleteAccount(c.params.id) });
route('POST', '/api/broker/accounts/:id/check', c => check(c.params.id));
route('GET', '/api/broker/:id/state', c => getState(c.params.id));
route('POST', '/api/broker/:id/orders', c => placeOrder(c.params.id, c.body), { limit: 16 * 1024 });
route('PATCH', '/api/broker/:id/orders/:oid', c => modifyOrder(c.params.id, c.params.oid, c.body), { limit: 16 * 1024 });
route('DELETE', '/api/broker/:id/orders/:oid', c => cancelOrder(c.params.id, c.params.oid));
route('POST', '/api/broker/:id/close', c => closePosition(c.params.id, c.body), { limit: 4 * 1024 });

