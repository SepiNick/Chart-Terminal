// The Market panel (ROADMAP phase 9): screener for any exchange (CEX) and DEX pairs, crypto heatmap with dominance,
// market movers, economic calendar (also on the charts) and news; plus the watchlist's symbol details (technical
// rating, seasonals, news). Keyless sources only: exchanges, DexScreener, CoinGecko, ForexFactory, RSS (server/marketdata.ts).
import { fetch24h, fetchBars, fetchExchanges, isRemote, serverJson, splitSym, type Bar, type Ticker24 } from '../data.ts';
import { $, calcPrec, esc, fmtVol, store } from '../store.ts';
import { STANDALONE_WHY, isStandalone } from '../servers.ts';
import { movers, seasonals, squarify, technicalRating, type Rating } from './analysis.ts';
import { describe, matches, needsBars, parseQuery, test1, type Query, type Row as QRow } from './query.ts';
import { ema, rsi, sma } from '../indicators.ts';
import { openScreenerPro } from '../screenerpro.ts';

export interface MarketHost { setSymbol(s: string): void; addWatch(s: string): void; symbol(): string; refreshCharts(): void }
let host: MarketHost;

// ---------- economic events on the charts ----------
interface CalEv { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string; actual?: string }
let calendar: CalEv[] | null = null;
const calCfg = store.get('calCfg', { onChart: false, impacts: ['High'], ccys: ['USD'] as string[] });
/** Markers for chart.ts: the chosen events of the loaded week (crypto reacts to them too, so every symbol shows them). */
export function chartEvents(): { t: number; text: string; color: string }[] {
  if (!calCfg.onChart || !calendar) return [];
  return calendar.filter(e => calCfg.impacts.includes(e.impact) && calCfg.ccys.includes(e.country))
    .map(e => ({ t: Date.parse(e.date) / 1000, text: `${e.country} ${e.title}`, color: e.impact === 'High' ? '#f23645' : e.impact === 'Medium' ? '#ff9800' : '#9598a1' }))
    .filter(e => Number.isFinite(e.t));
}
async function loadCalendar() { calendar ??= await serverJson<CalEv[]>('/api/calendar'); return calendar }

// ---------- panel ----------
const TABS = { scr: 'Screener', dex: 'DEX', heat: 'Heatmap', mov: 'Movers', cal: 'Calendar', news: 'News' } as const;
type Tab = keyof typeof TABS;
let tab: Tab = store.get('mktTab', 'scr');
/** Tabs whose data comes from the server (the screener on Binance is fetched by the browser). */
const SERVER_TABS: Tab[] = ['dex', 'heat', 'mov', 'cal', 'news'];

export function initMarket(h: MarketHost) {
  host = h;
  const box = $('#s-screener');
  box.innerHTML = `<div class="tabs" id="mktTabs">${Object.entries(TABS).map(([k, v]) => `<button data-mt="${k}">${v}</button>`).join('')}</div><div id="mktView" class="mkt"></div>`;
  $('#mktTabs').onclick = e => { const t = (e.target as HTMLElement).dataset.mt as Tab | undefined; if (t) { tab = t; store.set('mktTab', t); renderMarket() } };
  $('#mktView').addEventListener('click', e => {
    const el = e.target as HTMLElement, sym = el.closest<HTMLElement>('[data-sym]')?.dataset.sym;
    if (el.dataset.add) { host.addWatch(el.dataset.add); return }
    if (sym && !el.closest('a')) host.setSymbol(sym);
  });
  if (calCfg.onChart) loadCalendar().then(() => host.refreshCharts()).catch(() => {});
}
export function renderMarket() {
  if (isStandalone() && SERVER_TABS.includes(tab)) tab = 'scr';
  document.querySelectorAll<HTMLButtonElement>('#mktTabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.mt === tab);
    const off = isStandalone() && SERVER_TABS.includes(b.dataset.mt as Tab);
    b.disabled = off; b.title = off ? STANDALONE_WHY : '';
  });
  const v = $('#mktView');
  ({ scr: screener, dex: dexView, heat: heatmap, mov: moversView, cal: calendarView, news: newsView })[tab](v);
}
const fail = (v: HTMLElement, e: unknown) => { v.innerHTML = `<div class="dn">${esc((e as Error).message)}</div>` };
const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `<span class="${x >= 0 ? 'up' : 'dn'}">${x >= 0 ? '+' : ''}${x.toFixed(2)}%</span>`);
const price = (x: number) => (Number.isFinite(x) ? x.toFixed(calcPrec(x)) : '–');
const ratingCell = (r?: Rating) => (r ? `<span class="${r.all > 0.1 ? 'up' : r.all < -0.1 ? 'dn' : 'muted'}" title="MA ${r.ma.toFixed(2)} · oscillators ${r.osc.toFixed(2)}">${r.label}</span>` : '');

