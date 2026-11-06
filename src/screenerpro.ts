// Screener Pro: a full-screen crypto screener with filter chips (exchange, symbol type, currencies, ranges), tabs of columns and
// saved presets. It sits beside the classic screener in the Market panel, which is unchanged.
import { fetch24h, fetchBars, fetchExchanges, serverJson, type Bar } from './data.ts';
import { esc, fmtVol, calcPrec, store, toast } from './store.ts';
import { isStandalone } from './servers.ts';
import { CATALOG } from './providers/catalog.ts';
import { UNUSABLE } from './exchangegroups.ts';
import { LAZY, emptyFilters, matchesAll, matchesCheap, metricsOf, needsMetrics, safeQuery, sortRows, titleOf, toRow, valueOf, type Field, type Filters, type Metrics, type RawTicker, type Row, type SymType } from './market/sprocore.ts';

export interface ScreenerProHost { openSymbol(sym: string): void; watchlists(): { id: string; name: string; syms: string[] }[]; openClassic(): void }

type ColKey = 'chg' | 'qv' | 'volchg' | 'rating' | 'price' | 'perf1w' | 'perf1m' | 'perf3m' | 'perf6m' | 'perfytd' | 'ma' | 'osc' | 'rsi';
type Tab = 'custom' | 'overview' | 'performance' | 'technicals';
interface State { f: Filters; tab: Tab; cols: ColKey[]; sort: { key: string; desc: boolean }; extra: Field[] }

const TAB_COLS: Record<Exclude<Tab, 'custom'>, ColKey[]> = { overview: ['price', 'chg', 'qv', 'rating'], performance: ['chg', 'perf1w', 'perf1m', 'perf3m', 'perf6m', 'perfytd'], technicals: ['rating', 'ma', 'osc', 'rsi'] };
const FIELD_NAMES: Record<Field, string> = { chg: 'Chg %', qv: 'Vol in USD', volchg: 'Vol chg %', price: 'Price', rating: 'Tech rating', rsi: 'RSI (14)', perf1w: 'Perf 1W', perf1m: 'Perf 1M', perf3m: 'Perf 3M', perf6m: 'Perf 6M', perfytd: 'Perf YTD' };
const PERF: Field[] = ['perf1w', 'perf1m', 'perf3m', 'perf6m', 'perfytd'];
const LOCAL_ONLY = new Set(['fx', 'mt5', 'cryptocap', 'tgju', 'tse', 'nobitex', 'oanda', 'alpaca', 'polygon', 'twelvedata']);

const defaults = (): State => ({ f: emptyFilters(), tab: 'custom', cols: ['chg', 'qv', 'volchg', 'rating', 'price'], sort: { key: 'chg', desc: true }, extra: [] });
function load(): State {
  const d = defaults(), s = store.get<Partial<State>>('spState', {});
  return { ...d, ...s, f: { ...d.f, ...(s.f ?? {}), ranges: { ...(s.f?.ranges ?? {}) } }, sort: s.sort ?? d.sort, cols: Array.isArray(s.cols) ? s.cols : d.cols, extra: Array.isArray(s.extra) ? s.extra : [] };
}
let S: State = defaults(), presets: Record<string, State> = {}, host: ScreenerProHost, root: HTMLElement | null = null;
let all: Row[] = [], loading = 0, status = '', shown = 100, exchanges: { id: string; name: string }[] = [];
const rowsCache = new Map<string, { at: number; rows: Row[] }>(), metrics = new Map<string, Metrics | null>();
let analyzing = 0, analyzed = 0, wanted = 0, drawTimer = 0;
const save = () => store.set('spState', S);

