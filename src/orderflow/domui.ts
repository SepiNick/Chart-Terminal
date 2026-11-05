// DOM / Level 2 side panel: price ladder (bids, asks, traded volume, optional cumulative depth, own orders), spread and book imbalance,
// click-to-trade limit/stop orders on the active broker (paper or an exchange testnet, src/broker/registry.ts), and a Time & Sales tape with big-print highlighting.
// The ladder and the tape are fixed sets of rows that are created once and updated in place, at most once per animation frame (see schedule()).
import { streamBook, streamPrints, hasOrderFlow } from './feed.ts';
import { aggregatePrints, autoRow, binOf, bigPrints, type BookSnap, type Print } from './model.ts';
import { connState, cumulative, fmtPrice, fmtSize, fmtValue, GROUP_MULTS, groupLabel, groupLevels, pct, stepDecimals, type ConnState } from './domfmt.ts';
import { $, store, toast } from '../store.ts';
import { t } from '../i18n.ts';
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
const cfg = store.get('domCfg', { mult: 1, rows: 31, agg: true, minTape: 0, center: true, cum: false });
let sym = '', stopBook = () => {}, stopPrints = () => {};
let book: BookSnap | null = null, tape: Print[] = [], traded = new Map<number, { buy: number; sell: number; t: number }>();
let base = 0, step = 0, center = 0, timer = 0, raf = 0, openedAt = 0, lastBookAt = 0, lastBookT = 0, curK: number | null = null;

const visible = () => $('#s-dom').classList.contains('on');
const TAPE_ROWS = 80;
type El = HTMLElement & { _t?: string };
/** Write text only when it changed: no layout work for rows whose numbers did not move. */
const put = (el: El, s: string) => { if (el._t !== s) { el._t = s; el.textContent = s } };
const cls = (el: El, c: string) => { if (el._t !== c) { el._t = c; el.className = c } };
const css = (el: HTMLElement, k: string, v: string) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v) };
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour12: false });

interface LRow { tr: HTMLTableRowElement; b: El; px: El; a: El; trd: El; cum: El }
let lrows: LRow[] = [], trows: { tr: HTMLTableRowElement; c: El[] }[] = [];

function buildLadder() {
  const L = $<HTMLTableElement>('#domLadder');
  L.innerHTML = '<thead><tr><th class="n">Bid</th><th class="n">Price</th><th class="n">Ask</th><th class="n trd" title="Traded at this price since the panel opened">Traded</th><th class="n cum" title="Cumulative resting size from the touch outward">Cum.</th></tr></thead><tbody></tbody>';
  const tb = L.tBodies[0];
  lrows = Array.from({ length: cfg.rows }, () => {
    const tr = tb.insertRow();
    tr.innerHTML = '<td class="n" data-side="buy"></td><td class="n px"></td><td class="n" data-side="sell"></td><td class="n trd"></td><td class="n cum"></td>';
    const c = tr.cells;
    return { tr, b: c[0], px: c[1], a: c[2], trd: c[3], cum: c[4] } as LRow;
  });
  const T = $<HTMLTableElement>('#domTape');
  T.innerHTML = '<thead><tr><th class="n">Time</th><th class="n">Price</th><th class="n">Size</th><th class="n">Value</th></tr></thead><tbody></tbody>';
  trows = Array.from({ length: TAPE_ROWS }, () => {
    const tr = T.tBodies[0].insertRow(); tr.hidden = true;
    tr.innerHTML = '<td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td>';
    return { tr, c: [...tr.cells] as El[] };
  });
}

