// DOM / Level 2 side panel: price ladder (bids, asks, traded volume, own orders), spread and book imbalance,
// click-to-trade limit/stop orders on the active broker (paper or an exchange testnet, src/broker/registry.ts), and a Time & Sales tape with big-print highlighting.
import { streamBook, streamPrints, hasOrderFlow } from './feed.ts';
import { aggregatePrints, autoRow, binOf, bigPrints, type BookSnap, type Print } from './model.ts';
import { $, esc, store, toast } from '../store.ts';
import { activeBroker, onBrokers } from '../broker/registry.ts';
import type { OrderReq } from '../broker/types.ts';

export interface DomHost {
  symbol(): string;
  prec(): number;
  /** Last price of the active chart, the order ticket's quantity, and the user's OK (true when instant orders are on). */
  last(): number | undefined;
  qty(): number;
  confirm(msg: string): boolean;
  /** Send an order the way the ticket does (Replay → backtest account, refusals → toasts). */
  place(r: OrderReq): Promise<void>;
  /** Before a broker is registered: the old paper path (the host confirms and validates). */
  limit(side: 'buy' | 'sell', price: number): void;
  orders(sym: string): { side: 'buy' | 'sell'; price: number; qty: number }[];
}
let host: DomHost;
const cfg = store.get('domCfg', { mult: 1, rows: 31, agg: true, minTape: 0, center: true });
let sym = '', stopBook = () => {}, stopPrints = () => {};
let book: BookSnap | null = null, tape: Print[] = [], traded = new Map<number, { buy: number; sell: number; t: number }>();
let step = 0, center = 0, timer = 0;

const fmtQ = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(3) : v ? v.toPrecision(2) : '');
const visible = () => $('#s-dom').classList.contains('on');

export function initDom(h: DomHost) {
  host = h;
  const acct = () => { $('#domAcct').textContent = activeBroker()?.account.label ?? 'paper' };
  onBrokers(acct); acct();
  $('#domMult').onchange = e => { cfg.mult = +(e.target as HTMLSelectElement).value; save(); step = 0; draw() };
  $('#domCenter').onclick = () => { center = 0; draw() };
  $('#domAgg').onchange = e => { cfg.agg = (e.target as HTMLInputElement).checked; save(); drawTape() };
  $('#domMin').onchange = e => { cfg.minTape = Math.max(0, +(e.target as HTMLInputElement).value || 0); save(); drawTape() };
  $<HTMLSelectElement>('#domMult').value = String(cfg.mult); $<HTMLInputElement>('#domAgg').checked = cfg.agg; $<HTMLInputElement>('#domMin').value = String(cfg.minTape || '');
  $('#domLadder').onclick = e => {
    const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-side]'); if (!td) return;
    trade(td.dataset.side as 'buy' | 'sell', +td.closest<HTMLElement>('tr')!.dataset.px!);
  };
  $('#domLadder').onwheel = e => { e.preventDefault(); center = (center || midBin()) + (e.deltaY > 0 ? -3 : 3); draw() };
}
const save = () => store.set('domCfg', cfg);

/** Below the market a buy rests as a limit, above it as a stop (and the reverse for sells). */
const ladderKind = (side: 'buy' | 'sell', price: number, last: number) => ((side === 'buy') === (price < last) ? 'limit' : 'stop');
function trade(side: 'buy' | 'sell', price: number) {
  const b = activeBroker();
  if (!b) return host.limit(side, price);
  const last = host.last(), qty = host.qty(), s = host.symbol();
  if (!last) return toast('No price yet');
  if (!(qty > 0)) return toast('Set a quantity in the order ticket');
  const kind = ladderKind(side, price, last);
  if (!host.confirm(`${side.toUpperCase()} ${kind} ${qty} ${s} @ ${price} on ${b.account.label}?`)) return;
  void host.place({ sym: s, side, kind, qty, ...(kind === 'limit' ? { price } : { stopPrice: price }) }).then(() => draw());
}
/** Resting orders of the active broker on this symbol (limit price or stop trigger). */
function myOrders(s: string) {
  const b = activeBroker();
  if (!b) return host.orders(s);
  return (b.state()?.orders ?? []).filter(o => o.sym === s && o.status === 'open' && (o.price ?? o.stopPrice) != null).map(o => ({ side: o.side, price: (o.price ?? o.stopPrice)!, qty: o.qty - o.filled }));
}
const midBin = () => { if (!book?.bids[0] || !book.asks[0]) return 0; return binOf((book.bids[0][0] + book.asks[0][0]) / 2, step) };

/** Follow the active chart's symbol while the panel is open; stop streaming when it closes. */
export function domSync() {
  if (!host) return;   // the side panel can be restored before the DOM panel is wired
  const want = visible() ? host.symbol() : '';
  if (want === sym) return;
  stopBook(); stopPrints(); stopBook = stopPrints = () => {};
  sym = want; book = null; tape = []; traded = new Map(); step = 0; center = 0;
  clearInterval(timer);
  $('#domSym').textContent = sym || '—';
  if (!sym) return;
  if (!hasOrderFlow(sym)) { $('#domLadder').innerHTML = '<tr><td class="muted">Level 2 is available for crypto symbols.</td></tr>'; $('#domTape').innerHTML = ''; return }
  $('#domLadder').innerHTML = '<tr><td class="muted">Loading order book…</td></tr>';
  stopBook = streamBook(sym, b => { book = b }, 250);
  stopPrints = streamPrints(sym, ps => {
    tape.push(...ps); if (tape.length > 3000) tape = tape.slice(-2000);
    for (const p of ps) { if (!step) continue; const k = binOf(p.px, step), x = traded.get(k) ?? { buy: 0, sell: 0, t: 0 }; if (p.buy) x.buy += p.qty; else x.sell += p.qty; x.t = p.t; traded.set(k, x) }
  });
  timer = window.setInterval(() => { if (!visible()) { domSync(); return } draw(); drawTape() }, 300);
}

