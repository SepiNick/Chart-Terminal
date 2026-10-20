// Liquidations side panel: live liquidation orders of the active chart's perpetual (side, size, price, time) with a
// minimum-value filter shared with the chart's liquidation bubbles. Polls the data server while the panel is open.
import { $, esc, store } from '../store.ts';
import { derivSym, type DSym, type Liq } from './model.ts';
import { fmtN, getDerivs, liqMin } from './layer.ts';

let host: { symbol(): string }, key = '', list: Liq[] = [], err = '', busy = false;

export function initLiqPanel(h: { symbol(): string }) {
  host = h;
  const root = $('#s-liqs');
  root.innerHTML = `<h3>Liquidations · <span id="liqSym">—</span><span class="grow"></span>
    <input id="liqMin" type="number" min="0" placeholder="min value" title="Hide liquidations below this value (quote currency); also filters the chart bubbles" style="width:90px"></h3>
    <div class="row muted" id="liqStats"></div><div class="muted" id="liqErr" style="color:#ef5350"></div><table id="liqT"></table>
    <div class="muted dom-hint">Live from the exchange's public liquidation stream (no history before the panel opened). Red: longs liquidated, green: shorts.</div>`;
  const min = $<HTMLInputElement>('#liqMin');
  min.value = liqMin() ? String(liqMin()) : '';
  min.onchange = () => { store.set('liqMin', Math.max(0, +min.value || 0)); draw() };
  setInterval(poll, 2000);
}

async function poll() {
  if (!host || busy || !$('#s-liqs').classList.contains('on')) return;
  const ds: DSym | null = derivSym(host.symbol()), k = ds ? `${ds.ex}|${ds.ccxt}` : '';
  if (k !== key) { key = k; list = []; err = ds ? '' : 'Liquidations are available for crypto symbols.'; $('#liqSym').textContent = ds ? `${ds.ccxt} (${ds.ex})` : '—'; draw() }
  if (!ds) return;
  busy = true;
  try {
    const r = await getDerivs<{ list: Liq[]; err?: string }>('liqs', ds, { since: String(list.at(-1)?.t ?? 0) });
    if (k !== key) return;
    list.push(...r.list); if (list.length > 500) list.splice(0, list.length - 500);
    err = r.err ?? '';
  } catch (e) { err = (e as Error).message } finally { busy = false }
  draw();
}

function draw() {
  const min = liqMin(), rows = list.filter(l => l.value >= min).slice(-200).reverse();
  const sum = (long: boolean) => fmtN(list.filter(l => l.long === long && l.value >= min).reduce((a, l) => a + l.value, 0));
  $('#liqStats').textContent = `Longs ${sum(true)} · Shorts ${sum(false)} · ${rows.length} shown`;
  $('#liqErr').textContent = err;
  $('#liqT').innerHTML = '<tr class="muted"><th>Time</th><th>Side</th><th>Size</th><th>Price</th><th>Value</th></tr>' + rows.map(l =>
    `<tr style="color:${l.long ? '#ef5350' : '#26a69a'}"><td>${esc(new Date(l.t * 1000).toLocaleTimeString())}</td><td>${l.long ? 'Long' : 'Short'}</td><td>${esc(fmtN(l.qty))}</td><td>${esc(String(+l.px.toPrecision(8)))}</td><td>${esc(fmtN(l.value))}</td></tr>`).join('');
}
