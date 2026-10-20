// Derivatives data from free public exchange APIs via CCXT (Binance USDⓈ-M, Bybit, OKX and any other CCXT exchange
// that implements the call). Cached, and rate-limited per exchange on top of CCXT's own limiter.
//   GET /api/derivs/oi?ex=ID&sym=BASE/QUOTE:SETTLE&period=5m   → { hist: [{t, oi, oiv}], now }
//   GET /api/derivs/funding?ex&sym                              → { hist: [{t, v}], now: {rate, next, interval} }
//   GET /api/derivs/ratio?ex&sym&period                         → { accounts: [{t, v}], top?, topPos? }  (top: Binance only)
//   GET /api/derivs/liqs?ex&sym[&since=sec]                     → { list: [{t, long, qty, px, value}], err? }
// Liquidations are live only (no exchange serves public history): the first poll starts a watcher that stops 2 minutes
// after the last poll. Exchanges that geo-block this machine fail with a clear message (the client shows it in the pane).
import ccxtNs from 'ccxt';
import { route, bad, HttpError } from './core/http.ts';
import * as cx from './ccxt.ts';
import { normFunding, normFundingHist, normLiq, normOI, normRatio, type Liq } from '../src/derivs/model.ts';

const ccxt = ((ccxtNs as unknown as { exchanges?: string[] }).exchanges ? ccxtNs : (ccxtNs as unknown as { default: typeof ccxtNs }).default);
type Ex = Record<string, unknown> & { has: Record<string, unknown>; loadMarkets: () => Promise<unknown>; market: (s: string) => { id: string } };
type Call = (...a: unknown[]) => Promise<unknown>;
const call = (x: Ex, m: string, ...a: unknown[]) => (x[m] as Call).apply(x, a);

const rest = new Map<string, Ex>(), pro = new Map<string, Ex>();
/** Swappable for tests (recorded payloads instead of the network). */
export const deps = {
  rest(id: string): Ex {
    let x = rest.get(id);
    if (!x) { x = new (ccxt as unknown as Record<string, new (o: object) => Ex>)[id]({ enableRateLimit: true, timeout: 15000 }); rest.set(id, x) }
    return x;
  },
  pro(id: string): Ex | null {
    const P = (ccxt.pro as unknown as Record<string, (new (o: object) => Ex) | undefined>)[id]; if (!P) return null;
    let x = pro.get(id);
    if (!x) { x = new P({ enableRateLimit: true }); pro.set(id, x) }
    return x;
  },
  gapMs: 250,
};

// ---------- cache + per-exchange limiter ----------
const cache = new Map<string, { at: number; p: Promise<unknown> }>();
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.p as Promise<T>;
  const p = fn();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));   // don't cache failures
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return p;
}
const gates = new Map<string, { tail: Promise<unknown>; n: number }>();
/** One request at a time per exchange, `gapMs` apart; refuses when 20 are already queued. */
export function limited<T>(ex: string, fn: () => Promise<T>): Promise<T> {
  const g = gates.get(ex) ?? { tail: Promise.resolve(), n: 0 };
  gates.set(ex, g);
  if (g.n >= 20) return Promise.reject(new HttpError(429, `${ex}: too many derivatives requests queued, try again shortly`));
  g.n++;
  const run = g.tail.then(fn);
  g.tail = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, deps.gapMs))).finally(() => g.n--);
  return run;
}
function friendly(ex: string, e: unknown): Error {
  const msg = (e as Error).message ?? String(e);
  const blocked = /451|403|restricted|location|ECONN|ETIMEDOUT|ENOTFOUND|timed out|fetch failed|NetworkError|RequestTimeout/i.test(msg + (e as Error).name);
  return new HttpError(502, `${ex}: ${msg.slice(0, 200)}${blocked ? ' — the exchange may block this region; turn on a VPN' : ''}`);
}
async function ask<T>(ex: string, key: string, ttlMs: number, fn: (x: Ex) => Promise<T>): Promise<T> {
  return cached(`${ex}|${key}`, ttlMs, () => limited(ex, async () => {
    const x = deps.rest(ex);
    try { await x.loadMarkets(); return await fn(x) } catch (e) { throw e instanceof HttpError ? e : friendly(ex, e) }
  }));
}
const need = (x: Ex, m: string, ex: string) => { if (!x.has[m]) throw bad(`${ex} has no public ${m.replace(/^fetch/, '')}`) };

