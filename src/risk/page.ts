// Portfolio risk page of the journal workspace: exposure of the paper account's open positions and the correlation
// of those symbols and the watchlist (log returns over a chosen timeframe and lookback).
import { fetchBars, type Bar } from '../data.ts';
import { equity } from '../trading.ts';
import { journal, journalHost } from '../journalui.ts';
import { card, cls, kpi, money } from '../journal/workspace.ts';
import { esc, store } from '../store.ts';
import { STABLE, correlationMatrix, exposure, splitPair, stacks, type Leg } from './risk.ts';

const cfg = store.get('riskCfg', { tf: '1h', lookback: 200, th: 0.7 });
const cache = new Map<string, { at: number; bars: Bar[] }>();
let tok = 0;

async function bars(sym: string, tf: string) {
  const k = `${sym}|${tf}`, c = cache.get(k);
  if (c && Date.now() - c.at < 5 * 60_000) return c.bars;
  const b = await fetchBars(sym, tf);
  cache.set(k, { at: Date.now(), bars: b });
  return b;
}

function snapshot() {
  const { acct, price, watch } = journalHost().portfolio();
  const prices: Record<string, number | undefined> = {};
  const stopOf = (sym: string) => acct.orders.find(o => o.sym === sym && o.reduceOnly && o.type === 'stop')?.price
    ?? journal().trades.find(t => t.sym === sym && t.status === 'open' && (t.accountId ?? 'paper') === 'paper')?.stop;
  const fx = (quote: string) => (STABLE.has(quote) ? 1 : price(`${quote}USDT`));
  const pos = Object.entries(acct.pos).map(([sym, p]) => {
    const px = price(sym) ?? p.avg; prices[sym] = px;
    return { sym, qty: p.qty, avg: p.avg, px, stop: stopOf(sym), fx: fx(splitPair(sym).quote) };
  });
  const eq = equity(acct, prices).equity;
  return { pos, eq, syms: [...new Set([...pos.map(p => p.sym), ...watch])].slice(0, 24) };
}

const legTable = (title: string, legs: Leg[], sub: string) => card(title, legs.length ? `<table class="jw-table small"><tr><th></th><th>Net</th><th>% equity</th><th>Gross</th><th>% equity</th></tr>${legs.map(l => `<tr><td>${esc(l.key)}</td><td class="${cls(l.net)}">${money(l.net)}</td><td class="${cls(l.net)}">${l.netPct.toFixed(1)}%</td><td>${money(l.gross, false)}</td><td>${l.grossPct.toFixed(1)}%</td></tr>`).join('')}</table>` : '<p class="muted">No open positions.</p>', sub);

