// [agent: brokers] Exchange TESTNET accounts on the server (docs/phase6-contracts.md, src/broker/types.ts).
//   Accounts CRUD with encrypted keys, the guardian check, guarded orders, server-side emulation (trailing, OCO,
//   brackets, missing stop kinds) and a poll loop that pushes { type: 'broker', account, state } over WS.
// Keys never leave this module except into the adapter: not in responses, logs or error messages (scrub()).
import { randomUUID } from 'node:crypto';
import type { BrokerAccount, BrokerOrder, BrokerState, GuardianItem, GuardianReport, OrderPatch, OrderReq } from '../../src/broker/types.ts';
import { DEFAULT_GUARD } from '../../src/broker/types.ts';
import { db, migration } from '../core/db.ts';
import { secretDel, secretGet, secretHas, secretSet } from '../core/secrets.ts';
import { HttpError, bad, broadcast, route } from '../core/http.ts';
import type { Adapter, Native } from './adapter.ts';
import { parseSym } from './adapter.ts';
import { ccxtAdapter } from './ccxtx.ts';
import { nobitexAdapter } from './nobitex.ts';
import { arm, sendKind, step, type Trigger } from './emulate.ts';
import { breakerHit, checkOrder, guardItems, utcDay, type OrderCtx } from './risk.ts';
import { scrub } from './safety.ts';
import { KUCOIN_MSG, checkBracket, validAccount, validAccountPatch, validGuard, validOrder, validPatch } from './validate.ts';

migration('brokers/1', `
  CREATE TABLE broker_accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL, meta TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE broker_day (account TEXT NOT NULL, day TEXT NOT NULL, equity REAL NOT NULL, PRIMARY KEY (account, day));
  CREATE TABLE broker_emu (id TEXT PRIMARY KEY, account TEXT NOT NULL, data TEXT NOT NULL);
`);

interface Meta { syms: string[]; trippedDay?: string; okStatus?: 'active' | 'tripped' }
interface Row { acct: BrokerAccount; meta: Meta }
/** A server-emulated order: `trigger` waits for a price and then sends `send`; `bracket` waits for its entry to fill. */
export interface Emu {
  id: string; account: string; kind: 'trigger' | 'bracket'; order: BrokerOrder;
  trig?: Trigger; send?: Native; what?: string;
  oco?: string;                              // trigger legs of one OCO group cancel each other
  peer?: { id: string; sym: string };        // native order of the same OCO group (a bracket's exchange-side stop)
  parent?: string; parentSym?: string;       // bracket: the entry order (native id, or an emu id until it fires)
  tries?: number;
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
  if (a.broker === 'paper') throw Error('The paper account lives in the browser');
  return ccxtAdapter(a.broker, a.market, k);
}
/** Swappable for tests (fake exchanges, a fixed clock). */
export const deps = { adapter: makeAdapter, now: () => Date.now() };

// ---------- runtime per account ----------
interface Rt { ad: Adapter | null; state: BrokerState | null; json: string; errors: number; timer?: ReturnType<typeof setTimeout>; unwatch?: () => void; busy?: Promise<BrokerState>; next?: Promise<BrokerState>; prices: Map<string, number> }
const rts = new Map<string, Rt>();
const rt = (id: string) => { let r = rts.get(id); if (!r) rts.set(id, (r = { ad: null, state: null, json: '', errors: 0, prices: new Map() })); return r };

function rowOf(id: string): Row { const r = rows.get(id); if (!r) throw new HttpError(404, 'Unknown account'); return r }
const fail = (id: string, e: unknown) => (e instanceof HttpError ? e : new HttpError(502, scrub(e, secretsOf(id))));
function adapterOf(id: string): Adapter {
  const r = rt(id);
  if (!r.ad) { try { r.ad = deps.adapter(rowOf(id).acct, keysOf(id)) } catch (e) { throw new HttpError(400, scrub(e, secretsOf(id))) } }
  return r.ad;
}
function dropAdapter(id: string) { const r = rt(id); r.unwatch?.(); r.unwatch = undefined; r.ad?.close(); r.ad = null }

