// Desktop widget page (/widget.html?id=<chartN|watchN>&locked=0|1). The Electron shell shows it in a frameless window that,
// once locked, sits behind other windows like a wallpaper. Every widget has its own entry in the device-local `widgets` key
// ({sym, tf} for a chart, {list} for a watchlist); the app's Desktop widgets menu writes it and the `storage` event refreshes
// this page. The window itself has no menus: a drop-down inside a small window would be cut off by its edges.
import { createChart, AreaSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { fetchBars, streamBars, streamTickers, fetch24h, TFS, anyTf, type Bar } from './data.ts';
import { migrate, resolveActive, isSection } from './watchlists.ts';

const q = new URLSearchParams(location.search), id = q.get('id') ?? 'chart', kind = id.startsWith('watch') ? 'watch' : 'chart', locked = q.get('locked') === '1';
const $ = (i: string) => document.getElementById(i)!;
const desk = (globalThis as unknown as { ctDesktop?: { win(op: string, arg?: unknown): Promise<unknown> } }).ctDesktop;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem('ct.' + k); return v ? JSON.parse(v) as T : d } catch { return d } };
type Cfg = { sym?: string; tf?: string; list?: string };
const cfg = (): Cfg => read<Record<string, Cfg>>('widgets', {})[id] ?? (id === 'chart' ? read<Cfg>('widget', {}) : {});
const setCfg = (patch: Cfg) => { try { const all = read<Record<string, Cfg>>('widgets', {}); all[id] = { ...cfg(), ...patch }; localStorage.setItem('ct.widgets', JSON.stringify(all)) } catch { /* storage refused: the widget keeps what it shows */ } };
const fmt = (p: number) => p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6);
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

document.body.classList.toggle('locked', locked);
$('chart').hidden = kind !== 'chart'; $('info').hidden = kind !== 'chart'; $('list').hidden = kind !== 'watch';
let reload = () => {};
if (!locked) {
  $('setup').hidden = false;
  const dims = () => { $('dims').textContent = `${innerWidth}×${innerHeight} · ${Math.round(innerWidth / (screen.availWidth || screen.width || innerWidth) * 100)}% × ${Math.round(innerHeight / (screen.availHeight || screen.height || innerHeight) * 100)}%` };
  dims(); addEventListener('resize', dims);
  const tfSel = $('tfSel') as HTMLSelectElement, symIn = $('symIn') as HTMLInputElement;
  if (kind === 'chart') {
    tfSel.innerHTML = TFS.map(t => `<option>${t}</option>`).join(''); tfSel.value = cfg().tf || '1h'; symIn.value = cfg().sym || 'BTCUSDT';
    tfSel.onchange = () => { setCfg({ tf: tfSel.value }); reload() };
    symIn.onchange = () => { const v = symIn.value.trim().toUpperCase(); if (v && !/[+\-*/^()]/.test(v)) { setCfg({ sym: v }); reload() } };
  } else { tfSel.hidden = true; symIn.hidden = true }
  $('lock').onclick = () => void desk?.win('widget', { op: 'lock', id });
  $('rm').onclick = () => void desk?.win('widget', { op: 'close', id });
  document.querySelectorAll<HTMLElement>('[data-pct]').forEach(b => { b.onclick = () => void desk?.win('widget', { op: 'size', id, pct: +b.dataset.pct! }) });
}

