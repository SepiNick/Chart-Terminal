// Nobitex testnet adapter: a small REST client for https://testnetapiv2.nobitex.ir (no CCXT support).
// Auth is a token header (`Authorization: Token <key>`), no request signing. Spot only.
// Nobitex prices Toman markets in Rial (`rls`); the app speaks IRT (Toman), so prices and IRT balances are ÷10 / ×10 here.
import type { Balance, BrokerFill, BrokerOrder } from '../../src/broker/types.ts';
import type { Adapter, Native } from './adapter.ts';
import { parseSym } from './adapter.ts';
import { assertTestnetUrl } from './safety.ts';

export const NOBITEX_TESTNET = 'https://testnetapiv2.nobitex.ir';
type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

const cur = (c: string) => (c === 'IRT' ? 'rls' : c.toLowerCase());
const app = (c: string) => (c === 'rls' ? 'IRT' : c.toUpperCase());
const RIAL = 10;
/** App-side number ↔ Nobitex string for a quote currency (IRT prices are sent in Rial). */
const out = (v: number, quote: string) => String(+(quote === 'IRT' ? v * RIAL : v).toFixed(10));
const inn = (v: unknown, quote: string) => { const n = Number(v ?? 0); return quote === 'IRT' ? n / RIAL : n };

type NxOrder = { id: number | string; type: 'buy' | 'sell'; execution?: string; srcCurrency: string; dstCurrency: string; price?: string; stopPrice?: string; amount: string; matchedAmount?: string; averagePrice?: string; status: string; created_at?: string; clientOrderId?: string };
const STATUS: Record<string, BrokerOrder['status']> = { Active: 'open', Inactive: 'open', New: 'open', Done: 'filled', Canceled: 'canceled' };

export function nobitexAdapter(token: string, fetchFn: FetchFn = fetch as unknown as FetchFn, base = NOBITEX_TESTNET): Adapter {
  const host = assertTestnetUrl(base);
  async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    const url = base + path;
    assertTestnetUrl(url);
    const r = await fetchFn(url, {
      method,
      headers: { authorization: `Token ${token}`, 'content-type': 'application/json', 'user-agent': 'TraderBot/ChartTerminal' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),   // a stalled call would hold the account lock (polls, cancel, close)
    });
    const j = await r.json().catch(() => ({})) as { status?: string; message?: string; code?: string };
    if (r.status >= 400 || j.status !== 'ok') throw Error(`Nobitex: ${j.message ?? j.code ?? `HTTP ${r.status}`}`);
    return j as T;
  }
  const pair = (sym: string) => { const p = parseSym(sym); if (p.perp) throw Error('Nobitex testnet: spot only'); return { ...p, src: cur(p.base), dst: cur(p.quote), sym: `${p.base}${p.quote}` } };
  const toOrder = (o: NxOrder): BrokerOrder => {
    const quote = app(o.dstCurrency), ex = (o.execution ?? 'limit').toLowerCase().replace(/[^a-z]/g, '');
    const kind = ex === 'market' ? 'market' : ex === 'stopmarket' ? 'stop' : ex === 'stoplimit' ? 'stop_limit' : 'limit';
    const t = o.created_at ? Date.parse(o.created_at) : Date.now();
    return {
      id: String(o.id), sym: `${o.srcCurrency.toUpperCase()}${quote}`, side: o.type, kind, qty: Number(o.amount), filled: Number(o.matchedAmount ?? 0),
      ...(kind === 'limit' || kind === 'stop_limit' ? { price: inn(o.price, quote) } : {}),
      ...(o.stopPrice ? { stopPrice: inn(o.stopPrice, quote) } : {}),
      status: STATUS[o.status] ?? 'open', ...(Number(o.averagePrice) ? { avgPrice: inn(o.averagePrice, quote) } : {}), created: t, updated: t,
    };
  };

  return {
    hosts: [host],
    native: new Set(['stop', 'stop_limit'] as const),
    canEdit: false,
    async balances() {
      const r = await call<{ wallets: { currency: string; balance: string; blockedBalance?: string; activeBalance?: string }[] }>('POST', '/users/wallets/list');
      return r.wallets.filter(w => Number(w.balance) > 0).map((w): Balance => {
        const a = app(w.currency), k = a === 'IRT' ? RIAL : 1;
        return { asset: a, free: Number(w.activeBalance ?? w.balance) / k, locked: Number(w.blockedBalance ?? 0) / k };
      });
    },
    async positions() { return [] },
    async openOrders() { return (await call<{ orders: NxOrder[] }>('POST', '/market/orders/list', { status: 'open', details: 2 })).orders.map(toOrder) },
    async order(id) { return toOrder((await call<{ order: NxOrder }>('POST', '/market/orders/status', { id: Number(id) })).order) },
    async fills(syms) {
      const res: BrokerFill[] = [];
      for (const s of syms) {
        const p = pair(s);
        const r = await call<{ trades: { id: number; orderId: number; type: 'buy' | 'sell'; amount: string; price: string; fee: string; timestamp: string }[] }>('POST', '/market/trades/list', { srcCurrency: p.src, dstCurrency: p.dst });
        for (const t of r.trades) res.push({ id: String(t.id), orderId: String(t.orderId), sym: p.sym, side: t.type, qty: Number(t.amount), price: inn(t.price, p.quote), fee: Number(t.fee ?? 0), ts: Date.parse(t.timestamp) });
      }
      return res;
    },
    async price(sym) {
      const p = pair(sym);
      const r = await call<{ stats: Record<string, { latest?: string }> }>('GET', `/market/stats?srcCurrency=${p.src}&dstCurrency=${p.dst}`);
      const v = inn(r.stats[`${p.src}-${p.dst}`]?.latest, p.quote);
      if (!v) throw Error(`No price for ${sym}`);
      return v;
    },
    async place(o: Native) {
      const p = pair(o.sym);
      const body: Record<string, unknown> = {
        type: o.side, execution: o.kind === 'stop' ? 'stop_market' : o.kind, srcCurrency: p.src, dstCurrency: p.dst, amount: String(o.qty),
      };
      if (o.price !== undefined && o.kind !== 'market' && o.kind !== 'stop') body.price = out(o.price, p.quote);
      if (o.stopPrice !== undefined && (o.kind === 'stop' || o.kind === 'stop_limit')) body.stopPrice = out(o.stopPrice, p.quote);
      if (o.clientId) body.clientOrderId = o.clientId;
      return toOrder((await call<{ order: NxOrder }>('POST', '/market/orders/add', body)).order);
    },
    async cancel(id) { await call('POST', '/market/orders/update-status', { order: Number(id), status: 'canceled' }) },
    async canWithdraw() { return null },   // Nobitex exposes no token-permission endpoint
    close() {},
  };
}