const mainQuote = (a: BrokerAccount) => (a.broker === 'nobitex' ? 'IRT' : 'USDT');
/** Same instrument? BTCUSDT, BINANCE:BTCUSDT and BYBIT:BTC_USDT all mean BTC/USDT. */
const keyOf = (sym: string) => { try { const p = parseSym(sym); return `${p.base}/${p.quote}` } catch { return sym } };
const same = (a: string, b: string) => keyOf(a) === keyOf(b);

function setStatus(row: Row, status: BrokerAccount['status'], error?: string) {
  row.acct.status = status;
  if (error) row.acct.error = error; else delete row.acct.error;
  saveRow(row);
}
const polls = (a: BrokerAccount) => a.status === 'active' || a.status === 'tripped' || a.status === 'error';

/**
 * Equity in quote currency `q`: its balance, plus base assets of the symbols this account trades at their last price
 * (spot), plus unrealised PnL (futures). ponytail: other coins held on a spot testnet are not counted; price them all
 * (one fetchTickers) if equity must include them.
 */
function equityIn(q: string, row: Row, st: Pick<BrokerState, 'balances' | 'positions'>, prices: Map<string, number>) {
  const bal = (a: string) => { const b = st.balances.find(x => x.asset === a); return b ? b.free + b.locked : 0 };
  let e = bal(q);
  if (row.acct.market === 'futures') return e + st.positions.filter(p => keyOf(p.sym).endsWith(`/${q}`)).reduce((s, p) => s + (p.upnl ?? 0), 0);
  const seen = new Set<string>();
  for (const sym of row.meta.syms) {
    const p = parseSym(sym), px = prices.get(sym);
    if (p.quote !== q || seen.has(p.base) || !px) continue;
    seen.add(p.base); e += bal(p.base) * px;
  }
  return e;
}
function dayStart(id: string, equity: number) {
  const day = utcDay(deps.now());
  db.prepare('INSERT OR IGNORE INTO broker_day (account, day, equity) VALUES (?, ?, ?)').run(id, day, equity);
  return (db.prepare('SELECT equity FROM broker_day WHERE account = ? AND day = ?').get(id, day) as { equity: number }).equity;
}