if (kind === 'chart') {
  const chart: IChartApi = createChart($('chart'), {
    autoSize: true,   // follows the window when it is resized
    layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#868993', attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: '#ffffff0d' } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true },
    handleScroll: false, handleScale: false, crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
  });
  const area: ISeriesApi<'Area'> = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false });
  let stop = () => {}, gen = 0, first = 0, sym = '', tf = '';
  const paint = (b: Bar) => {
    const up = b.close >= first, c = up ? '#089981' : '#f23645';
    area.applyOptions({ lineColor: c, topColor: c + '66', bottomColor: c + '00' });
    $('info').innerHTML = `<b>${esc(sym)}</b> <span class="muted">${esc(tf)}</span><span class="px">${fmt(b.close)}</span><span class="${up ? 'up' : 'dn'}">${pct((b.close / first - 1) * 100)}</span>`;
  };
  async function load() {
    const w = cfg(), g = ++gen;
    sym = w.sym || 'BTCUSDT'; tf = w.tf && anyTf(w.tf) ? w.tf : '1h'; stop(); stop = () => {};
    try {
      const bars = (await fetchBars(sym, tf)).slice(-200);
      if (g !== gen || !bars.length) return;
      first = bars[0].close;
      area.setData(bars.map(b => ({ time: b.time as UTCTimestamp, value: b.close })));
      chart.timeScale().fitContent(); paint(bars.at(-1)!);
      stop = streamBars(sym, tf, b => { if (g === gen) { area.update({ time: b.time as UTCTimestamp, value: b.close }); paint(b) } });
    } catch { $('info').innerHTML = `<b>${esc(sym)}</b> <span class="muted">no data</span>` }
  }
  reload = () => void load();
  void load();
  addEventListener('storage', e => { if (e.key === 'ct.widgets' || e.key === 'ct.widget') void load() });
} else {
  const ch = new Map<string, { c: number; ch: number }>(), spark = new Map<string, number[]>();
  let stop = () => {}, syms: string[] = [], title = '', gen = 0, sparkTimer = 0;
  const line = (s: string, up: boolean) => {
    const v = spark.get(s); if (!v || v.length < 2) return '<span class="sp"></span>';
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, d = ch.get(s);
    const pts = (d ? [...v.slice(0, -1), d.c] : v).map((x, i, a) => `${(i / (a.length - 1) * 60).toFixed(1)},${(17 - (x - lo) / span * 16).toFixed(1)}`).join(' ');
    return `<svg class="sp" viewBox="0 0 60 18" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const draw = () => {
    const rows = syms.map(s => ({ s, d: ch.get(s) })), max = Math.max(1, ...rows.map(r => Math.abs(r.d?.ch ?? 0)));
    $('list').innerHTML = `<h4>${esc(title)} · 24h</h4>` + rows.map(({ s, d }) => {
      const up = (d?.ch ?? 0) >= 0, col = up ? 'var(--up)' : 'var(--down)';
      return `<div class="r"><i style="width:${d ? Math.abs(d.ch) / max * 100 : 0}%;background:${col}"></i><b>${esc(s.replace(/USDT$/, ''))}<span class="muted">${s.endsWith('USDT') ? '/USDT' : ''}</span></b>${line(s, up)}<span class="p">${d ? fmt(d.c) : '–'}</span><span class="c" style="color:${col}">${d ? pct(d.ch) : '–'}</span></div>`;
    }).join('');
  };
  async function load() {
    const g = ++gen, lists = migrate(read<unknown>('watchLists', undefined), read<unknown>('watch', undefined), read<unknown>('watchFlags', undefined));
    const want = cfg().list, key = want && lists[want] ? want : resolveActive(lists, read<string | null>('watchActive', null));
    title = lists[key].name; syms = lists[key].syms.filter(s => !isSection(s)).slice(0, 12);
    stop(); clearInterval(sparkTimer); draw();
    const sparks = async () => { for (const s of syms) try { const b = await fetchBars(s, '1h'); if (g !== gen) return; spark.set(s, b.slice(-24).map(x => x.close)) } catch { /* no history for this symbol: no line */ } if (g === gen) draw() };
    void sparks(); sparkTimer = window.setInterval(() => void sparks(), 300_000);
    try { for (const t of await fetch24h()) if (syms.includes(t.s)) ch.set(t.s, { c: t.c, ch: t.ch }); if (g === gen) draw() } catch { /* offline: shows – until the stream answers */ }
    if (g !== gen) return;
    stop = streamTickers(syms, (s, t) => { ch.set(s, { c: t.c, ch: t.o ? (t.c / t.o - 1) * 100 : 0 }); draw() });
  }
  reload = () => void load();
  void load();
  addEventListener('storage', e => { if (e.key === 'ct.watchLists' || e.key === 'ct.watchActive' || e.key === 'ct.widgets') void load() });
}
