// Strict validation of broker API input (any device on the LAN can send anything).
import type { AccountInput, Guard, OrderKind, OrderPatch, OrderReq } from '../../src/broker/types.ts';
import { bad } from '../core/http.ts';
import { parseSym } from './adapter.ts';

export const KUCOIN_MSG = 'KuCoin is not available: CCXT 4.5 has no KuCoin sandbox (KuCoin closed its sandbox), so there is no testnet to trade on';
const BROKERS = ['binance', 'binanceusdm', 'bybit', 'okx', 'kucoin', 'nobitex', 'mt5'] as const;
const KINDS: OrderKind[] = ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'];
const MAX = 1e15;

const obj = (x: unknown, what: string) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad(`${what} must be an object`); return x as Record<string, unknown> };
const only = (o: Record<string, unknown>, keys: string[]) => { for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad(`Unknown field ${k.slice(0, 40)}`) };
const pos = (x: unknown, what: string) => { if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > MAX) throw bad(`Bad ${what}`); return x };
const pct = (x: unknown, what: string) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 100) throw bad(`${what} must be 0–100`); return x };
const bool = (x: unknown, what: string) => { if (typeof x !== 'boolean') throw bad(`Bad ${what}`); return x };
const str = (x: unknown, what: string, max: number, re?: RegExp) => {
  if (typeof x !== 'string' || !x.trim() || x.length > max || (re && !re.test(x))) throw bad(`Bad ${what}`);
  return x.trim();
};

export function validGuard(x: unknown, base: Guard): Guard {
  const g = obj(x, 'guard');
  only(g, ['maxDailyLossPct', 'maxPositionPct', 'requireStop', 'confirmedNoWithdraw']);
  const out = { ...base };
  if (g.maxDailyLossPct !== undefined) out.maxDailyLossPct = pct(g.maxDailyLossPct, 'maxDailyLossPct');
  if (g.maxPositionPct !== undefined) out.maxPositionPct = pct(g.maxPositionPct, 'maxPositionPct');
  if (g.requireStop !== undefined) out.requireStop = bool(g.requireStop, 'requireStop');
  if (g.confirmedNoWithdraw !== undefined) out.confirmedNoWithdraw = bool(g.confirmedNoWithdraw, 'confirmedNoWithdraw');
  return out;
}

const KEY_RE = /^[\x21-\x7e]+$/;   // printable ASCII, no spaces
export function validAccount(x: unknown, defaults: Guard): AccountInput & { guard: Guard } {
  const b = obj(x, 'Account');
  only(b, ['broker', 'label', 'market', 'apiKey', 'secret', 'passphrase', 'guard']);
  if (!BROKERS.includes(b.broker as never)) throw bad('Unknown broker');
  if (b.broker === 'kucoin') throw bad(KUCOIN_MSG);
  const broker = b.broker as AccountInput['broker'];
  if (b.market !== 'spot' && b.market !== 'futures') throw bad('market must be spot or futures');
  const market = b.market;
  if ((broker === 'binance' || broker === 'nobitex') && market !== 'spot') throw bad(`${broker} accounts are spot (use binanceusdm for futures)`);
  if (broker === 'binanceusdm' && market !== 'futures') throw bad('binanceusdm accounts are futures (use binance for spot)');
  if (broker === 'mt5' && market !== 'futures') throw bad('MetaTrader 5 accounts hold positions: use market futures');
  const a: AccountInput & { guard: Guard } = {
    broker, market, label: str(b.label, 'label', 60),
    apiKey: str(b.apiKey, 'apiKey', 512, KEY_RE),
    secret: (broker === 'nobitex' || broker === 'mt5') && (b.secret === undefined || b.secret === '') ? '' : str(b.secret, 'secret', 512, KEY_RE),
    guard: b.guard === undefined ? { ...defaults } : validGuard(b.guard, defaults),
  };
  if (b.passphrase !== undefined && b.passphrase !== '') a.passphrase = str(b.passphrase, 'passphrase', 128, KEY_RE);
  if (broker === 'okx' && !a.passphrase) throw bad('OKX needs the API key passphrase');
  return a;
}

export function validAccountPatch(x: unknown): { label?: string; guard?: Record<string, unknown> } {
  const b = obj(x, 'Patch');
  only(b, ['label', 'guard']);
  return { ...(b.label !== undefined ? { label: str(b.label, 'label', 60) } : {}), ...(b.guard !== undefined ? { guard: obj(b.guard, 'guard') } : {}) };
}