const isStopKind = (k: string) => k === 'stop' || k === 'stop_limit' || k === 'trailing_stop';
/** The UI's view of the exchange's orders: TP/SL of pending brackets and OCO links filled in. */
function annotate(id: string, orders: BrokerOrder[]): BrokerOrder[] {
  const es = emusOf(id);
  return orders.map(o => {
    const b = es.find(e => e.kind === 'bracket' && e.parent === o.id), p = es.find(e => e.peer?.id === o.id);
    return { ...o, ...(b?.order.tp ? { tp: b.order.tp } : {}), ...(b?.order.sl ? { sl: b.order.sl } : {}), ...(p?.oco ? { ocoGroup: p.oco } : {}) };
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
  if (json !== r.json) { r.json = json; broadcast({ type: 'broker', account: id, state: st }) }
}

/** Poll the exchange once: balances, positions, open orders, fills; run emulation; enforce the breaker; push on change. */
export function refresh(id: string): Promise<BrokerState> {
  const r = rt(id);
  // One poll at a time; callers arriving during a poll share one follow-up poll (they may need data newer than it).
  if (r.busy) return (r.next ??= r.busy.catch(() => {}).then(() => { r.next = undefined; return refresh(id) }));
  r.busy = poll(id).finally(() => { r.busy = undefined });
  return r.busy;
}
async function poll(id: string): Promise<BrokerState> {
  const row = rowOf(id), r = rt(id), ad = adapterOf(id), now = deps.now();
  try {
    const [balances, positions, open] = await Promise.all([ad.balances(), ad.positions(), ad.openOrders()]);
    const fills = row.meta.syms.length ? (await ad.fills(row.meta.syms)).sort((a, b) => b.ts - a.ts).slice(0, 100) : [];
    // Prices: symbols with something emulated waiting, and spot holdings of traded symbols (for equity).
    const want = new Set<string>([...emusOf(id).filter(e => e.kind === 'trigger').map(e => e.order.sym), ...(row.acct.market === 'spot' ? row.meta.syms : [])]);
    for (const s of want) { try { r.prices.set(s, await ad.price(s)) } catch {} }
    for (const p of positions) if (p.mark) r.prices.set(p.sym, p.mark);
    const equity = equityIn(mainQuote(row.acct), row, { balances, positions }, r.prices);
    const start = dayStart(id, equity), today = utcDay(now);
    let st: BrokerState = { account: id, balances, positions, orders: [], fills, equity, dayStartEquity: start, updated: now };
    r.state = { ...st, orders: open };
    const fired = await tickEmus(id, ad, open, r.prices);
    st = { ...st, orders: [...annotate(id, open), ...emuView(id)] };

    if (row.acct.status === 'error') setStatus(row, row.meta.okStatus ?? 'active');
    if (row.acct.status === 'tripped' && row.meta.trippedDay !== today) setStatus(row, 'active');
    if (row.acct.status === 'active' && breakerHit(row.acct.guard, equity, start)) trip(row);
    r.errors = 0;
    publish(id, st);
    if (fired) schedule(id, 300);
    return st;
  } catch (e) {
    const msg = scrub(e, secretsOf(id));
    r.errors++;
    if (row.acct.status !== 'error' && polls(row.acct)) { row.meta.okStatus = row.acct.status === 'tripped' ? 'tripped' : 'active'; setStatus(row, 'error', msg) }
    console.error(`[brokers] ${id}: ${msg}`);
    throw new HttpError(502, msg);
  }
}
function trip(row: Row) { row.meta.trippedDay = utcDay(deps.now()); setStatus(row, 'tripped') }

// ---------- emulation ----------
const describe = (e: Pick<Emu, 'what' | 'trig'>) => `Emulated by the server (${e.what}): fires when price ${e.trig!.dir === 'up' ? 'rises to' : 'falls to'} ${+e.trig!.at.toPrecision(10)}`;

function addTrigger(account: string, o: Omit<OrderReq, 'tp' | 'sl' | 'ocoWith'>, px: number, what: string, extra: Partial<Emu> = {}): Emu {
  const now = deps.now(), trig = arm(o, px), id = `emu:${randomUUID()}`;
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
function addBracket(account: string, parent: BrokerOrder, tp?: number, sl?: number) {
  const id = `emu:${randomUUID()}`;
  saveEmu({ id, account, kind: 'bracket', parent: parent.id, parentSym: parent.sym, order: { ...parent, id, ...(tp ? { tp } : {}), ...(sl ? { sl } : {}) } });
}

/** Exit orders once the entry filled: SL on the exchange where it holds stops (survives a server restart), TP emulated; OCO-linked. */
async function placeLegs(account: string, ad: Adapter, b: Emu, qty: number) {
  const side = b.order.side === 'buy' ? 'sell' : 'buy', sym = b.order.sym, { tp, sl } = b.order;
  const oco = tp && sl ? randomUUID() : undefined;
  let peer: Emu['peer'];
  if (sl) {
    let err = '';
    if (ad.native.has('stop')) {
      try { const o = await ad.place({ sym, side, kind: 'stop', qty, stopPrice: sl, reduceOnly: true }); peer = { id: o.id, sym: o.sym } }
      catch (e) { err = ` — the exchange refused the native stop (${scrub(e, secretsOf(account))})` }
    }
    if (!peer) { const e = addTrigger(account, { sym, side, kind: 'stop', qty, stopPrice: sl, reduceOnly: true }, sl, 'bracket stop loss', { oco }); if (err) { e.order.error += err; saveEmu(e) } }
  }
  if (tp) addTrigger(account, { sym, side, kind: 'limit', qty, price: tp, reduceOnly: true }, tp, 'bracket take profit', { oco, ...(peer ? { peer } : {}) });
}

/** One emulation pass. Returns true when something was sent (so the loop polls again soon). */
async function tickEmus(account: string, ad: Adapter, open: BrokerOrder[], prices: Map<string, number>): Promise<boolean> {
  let fired = false;
  const isOpen = (id: string) => open.some(o => o.id === id);
  for (const e of emusOf(account)) {
    if (!emus.has(e.id)) continue;   // canceled by an OCO sibling earlier in this pass
    if (e.kind === 'bracket') {
      if (e.parent!.startsWith('emu:')) { if (!emus.has(e.parent!)) dropEmu(e.id); continue }
      if (isOpen(e.parent!)) continue;
      let p: BrokerOrder;
      try { p = await ad.order(e.parent!, e.parentSym!) } catch { continue }   // retried next pass
      if (p.status === 'open') continue;
      dropEmu(e.id);
      if (p.filled > 0) await placeLegs(account, ad, e, p.filled);
      fired = true;
      continue;
    }
    if (e.order.status !== 'open') continue;
    if (e.peer && !isOpen(e.peer.id)) {
      // The exchange-side partner is gone: filled → this leg is void; canceled by the user → this leg stays on its own.
      const p = await ad.order(e.peer.id, e.peer.sym).catch(() => null);
      if (p?.status === 'filled' || (p && p.filled > 0)) { dropEmu(e.id); continue }
      if (p) { delete e.peer; saveEmu(e) }
    }
    const px = prices.get(e.order.sym);
    if (px === undefined) continue;
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
  const row = rowOf(account);
  if (!e.send!.reduceOnly) {
    const v = checkOrder(e.send!, ctxFor(row, e.send!.sym, e.send!.side, e.send!.price ?? px, true));
    if (!v.ok) { reject(e, `Not sent: ${v.reason}`); if (v.trip) trip(row); return false }
  }
  try {
    const o = await ad.place(e.send!);
    if (e.oco) for (const s of emusOf(account)) if (s.oco === e.oco && s.id !== e.id) dropEmu(s.id);
    if (e.peer) await ad.cancel(e.peer.id, e.peer.sym, true).catch(() => {});   // already filled/canceled is fine
    for (const b of emusOf(account)) if (b.kind === 'bracket' && b.parent === e.id) { b.parent = o.id; b.parentSym = o.sym; saveEmu(b) }
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
function reject(e: Emu, why: string) { e.order.status = 'rejected'; e.order.error = `${e.what}: ${why}`; e.order.updated = deps.now(); saveEmu(e) }

// ---------- guard ----------
function ctxFor(row: Row, sym: string, side: 'buy' | 'sell', price: number, skipStop = false): OrderCtx {
  const r = rt(row.acct.id), st = r.state, p = parseSym(sym);
  const balances = st?.balances ?? [], positions = st?.positions ?? [];
  const b = balances.find(x => x.asset === p.base);
  const pos = row.acct.market === 'futures' ? positions.filter(x => same(x.sym, sym)).reduce((s, x) => s + x.qty, 0) : b ? b.free + b.locked : 0;
  // An existing stop protects what this order opens or adds to when it sits on the other side.
  const stops = [...(st?.orders ?? []), ...emuView(row.acct.id)].filter(o => same(o.sym, sym) && o.status === 'open' && isStopKind(o.kind) && o.side !== side);
  const prices = new Map(r.prices); prices.set(sym, price);
  return {
    status: row.acct.status, guard: row.acct.guard, spot: row.acct.market === 'spot', pos, spotFree: b?.free ?? 0, price,
    equity: equityIn(p.quote, { ...row, meta: { ...row.meta, syms: [...new Set([...row.meta.syms, sym])] } }, { balances, positions }, prices),
    dayEquity: st?.equity ?? 0, dayStart: st?.dayStartEquity, skipStop,
    hasStop: stops.length > 0,
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
  rows.set(id, row); saveRow(row);
  return acct;
}

export function updateAccount(id: string, x: unknown): BrokerAccount {
  const row = rowOf(id), p = validAccountPatch(x);
  if (p.label) row.acct.label = p.label;
  if (p.guard) {
    row.acct.guard = validGuard(p.guard, row.acct.guard);
    // Loosening the guard below what the guardian requires takes the account out of trading until it is checked again.
    if (row.acct.status !== 'pending' && guardItems(row.acct.guard, null).some(i => i.id !== 'withdraw' && !i.ok)) { setStatus(row, 'pending'); stop(id) }
  }
  saveRow(row);
  return row.acct;
}

export function deleteAccount(id: string) {
  rowOf(id);
  stop(id); dropAdapter(id); rts.delete(id);
  for (const k of SECRET_KEYS) secretDel(secretName(id, k));
  for (const e of emusOf(id)) dropEmu(e.id);
  db.prepare('DELETE FROM broker_day WHERE account = ?').run(id);
  db.prepare('DELETE FROM broker_accounts WHERE id = ?').run(id);
  rows.delete(id);
}

export async function check(id: string): Promise<GuardianReport> {
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
  else { setStatus(row, 'pending'); stop(id) }
  return { ok, items };
}

const activeRow = (id: string) => { const row = rowOf(id); if (row.acct.status === 'pending') throw bad('Account is pending: run the guardian check first'); return row };
async function fresh(id: string) { const r = rt(id); if (!r.state || deps.now() - r.state.updated > 10_000) await refresh(id); return r.state! }
function track(row: Row, sym: string) { if (!row.meta.syms.includes(sym)) { row.meta.syms.push(sym); saveRow(row) } }

export async function getState(id: string): Promise<BrokerState> {
  // A pending account has no verified testnet connection yet: an empty state, no exchange call.
  if (rowOf(id).acct.status === 'pending') return { account: id, balances: [], positions: [], orders: [], fills: [], updated: deps.now() };
  return rt(id).state ?? refresh(id);
}

export async function placeOrder(id: string, x: unknown): Promise<BrokerOrder> {
  const row = activeRow(id), o = validOrder(x), ad = adapterOf(id);
  await fresh(id);
  let px: number;
  try { px = await ad.price(o.sym) } catch (e) { throw fail(id, e) }
  rt(id).prices.set(o.sym, px);
  const entry = o.price ?? o.stopPrice ?? px;
  checkBracket(o, entry);
  for (const leg of o.ocoWith ? [o, o.ocoWith] : [o]) {
    const v = checkOrder(leg, ctxFor(row, leg.sym, leg.side, leg.price ?? leg.stopPrice ?? px));
    if (!v.ok) { if (v.trip) trip(row); throw bad(v.reason) }
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
    const n: Native = { sym: o.sym, side: o.side, kind: o.kind as Native['kind'], qty: o.qty, ...(o.price !== undefined ? { price: o.price } : {}), ...(o.stopPrice !== undefined ? { stopPrice: o.stopPrice } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}), ...(o.clientId ? { clientId: o.clientId } : {}) };
    try { placed = await ad.place(n) } catch (e) { throw fail(id, e) }
  }
  if (o.tp || o.sl) { addBracket(id, placed, o.tp, o.sl); placed = { ...placed, ...(o.tp ? { tp: o.tp } : {}), ...(o.sl ? { sl: o.sl } : {}) } }
  refresh(id).catch(() => {});
  return placed;
}

export async function cancelOrder(id: string, oid: string) {
  activeRow(id);
  const e = emus.get(oid);
  if (e && e.account === id) {
    for (const s of emusOf(id)) if (s.id === oid || (e.oco && s.oco === e.oco) || s.parent === oid) dropEmu(s.id);
    refresh(id).catch(() => {});
    return;
  }
  const st = await fresh(id), o = st.orders.find(x => x.id === oid);
  if (!o) throw new HttpError(404, 'Unknown or already closed order');
  try { await adapterOf(id).cancel(oid, o.sym, isStopKind(o.kind)) } catch (err) { throw fail(id, err) }
  for (const b of emusOf(id)) if (b.parent === oid) dropEmu(b.id);
  for (const t of emusOf(id)) if (t.peer?.id === oid) { delete t.peer; saveEmu(t) }
  refresh(id).catch(() => {});
}

function setBracket(id: string, parent: BrokerOrder, p: OrderPatch) {
  const b = emusOf(id).find(e => e.kind === 'bracket' && e.parent === parent.id);
  const tp = p.tp === undefined ? b?.order.tp : p.tp ?? undefined, sl = p.sl === undefined ? b?.order.sl : p.sl ?? undefined;
  checkBracket({ side: parent.side, tp, sl }, parent.price ?? parent.stopPrice ?? rt(id).prices.get(parent.sym) ?? (tp && sl ? (tp + sl) / 2 : tp ?? sl ?? 0));
  if (b) dropEmu(b.id);
  if (tp || sl) addBracket(id, parent, tp, sl);
}

export async function modifyOrder(id: string, oid: string, x: unknown): Promise<BrokerOrder> {
  const row = activeRow(id), p = validPatch(x), ad = adapterOf(id);
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
    refresh(id).catch(() => {});
    return emuView(id).find(o => o.id === oid)!;
  }
  const st = await fresh(id), o = st.orders.find(z => z.id === oid);
  if (!o || o.id.startsWith('emu:')) throw new HttpError(404, 'Unknown or already closed order');
  if (p.tp !== undefined || p.sl !== undefined) setBracket(id, o, p);
  if (p.price === undefined && p.stopPrice === undefined && p.qty === undefined) { refresh(id).catch(() => {}); return { ...o, ...(p.tp != null ? { tp: p.tp } : {}), ...(p.sl != null ? { sl: p.sl } : {}) } }
  if (p.price !== undefined && o.kind !== 'limit' && o.kind !== 'stop_limit') throw bad('This order has no limit price');
  if (p.stopPrice !== undefined && o.kind !== 'stop' && o.kind !== 'stop_limit') throw bad('This order has no stop price');
  if (o.kind === 'market' || o.kind === 'trailing_stop') throw bad('This order cannot be modified');
  const n: Native = { sym: o.sym, side: o.side, kind: o.kind, qty: p.qty ?? o.qty - o.filled, ...(o.kind === 'limit' || o.kind === 'stop_limit' ? { price: p.price ?? o.price } : {}), ...(o.stopPrice !== undefined || p.stopPrice !== undefined ? { stopPrice: p.stopPrice ?? o.stopPrice } : {}), ...(o.reduceOnly ? { reduceOnly: true } : {}) };
  if (p.qty !== undefined && p.qty > o.qty - o.filled) {
    const v = checkOrder({ side: o.side, qty: p.qty - (o.qty - o.filled), reduceOnly: o.reduceOnly }, ctxFor(row, o.sym, o.side, n.price ?? n.stopPrice ?? rt(id).prices.get(o.sym) ?? 0, true));
    if (!v.ok) { if (v.trip) trip(row); throw bad(v.reason) }
  }
  let out: BrokerOrder;
  if (ad.canEdit && ad.edit && o.kind === 'limit') {
    try { out = await ad.edit(oid, n) } catch (err) { throw fail(id, err) }
  } else {
    // Cancel + replace. If the replacement fails the user must know nothing rests any more.
    try { await ad.cancel(oid, o.sym, isStopKind(o.kind)) } catch (err) { throw fail(id, err) }
    try { out = await ad.place(n) }
    catch (err) { throw new HttpError(502, `The old order was canceled but its replacement failed, so nothing rests now: ${scrub(err, secretsOf(id))}`) }
  }
  for (const b of emusOf(id)) if (b.parent === oid) { b.parent = out.id; saveEmu(b) }
  for (const t of emusOf(id)) if (t.peer?.id === oid) { t.peer = { id: out.id, sym: out.sym }; saveEmu(t) }
  refresh(id).catch(() => {});
  return annotate(id, [out])[0];
}

export async function closePosition(id: string, x: unknown) {
  const row = activeRow(id);
  const sym = (x && typeof x === 'object' && typeof (x as { sym?: unknown }).sym === 'string') ? (x as { sym: string }).sym : '';
  if (!/^(?:[A-Z0-9]{2,30}:)?[A-Z0-9_.]{1,40}$/.test(sym)) throw bad('Bad symbol');
  const st = await refresh(id), ad = adapterOf(id);
  let qty: number;
  if (row.acct.market === 'futures') qty = st.positions.filter(p => same(p.sym, sym)).reduce((s, p) => s + p.qty, 0);
  else { const base = parseSym(sym).base; qty = st.balances.find(b => b.asset === base)?.free ?? 0 }
  if (!qty) throw bad('No position in this symbol');
  // Exits that belong to this position go with it.
  for (const e of emusOf(id)) if (same(e.order.sym, sym) && (e.kind === 'bracket' || e.send?.reduceOnly)) dropEmu(e.id);
  const posSym = row.acct.market === 'futures' ? st.positions.find(p => same(p.sym, sym))!.sym : sym;
  try { await ad.place({ sym: posSym, side: qty > 0 ? 'sell' : 'buy', kind: 'market', qty: Math.abs(qty), reduceOnly: true }) } catch (e) { throw fail(id, e) }
  refresh(id).catch(() => {});
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
  if (!row || !polls(row.acct) || process.env.CT_NO_AUTOSTART) return;
  r.timer = setTimeout(async () => { await refresh(id).catch(() => {}); schedule(id, nextDelay(id)) }, ms);
  r.timer.unref?.();
}
function start(id: string) {
  schedule(id, 0);
  const r = rt(id);
  if (!r.unwatch && !process.env.CT_NO_AUTOSTART) { try { r.unwatch = adapterOf(id).watch?.(() => schedule(id, 200)) } catch {} }
}
function stop(id: string) { const r = rt(id); if (r.timer) clearTimeout(r.timer); r.timer = undefined; r.unwatch?.(); r.unwatch = undefined }
for (const r of rows.values()) if (polls(r.acct)) start(r.acct.id);

// ---------- routes (all need a login) ----------
route('GET', '/api/broker/accounts', () => listAccounts());
route('POST', '/api/broker/accounts', c => createAccount(c.body), { limit: 16 * 1024 });
route('PUT', '/api/broker/accounts/:id', c => updateAccount(c.params.id, c.body), { limit: 16 * 1024 });
route('DELETE', '/api/broker/accounts/:id', c => { deleteAccount(c.params.id) });
route('POST', '/api/broker/accounts/:id/check', c => check(c.params.id));
route('GET', '/api/broker/:id/state', c => getState(c.params.id));
route('POST', '/api/broker/:id/orders', c => placeOrder(c.params.id, c.body), { limit: 16 * 1024 });
route('PATCH', '/api/broker/:id/orders/:oid', c => modifyOrder(c.params.id, c.params.oid, c.body), { limit: 16 * 1024 });
route('DELETE', '/api/broker/:id/orders/:oid', c => cancelOrder(c.params.id, c.params.oid));
route('POST', '/api/broker/:id/close', c => closePosition(c.params.id, c.body), { limit: 4 * 1024 });