export function initDom(h: DomHost) {
  host = h;
  cfg.cum ??= false;
  buildLadder();
  const acct = () => { $('#domAcct').textContent = activeBroker()?.account.label ?? 'paper' };
  onBrokers(acct); acct();
  const sel = $<HTMLSelectElement>('#domMult');
  sel.innerHTML = GROUP_MULTS.map(m => `<option value="${m}">×${m}</option>`).join('');
  sel.onchange = e => { cfg.mult = +(e.target as HTMLSelectElement).value; save(); step = 0; curK = null; schedule() };
  sel.value = String(cfg.mult);
  $('#domCenter').onclick = () => { center = 0; schedule() };
  $('#domAgg').onchange = e => { cfg.agg = (e.target as HTMLInputElement).checked; save(); schedule() };
  $('#domMin').onchange = e => { cfg.minTape = Math.max(0, +(e.target as HTMLInputElement).value || 0); save(); schedule() };
  $('#domCum').onchange = e => { cfg.cum = (e.target as HTMLInputElement).checked; save(); showCum() };
  $<HTMLInputElement>('#domAgg').checked = cfg.agg; $<HTMLInputElement>('#domMin').value = String(cfg.minTape || ''); $<HTMLInputElement>('#domCum').checked = cfg.cum;
  showCum();
  const L = $('#domLadder');
  L.onclick = e => {
    const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-side]'); if (!td) return;
    trade(td.dataset.side as 'buy' | 'sell', +td.closest<HTMLElement>('tr')!.dataset.px!);
  };
  L.onwheel = e => { e.preventDefault(); center = (center || midBin()) + (e.deltaY > 0 ? -3 : 3); schedule() };
  // Keyboard: ↑/↓ move the cursor row, B buys and S sells at it, Home re-centres, Esc clears the cursor.
  L.onkeydown = e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'arrowdown') { e.preventDefault(); curK = (curK ?? (center || midBin())) + (k === 'arrowup' ? 1 : -1); const half = Math.floor(cfg.rows / 2), c = center || midBin(); if (curK > c + half) center = curK - half; else if (curK < c - half + 1) center = curK + half - 1; schedule() }
    else if ((k === 'b' || k === 's') && curK != null && step) { e.preventDefault(); trade(k === 'b' ? 'buy' : 'sell', curK * step) }
    else if (k === 'home') { e.preventDefault(); center = 0; schedule() }
    else if (k === 'escape') { curK = null; schedule() }
  };
  L.onblur = () => { curK = null; schedule() };
}
const save = () => store.set('domCfg', cfg);
const showCum = () => $('#s-dom').classList.toggle('cum-on', !!cfg.cum);

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
  void host.place({ sym: s, side, kind, qty, ...(kind === 'limit' ? { price } : { stopPrice: price }) }).then(() => schedule());
}
/** Resting orders of the active broker on this symbol (limit price or stop trigger). */
function myOrders(s: string) {
  const b = activeBroker();
  if (!b) return host.orders(s);
  return (b.state()?.orders ?? []).filter(o => o.sym === s && o.status === 'open' && (o.price ?? o.stopPrice) != null).map(o => ({ side: o.side, price: (o.price ?? o.stopPrice)!, qty: o.qty - o.filled }));
}
const midBin = () => { if (!book?.bids[0] || !book.asks[0]) return 0; return binOf((book.bids[0][0] + book.asks[0][0]) / 2, step) };

/** All redraws go through here: many triggers, one DOM update per frame. */
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; frame() }) }

function message(text: string, kind: 'info' | 'error' = 'info') {
  const m = $('#domMsg'); m.hidden = !text; m.textContent = text ? t(text) : ''; m.dataset.k = kind;
  $('#domLadder').hidden = !!text;
}
let lastConn: ConnState | 'na' | '' = '';
function setConn(s: ConnState | 'na') {
  const c = $('#domConn'); c.dataset.s = s;
  const label = s === 'live' ? 'Live' : s === 'stale' ? 'Stale' : s === 'offline' ? 'Reconnecting…' : s === 'loading' ? 'Loading…' : 'No Level 2';
  put($('#domConnT') as El, t(label));
  put($('#domUpd') as El, lastBookT && s !== 'na' ? hhmmss(lastBookT) : '');
  c.title = lastBookT ? `${t('Last update')}: ${hhmmss(lastBookT)}` : '';
  if (s !== lastConn) { lastConn = s; $('#s-dom').classList.toggle('stale', s === 'stale' || s === 'offline') }
}