// ---------- screener (any exchange) ----------
const scr = store.get('mktScr', { ex: 'binance', quote: 'USDT', minVol: 1_000_000, q: '', cond: '', sort: 'qv' as keyof Ticker24 | 'rating', desc: true });
const scrRows = new Map<string, Ticker24[]>(), ratings = new Map<string, Rating>();
/** Daily closes, RSI and rating per symbol, for screener conditions (kept for the session). */
const metrics = new Map<string, { closes?: number[]; rsi?: number | null; rating?: number | null }>();
const lastOf = (s: (number | null)[]) => s.at(-1) ?? null;
/** 300 daily bars (SMA 200 and the rating need no more): one request for Binance, the usual path elsewhere. */
async function dailyBars(sym: string): Promise<Bar[]> {
  if (isRemote(sym)) return fetchBars(sym, '1d');
  const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=1d&limit=300`);
  if (!r.ok) throw Error(`klines ${r.status}`);
  return ((await r.json()) as string[][]).map(k => ({ time: +k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}
function dailyMetrics(b: Bar[]) {
  const closes = b.map(x => x.close);
  return { closes, rsi: lastOf(rsi(closes, 14)), rating: b.length > 30 ? technicalRating(b).all : null };
}
/** A screener row with the moving averages this query asks for, computed from the cached closes. */
function qrow(q: Query, r: Ticker24): QRow {
  const m = metrics.get(r.s), c = m?.closes, ma = (k: 'sma' | 'ema') => Object.fromEntries(q.conds.filter(x => x.field === k).map(x => [x.period!, c ? lastOf((k === 'sma' ? sma : ema)(c, x.period!)) : null]));
  return { price: r.c, change: r.ch, volume: r.qv, rsi: m?.rsi, rating: m?.rating, sma: ma('sma'), ema: ma('ema') };
}
let exList: { id: string; name: string }[] | null = null;
async function tickersOf(ex: string): Promise<Ticker24[]> {
  let r = scrRows.get(ex);
  if (r) return r;
  if (ex === 'binance') r = await fetch24h();
  else r = (await serverJson<{ sym: string; last: number; change: number; quoteVolume: number }[]>(`/api/tickers?exchange=${encodeURIComponent(ex)}`)).map(t => ({ s: `${ex.toUpperCase()}:${t.sym}`, c: t.last, ch: t.change, qv: t.quoteVolume }));
  scrRows.set(ex, r); setTimeout(() => scrRows.delete(ex), 60_000);
  return r;
}
async function screener(v: HTMLElement) {
  if (!exList && isStandalone()) exList = [];
  if (!exList) fetchExchanges().then(l => { exList = l.filter(x => x.id !== 'fx'); if (tab === 'scr') renderMarket() }).catch(() => { exList = [] });
  v.innerHTML = `<div class="row wrap">
    <select id="scrEx" title="Exchange">${[{ id: 'binance', name: 'binance' }, ...(exList ?? []).filter(x => x.id !== 'binance')].map(x => `<option ${x.id === scr.ex ? 'selected' : ''}>${esc(x.id)}</option>`).join('')}</select>
    <input id="scrQuote" value="${esc(scr.quote)}" placeholder="Quote" title="Quote currency (empty = all)" style="width:60px">
    <input id="scrMin" type="number" value="${esc(scr.minVol)}" title="Minimum 24h volume (quote)" style="width:90px">
    <input id="scrQ" value="${esc(scr.q)}" placeholder="Search" style="width:80px">
    <button id="scrRate" title="Technical rating (daily) of the first 25 rows">Rate</button><button id="scrPro" title="Full-screen screener with filters, tabs and saved presets">Screener Pro ↗</button></div>
    <div class="row"><input id="scrCond" class="grow" dir="auto" value="${esc(scr.cond)}" placeholder="Condition in words, e.g. RSI below 30 and volume above 1 million · price above sma 50 and change > 3%"><button id="scrCondGo">Filter</button></div>
    <div id="scrCondOut" class="muted"></div><div id="scrOut" class="muted">Loading…</div>`;
  const read = () => { Object.assign(scr, { ex: $<HTMLSelectElement>('#scrEx').value, quote: $<HTMLInputElement>('#scrQuote').value.trim().toUpperCase(), minVol: +$<HTMLInputElement>('#scrMin').value || 0, q: $<HTMLInputElement>('#scrQ').value.trim().toUpperCase() }); store.set('mktScr', scr); draw() };
  v.querySelector('.row')!.addEventListener('change', read);
  $('#scrQ').oninput = read;
  $('#scrRate').onclick = () => void rateRows();
  $('#scrPro').onclick = () => openScreenerPro();
  // Conditions in plain words (src/market/query.ts): parsed here, shown back, applied in draw().
  let query: Query | null = null;
  const parseCond = () => {
    scr.cond = $<HTMLInputElement>('#scrCond').value.trim(); store.set('mktScr', scr);
    const out = $('#scrCondOut');
    query = null;
    if (!scr.cond) { out.textContent = ''; return }
    try { query = parseQuery(scr.cond); out.className = 'up'; out.textContent = `✓ ${describe(query)}` }
    catch (e) { out.className = 'dn'; out.textContent = (e as Error).message }
  };
  $('#scrCondGo').onclick = () => { parseCond(); draw() };
  $('#scrCond').onkeydown = e => { if (e.key === 'Enter') { parseCond(); draw() } };
  parseCond();
  let rows: Ticker24[] = [], drawing = 0;
  const draw = async () => {
    const me = ++drawing;
    try { rows = await tickersOf(scr.ex) } catch (e) { return fail($('#scrOut'), e) }
    const quoteOf = (s: string) => (isRemote(s) ? splitSym(s).symbol : s).replace(/\.P$/, '');
    let list = rows.filter(r => r.qv >= scr.minVol && (!scr.quote || quoteOf(r.s).endsWith(scr.quote)) && (!scr.q || r.s.includes(scr.q)));
    if (query) {
      const q = query, row = (r: Ticker24) => qrow(q, r);
      // RSI / moving averages / rating need daily bars: fetched for at most 60 rows (by volume) that pass the rest.
      const cheap = q.conds.filter(c => !needsBars(c));
      const pre = q.join === 'and' ? list.filter(r => cheap.every(c => test1(c, row(r)))) : list;
      if (q.conds.some(needsBars)) {
        const todo = [...pre].sort((a, b) => b.qv - a.qv).slice(0, 60).filter(r => !metrics.has(r.s));
        let done = 0, next = 0;
        const worker = async () => {
          while (next < todo.length && me === drawing) {
            const r = todo[next++];
            try { metrics.set(r.s, dailyMetrics(await dailyBars(r.s))) } catch { metrics.set(r.s, {}) }
            $('#scrOut').textContent = `Daily data ${++done}/${todo.length}…`;
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));   // 6 at a time: fast, still gentle on the exchange
        if (me !== drawing) return;
      }
      list = pre.filter(r => matches(q, row(r)));
    }
    if (me !== drawing) return;
    const key = scr.sort, val = (r: Ticker24) => (key === 'rating' ? ratings.get(r.s)?.all ?? -9 : r[key]);
    list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * (scr.desc ? -1 : 1) });
    shown = list.slice(0, 200);
    $('#scrOut').innerHTML = `<table class="scr"><tr>${[['s', 'Symbol'], ['c', 'Price'], ['ch', 'Chg%'], ['qv', 'Vol'], ['rating', 'Rating']].map(([k, n]) => `<th data-sort="${k}" class="click">${n}${scr.sort === k ? (scr.desc ? ' ↓' : ' ↑') : ''}</th>`).join('')}<th></th></tr>
      ${shown.map(r => `<tr class="click" data-sym="${esc(r.s)}"><td>${esc(r.s)}</td><td>${price(r.c)}</td><td>${pct(r.ch)}</td><td>${fmtVol(r.qv)}</td><td>${ratingCell(ratings.get(r.s))}</td><td><button class="x" data-add="${esc(r.s)}" title="Add to watchlist">＋</button></td></tr>`).join('')}</table>
      <div class="muted">${list.length} of ${rows.length} symbols</div>`;
    $('#scrOut').querySelector('tr')!.onclick = e => { const k = (e.target as HTMLElement).dataset.sort as typeof scr.sort | undefined; if (!k) return; scr.desc = scr.sort === k ? !scr.desc : true; scr.sort = k; store.set('mktScr', scr); draw() };
  };
  let shown: Ticker24[] = [];
  const rateRows = async () => {
    const todo = shown.slice(0, 25).filter(r => !ratings.has(r.s));
    for (const [i, r] of todo.entries()) {
      $('#scrRate').textContent = `Rating ${i + 1}/${todo.length}…`;
      try { ratings.set(r.s, technicalRating(await fetchBars(r.s, '1d'))) } catch { /* no daily bars: no rating */ }
    }
    $('#scrRate').textContent = 'Rate';
    if (tab === 'scr') draw();
  };
  await draw();
}

// ---------- DEX pairs ----------
interface Dex { chain: string; dex: string; url: string; pair: string; name: string; price: number; ch: number | null; vol: number; liq: number; fdv: number | null }
let dexQ = store.get('mktDex', 'PEPE');
async function dexView(v: HTMLElement) {
  v.innerHTML = `<div class="row"><input id="dexQ" value="${esc(dexQ)}" placeholder="Token symbol, name or address" class="grow"><button id="dexGo">Search</button></div><div id="dexOut" class="muted">Loading…</div>`;
  const go = async () => {
    dexQ = $<HTMLInputElement>('#dexQ').value.trim(); store.set('mktDex', dexQ);
    if (!dexQ) return;
    try {
      const rows = (await serverJson<Dex[]>(`/api/dex?q=${encodeURIComponent(dexQ)}`)).sort((a, b) => b.vol - a.vol);
      $('#dexOut').innerHTML = rows.length ? `<table class="scr"><tr><th>Pair</th><th>Chain · DEX</th><th>Price $</th><th>24h</th><th>Vol</th><th>Liquidity</th></tr>
        ${rows.map(r => `<tr><td><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" title="${esc(r.name)}">${esc(r.pair)}</a></td><td class="muted">${esc(r.chain)} · ${esc(r.dex)}</td><td>${price(r.price)}</td><td>${pct(r.ch)}</td><td>${fmtVol(r.vol)}</td><td>${fmtVol(r.liq)}</td></tr>`).join('')}</table>
        <div class="muted">DEX prices from DexScreener; these pairs can't be charted here.</div>` : '<div class="muted">No pairs found.</div>';
    } catch (e) { fail($('#dexOut'), e) }
  };
  $('#dexGo').onclick = go;
  $('#dexQ').onkeydown = e => { if (e.key === 'Enter') go() };
  await go();
}

