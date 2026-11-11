// CCXT adapter for the exchange testnets: Binance spot, Binance USDⓈ-M futures, Bybit, OKX demo trading.
// One CCXT pro instance per account (REST + WebSocket), forced into sandbox mode; every REST request and WebSocket
// connection is checked against the testnet allow-list (safety.ts) before it leaves the process.
import { ccxtLib } from '../ccxtlib.ts';
import type { BrokerFill, BrokerOrder, BrokerPosition, Market, OrderKind } from '../../src/broker/types.ts';
import { symOf } from '../ccxt.ts';
import type { Adapter, Native } from './adapter.ts';
import { parseSym } from './adapter.ts';
import { assertTestnetUrl, urlLeaves } from './safety.ts';

// Loose view of a CCXT instance: only what this file calls.
type Fn = (...a: unknown[]) => Promise<unknown>;
export interface Cx {
  id: string; urls: { api: unknown }; headers?: Record<string, string>; has: Record<string, unknown>;
  markets?: Record<string, { symbol: string; base: string; quote: string; type?: string; settle?: string; contractSize?: number }>;
  setSandboxMode(on: boolean): void; enableDemoTrading?(on: boolean): void; implodeHostname(url: string): string;
  fetch: (url: string, method?: string, headers?: unknown, body?: unknown) => Promise<unknown>;
  client?: (url: string) => unknown;
  loadMarkets: Fn; fetchBalance: Fn; fetchPositions: Fn; fetchOpenOrders: Fn; fetchOrder: Fn; fetchMyTrades: Fn; fetchTicker: Fn;
  createOrder: Fn; fetchClosedOrders?: Fn; cancelOrder: Fn; editOrder: Fn; watchOrders?: Fn; close?: () => Promise<void> | void;
  [k: string]: unknown;
}
type CcxtBroker = 'binance' | 'binanceusdm' | 'bybit' | 'okx';
export interface Keys { apiKey: string; secret: string; passphrase?: string }

/** How an account's CCXT instance is made (tests swap in a fake). */
export const make = { exchange: (id: string, opts: object): Cx => new (ccxtLib().pro as unknown as Record<string, new (o: object) => Cx>)[id](opts) };

/**
 * Sandbox mode + allow-list on every base URL, every REST request and every WebSocket. Returns the hosts.
 * Binance USDⓈ-M: CCXT 4.5 refuses signed calls to the old futures testnet and points to Binance demo trading instead.
 */
export function lockToTestnet(x: Cx): string[] {
  const urls = x.urls as { test?: unknown; demo?: unknown };
  if (x.id === 'binanceusdm') {
    if (!urls.demo || !x.enableDemoTrading) throw Error(`${x.id}: CCXT has no demo trading for this exchange`);
    x.enableDemoTrading(true);
  } else {
    if (!urls.test) throw Error(`${x.id}: CCXT has no sandbox for this exchange`);
    x.setSandboxMode(true);
  }
  const demo = () => x.id === 'okx' && x.headers?.['x-simulated-trading'] === '1';
  const hosts = new Set(urlLeaves(x.urls.api).map(u => assertTestnetUrl(x.implodeHostname(u), demo())));
  const f = x.fetch.bind(x);
  x.fetch = async (url, method, headers, body) => { assertTestnetUrl(url, demo()); return f(url, method, headers, body) };
  if (typeof x.client === 'function') { const c = x.client.bind(x); x.client = url => { assertTestnetUrl(url, demo()); return c(url) } }
  return [...hosts].sort();
}

const STATUS: Record<string, BrokerOrder['status']> = { open: 'open', closed: 'filled', canceled: 'canceled', cancelled: 'canceled', expired: 'canceled', rejected: 'rejected' };
type CcxtOrder = { id: string; symbol: string; side: 'buy' | 'sell'; type?: string; amount?: number; filled?: number; price?: number; average?: number; triggerPrice?: number; stopPrice?: number; reduceOnly?: boolean; clientOrderId?: string; status?: string; timestamp?: number; lastUpdateTimestamp?: number };