// ---------- cells ----------
const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '<span class="muted">–</span>' : `<span class="${x >= 0 ? 'up' : 'dn'}">${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}%</span>`);
const label = (v: number | null | undefined) => (v == null ? '<span class="muted">–</span>' : v > 0.5 ? '<span class="up">⇈ Strong buy</span>' : v > 0.1 ? '<span class="up">⌃ Buy</span>' : v < -0.5 ? '<span class="dn">⇊ Strong sell</span>' : v < -0.1 ? '<span class="dn">⌄ Sell</span>' : '<span class="muted">= Neutral</span>');
const COLS: Record<ColKey, { name: string; sub?: string; cell: (r: Row) => string }> = {
  chg: { name: 'Chg %', sub: '24h', cell: r => pct(r.chg) },
  qv: { name: 'Vol in USD', sub: '24h', cell: r => (r.qv == null ? '<span class="muted">–</span>' : fmtVol(r.qv)) },
  volchg: { name: 'Vol chg %', sub: '24h', cell: r => pct(r.m?.volchg) },
  rating: { name: 'Tech rating', sub: '1D', cell: r => label(r.m?.rating) },
  price: { name: 'Price', cell: r => `${r.price.toFixed(calcPrec(r.price))} <small class="muted">${esc(r.quote)}</small>` },
  perf1w: { name: 'Perf %', sub: '1W', cell: r => pct(r.m?.perf1w) }, perf1m: { name: 'Perf %', sub: '1M', cell: r => pct(r.m?.perf1m) },
  perf3m: { name: 'Perf %', sub: '3M', cell: r => pct(r.m?.perf3m) }, perf6m: { name: 'Perf %', sub: '6M', cell: r => pct(r.m?.perf6m) }, perfytd: { name: 'Perf %', sub: 'YTD', cell: r => pct(r.m?.perfytd) },
  ma: { name: 'MA rating', sub: '1D', cell: r => label(r.m?.ma) }, osc: { name: 'Oscillators', sub: '1D', cell: r => label(r.m?.osc) },
  rsi: { name: 'RSI (14)', sub: '1D', cell: r => (r.m?.rsi == null ? '<span class="muted">–</span>' : r.m.rsi.toFixed(1)) },
};
const colsOf = (): ColKey[] => (S.tab === 'custom' ? S.cols : TAB_COLS[S.tab]);