// ---------- heatmap and dominance ----------
interface Coin { id: string; sym: string; name: string; price: number; cap: number; ch: number | null; vol: number }
async function heatmap(v: HTMLElement) {
  v.innerHTML = '<div class="muted">Loading…</div>';
  let coins: Coin[], g: Record<string, number | null>;
  try { [coins, g] = await Promise.all([serverJson<Coin[]>('/api/coins'), serverJson<Record<string, number | null>>('/api/global')]) } catch (e) { return fail(v, e) }
  const big = (x: number | null) => (x == null ? '–' : `$${fmtVol(x)}`), d = (x: number | null) => (x == null ? '–' : `${x.toFixed(2)}%`);
  const W = Math.max(240, v.clientWidth - 4), H = 420, list = coins.filter(c => c.cap > 0).slice(0, 60), rs = squarify(list.map(c => c.cap), W, H);
  const col = (ch: number | null) => { const t = Math.max(-1, Math.min(1, (ch ?? 0) / 8)); return `color-mix(in srgb, var(${t >= 0 ? '--up' : '--down'}) ${Math.round(25 + 65 * Math.abs(t))}%, var(--bg))` };
  v.innerHTML = `<div class="kpis row wrap">
      <div title="Total crypto market cap"><span>TOTAL</span><b>${big(g.TOTAL)}</b></div><div title="Without BTC"><span>TOTAL2</span><b>${big(g.TOTAL2)}</b></div><div title="Without BTC and ETH"><span>TOTAL3</span><b>${big(g.TOTAL3)}</b></div>
      <div><span>BTC.D</span><b>${d(g['BTC.D'])}</b></div><div><span>ETH.D</span><b>${d(g['ETH.D'])}</b></div><div><span>USDT.D</span><b>${d(g['USDT.D'])}</b></div><div><span>24h</span><b>${pct(g.change24h)}</b></div></div>
    <div class="heatmap" style="position:relative;height:${H}px">${list.map((c, i) => { const r = rs[i]; return r.w < 1 ? '' : `<div class="click" data-sym="${esc(c.sym)}USDT" title="${esc(c.name)} · $${fmtVol(c.cap)} · ${c.ch?.toFixed(2) ?? '–'}%" style="position:absolute;left:${r.x.toFixed(1)}px;top:${r.y.toFixed(1)}px;width:${r.w.toFixed(1)}px;height:${r.h.toFixed(1)}px;background:${col(c.ch)}">${r.w > 34 && r.h > 22 ? `<b>${esc(c.sym)}</b>${r.h > 38 ? `<br>${c.ch?.toFixed(1) ?? ''}%` : ''}` : ''}</div>` }).join('')}</div>
    <div class="muted">Size = market cap, colour = 24h change. CoinGecko, refreshed every 5 minutes. Click a coin to chart it against USDT.</div>`;
}