export function ccxtAdapter(broker: CcxtBroker, market: Market, keys: Keys): Adapter {
  const futures = market === 'futures';
  const x = make.exchange(broker, {
    apiKey: keys.apiKey, secret: keys.secret, ...(keys.passphrase ? { password: keys.passphrase } : {}),
    enableRateLimit: true, timeout: 15000,
    options: {
      defaultType: futures ? 'swap' : 'spot', warnOnFetchOpenOrdersWithoutSymbol: false,
      fetchMarkets: { types: futures ? (broker === 'okx' ? ['swap'] : ['linear']) : ['spot'] },
    },
  });
  const hosts = lockToTestnet(x);
  const names = new Map<string, string>();   // CCXT symbol → the app symbol it was ordered as
  const EX = broker.toUpperCase();

  const mkt = async (sym: string) => {
    await x.loadMarkets();
    const p = parseSym(sym);
    const s = futures ? `${p.base}/${p.quote}:${p.settle ?? p.quote}` : `${p.base}/${p.quote}`;
    const m = x.markets?.[s];
    if (!m) throw Error(`${sym} is not traded on the ${broker} testnet (${s})`);
    names.set(s, sym);
    return m;
  };
  const appSym = (s: string) => {
    const known = names.get(s); if (known) return known;
    const m = x.markets?.[s];
    if (!m) return s;
    if (broker === 'binance') return `${m.base}${m.quote}`;   // the chart's own Binance symbols
    return `${EX}:${symOf(m) ?? s}`;
  };
  const size = (s: string) => x.markets?.[s]?.contractSize ?? 1;   // OKX swaps trade in contracts, we speak base units
  const kindOf = (o: CcxtOrder): OrderKind => {
    const trig = o.triggerPrice ?? o.stopPrice;
    return trig ? (o.type === 'limit' ? 'stop_limit' : 'stop') : o.type === 'limit' ? 'limit' : 'market';
  };
  const toOrder = (o: CcxtOrder): BrokerOrder => {
    const k = kindOf(o), c = size(o.symbol), now = Date.now();
    return {
      id: String(o.id), sym: appSym(o.symbol), side: o.side, kind: k, qty: (o.amount ?? 0) * c, filled: (o.filled ?? 0) * c,
      ...(k === 'limit' || k === 'stop_limit' ? { price: o.price } : {}),
      ...(k === 'stop' || k === 'stop_limit' ? { stopPrice: o.triggerPrice ?? o.stopPrice } : {}),
      ...(o.reduceOnly ? { reduceOnly: true } : {}),
      status: STATUS[o.status ?? 'open'] ?? 'open', ...(o.average ? { avgPrice: o.average } : {}),
      created: o.timestamp ?? now, updated: o.lastUpdateTimestamp ?? o.timestamp ?? now,
    };
  };
  const request = async (o: Native) => {
    const m = await mkt(o.sym);
    const params: Record<string, unknown> = {};
    if (futures && o.reduceOnly) params.reduceOnly = true;
    if (o.clientId) params.clientOrderId = o.clientId;
    if (o.kind === 'stop' || o.kind === 'stop_limit') {
      // Binance spot only has STOP_LOSS_LIMIT (side decides the direction); the others take a unified trigger price.
      if (broker === 'binance') params.stopLossPrice = o.stopPrice;
      else params.triggerPrice = o.stopPrice;
      if (broker === 'bybit' && futures) params.triggerDirection = o.side === 'buy' ? 'ascending' : 'descending';
    }
    const type = o.kind === 'market' || o.kind === 'stop' ? 'market' : 'limit';
    return { s: m.symbol, type, amount: o.qty / size(m.symbol), price: type === 'limit' ? o.price : undefined, params };
  };

  return {
    hosts,
    native: new Set(broker === 'binance' ? ['stop_limit'] as const : ['stop', 'stop_limit'] as const),
    canEdit: x.has.editOrder === true,
    upnlInBalance: broker !== 'bybit',
    async balances() {
      const b = await x.fetchBalance() as { total?: Record<string, number>; free?: Record<string, number>; used?: Record<string, number> };
      // locked = total − free, so free + locked is the exchange's own total (margin balance on futures).
      return Object.entries(b.total ?? {}).filter(([, t]) => t > 0).map(([asset, t]) => { const free = b.free?.[asset] ?? 0; return { asset, free, locked: Math.max(0, t - free) } });
    },
    async positions() {
      if (!futures) return [];
      await x.loadMarkets();
      const ps = await x.fetchPositions() as { symbol: string; contracts?: number; contractSize?: number; side?: string; entryPrice?: number; markPrice?: number; unrealizedPnl?: number; liquidationPrice?: number; leverage?: number }[];
      return ps.filter(p => p.contracts).map((p): BrokerPosition => ({
        sym: appSym(p.symbol), qty: (p.contracts ?? 0) * (p.contractSize ?? size(p.symbol)) * (p.side === 'short' ? -1 : 1), entry: p.entryPrice ?? 0,
        ...(p.markPrice ? { mark: p.markPrice } : {}), ...(p.unrealizedPnl != null ? { upnl: p.unrealizedPnl } : {}),
        ...(p.liquidationPrice ? { liq: p.liquidationPrice } : {}), ...(p.leverage ? { leverage: p.leverage } : {}),
      }));
    },
    async openOrders() {
      await x.loadMarkets();
      const plain = await x.fetchOpenOrders() as CcxtOrder[];
      // Trigger orders sit in a separate list on OKX / Bybit / Binance futures.
      // shortcut: a failing trigger-list call is ignored (exchange without that list); the plain list still shows.
      const trig = await (x.fetchOpenOrders(undefined, undefined, undefined, { trigger: true }) as Promise<CcxtOrder[]>).catch(() => []);
      const seen = new Set<string>();
      return [...plain, ...trig].filter(o => !seen.has(o.id) && seen.add(o.id)).map(toOrder);
    },
    async order(id, sym, trigger) {
      const m = await mkt(sym);
      // Bybit's fetchOrder only sees its last 500 orders and refuses without this flag; trigger orders need `trigger`.
      const params = { ...(broker === 'bybit' ? { acknowledged: true } : {}), ...(trigger ? { trigger: true } : {}) };
      return toOrder(await x.fetchOrder(id, m.symbol, params) as CcxtOrder);
    },
    async fills(syms) {
      const out: BrokerFill[] = [];
      for (const sym of syms) {
        const m = await mkt(sym);
        const ts = await x.fetchMyTrades(m.symbol, undefined, 50) as { id: string; order?: string; symbol: string; side: 'buy' | 'sell'; amount: number; price: number; fee?: { cost?: number }; timestamp: number }[];
        for (const t of ts) out.push({ id: String(t.id), orderId: String(t.order ?? ''), sym: appSym(t.symbol), side: t.side, qty: t.amount * size(t.symbol), price: t.price, fee: t.fee?.cost ?? 0, ts: t.timestamp });
      }
      return out;
    },
    async price(sym) {
      const m = await mkt(sym);
      const t = await x.fetchTicker(m.symbol) as { last?: number; close?: number };
      const p = t.last ?? t.close;
      if (!p) throw Error(`No price for ${sym}`);
      return p;
    },
    async place(o) { const r = await request(o); return toOrder(await x.createOrder(r.s, r.type, o.side, r.amount, r.price, r.params) as CcxtOrder) },
    async find(clientId, sym) {
      const m = await mkt(sym);
      for (const get of [() => x.fetchOpenOrders(m.symbol), () => x.fetchOpenOrders(m.symbol, undefined, undefined, { trigger: true }), () => x.fetchClosedOrders?.(m.symbol, undefined, 50)]) {
        try { const f = ((await get()) as CcxtOrder[] | undefined)?.find(o => o.clientOrderId === clientId); if (f) return toOrder(f) } catch { /* try the next list */ }
      }
      return null;
    },
    async cancel(id, sym, trigger) { const m = await mkt(sym); await x.cancelOrder(id, m.symbol, trigger ? { trigger: true } : {}) },
    async edit(id, o) { const r = await request(o); return toOrder(await x.editOrder(id, r.s, r.type, o.side, r.amount, r.price, r.params) as CcxtOrder) },
    async canWithdraw() {
      if (broker === 'bybit') {
        const r = await (x.privateGetV5UserQueryApi as Fn)() as { result?: { permissions?: Record<string, string[]>; readOnly?: number } };
        const perms = Object.values(r.result?.permissions ?? {}).flat();
        return perms.some(p => /withdraw|transfer/i.test(p));
      }
      if (broker === 'okx') {
        const r = await (x.privateGetAccountConfig as Fn)() as { data?: { perm?: string }[] };
        return /withdraw|transfer/i.test(r.data?.[0]?.perm ?? '');
      }
      return null;   // Binance testnets have no key-permission endpoint (sapi is mainnet only)
    },
    watch(nudge) {
      if (!x.has.watchOrders || !x.watchOrders) return () => {};
      let alive = true;
      (async () => {
        while (alive) {
          try { await x.watchOrders!(); if (alive) nudge() }
          catch { if (alive) await new Promise(r => setTimeout(r, 5000)) }
        }
      })();
      return () => { alive = false };
    },
    close() { try { void x.close?.() } catch {} },
  };
}