function draw() {
  if (!book || !book.bids.length || !book.asks.length) return;
  const bb = book.bids[0][0], ba = book.asks[0][0], mid = (bb + ba) / 2;
  if (!step) {
    // base = a "nice" step ≈ 0.002% of price (BTC ≈ $2), times the user's grouping multiplier
    step = autoRow([mid * 0.00002 * 22], 22, 10 ** -host.prec()) * cfg.mult;
    traded = new Map();
    for (const p of tape) { const k = binOf(p.px, step), x = traded.get(k) ?? { buy: 0, sell: 0, t: 0 }; if (p.buy) x.buy += p.qty; else x.sell += p.qty; traded.set(k, x) }
  }
  const bids = new Map<number, number>(), asks = new Map<number, number>();
  for (const [p, q] of book.bids) { const k = binOf(p, step); bids.set(k, (bids.get(k) ?? 0) + q) }
  for (const [p, q] of book.asks) { const k = binOf(p, step); asks.set(k, (asks.get(k) ?? 0) + q) }
  const n = cfg.rows, half = Math.floor(n / 2), c = center || binOf(mid, step);
  const ks = Array.from({ length: n }, (_, i) => c + half - i);
  const maxQ = Math.max(1e-12, ...ks.map(k => Math.max(bids.get(k) ?? 0, asks.get(k) ?? 0)));
  const maxT = Math.max(1e-12, ...ks.map(k => { const t = traded.get(k); return t ? t.buy + t.sell : 0 }));
  const mine = myOrders(sym), prec = Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9)));
  const bestBidK = binOf(bb, step), bestAskK = binOf(ba, step);
  $('#domLadder').innerHTML = '<tr><th>Bid</th><th>Price</th><th>Ask</th><th title="Traded at this price since the panel opened">Traded</th></tr>' + ks.map(k => {
    const px = k * step, b = bids.get(k) ?? 0, a = asks.get(k) ?? 0, t = traded.get(k), my = mine.filter(o => binOf(o.price, step) === k);
    const bw = (b / maxQ) * 100, aw = (a / maxQ) * 100, tw = t ? ((t.buy + t.sell) / maxT) * 100 : 0, tb = t && t.buy + t.sell ? (t.buy / (t.buy + t.sell)) * tw : 0;
    const cls = k === bestBidK ? 'bb' : k === bestAskK ? 'ba' : k > bestAskK ? 'ask' : k < bestBidK ? 'bid' : 'spread';
    return `<tr data-px="${px}" class="${cls}">
      <td data-side="buy" title="Buy limit at ${px.toFixed(prec)}" style="background:linear-gradient(to left, color-mix(in srgb, var(--up) 35%, transparent) ${bw}%, transparent ${bw}%)">${my.some(o => o.side === 'buy') ? '● ' : ''}${fmtQ(b)}</td>
      <td class="px">${px.toFixed(prec)}</td>
      <td data-side="sell" title="Sell limit at ${px.toFixed(prec)}" style="background:linear-gradient(to right, color-mix(in srgb, var(--down) 35%, transparent) ${aw}%, transparent ${aw}%)">${fmtQ(a)}${my.some(o => o.side === 'sell') ? ' ●' : ''}</td>
      <td class="tr" style="background:linear-gradient(to right, color-mix(in srgb, var(--up) 45%, transparent) ${tb}%, color-mix(in srgb, var(--down) 45%, transparent) ${tb}%, color-mix(in srgb, var(--down) 45%, transparent) ${tw}%, transparent ${tw}%)">${t ? fmtQ(t.buy + t.sell) : ''}</td></tr>`;
  }).join('');
  // book imbalance over the 20 rows nearest the touch
  let sb = 0, sa = 0;
  for (let i = 0; i < 20; i++) { sb += bids.get(bestBidK - i) ?? 0; sa += asks.get(bestAskK + i) ?? 0 }
  const imb = sb + sa ? (sb / (sb + sa)) * 100 : 50;
  $('#domStats').innerHTML = `<span>Spread <b>${(ba - bb).toFixed(Math.max(prec, 2))}</b></span><span class="grow"></span><span title="Bid share of resting size in the 20 rows around the touch">Bids ${imb.toFixed(0)}%</span>
    <div class="imb"><i style="width:${imb}%"></i></div><span>Asks ${(100 - imb).toFixed(0)}%</span>`;
}

function drawTape() {
  const src = cfg.agg ? aggregatePrints(tape.slice(-600)) : tape.slice(-600);
  const big = new Set(bigPrints(src));
  const rows = src.filter(p => p.px * p.qty >= cfg.minTape).slice(-80).reverse();
  const t = (x: number) => new Date(x * 1000).toLocaleTimeString(undefined, { hour12: false });
  $('#domTape').innerHTML = rows.map(p => `<tr class="${p.buy ? 'up' : 'dn'}${big.has(p) ? ' big' : ''}"><td>${t(p.t)}</td><td>${esc(p.px.toFixed(host.prec()))}</td><td>${fmtQ(p.qty)}</td><td>${fmtQ(p.px * p.qty)}</td></tr>`).join('') || '<tr><td class="muted">Waiting for trades…</td></tr>';
}