// ---------- movers ----------
async function moversView(v: HTMLElement) {
  v.innerHTML = '<div class="muted">Loading…</div>';
  let t: Ticker24[];
  try { t = await tickersOf('binance') } catch (e) { return fail(v, e) }
  const m = movers(t.filter(x => x.s.endsWith('USDT')), 10), table = (title: string, rows: Ticker24[]) => `<h4>${title}</h4><table class="scr">${rows.map(r => `<tr class="click" data-sym="${esc(r.s)}"><td>${esc(r.s.replace(/USDT$/, ''))}</td><td>${price(r.c)}</td><td>${pct(r.ch)}</td><td>${fmtVol(r.qv)}</td></tr>`).join('')}</table>`;
  v.innerHTML = table('Top gainers (24h)', m.gainers) + table('Top losers (24h)', m.losers) + table('Most traded', m.active) + '<div class="muted">Binance USDT pairs with at least $1M volume.</div>';
}

// ---------- economic calendar ----------
async function calendarView(v: HTMLElement) {
  v.innerHTML = '<div class="muted">Loading…</div>';
  let evs: CalEv[];
  try { evs = await loadCalendar() } catch (e) { return fail(v, e) }
  const ccys = [...new Set(evs.map(e => e.country))].sort(), now = Date.now();
  const draw = () => {
    const rows = evs.filter(e => calCfg.impacts.includes(e.impact) && calCfg.ccys.includes(e.country));
    $('#calOut').innerHTML = `<table class="scr"><tr><th>Time</th><th></th><th>Event</th><th>Actual</th><th>Fcst</th><th>Prev</th></tr>${rows.map(e => {
      const t = Date.parse(e.date), past = t < now;
      return `<tr class="${past ? 'muted' : ''}"><td>${new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td><td><span class="imp imp-${esc(e.impact.toLowerCase())}" title="${esc(e.impact)} impact"></span>${esc(e.country)}</td><td>${esc(e.title)}</td><td>${esc(e.actual ?? '')}</td><td>${esc(e.forecast ?? '')}</td><td>${esc(e.previous ?? '')}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No events for this filter.</td></tr>'}</table>`;
  };
  v.innerHTML = `<div class="row wrap">${['High', 'Medium', 'Low', 'Holiday'].map(i => `<label><input type="checkbox" data-imp="${i}" ${calCfg.impacts.includes(i) ? 'checked' : ''}> ${i}</label>`).join(' ')}
      <label title="Draw the filtered events on every chart"><input type="checkbox" id="calChart" ${calCfg.onChart ? 'checked' : ''}> on charts</label></div>
    <div class="row wrap">${ccys.map(c => `<label><input type="checkbox" data-ccy="${esc(c)}" ${calCfg.ccys.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join(' ')}</div>
    <div id="calOut"></div><div class="muted">This week's calendar from ForexFactory; times in your local zone.</div>`;
  v.querySelectorAll<HTMLInputElement>('input').forEach(i => i.onchange = () => {
    if (i.dataset.imp) calCfg.impacts = i.checked ? [...calCfg.impacts, i.dataset.imp] : calCfg.impacts.filter(x => x !== i.dataset.imp);
    if (i.dataset.ccy) calCfg.ccys = i.checked ? [...calCfg.ccys, i.dataset.ccy] : calCfg.ccys.filter(x => x !== i.dataset.ccy);
    if (i.id === 'calChart') calCfg.onChart = i.checked;
    store.set('calCfg', calCfg); draw(); host.refreshCharts();
  });
  draw();
}

// ---------- news ----------
interface News { title: string; link: string; source: string; t: number }
let newsMine = store.get('mktNewsMine', false);
/** Words that find a symbol's news: its base asset (BTC) and, for well-known coins, the name (Bitcoin). */
const NAMES: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum,Ether', SOL: 'Solana', XRP: 'Ripple,XRP', BNB: 'Binance', DOGE: 'Dogecoin', ADA: 'Cardano', TON: 'Toncoin', TRX: 'Tron', AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink', LTC: 'Litecoin', SHIB: 'Shiba', PEPE: 'Pepe', SUI: 'Sui', ARB: 'Arbitrum', OP: 'Optimism' };
const newsWords = (sym: string) => { const s = (isRemote(sym) ? splitSym(sym).symbol : sym).replace(/^[A-Z0-9]+:/, '').replace(/[_/]?(USDT|USDC|USD|BUSD|IRT|EUR|BTC)(\.P)?$/, ''); return [s, ...(NAMES[s]?.split(',') ?? [])].join(',') };
const newsList = (items: News[]) => items.map(n => `<div class="news"><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><div class="muted">${esc(n.source)}${n.t ? ' · ' + new Date(n.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div></div>`).join('') || '<div class="muted">No headlines.</div>';
async function newsView(v: HTMLElement) {
  v.innerHTML = `<label><input type="checkbox" id="newsMine" ${newsMine ? 'checked' : ''}> only ${esc(host.symbol())}</label><div id="newsOut" class="muted">Loading…</div>`;
  $<HTMLInputElement>('#newsMine').onchange = e => { newsMine = (e.target as HTMLInputElement).checked; store.set('mktNewsMine', newsMine); renderMarket() };
  try { $('#newsOut').innerHTML = newsList(await serverJson<News[]>(`/api/news${newsMine ? `?q=${encodeURIComponent(newsWords(host.symbol()))}` : ''}`)) + '<div class="muted">CoinDesk, Cointelegraph, Decrypt and The Block RSS feeds.</div>' }
  catch (e) { fail($('#newsOut'), e) }
}