// ---------- liquidations: live watchers with a ring buffer ----------
interface LiqFeed { list: Liq[]; seen: number; alive: boolean; err?: string }
const liqFeeds = new Map<string, LiqFeed>();
const KEEP = 500, IDLE = 120_000;
function pushLiqs(f: LiqFeed, ex: string, rows: unknown[], contractSize = 1) {
  const have = new Set(f.list.slice(-200).map(l => `${l.t}|${l.px}|${l.qty}`));
  for (const r of rows) {
    const row = r as { contractSize?: number }, l = normLiq(ex, { ...row, contractSize: row.contractSize ?? contractSize }); if (!l) continue;
    const k = `${l.t}|${l.px}|${l.qty}`; if (have.has(k)) continue;
    have.add(k); f.list.push(l);
  }
  f.list.sort((a, b) => a.t - b.t);
  if (f.list.length > KEEP) f.list.splice(0, f.list.length - KEEP);
  f.err = undefined;
}
function liqFeed(ex: string, sym: string): LiqFeed {
  const k = `${ex}|${sym}`;
  let f = liqFeeds.get(k);
  if (f) { f.seen = Date.now(); return f }
  const feed: LiqFeed = { list: [], seen: Date.now(), alive: true };
  liqFeeds.set(k, (f = feed));
  (async () => {
    const p = deps.pro(ex), x = deps.rest(ex);
    const watch = p?.has.watchLiquidations ? p : null;
    if (!watch && !x.has.fetchLiquidations) { feed.err = `${ex} has no public liquidation feed`; return }
    let cs = 0;   // CCXT's liquidation rows often leave contractSize out (OKX contracts are fractions of a coin)
    while (feed.alive) {
      try {
        if (!cs) { await x.loadMarkets(); cs = (x.market(sym) as { contractSize?: number }).contractSize ?? 1 }
        if (watch) pushLiqs(feed, ex, await call(watch, 'watchLiquidations', sym) as unknown[], cs);
        else { pushLiqs(feed, ex, await limited(ex, () => call(x, 'fetchLiquidations', sym)) as unknown[], cs); await new Promise(r => setTimeout(r, 10_000)) }
      } catch (e) { feed.err = friendly(ex, e).message; await new Promise(r => setTimeout(r, 5000)) }
    }
  })().catch(e => (feed.err = friendly(ex, e).message));
  return f;
}
setInterval(() => { for (const [k, f] of liqFeeds) if (Date.now() - f.seen > IDLE) { f.alive = false; liqFeeds.delete(k) } }, 30_000).unref();

// ---------- routes ----------
const SYM_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,10}:[A-Z0-9]{1,10}$/, PERIOD_RE = /^\d{1,2}[mhd]$/;
export async function derivs(kind: string, q: URLSearchParams): Promise<unknown> {
  const ex = q.get('ex') ?? '', sym = q.get('sym') ?? '', period = q.get('period') ?? '1h';
  if (!cx.isExchange(ex)) throw bad('Unknown exchange');
  if (!SYM_RE.test(sym)) throw bad('Bad symbol (want BASE/QUOTE:SETTLE)');
  if (!PERIOD_RE.test(period)) throw bad('Bad period');
  switch (kind) {
    case 'oi': {
      const hist = await ask(ex, `oi|${sym}|${period}`, 60_000, async x => { need(x, 'fetchOpenInterestHistory', ex); return normOI(await call(x, 'fetchOpenInterestHistory', sym, period, undefined, 500) as never) });
      const now = await ask(ex, `oinow|${sym}`, 15_000, async x => (x.has.fetchOpenInterest ? normOI([await call(x, 'fetchOpenInterest', sym) as never])[0] ?? null : null)).catch(() => null);
      return { hist, now };
    }
    case 'funding': {
      const hist = await ask(ex, `fh|${sym}`, 300_000, async x => { need(x, 'fetchFundingRateHistory', ex); return normFundingHist(await call(x, 'fetchFundingRateHistory', sym, undefined, 500) as never) });
      const now = await ask(ex, `fnow|${sym}`, 15_000, async x => (x.has.fetchFundingRate ? normFunding(await call(x, 'fetchFundingRate', sym) as never) : null)).catch(() => null);
      return { hist, now };
    }
    case 'ratio':
      return ask(ex, `ratio|${sym}|${period}`, 60_000, async x => {
        need(x, 'fetchLongShortRatioHistory', ex);
        const accounts = normRatio(await call(x, 'fetchLongShortRatioHistory', sym, period, undefined, 500) as never);
        if (ex !== 'binanceusdm' && ex !== 'binance') return { accounts };
        // Top-trader ratios are Binance-only and not in CCXT's unified API: use its implicit REST methods.
        const args = { symbol: x.market(sym).id, period, limit: 500 };
        const [top, topPos] = await Promise.all([call(x, 'fapiDataGetTopLongShortAccountRatio', args), call(x, 'fapiDataGetTopLongShortPositionRatio', args)]);
        return { accounts, top: normRatio(top as never), topPos: normRatio(topPos as never) };
      });
    case 'liqs': {
      const f = liqFeed(ex, sym), since = Number(q.get('since') ?? 0);
      return { list: f.list.filter(l => l.t > since), err: f.err };
    }
  }
  throw new HttpError(404, 'Not found');
}
route('GET', '/api/derivs/:kind', c => derivs(c.params.kind, c.url.searchParams));