// ---------- data ----------
async function dailyBars(r: Row): Promise<Bar[]> {
  if (r.ex === 'binance') {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(r.sym)}&interval=1d&limit=300`);
    if (!res.ok) throw Error(`klines ${res.status}`);
    return ((await res.json()) as string[][]).map(k => ({ time: +k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
  }
  return fetchBars(r.sym, '1d');
}
async function rowsOf(ex: string): Promise<Row[]> {
  const c = rowsCache.get(ex);
  if (c && Date.now() - c.at < 60_000) return c.rows;
  let rows: Row[];
  if (ex === 'binance') rows = (await fetch24h()).map(t => toRow(ex, { sym: t.s, last: t.c, change: t.ch, quoteVolume: t.qv }, true)).filter((r): r is Row => !!r);
  else rows = (await serverJson<RawTicker[]>(`/api/tickers?exchange=${encodeURIComponent(ex)}`)).map(t => toRow(ex, t, false)).filter((r): r is Row => !!r);
  rowsCache.set(ex, { at: Date.now(), rows });
  return rows;
}
async function reload(force = false) {
  if (force) rowsCache.clear();
  const me = ++loading, want = S.f.exchanges.length ? S.f.exchanges : ['binance'];
  status = 'Loading…'; draw();
  const out: Row[] = [], errs: string[] = [];
  await Promise.all(want.map(async ex => { try { out.push(...(await rowsOf(ex))) } catch (e) { errs.push(`${ex}: ${(e as Error).message}`) } }));
  if (me !== loading) return;
  all = out; status = errs.length ? errs.join(' · ') : ''; shown = 100; draw();
}
/** Daily-bar metrics for `list` (5 at a time); the table redraws as they arrive. */
async function analyze(list: Row[]) {
  const todo = list.filter(r => !metrics.has(r.key));
  wanted = list.length; analyzed = list.length - todo.length;
  if (!todo.length) return;
  let next = 0;
  const worker = async () => {
    analyzing++;
    while (next < todo.length) {
      const r = todo[next++];
      try { metrics.set(r.key, metricsOf(await dailyBars(r), r.qv)) } catch { metrics.set(r.key, null) }
      analyzed++; scheduleDraw();
    }
    analyzing--;
  };
  void Promise.all(Array.from({ length: Math.min(5, todo.length) }, worker));
}
const scheduleDraw = () => { if (!drawTimer) drawTimer = window.setTimeout(() => { drawTimer = 0; draw() }, 400) };

// ---------- the view ----------
function visibleRows(): { list: Row[]; total: number; condError?: string } {
  for (const r of all) r.m = metrics.get(r.key) ?? undefined;
  const { q, error } = safeQuery(S.f.cond), cheap = all.filter(r => matchesCheap(r, S.f)), byVol = [...cheap].sort((a, b) => (b.qv ?? -1) - (a.qv ?? -1));
  const lazyCol = colsOf().some(c => LAZY.has(c as Field) || c === 'ma' || c === 'osc'), lazySort = LAZY.has(S.sort.key as Field) || S.sort.key === 'ma' || S.sort.key === 'osc';
  let list: Row[];
  if (needsMetrics(S.f)) { void analyze(byVol.slice(0, 150)); list = cheap.filter(r => matchesAll(r, S.f, q)) }
  else {
    list = q ? cheap.filter(r => matchesAll(r, S.f, q)) : cheap;
    if (lazySort) void analyze(byVol.slice(0, 150));
  }
  list = sortRows(list, S.sort.key, S.sort.desc);
  if (lazyCol && !needsMetrics(S.f) && !lazySort) void analyze(list.slice(0, shown));
  return { list, total: list.length, condError: error };
}

function chip(key: string, name: string, value: string): string {
  return value ? `<span class="sp-chip on"><button data-chip="${key}">${esc(value)}</button><button class="x" data-clear="${key}" aria-label="Clear ${esc(name)}">×</button></span>` : `<button class="sp-chip" data-chip="${key}">${esc(name)} ▾</button>`;
}
const rangeText = (g?: { min?: number; max?: number }) => (g && (g.min != null || g.max != null) ? `${g.min ?? ''}…${g.max ?? ''}` : '');
const exName = (id: string) => CATALOG.find(p => p.id === id)?.name ?? (id === 'binance' ? 'Binance' : id);
const TYPE_NAMES: Record<SymType, string> = { spot: 'Spot', perpetual: 'Perpetual', future: 'Futures' };

function chipsHtml(): string {
  const F = S.f, perf = PERF.find(k => rangeText(F.ranges[k]));
  const wl = F.watch ? host.watchlists().find(l => l.syms.length === F.watch!.length && l.syms.every(s => F.watch!.includes(s)))?.name ?? 'Watchlist' : '';
  const parts = [
    chip('watch', 'Watchlist', wl),
    chip('exchanges', 'Exchange', F.exchanges.map(exName).join(', ')),
    chip('types', 'Symbol type', F.types.map(t => TYPE_NAMES[t]).join(', ')),
    chip('bases', 'Base currency', F.bases.join(', ')),
    chip('quotes', 'Quote currency', F.quotes.length ? F.quotes.join(', ') : ''),
    chip('chg', 'Chg %', rangeText(F.ranges.chg) && `Chg % ${rangeText(F.ranges.chg)}`),
    chip('perf', 'Perf %', perf ? `${FIELD_NAMES[perf]} ${rangeText(F.ranges[perf])}` : ''),
    chip('qv', 'Vol in USD', rangeText(F.ranges.qv) && `Vol ${rangeText(F.ranges.qv)}`),
    chip('volchg', 'Vol chg %', rangeText(F.ranges.volchg) && `Vol chg ${rangeText(F.ranges.volchg)}`),
    ...S.extra.map(k => chip(k, FIELD_NAMES[k], rangeText(F.ranges[k]) && `${FIELD_NAMES[k]} ${rangeText(F.ranges[k])}`)),
    F.cond ? chip('cond', 'Condition', F.cond.length > 28 ? F.cond.slice(0, 27) + '…' : F.cond) : '',
    '<button class="sp-chip sp-plus" data-chip="add" title="Add a filter" aria-label="Add a filter">＋</button>',
    '<button class="sp-chip" data-chip="more" title="More" aria-label="More">⋯</button>',
  ];
  return parts.join('');
}

function draw() {
  if (!root || root.hidden) return;
  const { list, total, condError } = visibleRows(), cols = colsOf();
  root.querySelector('.sp-title')!.textContent = titleOf(S.f);
  root.querySelector('.sp-chips')!.innerHTML = chipsHtml();
  root.querySelector('.sp-tabs')!.innerHTML = (['custom', 'overview', 'performance', 'technicals'] as Tab[]).map(t => `<button type="button" data-tab="${t}" class="${t === S.tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('') + '<span class="grow"></span><button type="button" data-a="refresh" title="Reload prices" aria-label="Reload prices">⟳</button>';
  const arrow = (k: string) => (S.sort.key === k ? (S.sort.desc ? ' ↓' : ' ↑') : '');
  const head = `<tr><th data-sort="sym" class="sp-l">Symbol${arrow('sym')}<div class="muted">${total}</div></th>${cols.map(c => `<th data-sort="${c}">${esc(COLS[c].name)}${arrow(c)}${COLS[c].sub ? `<div class="muted">${COLS[c].sub}</div>` : ''}</th>`).join('')}<th class="sp-add">${S.tab === 'custom' ? '<button type="button" data-chip="cols" title="Add or remove columns" aria-label="Columns">＋</button>' : ''}</th></tr>`;
  const body = list.slice(0, shown).map(r => `<tr data-s="${esc(r.sym)}"><td class="sp-l"><b class="sp-sym">${esc(r.base)}${esc(r.quote)}${r.type === 'perpetual' ? '.P' : r.type === 'future' ? '.F' : ''}</b><span class="muted"> ${esc(r.ex)}</span></td>${cols.map(c => `<td>${COLS[c].cell(r)}</td>`).join('')}<td></td></tr>`).join('');
  root.querySelector('.sp-table')!.innerHTML = `<table><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length + 2}" class="muted sp-empty">${loading && !all.length ? 'Loading…' : 'No symbols match these filters.'}</td></tr>`}</tbody></table>`;
  const wait = analyzing && wanted ? ` · analysing ${Math.min(analyzed, wanted)}/${wanted}` : '';
  root.querySelector('.sp-foot')!.innerHTML = esc(`${Math.min(shown, total)} of ${total} shown${wait}${status ? ' · ' + status : ''}${condError ? ' · condition: ' + condError : ''}`) + (isStandalone() ? ' · standalone: only Binance spot (connect a server for other exchanges and perpetuals)' : '');
}

// ---------- pop-overs ----------
function pop(anchor: HTMLElement, html: string, wire: (el: HTMLElement, close: () => void) => void) {
  root!.querySelector('.sp-pop')?.remove();
  const el = document.createElement('div'), r = anchor.getBoundingClientRect();
  el.className = 'sp-pop'; el.innerHTML = html;
  el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 300))}px`; el.style.top = `${r.bottom + 4}px`;
  root!.append(el);
  const close = () => { el.remove(); removeEventListener('pointerdown', out, true); removeEventListener('keydown', key, true) };
  const out = (e: Event) => { if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close() };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } };
  addEventListener('pointerdown', out, true); addEventListener('keydown', key, true);
  wire(el, close);
}
function multi(anchor: HTMLElement, opts: { v: string; l: string }[], current: string[], set: (v: string[]) => void, free = false) {
  let sel = [...current];
  const list = (q: string) => opts.filter(o => !q || o.l.toLowerCase().includes(q.toLowerCase())).slice(0, 300).map(o => `<label class="sp-opt"><input type="checkbox" value="${esc(o.v)}" ${sel.includes(o.v) ? 'checked' : ''}> ${esc(o.l)}</label>`).join('') || '<div class="muted">Nothing found</div>';
  pop(anchor, `<input class="sp-q" placeholder="Search${free ? ' or type and press Enter' : ''}…" aria-label="Search"><div class="sp-opts">${list('')}</div>`, el => {
    const box = el.querySelector<HTMLElement>('.sp-opts')!, q = el.querySelector<HTMLInputElement>('.sp-q')!;
    q.focus(); q.oninput = () => { box.innerHTML = list(q.value) };
    q.onkeydown = e => { if (e.key === 'Enter' && free && q.value.trim()) { const v = q.value.trim().toUpperCase(); if (!sel.includes(v)) sel.push(v); set(sel); q.value = ''; box.innerHTML = list('') } };
    box.onchange = e => { const i = e.target as HTMLInputElement; sel = i.checked ? [...new Set([...sel, i.value])] : sel.filter(x => x !== i.value); set(sel) };
  });
}
function range(anchor: HTMLElement, field: Field, title: string, fields?: Field[]) {
  let f = field;
  const g = () => S.f.ranges[f] ?? {};
  pop(anchor, `${fields ? `<select class="sp-per">${fields.map(k => `<option value="${k}" ${k === f ? 'selected' : ''}>${FIELD_NAMES[k]}</option>`).join('')}</select>` : `<b>${esc(title)}</b>`}<div class="row"><input class="sp-min" type="number" placeholder="Min" value="${g().min ?? ''}"><input class="sp-max" type="number" placeholder="Max" value="${g().max ?? ''}"></div><button type="button" class="sp-clr">Clear</button>`, el => {
    const min = el.querySelector<HTMLInputElement>('.sp-min')!, max = el.querySelector<HTMLInputElement>('.sp-max')!;
    const apply = () => {
      if (fields) for (const k of fields) if (k !== f) delete S.f.ranges[k];   // one period at a time
      const lo = min.value === '' ? undefined : Number(min.value), hi = max.value === '' ? undefined : Number(max.value);
      if (lo === undefined && hi === undefined) delete S.f.ranges[f]; else S.f.ranges[f] = { ...(lo !== undefined && Number.isFinite(lo) ? { min: lo } : {}), ...(hi !== undefined && Number.isFinite(hi) ? { max: hi } : {}) };
      save(); draw();
    };
    let t = 0; const later = () => { clearTimeout(t); t = window.setTimeout(apply, 250) };
    min.oninput = later; max.oninput = later; min.focus();
    el.querySelector<HTMLSelectElement>('.sp-per')?.addEventListener('change', e => { delete S.f.ranges[f]; f = (e.target as HTMLSelectElement).value as Field; min.value = String(g().min ?? ''); max.value = String(g().max ?? ''); apply() });
    el.querySelector<HTMLElement>('.sp-clr')!.onclick = () => { min.value = ''; max.value = ''; apply() };
  });
}
const menu = (anchor: HTMLElement, items: [string, () => void][]) => pop(anchor, items.map(([t], i) => `<button type="button" class="sp-mi" data-i="${i}">${esc(t)}</button>`).join(''), (el, close) => { el.onclick = e => { const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i; if (i !== undefined) { close(); items[+i][1]() } } });