export function riskPage(main: HTMLElement) {
  const s = snapshot(), e = exposure(s.pos, s.eq), my = ++tok;
  const noFx = s.pos.filter(p => p.fx == null).map(p => splitPair(p.sym).quote);
  main.innerHTML = `<div class="jw-toolbar"><h2>Portfolio risk</h2><span class="grow"></span>
      <label>Timeframe <select data-rk="tf">${['15m', '1h', '4h', '1d'].map(t => `<option ${t === cfg.tf ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Lookback <input data-rk="lookback" type="number" min="20" max="1000" value="${cfg.lookback}" style="width:70px"> bars</label>
      <label title="Positions correlated at least this much count as one bet">Correlated at |ρ| ≥ <input data-rk="th" type="number" min="0.3" max="0.99" step="0.05" value="${cfg.th}" style="width:60px"></label>
      <button data-rk="refresh">↻ Refresh</button></div>
    <div class="jw-grid">
      <div class="jw-kpis">
        ${kpi('Equity (paper)', money(s.eq, false))}${kpi('Gross exposure', `${money(e.gross, false)} <small>${e.grossPct.toFixed(1)}%</small>`)}${kpi('Net exposure', `${money(e.net)} <small>${e.netPct.toFixed(1)}%</small>`, cls(e.net))}
        ${kpi('Largest position', e.largest ? `${esc(e.largest.sym)} <small>${Math.abs(e.largest.pct).toFixed(1)}%</small>` : '—')}
        ${kpi('Open risk to stops', `${money(e.risk, false)} <small>${e.riskPct.toFixed(2)}% · ${e.riskR.toFixed(2)}R</small>`, e.risk ? 'dn' : '', 'What is lost from current prices if every stop is hit; R is in units of each trade’s initial risk')}
        ${kpi('Without a stop', e.noStop.length ? esc(e.noStop.join(', ')) : 'none', e.noStop.length ? 'dn' : '')}
      </div>
      <div id="rkWarn" class="wide" style="grid-column:1/-1"></div>
      ${card('Positions', e.rows.length ? `<table class="jw-table small"><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Price</th><th>Notional</th><th>% equity</th><th>Stop</th><th>Risk</th><th>R</th></tr>${e.rows.map(r => `<tr><td>${esc(r.sym)}</td><td class="${r.qty > 0 ? 'up' : 'dn'}">${r.qty > 0 ? 'long' : 'short'}</td><td>${+Math.abs(r.qty).toFixed(8)}</td><td>${+r.avg.toPrecision(8)}</td><td>${+r.px.toPrecision(8)}</td><td>${money(Math.abs(r.notional), false)}</td><td>${Math.abs(r.pct).toFixed(1)}%</td><td>${r.stop == null ? '<span class="dn">none</span>' : +r.stop.toPrecision(8)}</td><td>${r.risk == null ? '—' : money(r.risk, false)}</td><td>${r.r == null ? '—' : r.r.toFixed(2)}</td></tr>`).join('')}</table>` : '<p class="muted">The paper account has no open positions.</p>', noFx.length ? `Amounts in ${[...new Set(noFx)].join(', ')} are not converted (no USDT price)` : 'Paper account, at the latest prices', 'wide')}
      ${legTable('Exposure per asset', e.byAsset, 'Base currency of each position')}
      ${legTable('Exposure per quote currency', e.byQuote, 'A long BTCUSDT is short USDT')}
      ${card('Correlation matrix', '<div id="rkCorr" class="muted">Loading bars…</div>', `Pearson correlation of ${cfg.tf} log returns over the last ${cfg.lookback} bars: open positions and the watchlist`, 'wide')}
    </div>`;
  main.onclick = ev => { if ((ev.target as HTMLElement).dataset.rk === 'refresh') { cache.clear(); riskPage(main) } };
  main.onchange = ev => {
    const el = ev.target as HTMLInputElement, k = el.dataset.rk;
    if (k === 'tf') cfg.tf = el.value;
    else if (k === 'lookback') cfg.lookback = Math.max(20, Math.min(1000, Math.round(+el.value) || 200));
    else if (k === 'th') cfg.th = Math.max(0.3, Math.min(0.99, +el.value || 0.7));
    else return;
    store.set('riskCfg', cfg); riskPage(main);
  };
  void loadCorr(s.syms, e, s.eq, my);
}

async function loadCorr(syms: string[], e: ReturnType<typeof exposure>, eq: number, my: number) {
  const got = await Promise.allSettled(syms.map(x => bars(x, cfg.tf)));
  if (my !== tok) return;
  const series: Record<string, { time: number; close: number }[]> = {}, failed: string[] = [];
  got.forEach((g, i) => { if (g.status === 'fulfilled' && g.value.length > 3) series[syms[i]] = g.value.slice(-(cfg.lookback + 1)); else failed.push(syms[i]) });
  const m = correlationMatrix(series), at = (a: string, b: string) => { const i = m.syms.indexOf(a), k = m.syms.indexOf(b); return i < 0 || k < 0 ? null : m.r[i][k] };
  const held = new Set(e.rows.map(r => r.sym));
  const cell = (r: number | null, n: number) => r == null ? '<td class="muted">—</td>'
    : `<td title="${n} returns" style="text-align:center;background:color-mix(in srgb, var(--${r >= 0 ? 'up' : 'down'}) ${Math.round(Math.abs(r) * 70)}%, transparent)">${r.toFixed(2)}</td>`;
  const el = document.getElementById('rkCorr'); if (!el) return;
  el.className = '';
  el.innerHTML = m.syms.length < 2 ? '<p class="muted">Need at least two symbols with data (open positions or watchlist).</p>'
    : `<div class="jw-tablewrap"><table class="jw-table small"><tr><th></th>${m.syms.map(x => `<th>${esc(x)}${held.has(x) ? ' •' : ''}</th>`).join('')}</tr>${m.syms.map((x, i) => `<tr><th>${esc(x)}${held.has(x) ? ' •' : ''}</th>${m.r[i].map((r, k) => cell(r, m.n[i][k])).join('')}</tr>`).join('')}</table></div>
      <p class="muted">• open position${failed.length ? ` · no data for ${esc(failed.join(', '))}` : ''}</p>`;
  const w = stacks(e.rows, at, cfg.th), warn = document.getElementById('rkWarn');
  if (warn) warn.innerHTML = w.length ? card('⚠ Correlated positions stack risk in one direction', w.map(g => `<p><b>${esc(g.legs.join(' + '))}</b> <span class="muted">(|ρ| ≥ ${g.minCorr.toFixed(2)})</span>: ${money(g.notional, false)} exposure (${eq > 0 ? ((g.notional / eq) * 100).toFixed(1) : '—'}% of equity), ${g.risk == null ? '<span class="dn">risk unknown: a position has no stop</span>' : `${money(g.risk, false)} to the stops`}. These move together, so treat them as one position.</p>`).join(''), '', 'wide dn') : '';
}