// ---------- watchlist details ----------
const MONTHS = 'JFMAMJJASOND';
/** Details of the selected watchlist symbol: daily technical rating, seasonals and its news. */
export async function renderDetails(el: HTMLElement, sym: string) {
  el.innerHTML = `<h4>${esc(sym)}</h4><div class="muted">Loading…</div>`;
  let bars;
  try { bars = await fetchBars(sym, '1d') } catch (e) { return fail(el, e) }
  if (el.dataset.sym !== sym) return;   // another row was picked meanwhile
  const r = technicalRating(bars), s = seasonals(bars), cell = (x: number | null) => (x == null ? '<td></td>' : `<td class="${x >= 0 ? 'up' : 'dn'}">${x.toFixed(1)}</td>`);
  const g = (v: number) => `<span class="${v > 0.1 ? 'up' : v < -0.1 ? 'dn' : 'muted'}">${(v * 100).toFixed(0)}</span>`;
  el.innerHTML = `<h4>${esc(sym)} <span class="muted">daily</span></h4>
    <div class="kpis row wrap"><div><span>Technical rating</span><b>${ratingCell(r)}</b></div><div><span>Moving averages</span><b>${g(r.ma)}</b></div><div><span>Oscillators</span><b>${g(r.osc)}</b></div></div>
    <details><summary class="muted">${r.votes.length} indicators</summary><table class="scr">${r.votes.map(x => `<tr><td>${esc(x.name)}</td><td>${price(x.value!)}</td><td class="${x.vote > 0 ? 'up' : x.vote < 0 ? 'dn' : 'muted'}">${x.vote > 0 ? 'Buy' : x.vote < 0 ? 'Sell' : 'Neutral'}</td></tr>`).join('')}</table></details>
    <h4>Seasonals <span class="muted">monthly return %</span></h4>
    <table class="scr seas"><tr><th></th>${[...MONTHS].map(m => `<th>${m}</th>`).join('')}</tr>${s.years.slice(0, 6).map(y => `<tr><td>${y.year}</td>${y.months.map(cell).join('')}</tr>`).join('')}<tr><td><b>avg</b></td>${s.avg.map(cell).join('')}</tr></table>
    <h4>News</h4><div id="detNews" class="muted">Loading…</div>`;
  serverJson<News[]>(`/api/news?q=${encodeURIComponent(newsWords(sym))}`).then(n => { const d = el.querySelector('#detNews'); if (d && el.dataset.sym === sym) d.innerHTML = newsList(n.slice(0, 8)) }, () => { const d = el.querySelector('#detNews'); if (d) d.textContent = 'News needs the data server.' });
}