/** Follow the active chart's symbol while the panel is open; stop streaming when it closes. */
export function domSync() {
  if (!host) return;   // the side panel can be restored before the DOM panel is wired
  const want = visible() ? host.symbol() : '';
  if (want === sym) return;
  stopBook(); stopPrints(); stopBook = stopPrints = () => {};
  sym = want; book = null; tape = []; traded = new Map(); base = step = 0; center = 0; curK = null; lastBookAt = lastBookT = 0; openedAt = performance.now();
  clearInterval(timer); lastConn = '';
  const i = sym.indexOf(':');
  $('#domSym').textContent = (i >= 0 ? sym.slice(i + 1) : sym) || '—';
  $('#domEx').textContent = sym ? (i >= 0 ? sym.slice(0, i) : 'BINANCE') : '';
  if (!sym) return;
  if (!hasOrderFlow(sym)) { setConn('na'); message('Level 2 is available for crypto symbols.'); drawTape(); return }
  setConn('loading'); message('Loading order book…');
  stopBook = streamBook(sym, b => { book = b; lastBookAt = performance.now(); lastBookT = Date.now() }, 250);
  stopPrints = streamPrints(sym, ps => {
    tape.push(...ps); if (tape.length > 3000) tape = tape.slice(-2000);
    for (const p of ps) { if (!step) continue; const k = binOf(p.px, step), x = traded.get(k) ?? { buy: 0, sell: 0, t: 0 }; if (p.buy) x.buy += p.qty; else x.sell += p.qty; x.t = p.t; traded.set(k, x) }
  });
  timer = window.setInterval(() => { if (!visible()) { domSync(); return } schedule() }, 300);
  schedule();
}

function frame() {
  if (!sym) return;
  if (!hasOrderFlow(sym)) return;
  const age = lastBookAt ? performance.now() - lastBookAt : null;
  const cs = connState(age);
  if (cs === 'loading' && performance.now() - openedAt > 12000) { setConn('offline'); message('Order book unavailable, retrying…', 'error') }
  else setConn(cs);
  if (book?.bids.length && book.asks.length) drawLadder();
  drawTape();
}