function exchangeOptions() {
  const rank = (id: string) => { const c = CATALOG.find(p => p.id === id)?.category; return c === 'perp' ? 0 : c === 'spot' ? 1 : 2 };
  const list = isStandalone() ? [{ id: 'binance', name: 'binance' }] : [{ id: 'binance', name: 'binance' }, ...exchanges.filter(x => x.id !== 'binance')];
  return list.filter(x => !LOCAL_ONLY.has(x.id) && !UNUSABLE.has(x.id)).sort((a, b) => rank(a.id) - rank(b.id) || exName(a.id).localeCompare(exName(b.id))).map(x => ({ v: x.id, l: exName(x.id) }));
}
const distinct = (f: (r: Row) => string) => { const n = new Map<string, number>(); for (const r of all) n.set(f(r), (n.get(f(r)) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => ({ v, l: v })) };

function onChip(key: string, anchor: HTMLElement) {
  const F = S.f, upd = () => { save(); draw() };
  if (key === 'exchanges') return multi(anchor, exchangeOptions(), F.exchanges, v => { F.exchanges = v; save(); void reload() });
  if (key === 'types') return multi(anchor, (['spot', 'perpetual', 'future'] as SymType[]).map(t => ({ v: t, l: TYPE_NAMES[t] })), F.types, v => { F.types = v as SymType[]; upd() });
  if (key === 'bases') return multi(anchor, distinct(r => r.base), F.bases, v => { F.bases = v; upd() }, true);
  if (key === 'quotes') return multi(anchor, distinct(r => r.quote), F.quotes, v => { F.quotes = v; upd() }, true);
  if (key === 'watch') {
    const lists = host.watchlists();
    return menu(anchor, [['Any symbol', () => { F.watch = null; upd() }], ...lists.map(l => [l.name, () => { F.watch = l.syms; upd() }] as [string, () => void])]);
  }
  if (key === 'perf') return range(anchor, PERF.find(k => rangeText(F.ranges[k])) ?? 'perf1m', 'Perf %', PERF);
  if (key === 'cond') return askCondition();
  if (key === 'cols') return multi(anchor, (Object.keys(COLS) as ColKey[]).map(k => ({ v: k, l: `${COLS[k].name}${COLS[k].sub ? ' ' + COLS[k].sub : ''}` })), S.cols, v => { S.cols = v as ColKey[]; upd() });
  if (key === 'add') {
    const more = (['price', 'rating', 'rsi'] as Field[]).filter(k => !S.extra.includes(k));
    return menu(anchor, [...more.map(k => [FIELD_NAMES[k], () => { S.extra.push(k); save(); draw(); const a = root!.querySelector<HTMLElement>(`[data-chip="${k}"]`); if (a) onChip(k, a) }] as [string, () => void]), ['Condition in words…', askCondition]]);
  }
  if (key === 'more') return menu(anchor, [['Reset filters', () => { S.f = emptyFilters(); S.extra = []; save(); void reload() }], ['Export CSV', exportCsv], ['Classic screener', () => { close(); host.openClassic() }]]);
  range(anchor, key as Field, FIELD_NAMES[key as Field] ?? key);
}
function askCondition() {
  const t = prompt('Condition in plain words, e.g. "RSI below 30 and volume above 1 million" or "price above sma 50"', S.f.cond)?.trim();
  if (t === undefined) return;
  const { error } = safeQuery(t);
  if (error) return void toast(error, 6000);
  S.f.cond = t; save(); draw();
}
function exportCsv() {
  const { list } = visibleRows(), cols = colsOf(), text = (r: Row, c: ColKey) => { const v = valueOf(r, c as Field); return v == null ? '' : String(v) };
  const csv = [['symbol', 'exchange', ...cols.map(c => COLS[c].name + (COLS[c].sub ? ' ' + COLS[c].sub : ''))].join(','), ...list.map(r => [`${r.base}${r.quote}`, r.ex, ...cols.map(c => text(r, c))].join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'screener-pro.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
function close() { if (root) root.hidden = true }

function savePreset(anchor: HTMLElement) {
  const names = Object.keys(presets);
  menu(anchor, [['Save current as…', () => { const n = prompt('Preset name', '')?.trim(); if (!n) return; presets[n] = structuredClone(S); store.set('spPresets', presets); toast(`Preset “${n}” saved`) }],
    ...names.map(n => [`Load “${n}”`, () => { S = { ...structuredClone(presets[n]) }; save(); void reload() }] as [string, () => void]),
    ...names.map(n => [`Delete “${n}”`, () => { delete presets[n]; store.set('spPresets', presets) }] as [string, () => void])]);
}

export function openScreenerPro() {
  S = load(); presets = store.get<Record<string, State>>('spPresets', {});
  if (!root) {
    root = document.createElement('div'); root.id = 'sp'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Screener Pro');
    root.innerHTML = `<div class="sp-top"><button type="button" data-a="menu" class="sp-type">Screener Pro (CEX) ▾</button><span class="grow"></span><button type="button" data-a="close" class="x" title="Close (Esc)" aria-label="Close">×</button></div>
      <div class="sp-head"><b class="sp-title"></b><button type="button" data-a="presets" class="sp-save">Save ▾</button></div>
      <div class="sp-chips"></div><div class="sp-tabs"></div><div class="sp-table"></div><div class="sp-foot muted"></div>`;
    document.body.append(root);
    root.onclick = e => {
      const el = e.target as HTMLElement, b = el.closest<HTMLElement>('button'), tr = el.closest<HTMLElement>('tr[data-s]'), th = el.closest<HTMLElement>('th[data-sort]');
      if (b?.dataset.a === 'close') return close();
      if (b?.dataset.a === 'refresh') return void reload(true);
      if (b?.dataset.a === 'presets') return savePreset(b);
      if (b?.dataset.a === 'menu') return menu(b, [['Screener Pro (CEX)', () => {}], ['Classic screener (Market panel)', () => { close(); host.openClassic() }]]);
      if (b?.dataset.tab) { S.tab = b.dataset.tab as Tab; save(); return draw() }
      if (b?.dataset.clear) { const k = b.dataset.clear; if (k === 'perf') PERF.forEach(p => delete S.f.ranges[p]); else if (k === 'cond') S.f.cond = ''; else if (k === 'watch') S.f.watch = null; else if (k in S.f) ((S.f as unknown as Record<string, unknown>)[k] = []); else delete S.f.ranges[k as Field]; save(); return k === 'exchanges' ? void reload() : draw() }
      if (b?.dataset.chip) return onChip(b.dataset.chip, b);
      if (th && !el.closest('.sp-add')) { const k = th.dataset.sort!; S.sort = { key: k, desc: S.sort.key === k ? !S.sort.desc : k !== 'sym' }; save(); return draw() }
      if (tr) { const s = tr.dataset.s!; close(); host.openSymbol(s) }
    };
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && !root!.querySelector('.sp-pop')) close() });
    root.querySelector<HTMLElement>('.sp-table')!.addEventListener('scroll', e => { const t = e.target as HTMLElement; if (t.scrollTop + t.clientHeight > t.scrollHeight - 200) { shown += 100; draw() } });
    if (!isStandalone()) fetchExchanges().then(l => { exchanges = l }).catch(() => {});
  }
  root.hidden = false; root.focus();
  void reload();
}
export const initScreenerPro = (h: ScreenerProHost) => { host = h };