const SYM_RE = /^(?:[A-Z0-9]{2,30}:)?[A-Z0-9_.]{1,40}$/;
function leg(b: Record<string, unknown>, keys: string[]): OrderReq {
  only(b, keys);
  const sym = str(b.sym, 'symbol', 72, SYM_RE);
  try { parseSym(sym) } catch (e) { throw bad((e as Error).message) }
  if (b.side !== 'buy' && b.side !== 'sell') throw bad('side must be buy or sell');
  if (!KINDS.includes(b.kind as OrderKind)) throw bad('Bad order kind');
  const o: OrderReq = { sym, side: b.side, kind: b.kind as OrderKind, qty: pos(b.qty, 'qty') };
  if (o.kind === 'limit' || o.kind === 'stop_limit') o.price = pos(b.price, 'price');
  else if (b.price !== undefined) throw bad(`${o.kind} orders take no limit price`);
  if (o.kind === 'stop' || o.kind === 'stop_limit') o.stopPrice = pos(b.stopPrice, 'stopPrice');
  else if (b.stopPrice !== undefined) throw bad(`${o.kind} orders take no stop price`);
  if (o.kind === 'trailing_stop') {
    const t = obj(b.trail, 'trail');
    only(t, ['pct', 'amount']);
    if ((t.pct === undefined) === (t.amount === undefined)) throw bad('trail needs exactly one of pct or amount');
    if (t.pct !== undefined) { const p = pos(t.pct, 'trail.pct'); if (p >= 50) throw bad('trail.pct must be below 50'); o.trail = { pct: p } }
    else o.trail = { amount: pos(t.amount, 'trail.amount') };
  } else if (b.trail !== undefined) throw bad('Only trailing stops take trail');
  if (b.reduceOnly !== undefined) o.reduceOnly = bool(b.reduceOnly, 'reduceOnly');
  if (b.clientId !== undefined) o.clientId = str(b.clientId, 'clientId', 32, /^[A-Za-z0-9_-]+$/);
  return o;
}
const LEG_KEYS = ['sym', 'side', 'kind', 'qty', 'price', 'stopPrice', 'trail', 'reduceOnly', 'clientId'];

export function validOrder(x: unknown): OrderReq {
  const b = obj(x, 'Order');
  const o = leg(b, [...LEG_KEYS, 'tp', 'sl', 'ocoWith']);
  if (b.tp !== undefined) o.tp = pos(b.tp, 'tp');
  if (b.sl !== undefined) o.sl = pos(b.sl, 'sl');
  if ((o.tp || o.sl) && o.reduceOnly) throw bad('A reduce-only order takes no TP/SL bracket');
  if (b.ocoWith !== undefined) {
    const w = leg(obj(b.ocoWith, 'ocoWith'), LEG_KEYS);
    if (w.sym !== o.sym) throw bad('Both OCO legs must be on the same symbol');
    if (o.kind === 'market' || w.kind === 'market') throw bad('OCO legs must be limit, stop, stop-limit or trailing stop');
    o.ocoWith = w;
  }
  return o;
}

/** TP above and SL below the entry for a buy, the other way round for a sell. */
export function checkBracket(o: Pick<OrderReq, 'side' | 'tp' | 'sl'>, entry: number) {
  const up = o.side === 'buy';
  if (o.tp !== undefined && (up ? o.tp <= entry : o.tp >= entry)) throw bad(`Take profit must be ${up ? 'above' : 'below'} the entry (${entry})`);
  if (o.sl !== undefined && (up ? o.sl >= entry : o.sl <= entry)) throw bad(`Stop loss must be ${up ? 'below' : 'above'} the entry (${entry})`);
}

export function validPatch(x: unknown): OrderPatch {
  const b = obj(x, 'Patch');
  only(b, ['price', 'stopPrice', 'qty', 'tp', 'sl']);
  const p: OrderPatch = {};
  if (b.price !== undefined) p.price = pos(b.price, 'price');
  if (b.stopPrice !== undefined) p.stopPrice = pos(b.stopPrice, 'stopPrice');
  if (b.qty !== undefined) p.qty = pos(b.qty, 'qty');
  if (b.tp !== undefined) p.tp = b.tp === null ? null : pos(b.tp, 'tp');
  if (b.sl !== undefined) p.sl = b.sl === null ? null : pos(b.sl, 'sl');
  if (!Object.keys(p).length) throw bad('Nothing to change');
  return p;
}