function drawLadder() {
  const bk = book!, bb = bk.bids[0][0], ba = bk.asks[0][0], mid = (bb + ba) / 2;
  $('#domMsg').hidden || message('');
  if (!step) {
    // base = a "nice" step ≈ 0.002% of price (BTC ≈ $2), times the user's grouping multiplier
    base = autoRow([mid * 0.00002 * 22], 22, 10 ** -host.prec());
    step = base * cfg.mult;
    traded = new Map();
    for (const p of tape) { const k = binOf(p.px, step), x = traded.get(k) ?? { buy: 0, sell: 0, t: 0 }; if (p.buy) x.buy += p.qty; else x.sell += p.qty; traded.set(k, x) }
    const sel = $<HTMLSelectElement>('#domMult');
    [...sel.options].forEach(o => { o.textContent = `×${o.value} (${groupLabel(+o.value, base, 0)})` });
  }
  const bids = groupLevels(bk.bids, step), asks = groupLevels(bk.asks, step);
  const n = lrows.length, half = Math.floor(n / 2), c = center || binOf(mid, step);
  const ks = Array.from({ length: n }, (_, i) => c + half - i);
  let maxQ = 1e-12, maxT = 1e-12;
  for (const k of ks) { maxQ = Math.max(maxQ, bids.get(k) ?? 0, asks.get(k) ?? 0); const t = traded.get(k); if (t) maxT = Math.max(maxT, t.buy + t.sell) }
  const bestBidK = binOf(bb, step), bestAskK = binOf(ba, step);
  // Cumulative depth runs outward from the touch over the whole book (not only the visible rows), so the numbers are true totals.
  const bidKs = [...bids.keys()].filter(k => k <= bestBidK).sort((x, y) => y - x), askKs = [...asks.keys()].filter(k => k >= bestAskK).sort((x, y) => x - y);
  const cb = cumulative(bidKs, bids), ca = cumulative(askKs, asks), cum = new Map<number, number>();
  bidKs.forEach((k, i) => cum.set(k, cb[i])); askKs.forEach((k, i) => cum.set(k, ca[i]));
  let maxC = 1e-12; for (const k of ks) maxC = Math.max(maxC, cum.get(k) ?? 0);
  const mine = myOrders(sym), prec = stepDecimals(step);
  ks.forEach((k, i) => {
    const r = lrows[i], px = k * step, b = bids.get(k) ?? 0, a = asks.get(k) ?? 0, tr = traded.get(k), tot = tr ? tr.buy + tr.sell : 0;
    const mb = mine.some(o => binOf(o.price, step) === k && o.side === 'buy'), ma = mine.some(o => binOf(o.price, step) === k && o.side === 'sell');
    cls(r.tr as unknown as El, (k === bestBidK ? 'bb ' : '') + (k === bestAskK ? 'ba ' : '') + (k > bestAskK ? 'ask' : k < bestBidK ? 'bid' : 'spread') + (k === curK ? ' cur' : ''));
    r.tr.dataset.px = String(px);
    put(r.px, fmtPrice(px, prec)); put(r.b, fmtSize(b)); put(r.a, fmtSize(a)); put(r.trd, fmtSize(tot)); put(r.cum, fmtSize(cum.get(k) ?? 0));
    css(r.b, '--w', pct(b, maxQ).toFixed(1) + '%'); css(r.a, '--w', pct(a, maxQ).toFixed(1) + '%');
    css(r.trd, '--w', pct(tot, maxT).toFixed(1) + '%'); css(r.trd, '--tb', (tr && tot ? pct(tr.buy, maxT) : 0).toFixed(1) + '%');
    css(r.cum, '--w', pct(cum.get(k) ?? 0, maxC).toFixed(1) + '%'); r.cum.dataset.s = k >= bestAskK ? 'a' : 'b';
    r.b.classList.toggle('mine', mb); r.a.classList.toggle('mine', ma);
    const tb = `${t('Buy')} ${fmtPrice(px, prec)}${mb ? ' · ' + t('your order') : ''}`, ta = `${t('Sell')} ${fmtPrice(px, prec)}${ma ? ' · ' + t('your order') : ''}`; if (r.b.title !== tb) r.b.title = tb; if (r.a.title !== ta) r.a.title = ta;
  });
  // book imbalance over the 20 rows nearest the touch
  let sb = 0, sa = 0;
  for (let i = 0; i < 20; i++) { sb += bids.get(bestBidK - i) ?? 0; sa += asks.get(bestAskK + i) ?? 0 }
  const imb = sb + sa ? (sb / (sb + sa)) * 100 : 50, dp = Math.max(prec, host.prec());
  put($('#domBest') as El, fmtPrice(bb, dp)); put($('#domAsk') as El, fmtPrice(ba, dp)); put($('#domMid') as El, fmtPrice(mid, dp));
  put($('#domSpread') as El, `${fmtPrice(ba - bb, dp)} · ${((ba - bb) / mid * 1e4).toFixed(1)} bp`);
  put($('#domBidPct') as El, `${imb.toFixed(0)}%`); put($('#domAskPct') as El, `${(100 - imb).toFixed(0)}%`);
  css($('#domImb'), '--w', imb.toFixed(1) + '%');
}

function drawTape() {
  const msg = $('#domTapeMsg');
  if (!sym || !hasOrderFlow(sym)) { trows.forEach(r => { if (!r.tr.hidden) r.tr.hidden = true }); msg.hidden = true; return }
  const src = cfg.agg ? aggregatePrints(tape.slice(-600)) : tape.slice(-600);
  const big = new Set(bigPrints(src));
  const rows = src.filter(p => p.px * p.qty >= cfg.minTape).slice(-TAPE_ROWS).reverse();
  const dp = host.prec();
  trows.forEach((r, i) => {
    const p = rows[i];
    if (!p) { if (!r.tr.hidden) r.tr.hidden = true; return }
    if (r.tr.hidden) r.tr.hidden = false;
    cls(r.tr as unknown as El, (p.buy ? 'up' : 'dn') + (big.has(p) ? ' big' : ''));
    put(r.c[0], hhmmss(p.t * 1000)); put(r.c[1], fmtPrice(p.px, dp)); put(r.c[2], fmtSize(p.qty)); put(r.c[3], fmtValue(p.px * p.qty));
  });
  msg.hidden = rows.length > 0;
  put(msg as El, t(tape.length ? 'No trades above the minimum value' : 'Waiting for trades…'));
}
