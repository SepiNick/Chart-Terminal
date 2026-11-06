import { initWindows, pushCfg, redirectSelect, decorateCells, isPopout, monitorsMenu } from './popout.ts';   // first: a pop-out redirects its storage keys before anything reads them
import { ChartPane, type Alert, type PaneCfg, type Hooks, type ChartType } from './chart.ts';
import { TFS, anyTf, streamTickers, fetchBars, fetchSymbols, serverJson, fetchExchanges, fetchMarkets, isRemote, parseTf, tfLabel, tfSeconds, type Ticker, type RemoteMarket } from './data.ts';
import { INDICATORS } from './indicators.ts';
import { CHART_TYPES } from './charttypes.ts';
import { TOOL_MAP } from './tools/index.ts';
import type { Drawing } from './tools/types.ts';
import { renderLeftToolbar, wireLeftToolbar, renderFloating, drawingMenu, openProps, copyDrawings, pasteDrawings, setTool, setZoomOut, templateFor, type DrawUIHost } from './drawui.ts';
import { loadSettings, DEFAULT_SETTINGS, SETTINGS_TABS, renderSettingsForm, readSettingsInput, type Settings } from './settings.ts';
import { History, Snapshots } from './history.ts';
import { styleFor } from './drawings.ts';
import { sizeOf } from './tools/basic.ts';
import { isExpr, parse } from './symmath.ts';
import { showMenu, type MenuItem } from './menu.ts';
import { openConnections, initConnections } from './connections.ts';
import { exchangeOptions } from './exchangegroups.ts';
import { newAccount, onPrice, type Account, type Order, type OrderType, type Side } from './trading.ts';
import { PaperBroker, fromOrder, toOrder } from './broker/paper.ts';
import { registerBroker, activeBroker, allBrokers, setActiveBroker, onBrokers } from './broker/registry.ts';
import type { Broker, OrderReq } from './broker/types.ts';
import { sizeQty, quoteBalance, type SizeMode } from './sizing.ts';
import { store, $, $$, esc, toast, calcPrec } from './store.ts';
import { initTesterUI } from './testerui.ts';
import { defaultOF, type OFCfg } from './orderflow/layer.ts';
import { hasOrderFlow } from './orderflow/feed.ts';
import { initDom, domSync } from './orderflow/domui.ts';
import { derivsAttach, derivsMenu } from './derivs/layer.ts';   // derivs
import { initLiqPanel } from './derivs/liqpanel.ts';   // derivs
import { ofMenu, replayButton, marketReplayUi } from './orderflow/menu.ts';
import { initJournal, journal, journalBrokers, journalMark, journalSource, journalSync, renderJournal } from './journalui.ts';
import { journalReplayOrder } from './journal/replay.ts';
import { initPineUI, openNewScript, scriptById, compileById, compileNinjaScripts, openInputs, renderPineResults, sourceFor } from './pineui.ts';
import { initPyUI } from './pyui.ts';
import { serverMode, onServer, api } from './sync.ts';
import { isStandalone } from './servers.ts';
import { bundledOrigin } from './standalone.ts';
import { initServerAlerts, serverAlerts, openAlertDialog, renderAlertsPanel, migrateToServer, BUILTIN_PINE, type AlertCtx, type OldAlert } from './alertsui.ts';
import { initSettingsUI } from './settingsui.ts';
import './tooltip.ts';
import { MSG, COLORS, addSymbol, checkBytes, combinedRows, createList, deleteList, duplicateList, exportText, importAsList, importEntries, isSection, migrate, moveBefore, moveSymbol, parseImport, removeSymbol, renameList, reorder, resolveActive, restoreList, setColor, setIcon, sortedIds, symCount } from './watchlists.ts';
import { initAccountsUI, renderAccounts } from './broker/ui.ts';   // accounts
import { chartEvents, initMarket, renderDetails, renderMarket } from './market/ui.ts';
import './market/domhook.ts';
import { APPROX_NOTE, DOM_SYMS, asDomSym, isDomSym, isShare } from './market/dominance.ts';
import { autoAnalyze, clearAuto, higherTf, htfLevels } from './ai/ui.ts';
import { initSkills, renderSkills } from './skills/ui.ts';
import { initAi, refreshAi } from './ai/panel.ts';
import { SHOW_AI } from './flags.ts';
import { registerServiceWorker } from './push.ts';
import { rMultiple } from './journal.ts';
import { initI18n, t as tr } from './i18n.ts';
import { OF_PRESETS } from './orderflow/presets.ts';
import { describePlan, parseExitPlan, resolvePlan, type ExitPlan } from './exits.ts';
import { collectReport, installErrorLog } from './diagnostics.ts';

// ---------- layouts (grid arrangements) ----------
interface Arrangement { n: number; cols: number; rows: number; areas?: string[] }
const ARR: Record<string, Arrangement> = {
  '1': { n: 1, cols: 1, rows: 1 }, '2': { n: 2, cols: 2, rows: 1 }, '2v': { n: 2, cols: 1, rows: 2 },
  '3': { n: 3, cols: 2, rows: 2, areas: ['a b', 'a c'] }, '3h': { n: 3, cols: 3, rows: 1 }, '3v': { n: 3, cols: 1, rows: 3 },
  '1+3': { n: 4, cols: 3, rows: 2, areas: ['a a a', 'b c d'] }, '4': { n: 4, cols: 2, rows: 2 }, '4h': { n: 4, cols: 4, rows: 1 },
  '6': { n: 6, cols: 3, rows: 2 }, '8': { n: 8, cols: 4, rows: 2 }, '9': { n: 9, cols: 3, rows: 3 }, '16': { n: 16, cols: 4, rows: 4 },
};
const LINK_COLORS = ['', '#f23645', '#2962ff', '#089981', '#ff9800', '#9c27b0'];
interface Layout {
  mode: string; panes: (PaneCfg & { link?: string })[]; active: number;
  sync: { symbol: boolean; tf: boolean; crosshair: boolean; time: boolean; replay?: boolean };
  colFr?: number[]; rowFr?: number[];
}
const DEFAULT_LAYOUT: Layout = { mode: '1', panes: [{ symbol: 'BTCUSDT', tf: '1h', type: 'candles', ind: ['ema50', 'rsi'] }], active: 0, sync: { symbol: false, tf: false, crosshair: true, time: false } };

// ---------- state ----------
const st = {
  settings: loadSettings(),
  layout: store.get<Layout>('layout', DEFAULT_LAYOUT),
  tabs: store.get<{ name: string; layout: Layout }[]>('tabs', []),
  tab: store.get<number>('tab', 0),
  layoutName: store.get<string>('layoutName', 'Unnamed'),
  layouts: store.get<Record<string, Layout>>('layouts', {}),
  autosave: store.get<boolean>('autosave', true),
  drawings: store.get<Record<string, Drawing[]>>('drawings', {}),
  alerts: store.get<Alert[]>('alerts', []),
  acct: store.get<Account>('acct', newAccount()),
  side: store.get<string>('side', 'watch'),
  favTfs: store.get<string[]>('favTfs', ['1m', '5m', '15m', '1h', '4h', '1d', '1w']),
  customTfs: store.get<string[]>('customTfs', []),
  recent: store.get<string[]>('recentSymbols', []),
  indTemplates: store.get<Record<string, string[]>>('indTemplates', {}),
  chartTemplates: store.get<Record<string, Partial<PaneCfg> & { settings?: Partial<Settings> }>>('chartTemplates', {}),
  hidden: { indicators: false, positions: false },
  maximized: false,
};
st.layout = { ...DEFAULT_LAYOUT, ...st.layout, sync: { ...DEFAULT_LAYOUT.sync, ...st.layout.sync } };
// Workspace tabs: each tab is its own multi-chart layout; st.layout is always the open tab's.
if (!st.tabs.length) st.tabs = [{ name: '', layout: st.layout }];
st.tab = Math.min(st.tab, st.tabs.length - 1);
st.tabs[st.tab].layout = st.layout;
let panes: ChartPane[] = [];
const lastPx: Record<string, number> = {}, tick24: Record<string, Ticker> = {}, alertLog: string[] = [];
const active = () => panes[st.layout.active] ?? panes[0];
const pxOf = (sym: string) => lastPx[sym] ?? panes.find(p => p.cfg.symbol === sym)?.lastPrice();
const saveAcct = () => { store.set('acct', st.acct); journalSync(st.acct) };
// The paper account as a Broker (phase 6): the ticket, chart lines and panels trade the active broker.
const paper = new PaperBroker({ acct: () => st.acct, save: saveAcct, px: pxOf, now: () => active()?.vb().at(-1)?.time ?? Date.now() / 1000 });
registerBroker(paper);
// The server (forward-test fills) or another device changed the paper account: use it now, so the next local
// order doesn't overwrite those fills with this tab's older copy.
onServer('state', m => {
  if (m.key !== 'acct' || !m.value) return;
  st.acct = m.value as Account;
  journalSync(st.acct); paper.emit();
});
const saveLayout = () => {
  st.layout.panes = panes.map((p, i) => ({ ...p.cfg, link: st.layout.panes[i]?.link }));
  store.set('layout', st.layout);
  st.tabs[st.tab].layout = st.layout; store.set('tabs', st.tabs);
  pushCfg();
  if (st.autosave && st.layoutName !== 'Unnamed') { st.layouts[st.layoutName] = structuredClone(st.layout); store.set('layouts', st.layouts) }
};
const pending = new Set<() => void>();
function later(fn: () => void) { if (!pending.size) setTimeout(() => { const f = [...pending]; pending.clear(); f.forEach(x => x()) }, 250); pending.add(fn) }

// ---------- undo / redo ----------
const history = new History();
const drawSnaps = new Snapshots<string>(history, sym => st.drawings[sym] ?? [], (sym, v) => {
  st.drawings[sym] = v as Drawing[]; store.set('drawings', st.drawings);
  panes.forEach(p => { if (p.cfg.symbol === sym) { p.layer.drawings = st.drawings[sym]; p.layer.select([]); p.layer.update() } });
  renderTree();
});
history.onChange = () => {
  const { undo, redo } = history.peek();
  $<HTMLButtonElement>('#undoBtn').disabled = !history.canUndo; $('#undoBtn').title = `Undo ${undo ?? ''} (Ctrl+Z)`;
  $<HTMLButtonElement>('#redoBtn').disabled = !history.canRedo; $('#redoBtn').title = `Redo ${redo ?? ''} (Ctrl+Y)`;
};
/** Change a pane's config with undo support. */
function applyCfg(p: ChartPane, patch: Partial<PaneCfg>, label = 'chart change') {
  const before = structuredClone(p.cfg);
  p.set(patch);
  const after = structuredClone(p.cfg);
  history.push({ label, undo: () => panes.includes(p) && p.set(before), redo: () => panes.includes(p) && p.set(after) });
}

// ---------- hooks shared by every chart ----------
const hooks: Hooks = {
  settings: () => st.settings,
  drawings: sym => (st.drawings[sym] ??= []),
  alerts: () => (serverMode ? serverLines() : st.alerts),
  broker: () => activeBroker(),
  hidden: () => st.hidden,
  events: chartEvents,
  onPrice: handlePrice,
  onCrosshair(src, time, prm) {
    crossPx = prm.point ? src.main.coordinateToPrice(prm.point.y) : null;
    if (st.layout.sync.crosshair) for (const p of panes) if (p !== src) p.syncCrosshair(time);
    later(renderDataWindow);
  },
  onRange(src) {
    if (!st.layout.sync.time || src !== active() || syncingTime) return;
    const r = src.chart.timeScale().getVisibleRange(); if (!r) return;
    syncingTime = true;
    for (const p of panes) if (p !== src) try { p.chart.timeScale().setVisibleRange(r) } catch {}
    syncingTime = false;
  },
  onReplay(src) {
    // Replay all charts: with time sync or "Replay all charts" on, every chart follows this one's replay clock.
    if (replaySyncing || !(st.layout.sync.replay || st.layout.sync.time)) return;
    replaySyncing = true;
    const t = src.replayTime();
    for (const p of panes) if (p !== src) { if (t != null) p.replayTo(t); else if (p.replay || p.replayPending != null) p.exitReplay() }
    replaySyncing = false;
    syncUI();
  },
  onActivate(p) { const i = panes.indexOf(p); if (i >= 0 && i !== st.layout.active) { st.layout.active = i; saveLayout(); syncUI(); domSync() } },
  onCfgChange() { saveLayout(); syncUI(); connectTickers() },
  setupLayer(p) {
    const l = p.layer;
    l.magnet = st.settings.magnet; l.keepDrawing = st.settings.keepDrawing;
    l.templates = templateFor;
    l.onChange = () => {
      const sym = p.cfg.symbol;
      st.drawings[sym] = l.drawings; store.set('drawings', st.drawings);
      for (const o of panes) if (o !== p && o.cfg.symbol === sym) { o.layer.drawings = l.drawings; o.layer.update() }
      drawSnaps.commit(sym, 'drawing');
      renderTree(); renderFloating(p.cell, drawHost, l);
    };
    l.onSelect = () => { renderFloating(p.cell, drawHost, l); renderTree() };
    l.onToolDone = () => renderLeftToolbar(drawHost);
    l.onEdit = (d, tab) => openProps(d, l, drawHost, tab);
    l.onContext = (d, e) => drawingMenu(e.clientX, e.clientY, d, l, drawHost);
    drawSnaps.seed(p.cfg.symbol);
    if (p === active()) { renderLeftToolbar(drawHost); renderTree() }
    derivsAttach(p);   // derivs: OI / funding / ratio / CVD panes, liquidation overlays
  },
  quickOrder(p, side) {
    const px = pxOf(p.cfg.symbol); if (!px) return;
    const qty = +$<HTMLInputElement>('#tQty').value;
    if (!st.settings.instantOrders && !confirm(`${side.toUpperCase()} ${qty} ${p.cfg.symbol} at market (~${px})? (${brokerLabel()})`)) return;
    submit({ sym: p.cfg.symbol, side, type: 'market', qty }, px, p);
  },
  chartMenu: (p, e, price) => chartMenu(p, e, price),
  script: id => scriptById(id),
  compileMql: id => compileById(id),
  compileNinja: () => compileNinjaScripts(),
  onScripts: p => { if (p === active()) { renderPineResults(p); p.legend(p.disp.at(-1)) } },
  scriptSettings: (p, id) => openInputs(p, id),
};
let syncingTime = false, replaySyncing = false, crossPx: number | null = null;

// ---------- grid ----------
function buildLayout() {
  panes.forEach(p => p.destroy());
  const A = ARR[st.layout.mode] ?? ARR['1'], grid = $('#grid');
  grid.innerHTML = '';
  if (st.layout.colFr?.length !== A.cols) st.layout.colFr = Array(A.cols).fill(1);
  if (st.layout.rowFr?.length !== A.rows) st.layout.rowFr = Array(A.rows).fill(1);
  applyGridTemplate();
  document.body.classList.toggle('multi', A.n > 1);
  panes = Array.from({ length: A.n }, (_, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (A.areas) cell.style.gridArea = 'abcdefghijklmnop'[i];
    grid.append(cell);
    const cfg = st.layout.panes[i] ?? { ...st.layout.panes[0], ind: [...st.layout.panes[0].ind], compare: [] };
    const p = new ChartPane(cell, cfg, hooks);
    const link = document.createElement('button');
    link.className = 'link'; link.title = 'Symbol link group';
    link.onclick = e => { e.stopPropagation(); linkMenu(i, link) };
    cell.append(link);
    p.load();
    return p;
  });
  st.layout.active = Math.min(st.layout.active, A.n - 1);
  renderSplitters(); saveLayout(); syncUI(); connectTickers(); decorateCells();
}
function applyGridTemplate() {
  const A = ARR[st.layout.mode] ?? ARR['1'], grid = $('#grid');
  if (st.maximized) { grid.style.cssText = 'grid-template:1fr/1fr'; return }
  grid.style.gridTemplateColumns = st.layout.colFr!.map(f => `${f}fr`).join(' ');
  grid.style.gridTemplateRows = st.layout.rowFr!.map(f => `${f}fr`).join(' ');
  grid.style.gridTemplateAreas = A.areas ? A.areas.map(a => `"${a}"`).join(' ') : '';
}
/** Draggable splitters between grid columns/rows; they adjust fr weights. */
function renderSplitters() {
  $$('.split').forEach(s => s.remove());
  if (st.maximized) return;
  const grid = $('#grid');
  const mk = (axis: 'col' | 'row', i: number) => {
    const s = document.createElement('div');
    s.className = `split ${axis}`;
    const fr = axis === 'col' ? st.layout.colFr! : st.layout.rowFr!, total = fr.reduce((a, b) => a + b, 0);
    const pos = fr.slice(0, i + 1).reduce((a, b) => a + b, 0) / total * 100;
    s.style[axis === 'col' ? 'left' : 'top'] = `calc(${pos}% - 3px)`;
    s.onmousedown = e => {
      e.preventDefault();
      const rect = grid.getBoundingClientRect(), size = axis === 'col' ? rect.width : rect.height, start = axis === 'col' ? e.clientX : e.clientY;
      const a0 = fr[i], b0 = fr[i + 1];
      const move = (m: MouseEvent) => {
        const d = ((axis === 'col' ? m.clientX : m.clientY) - start) / size * total;
        fr[i] = Math.max(0.15, a0 + d); fr[i + 1] = Math.max(0.15, b0 - d);
        applyGridTemplate(); renderSplitters();
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveLayout() };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    };
    grid.append(s);
  };
  st.layout.colFr!.slice(0, -1).forEach((_, i) => mk('col', i));
  st.layout.rowFr!.slice(0, -1).forEach((_, i) => mk('row', i));
}
function toggleMaximize() {
  st.maximized = !st.maximized;
  panes.forEach((p, i) => (p.cell.style.display = st.maximized && i !== st.layout.active ? 'none' : ''));
  applyGridTemplate(); renderSplitters();
}
function linkMenu(i: number, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  showMenu(r.left, r.bottom, LINK_COLORS.map(c => ({
    label: c ? 'Link group' : 'No link', icon: c ? '●' : '○', checked: (st.layout.panes[i]?.link ?? '') === c,
    action: () => { st.layout.panes[i] = { ...panes[i].cfg, link: c }; store.set('layout', st.layout); syncUI() },
  })));
  // color the bullet glyphs
  $$('.ctx .ci').forEach((x, k) => { if (LINK_COLORS[k]) x.style.color = LINK_COLORS[k] });
}
/** Panes affected by a symbol/interval change: sync-all, or the active pane's colour link group. */
function targets(kind: 'symbol' | 'tf'): ChartPane[] {
  if (st.layout.sync[kind]) return panes;
  const link = st.layout.panes[st.layout.active]?.link;
  return kind === 'symbol' && link ? panes.filter((_, i) => st.layout.panes[i]?.link === link) : [active()];
}

// ---------- prices, alerts, paper fills ----------
function handlePrice(sym: string, px: number, ts: number) {
  const prev = lastPx[sym];
  lastPx[sym] = px;
  journalMark(sym, px);
  if (isPopout) { later(renderTrading); return }   // the main window runs alerts and paper fills; pop-outs only show
  if (prev != null && !serverMode) for (const a of st.alerts) {
    if (!a.on || a.sym !== sym) continue;
    const level = a.drawingId != null ? drawingPrice(a) : a.price;
    if (level == null) continue;
    if ((a.dir === 'up' && prev < level && px >= level) || (a.dir === 'down' && prev > level && px <= level)) fireAlert(a, px, level);
  }
  const levels = () => st.acct.orders.map(o => o.sym === sym ? `${o.price}${o.triggered ?? ''}` : '').join();
  const before = levels(), fills = onPrice(st.acct, sym, px, ts);
  if (fills.length) {
    saveAcct();
    fills.forEach(f => toast(`Filled ${f.orderType} ${f.side} ${f.qty} ${f.sym} @ ${f.px.toFixed(calcPrec(f.px))}`, 5000));
    paper.emit();
  } else if (levels() !== before) {   // a trailing stop moved or a stop-limit triggered: redraw now, save at most every 2 s
    paper.emit();
    trailSave ||= window.setTimeout(() => { trailSave = 0; saveAcct() }, 2000);
  }
  if (fills.length || st.acct.pos[sym]) later(renderTrading);
}
/** Current price level of a drawing-based alert (trend lines extend through time). */
function drawingPrice(a: Alert): number | null {
  const p = panes.find(x => x.cfg.symbol === a.sym); if (!p) return null;
  const d = (st.drawings[a.sym] ?? []).find(x => x.id === a.drawingId); if (!d) return null;
  return TOOL_MAP.get(d.type)?.priceAt?.(d, Date.now() / 1000, p.layer.geo()) ?? null;
}
let unsubTickers = () => {}, tickKey = '', trailSave = 0;
function connectTickers() {
  const syms = [...new Set([...watchSyms(), ...panes.flatMap(p => isExpr(p.cfg.symbol) ? [] : [p.cfg.symbol]), ...(serverMode ? [] : st.alerts.filter(a => a.on).map(a => a.sym)), ...Object.keys(st.acct.pos), ...st.acct.orders.map(o => o.sym)])];
  const key = syms.filter(x => !isRemote(x)).join();   // remote symbols get prices from their candle feed
  if (key === tickKey) return;
  tickKey = key; unsubTickers();
  unsubTickers = streamTickers(syms.filter(x => !isRemote(x)), (s, t) => {
    tick24[s] = t;
    if (!panes.some(p => p.cfg.symbol === s)) handlePrice(s, t.c, Date.now() / 1000);
    later(renderWatch);
  });
}
function beep() {
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    g.gain.value = st.settings.alertVolume; o.frequency.value = 880; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.3);
  } catch {}
}
/** Server alerts as chart price lines: price levels and horizontal-line drawings. */
function serverLines(): Alert[] {
  const out: Alert[] = [];
  for (const a of serverAlerts()) {
    const line = (price: number | undefined) => { if (price != null && Number.isFinite(price)) out.push({ id: out.length, sym: a.sym, price, dir: 'up', on: a.active }) };
    if (a.source.kind === 'price' && a.condition && !a.condition.startsWith('moving')) { line(a.value); line(a.value2) }
    if (a.source.kind === 'drawing') for (const l of [a.source.line, a.source.line2]) if (l?.type === 'hline') line(l.price);
  }
  return out;
}
/** What the active chart offers to the alert dialog: drawings, indicator plots and scripts (Pine, MQL, NinjaScript). */
function alertCtx(): AlertCtx {
  const p = active(), sym = p.cfg.symbol, bars = p.vb(), drawings = st.drawings[sym] ?? [];
  const plots: AlertCtx['plots'] = [], scripts: AlertCtx['scripts'] = [];
  for (const e of p.ind) {
    const src = BUILTIN_PINE[e.key]; if (!src) continue;
    const out = Object.entries(e.calc(bars)), many = out.length > 1;
    out.forEach(([k, v], i) => plots.push({ label: many ? `${e.name} · ${k}` : e.name, name: `${sym} ${e.name}${many ? ' ' + k : ''}`, script: src, plot: i, last: v.at(-1) ?? undefined }));
  }
  for (const r of p.scriptRuns) {
    const sc = scriptById(r.id), ref = p.cfg.scripts?.find(x => x.id === r.id);
    if (!sc || !r.out || r.error) continue;
    const inputs = ref?.inputs ?? {}, src = (sc.lang ?? 'pine') === 'pine' ? undefined : sourceFor(r.id, p.prec) ?? undefined;
    if ((sc.lang ?? 'pine') !== 'pine' && !src) continue;
    const code = src ? { code: src } : {};
    r.out.plots.forEach((pl, i) => { if (pl.kind === 'line') plots.push({ label: `${r.name} · ${pl.title || 'Plot ' + (i + 1)}`, name: `${sym} ${r.name}`, script: sc.src, ...code, inputs, plot: i, last: Number.isFinite(pl.values.at(-1)) ? pl.values.at(-1) : undefined }) });
    scripts.push({ id: r.id, name: r.name, src: sc.src, ...code, inputs, conds: r.out.alertconditions.map(c => ({ title: c.title, message: c.message })), strategy: r.out.meta.kind === 'strategy' || !!r.tester });
  }
  const drawingName = (d: Drawing) => {
    const def = TOOL_MAP.get(d.type), n = d.name ?? def?.name ?? d.type;
    if (d.type === 'hline' || d.type === 'hray') return `${n} ${d.pts[0].p.toFixed(p.prec)}`;
    return `${n} ${drawings.filter(x => x.type === d.type).indexOf(d) + 1}`;
  };
  return { sym, tf: p.cfg.tf, price: crossPx ?? p.lastPrice() ?? null, prec: p.prec, drawings, plots, scripts, drawingName };
}
function addAlert(a: Omit<Alert, 'id' | 'on' | 'dir'> & { dir?: Alert['dir'] }) {
  if (serverMode) return openAlertDialog({ value: a.price });
  const last = pxOf(a.sym);
  if (!(a.price > 0) || last == null) return toast('Invalid alert price');
  st.alerts.push({ ...a, id: Date.now(), on: true, dir: a.dir ?? (a.price >= last ? 'up' : 'down') });
  store.set('alerts', st.alerts);
  try { if (Notification.permission === 'default') Notification.requestPermission() } catch {}
  panes.forEach(p => p.tradeOverlay()); connectTickers(); renderAlerts();
  toast(`Alert: ${a.sym} ${a.note ?? 'crossing'} ${a.price >= last ? '↑' : '↓'} ${a.price}`);
}
function fireAlert(a: Alert, px: number, level: number) {
  a.on = false; store.set('alerts', st.alerts);
  const msg = `${a.sym} crossed ${a.note ? a.note + ' ' : ''}${a.dir} ${level.toFixed(calcPrec(level))} (now ${px})`;
  alertLog.unshift(`${new Date().toLocaleTimeString()} · ${msg}`);
  toast('⏰ ' + msg, st.settings.autoHideToasts ? 20000 : 120000); beep();
  try { if (Notification.permission === 'granted') new Notification('Price alert', { body: msg }) } catch {}
  panes.forEach(p => p.tradeOverlay()); renderAlerts();
}

// ---------- drawing UI host ----------
const drawHost: DrawUIHost = {
  layer: () => active()?.layer,
  layers: () => panes.map(p => p.layer),
  tf: () => active().cfg.tf,
  magnet: () => st.settings.magnet,
  setMagnet(m) { st.settings.magnet = m; store.set('settings', st.settings); panes.forEach(p => (p.layer.magnet = m)) },
  keepDrawing: () => st.settings.keepDrawing,
  setKeepDrawing(on) { st.settings.keepDrawing = on; store.set('settings', st.settings); panes.forEach(p => (p.layer.keepDrawing = on)) },
  hide(what) {
    if (what === 'drawings' || what === 'all') { const on = !active().layer.hideAll; panes.forEach(p => { p.layer.hideAll = on; p.layer.update() }) }
    if (what === 'indicators' || what === 'all') { st.hidden.indicators = !st.hidden.indicators; panes.forEach(p => p.setIndicatorsVisible(!st.hidden.indicators)) }
    if (what === 'positions' || what === 'all') { st.hidden.positions = !st.hidden.positions; panes.forEach(p => p.tradeOverlay()) }
    renderLeftToolbar(drawHost);
  },
  remove(what) {
    const p = active();
    if ((what === 'drawings' || what === 'all') && p.layer.drawings.length && confirm(`Remove ${p.layer.drawings.length} drawings on ${p.cfg.symbol}?`)) { p.layer.drawings = []; p.layer.select([]); p.layer.onChange(); p.layer.update() }
    if (what === 'indicators' || what === 'all') applyCfg(p, { ind: [] }, 'remove indicators');
  },
  commit: () => active().layer.onChange(),
  alertOn(d) {
    if (serverMode) return openAlertDialog({ drawingId: d.id });
    const p = active(), def = TOOL_MAP.get(d.type), price = def?.priceAt?.(d, Date.now() / 1000, p.layer.geo());
    if (price == null) return toast('This drawing has no price level right now');
    addAlert({ sym: p.cfg.symbol, price, drawingId: d.id, note: def!.name });
  },
  paneLabels: () => active().paneLabels(),
  positionOrder(d) {
    const p = active(), sym = p.cfg.symbol, last = pxOf(sym);
    if (!last) return toast('No price yet');
    if (isExpr(sym)) return toast('Spread symbols cannot be traded');
    if (p.replay) return toast('Exit Replay to place paper orders');
    const z = sizeOf(d), long = d.type === 'long', entry = +d.pts[0].p.toFixed(p.prec), side: Side = long ? 'buy' : 'sell';
    const step = Number(d.style.lotStep) > 0 ? Number(d.style.lotStep) : 10 ** -Number(d.style.qtyPrec ?? 4), qty = +(Math.floor(z.qty / step + 1e-9) * step).toFixed(8);
    if (!(qty > 0)) return toast('Position size is 0: check account size, risk and stop');
    // Entry within 0.05% of the market goes at market; otherwise a resting limit (better price) or stop (worse price).
    const type: OrderType = Math.abs(entry - last) / last < 5e-4 ? 'market' : (long === entry < last) ? 'limit' : 'stop';
    const tp = +d.pts[1].p.toFixed(p.prec), sl = +d.pts[2].p.toFixed(p.prec);
    const lev = Number(d.style.leverage) > 1 ? ` · ${d.style.leverage}x margin ${z.margin.toFixed(2)}` : '';
    if (!st.settings.instantOrders && !confirm(`${side.toUpperCase()} ${type} ${qty} ${sym}${type === 'market' ? '' : ' @ ' + entry} · TP ${tp} · SL ${sl}${lev} (${brokerLabel()})?`)) return;
    submit({ sym, side, type, qty, price: type === 'market' ? undefined : entry, tp, sl }, last, p);
  },
};
setZoomOut(() => { const ts = active().chart.timeScale(), r = ts.getVisibleLogicalRange(); if (r) { const w = r.to - r.from; ts.setVisibleLogicalRange({ from: r.from - w / 2, to: r.to + w / 2 }) } });
wireLeftToolbar(drawHost);

// ---------- top bar ----------
function setSymbol(raw: string) {
  const s = asDomSym(raw) ?? raw.trim().toUpperCase().replace(/\s+/g, '');   // BTC.D → CRYPTOCAP:BTC.D
  try { if (isExpr(s)) parse(s); else if (!/^([A-Z0-9]+:)?[A-Z0-9_.\u0600-\u06FF]{2,40}$/.test(s)) throw Error('Invalid symbol') } catch (e) { return toast((e as Error).message) }
  if (redirectSelect(s)) return;   // a panel pop-out: the main window changes the symbol
  st.recent = [s, ...st.recent.filter(x => x !== s)].slice(0, 12); store.set('recentSymbols', st.recent);
  // Dominance is a ratio: a line is the natural first view (candles stay available from the chart type menu).
  targets('symbol').forEach(p => applyCfg(p, { symbol: s, ...(isDomSym(s) && isShare(s) && p.cfg.type === 'candles' ? { type: 'line' as const } : {}) }, 'symbol change'));
  const link = st.layout.panes[st.layout.active]?.link;
  if (link && !st.layout.sync.symbol) linkChannel?.postMessage({ link, symbol: s });
}
// Colour link groups across windows (desktop "New window", or two browser tabs of this app): a symbol picked in a
// group also changes the charts of that group in the other windows.
// var: setSymbol can run before this line (startup); it then just doesn't broadcast.
var linkChannel = 'BroadcastChannel' in window ? new BroadcastChannel('ct-link') : null;   // eslint-disable-line no-var
linkChannel?.addEventListener('message', e => {
  const { link, symbol } = (e.data ?? {}) as { link?: unknown; symbol?: unknown };
  if (typeof link !== 'string' || typeof symbol !== 'string' || !/^([A-Z0-9]+:)?[A-Z0-9_.\u0600-\u06FF]{2,40}$/.test(symbol)) return;
  panes.forEach((p, i) => { if (st.layout.panes[i]?.link === link && p.cfg.symbol !== symbol) applyCfg(p, { symbol }, 'symbol change') });
});
function setTf(tf: string) { targets('tf').forEach(p => applyCfg(p, { tf }, 'interval change')) }
function syncUI() {
  const p = active(); if (!p) return;
  panes.forEach((x, i) => {
    x.cell.classList.toggle('active', i === st.layout.active);
    const link = st.layout.panes[i]?.link ?? '', b = x.cell.querySelector<HTMLElement>('.link');
    if (b) { b.style.background = link || 'transparent'; b.style.borderColor = link || 'var(--muted)' }
  });
  $('#symBtn').textContent = p.cfg.symbol;
  const tfs = [...new Set([...st.favTfs, p.cfg.tf])].sort((a, b) => tfSeconds(a) - tfSeconds(b));
  $('#tfs').innerHTML = tfs.filter(anyTf).map(t => `<button data-tf="${esc(t)}" class="${t === p.cfg.tf ? 'on' : ''}">${esc(t)}</button>`).join('');
  $('#typeBtn').textContent = CHART_TYPES.find(t => t.id === p.cfg.type)?.name ?? p.cfg.type;
  $('#layoutBtn').textContent = `⊞ ${st.layout.mode}`;
  $('#layoutName').textContent = st.layoutName;
  const mr = marketReplayUi(p);   // orderflow: a Market Replay uses the same bar
  $('#replayBar').classList.toggle('open', !!p.replay || !!mr);
  $('#replayBtn').classList.toggle('on', !!p.replay || !!mr);
  $('#rpPlay').textContent = (mr ? mr.playing : p.replay?.timer) ? '⏸' : '▶';
  const rpAll = $<HTMLInputElement>('#rpAll'); rpAll.checked = !!(st.layout.sync.replay || st.layout.sync.time); rpAll.disabled = st.layout.sync.time;
  $('#tSym').textContent = p.cfg.symbol;
  $('#pctBtn').classList.toggle('on', st.settings.scaleMode === 'percent');
  $('#logBtn').classList.toggle('on', st.settings.scaleMode === 'log');
  renderLeftToolbar(drawHost); renderTree(); renderTicket(); renderTrading(); renderWatch(); renderDataWindow();
  panes.forEach(x => x.layer && renderFloating(x.cell, drawHost, x.layer));
}
$('#symBtn').onclick = () => openSearch('');
$('#cmpBtn').onclick = () => openSearch('', 'compare');
$('#tfs').onclick = e => { const tf = (e.target as HTMLElement).dataset.tf; if (tf) setTf(tf) };
$('#tfMore').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect(), cur = active().cfg.tf;
  const all = [...new Set([...TFS, ...st.customTfs])].sort((a, b) => tfSeconds(a) - tfSeconds(b));
  const m = showMenu(r.left, r.bottom + 2, [
    ...all.map(t => ({ label: tfLabel(t), hint: t, checked: t === cur, action: () => setTf(t) })),
    { sep: true },
    { label: 'Add custom interval…', action: () => { const t = parseTf(prompt('Interval, e.g. 45m, 3h, 2d, 2w — or from trades: 100T ticks, R10 range, REV5 reversal ticks, D500 delta') ?? ''); if (t) { st.customTfs = [...new Set([...st.customTfs, t])]; store.set('customTfs', st.customTfs); setTf(t) } else toast('Invalid interval') } },
  ]);
  $$('.ctx-i', m).slice(0, all.length).forEach((row, i) => {
    const star = document.createElement('span'), t = all[i];
    star.className = 'star' + (st.favTfs.includes(t) ? ' on' : ''); star.textContent = '★'; star.title = 'Favorite (show in toolbar)';
    star.onclick = ev => { ev.stopPropagation(); st.favTfs = st.favTfs.includes(t) ? st.favTfs.filter(x => x !== t) : [...st.favTfs, t]; store.set('favTfs', st.favTfs); star.classList.toggle('on'); syncUI() };
    row.append(star);
  });
};
$('#typeBtn').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect(), cur = active().cfg.type;
  showMenu(r.left, r.bottom + 2, [
    ...CHART_TYPES.filter(t => t.group === 'time').map(t => ({ label: t.name, checked: t.id === cur, action: () => applyCfg(active(), { type: t.id as ChartType }, 'chart type') })),
    { sep: true },
    ...CHART_TYPES.filter(t => t.group === 'price').map(t => ({ label: t.name, checked: t.id === cur, action: () => applyCfg(active(), { type: t.id as ChartType }, 'chart type') })),
  ]);
};
$('#indBtn').onclick = e => indicatorsMenu(e.target as HTMLElement);
function indicatorsMenu(el: HTMLElement) {
  const r = el.getBoundingClientRect(), cur = active().cfg.ind;
  const toggle = (k: string) => () => applyCfg(active(), { ind: active().cfg.ind.includes(k) ? active().cfg.ind.filter(x => x !== k) : [...active().cfg.ind, k] }, 'indicators');
  showMenu(r.left, r.bottom + 2, [
    { label: 'Overlays', disabled: true },
    ...Object.entries(INDICATORS).filter(([, d]) => !d.pane).map(([k, d]) => ({ label: d.name, checked: cur.includes(k), action: toggle(k) })),
    { sep: true }, { label: 'Oscillators', disabled: true },
    ...Object.entries(INDICATORS).filter(([, d]) => d.pane).map(([k, d]) => ({ label: d.name, checked: cur.includes(k), action: toggle(k) })),
    ...derivsMenu(active().cfg, d => applyCfg(active(), { derivs: d } as never, 'derivatives')),   // derivs
  ]);
}
$('#tplBtn').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect(), p = active();
  const items: MenuItem[] = [
    { label: 'Save indicator template…', action: () => { const n = prompt('Template name'); if (n) { st.indTemplates[n] = [...p.cfg.ind]; store.set('indTemplates', st.indTemplates) } } },
    ...Object.entries(st.indTemplates).map(([n, ind]) => ({ label: `ƒx ${n}`, action: () => applyCfg(p, { ind: [...ind] }, 'indicator template') })),
    { sep: true },
    { label: 'Save chart template…', action: () => {
      const n = prompt('Chart template name'); if (!n) return;
      const withSym = confirm('Include symbol and interval?');
      st.chartTemplates[n] = { type: p.cfg.type, ind: [...p.cfg.ind], settings: { upColor: st.settings.upColor, downColor: st.settings.downColor, bgColor: st.settings.bgColor, vertGrid: st.settings.vertGrid, horzGrid: st.settings.horzGrid }, ...(withSym ? { symbol: p.cfg.symbol, tf: p.cfg.tf } : {}) };
      store.set('chartTemplates', st.chartTemplates);
    } },
    ...Object.entries(st.chartTemplates).map(([n, t]) => ({ label: `▤ ${n}`, action: () => { const { settings, ...cfg } = t; if (settings) applySettings(settings); applyCfg(p, cfg, 'chart template') } })),
  ];
  showMenu(r.left, r.bottom + 2, items);
};
$('#alertBtn').onclick = () => { if (serverMode) return openAlertDialog(); const p = active(), px = p.lastPrice(); if (px) { const v = prompt(`Alert price for ${p.cfg.symbol}`, (px * 1.01).toFixed(p.prec)); if (v) addAlert({ sym: p.cfg.symbol, price: +v }) } };
$('#undoBtn').onclick = () => history.undo();
$('#redoBtn').onclick = () => history.redo();
$('#layoutBtn').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect();
  showMenu(r.left, r.bottom + 2, Object.entries(ARR).map(([k, a]) => ({ label: `${k} — ${a.n} chart${a.n > 1 ? 's' : ''}`, checked: k === st.layout.mode, action: () => { st.layout.mode = k; st.layout.colFr = st.layout.rowFr = undefined; st.maximized = false; buildLayout() } })));
};
$('#syncBtn').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect(), s = st.layout.sync;
  const t = (k: keyof Layout['sync']) => () => { s[k] = !s[k]; saveLayout() };
  showMenu(r.left, r.bottom + 2, [
    { label: 'Symbol', checked: s.symbol, action: t('symbol') }, { label: 'Interval', checked: s.tf, action: t('tf') },
    { label: 'Crosshair', checked: s.crosshair, action: t('crosshair') }, { label: 'Time / date range', checked: s.time, action: t('time') },
    { label: 'Replay (all charts)', checked: !!s.replay, action: () => { s.replay = !s.replay; saveLayout(); syncUI() } },
    { sep: true }, { label: 'Link groups: use the dot in each chart’s corner', disabled: true },
  ]);
};
$('#fullBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
$('#shotBtn').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect(), p = active(), canvas = () => p.chart.takeScreenshot();
  showMenu(r.left, r.bottom + 2, [
    { label: 'Download image', hint: 'Ctrl+Alt+S', action: () => downloadShot(canvas(), p) },
    { label: 'Copy image', hint: 'Ctrl+Shift+S', action: () => copyShot(canvas()) },
    ...(serverMode ? [{ label: 'Copy link to image', action: () => shareShot(canvas()) }] : []),
    { label: 'Export chart data (CSV)', action: () => p.exportCsv() },
  ]);
};
function downloadShot(c: HTMLCanvasElement, p: ChartPane) { const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `${p.cfg.symbol}_${p.cfg.tf}_${new Date().toISOString().slice(0, 16)}.png`; a.click() }
/** Copy a link to text; falls back to a prompt where the clipboard is blocked (plain http on the LAN). */
const copyLink = (url: string, what: string) => navigator.clipboard.writeText(url).then(() => toast(`${what} link copied`), () => { prompt(`${what} link`, url) });
/** Upload the image to the server and copy its public /s/… link. */
function shareShot(c: HTMLCanvasElement) {
  c.toBlob(async b => {
    if (!b) return;
    try { const r = await api<{ url: string }>('/api/share/snapshot', { body: b }); copyLink(location.origin + r.url, 'Image') }
    catch (e) { toast((e as Error).message) }
  }, 'image/png');
}
function copyShot(c: HTMLCanvasElement) { c.toBlob(b => b && navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(() => toast('Chart image copied'), () => toast('Clipboard not available'))) }
initI18n();
installErrorLog();
$('#diagRun').onclick = async () => {
  const out = $<HTMLTextAreaElement>('#diagOut'), stat = $('#diagSt'), copy = $('#diagCopy'), run = $<HTMLButtonElement>('#diagRun');
  stat.textContent = 'Checking…'; run.disabled = true;
  try { out.value = await collectReport({ charts: panes.length, theme: st.settings.theme, lang: document.documentElement.lang }); out.hidden = false; copy.hidden = false; stat.textContent = '' }
  catch (e) { stat.textContent = (e as Error).message }
  run.disabled = false;
};
$('#diagCopy').onclick = async () => { const out = $<HTMLTextAreaElement>('#diagOut'); try { await navigator.clipboard.writeText(out.value); toast('Report copied') } catch { out.select(); toast('Press Ctrl+C to copy') } };
$('#themeBtn').onclick = () => applySettings({ theme: st.settings.theme === 'dark' ? 'light' : 'dark', bgColor: '', gridColor: '', scaleTextColor: '', separatorColor: '' });

// ---------- replay ----------
$('#replayBtn').onclick = () => { const p = active(); if (replayButton(p, 'exit', panes)) return syncUI(); if (p.replay) p.exitReplay(); else p.startReplay(); syncUI() };
$('#ofBtn').onclick = e => {
  const p = active(), of = { ...defaultOF(), ...p.cfg.of }, r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const set = (patch: Partial<OFCfg>, label = 'order flow') => applyCfg(p, { of: { ...of, ...patch } }, label);
  if (!hasOrderFlow(p.cfg.symbol) || isExpr(p.cfg.symbol)) return toast('Order flow needs a crypto symbol (Binance or an exchange via the data server)');
  const num = (q: string, cur: number) => { const v = prompt(q, String(cur)); return v == null || v.trim() === '' || !Number.isFinite(+v) || +v < 0 ? null : +v };
  showMenu(r.left, r.bottom + 2, [
    { label: 'Quick start', hint: 'ready-made views', sub: OF_PRESETS.map(q => ({ label: q.label, hint: q.hint.split('. ')[0], action: () => set(q.cfg, `order flow: ${q.id}`) })) },
    { sep: true },
    { label: 'Footprint', sub: (['off', 'bidask', 'delta', 'volume'] as const).map(m => ({ label: { off: 'Off', bidask: 'Bid × Ask', delta: 'Delta', volume: 'Volume profile per bar' }[m], checked: of.footprint === m, action: () => set({ footprint: m }) })) },
    { label: 'Liquidity heatmap (order book history)', checked: of.heatmap, action: () => set({ heatmap: !of.heatmap }) },
    { label: 'Big trades (bubbles)', checked: of.bubbles, action: () => set({ bubbles: !of.bubbles }) },
    { label: 'Cumulative delta (CVD) pane', checked: of.cvd, action: () => set({ cvd: !of.cvd }) },
    { label: 'Delta per bar pane', checked: of.delta, action: () => set({ delta: !of.delta }) },
    { sep: true },
    { label: 'Row size…', hint: of.row ? String(of.row) : 'auto', action: () => { const v = num('Price per footprint row (0 = automatic)', of.row); if (v != null) set({ row: v }) } },
    { label: 'Imbalance ratio', hint: `${of.ratio}×`, sub: [1.5, 2, 2.5, 3, 4, 5].map(x => ({ label: `${x}×`, checked: of.ratio === x, action: () => set({ ratio: x }) })) },
    { label: 'Big trade size…', hint: of.bigMin ? `≥ ${of.bigMin.toLocaleString()}` : 'auto', action: () => { const v = num('Minimum trade value (quote currency, e.g. USDT). 0 = automatic (top 0.5%)', of.bigMin); if (v != null) set({ bigMin: v }) } },
    { label: 'Load older trades', disabled: !p.of?.fp || p.of.firstId == null, action: () => p.of?.loadMore() },
    ...ofMenu(p, of, set, num, () => panes),
    { sep: true },
    { label: 'DOM / Level 2 panel', icon: '≣', action: () => { if (st.side !== 'dom') showSide('dom') } },
  ]);
};
$('#rpSelect').onclick = () => { active().startReplay(); syncUI() };
$('#rpDate').onchange = e => { const v = (e.target as HTMLInputElement).value; if (v) active().startReplayAt(new Date(v).getTime() / 1000) };
$('#rpRandom').onclick = () => active().replayRandom();
$('#rpFirst').onclick = () => active().replayFirst();
$('#rpBack').onclick = () => { if (!replayButton(active(), 'back', panes)) active().stepBack() };
$('#rpStep').onclick = () => { if (!replayButton(active(), 'step', panes)) active().stepReplay() };
const togglePlay = () => { const p = active(); if (replayButton(p, 'play', panes)) return syncUI(); if (p.replay?.timer) p.pauseReplay(); else p.playReplay(+$<HTMLSelectElement>('#rpSpeed').value); syncUI() };
$('#rpPlay').onclick = togglePlay;
$('#rpSpeed').onchange = () => { const p = active(); if (replayButton(p, 'speed', panes, +$<HTMLSelectElement>('#rpSpeed').value)) return; if (p.replay?.timer) p.playReplay(+$<HTMLSelectElement>('#rpSpeed').value) };
$('#rpExit').onclick = () => { if (!replayButton(active(), 'exit', panes)) active().exitReplay(); syncUI() };
$('#rpAll').onchange = e => {
  const on = (e.target as HTMLInputElement).checked;
  st.layout.sync.replay = on;
  saveLayout(); if (on && active().replay) hooks.onReplay!(active());
};

// ---------- bottom toolbar ----------
const RANGES: [string, string, number | 'ytd' | 'all'][] = [['1D', '1m', 86400], ['5D', '5m', 5 * 86400], ['1M', '30m', 30 * 86400], ['3M', '1h', 90 * 86400], ['6M', '2h', 182 * 86400], ['YTD', '1d', 'ytd'], ['1Y', '1d', 365 * 86400], ['5Y', '1w', 5 * 365 * 86400], ['All', '1M', 'all']];
$('#ranges').innerHTML = RANGES.map(([n]) => `<button data-r="${n}">${n}</button>`).join('');
$('#ranges').onclick = async e => {
  const r = RANGES.find(x => x[0] === (e.target as HTMLElement).dataset.r); if (!r) return;
  const p = active(), now = Date.now() / 1000;
  const from = r[2] === 'all' ? 0 : r[2] === 'ytd' ? Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 : now - r[2];
  if (p.cfg.tf !== r[1]) { applyCfg(p, { tf: r[1] }, 'date range'); await new Promise(res => setTimeout(res, 1200)) }
  if (r[2] === 'all') p.chart.timeScale().fitContent(); else p.showSince(from);
};
$('#gotoBtn').onclick = () => openGoto();
function openGoto() { $<HTMLDialogElement>('#gotoDlg').showModal() }
$<HTMLFormElement>('#gotoForm').addEventListener('submit', e => {
  if ((e.submitter as HTMLButtonElement)?.value !== 'go') return;
  const v = $<HTMLInputElement>('#gotoIn').value; if (v) active().goTo(new Date(v).getTime() / 1000);
});
const setScale = (mode: Settings['scaleMode']) => applySettings({ scaleMode: st.settings.scaleMode === mode ? 'normal' : mode });
$('#pctBtn').onclick = () => setScale('percent');
$('#logBtn').onclick = () => setScale('log');
$('#autoBtn').onclick = () => panes.forEach(p => p.main.priceScale().setAutoScale(true));
setInterval(() => {
  try { $('#clock').textContent = `${new Date().toLocaleTimeString('en-GB', { timeZone: st.settings.tz, hour12: st.settings.hour12 })} (${st.settings.tz})` } catch {}
}, 1000);

// ---------- chart context menu ----------
function chartMenu(p: ChartPane, e: MouseEvent, price: number | null) {
  const px = price != null ? +price.toFixed(p.prec) : null, last = p.lastPrice() ?? 0;
  showMenu(e.clientX, e.clientY, [
    { label: 'Reset chart view', hint: 'Alt+R', action: () => p.resetView() },
    { label: 'Auto analysis', icon: '✨', sub: [
      { label: 'Trend lines, levels and patterns', action: () => autoAnalyze(p) },
      { label: `Add ${higherTf(p.cfg.tf)} support / resistance`, action: () => void htfLevels(p) },
      { label: 'Clear auto analysis', action: () => clearAuto(p) },
    ] },
    ...(px != null ? [
      { label: `Copy price ${px}`, action: () => navigator.clipboard.writeText(String(px)).catch(() => {}) },
      { label: `Add alert at ${px}`, icon: '⏰', action: () => addAlert({ sym: p.cfg.symbol, price: px }) },
      { label: `${px < last ? 'Buy limit' : 'Buy stop'} ${p.cfg.symbol} @ ${px}`, action: () => submit({ sym: p.cfg.symbol, side: 'buy', type: px < last ? 'limit' : 'stop', qty: +$<HTMLInputElement>('#tQty').value, price: px }, last, p) },
      { label: `${px > last ? 'Sell limit' : 'Sell stop'} ${p.cfg.symbol} @ ${px}`, action: () => submit({ sym: p.cfg.symbol, side: 'sell', type: px > last ? 'limit' : 'stop', qty: +$<HTMLInputElement>('#tQty').value, price: px }, last, p) },
      { label: `Draw horizontal line at ${px}`, action: () => { const def = TOOL_MAP.get('hline')!; p.layer.add({ id: Date.now(), type: 'hline', pts: [{ t: p.disp.at(-1)?.time ?? 0, p: px }], style: { ...(templateFor('hline') ?? {}), ...styleOf(def.id, p.layer.color) } }) } },
    ] : []),
    { sep: true },
    { label: 'Add to watchlist', hint: 'Alt+W', action: () => addWatch(p.cfg.symbol) },
    { label: 'Indicators…', hint: '/', action: () => indicatorsMenu($('#indBtn')) },
    { label: 'Compare symbol…', action: () => openSearch('', 'compare') },
    ...((p.cfg.compare?.length ?? 0) ? [{ label: 'Remove compared symbols', action: () => applyCfg(p, { compare: [] }, 'compare') }] : []),
    { sep: true },
    { label: drawHost.layer().hideAll ? 'Show drawings' : 'Hide drawings', hint: 'Ctrl+Alt+H', action: () => drawHost.hide('drawings') },
    { label: 'Remove drawings', action: () => drawHost.remove('drawings') },
    { label: 'Remove indicators', action: () => drawHost.remove('indicators') },
    { sep: true },
    { label: 'Settings…', icon: '⚙', action: () => openSettings() },
  ]);
}
const styleOf = (type: string, color: string) => styleFor(TOOL_MAP.get(type)!, color, templateFor(type));

// ---------- symbol search ----------
let allSymbols: string[] = [];
fetchSymbols().then(s => (allSymbols = s.sort())).catch(() => {});
// Search tabs of the Iranian sources: Tehran bourse instrument kinds, tgju groups, Nobitex quote currencies.
const IR_TABS: Record<string, string[]> = { tse: ['all', 'stock', 'etf', 'bond', 'right', 'futures', 'option', 'commodity', 'index'], tgju: ['all', 'currency', 'gold', 'coin'], nobitex: ['all', 'IRT', 'USDT'], cryptocap: ['all', 'share', 'cap'], oanda: ['all', 'forex', 'metal', 'cfd'], alpaca: ['all', 'stock'] };
let searchMode: 'symbol' | 'compare' = 'symbol', searchQuote = 'USDT', searchEx = store.get<string>('searchEx', 'binance');
const marketCache = new Map<string, RemoteMarket[]>();
let exchangesLoaded = false;
async function loadExchanges() {
  if (exchangesLoaded) return;
  try {
    const ex = await fetchExchanges();
    exchangesLoaded = true;
    $('#searchEx').innerHTML = exchangeOptions(ex);
    $<HTMLSelectElement>('#searchEx').value = searchEx;
  } catch (e) { if (isStandalone()) searchEx = 'binance'; else if (searchEx !== 'binance') toast((e as Error).message, 6000) }
}
function openSearch(initial: string, mode: 'symbol' | 'compare' = 'symbol') {
  searchMode = mode;
  $('#searchMode').textContent = mode === 'compare' ? '· compare / add' : '';
  const i = $<HTMLInputElement>('#searchIn'); i.value = initial;
  $<HTMLSelectElement>('#searchEx').value = searchEx;
  $<HTMLDialogElement>('#searchDlg').showModal(); i.focus();
  loadExchanges();
  renderSearch();
}
async function renderSearch() {
  const q = $<HTMLInputElement>('#searchIn').value.trim().toUpperCase();
  const row = (sym: string, desc: string, i: number) => `<div class="sl${i === 0 ? ' sel' : ''}" data-s="${esc(sym)}"><b>${esc(sym)}</b><span class="muted">${esc(desc)}</span></div>`;
  if (searchEx !== 'binance') {
    const tabs = IR_TABS[searchEx] ?? (searchEx === 'fx' ? ['all', 'forex', 'metal', 'energy', 'index', 'commodity', 'stock', 'crypto'] : ['all', 'spot', 'swap', 'future']);
    if (!tabs.includes(searchQuote)) searchQuote = 'all';
    $('#searchTabs').innerHTML = tabs.map(x => `<button type="button" data-q="${x}" class="${x === searchQuote ? 'on' : ''}">${x === 'swap' ? 'perpetual' : x}</button>`).join('');
    let ms = marketCache.get(searchEx);
    if (!ms) {
      $('#searchList').innerHTML = '<div class="muted sl-h">Loading markets…</div>';
      try { ms = await fetchMarkets(searchEx); marketCache.set(searchEx, ms) }
      catch (e) { $('#searchList').innerHTML = `<div class="dn sl-h">${esc((e as Error).message)}</div>`; return }
    }
    const EX = searchEx.toUpperCase(), qq = (searchEx === 'tse' ? q.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, '_') : q).replace('/', '_');
    const list = ms.filter(m => (searchQuote === 'all' || m.type === searchQuote || m.quote === searchQuote) && (!q || m.sym.includes(qq) || (m.name ?? '').toUpperCase().includes(q)))
      .sort((a, b) => (a.sym.startsWith(qq) ? 0 : 1) - (b.sym.startsWith(qq) ? 0 : 1) || a.sym.length - b.sym.length).slice(0, 100);
    // FX also accepts any stock ticker typed in.
    const extra = searchEx === 'fx' && q && /^[A-Z0-9.]{1,12}$/.test(q) && !list.some(m => m.sym === q) ? row(`FX:${q}`, 'Stock or other Yahoo ticker', list.length ? 1 : 0) : '';
    // Tehran bourse: any ticker can be typed even when the market list could not be loaded.
    const tseExtra = searchEx === 'tse' && qq && /^[\u0600-\u06FFA-Z0-9_.]{1,40}$/.test(qq) && !list.some(m => m.sym === qq) ? row(`TSE:${qq}`, 'Ticker as listed on TSETMC', list.length ? 1 : 0) : '';
    // Nobitex: the Tether premium over the free-market dollar is a symbol expression (daily bars).
    const premium = searchEx === 'nobitex' && (!q || 'PREMIUM'.includes(q) || 'TETHER'.includes(q) || 'USDT'.includes(q)) ? row('NOBITEX:USDTIRT/TGJU:USD-1', 'Tether premium over the free-market dollar · expression · use 1D', list.length ? 1 : 0) : '';
    const desc = (m: RemoteMarket) => (searchEx === 'cryptocap' ? domDesc(m.sym) : `${m.name ?? `${m.base} / ${m.quote}`} · ${m.type} · ${searchEx}`);
    $('#searchList').innerHTML = (list.map((m, i) => row(`${EX}:${m.sym}`, desc(m), i)).join('') + extra + tseExtra + premium) || '<div class="muted sl-h">No matches</div>';
    return;
  }
  const quotes = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'TRY', 'EUR'];
  if (!quotes.includes(searchQuote)) searchQuote = 'USDT';
  $('#searchTabs').innerHTML = quotes.map(x => `<button type="button" data-q="${x}" class="${x === searchQuote ? 'on' : ''}">${x}</button>`).join('');
  let list: string[];
  if (!q) list = st.recent.length ? st.recent : allSymbols.filter(s => s.endsWith(searchQuote)).slice(0, 60);
  else if (isExpr(q) || q.includes(':')) list = [q];
  else list = allSymbols.filter(s => s.includes(q) && (q.length > 3 || s.endsWith(searchQuote))).sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 80);
  const desc = (s: string) => {
    if (isExpr(s)) return 'Spread';
    if (s.includes(':')) return s.split(':')[0].toLowerCase();
    const qu = quotes.find(x => s.endsWith(x)) ?? '';
    return `${s.slice(0, s.length - qu.length)} / ${qu} · Binance · spot`;
  };
  // Dominance and total market cap are searchable from here too (also in standalone mode, which has no market list).
  const dom = q && !q.includes(':') && !isExpr(q) ? DOM_SYMS.filter(d => d.sym.includes(q) || d.name.toUpperCase().includes(q)) : [];
  const domHtml = dom.length ? `<div class="muted sl-h">${esc(tr('Crypto market'))}</div>` + dom.map((d, i) => row(`CRYPTOCAP:${d.sym}`, domDesc(d.sym), i)).join('') : '';
  $('#searchList').innerHTML = (!q && st.recent.length ? '<div class="muted sl-h">Recent</div>' : '') + domHtml + list.map((s, i) => row(s, desc(s), i + dom.length)).join('');
}
/** "Bitcoin dominance · approximation from price × current supply" in the interface language. */
const domDesc = (sym: string) => `${tr(DOM_SYMS.find(d => d.sym === sym)?.name ?? sym)} · ${tr(APPROX_NOTE)}`;
function pickSymbol(s: string) {
  $<HTMLDialogElement>('#searchDlg').close();
  if (searchMode === 'compare') { const p = active(); if (!isExpr(s)) applyCfg(p, { compare: [...new Set([...(p.cfg.compare ?? []), s])] }, 'compare') }
  else setSymbol(s);
}
$('#searchIn').oninput = () => { renderSearch() };
$('#searchEx').onchange = e => { searchEx = (e.target as HTMLSelectElement).value; store.set('searchEx', searchEx); searchQuote = ''; renderSearch() };
$('#searchIn').onkeydown = e => {
  const rows = $$('#searchList .sl'), i = rows.findIndex(r => r.classList.contains('sel'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); rows.forEach((r, k) => r.classList.toggle('sel', k === j)); rows[j]?.scrollIntoView({ block: 'nearest' }) }
  if (e.key === 'Enter') { e.preventDefault(); const s = rows[i]?.dataset.s ?? $<HTMLInputElement>('#searchIn').value; if (s) pickSymbol(s) }
};
$('#searchList').onclick = e => { const s = (e.target as HTMLElement).closest<HTMLElement>('[data-s]')?.dataset.s; if (s) pickSymbol(s) };
$('#searchTabs').onclick = e => { const q = (e.target as HTMLElement).dataset.q; if (q) { searchQuote = q; renderSearch() } };

// ---------- interval dialog (type a number on the chart) ----------
function openTfDialog(first: string) {
  const i = $<HTMLInputElement>('#tfIn'); i.value = first;
  $<HTMLDialogElement>('#tfDlg').showModal(); i.focus();
  i.setSelectionRange(1, 1); tfHint();
}
const tfHint = () => { const t = parseTf($<HTMLInputElement>('#tfIn').value); $('#tfHint').textContent = t ? tfLabel(t) : 'Not a valid interval' };
$('#tfIn').oninput = tfHint;
$<HTMLFormElement>('#tfForm').addEventListener('submit', () => { const t = parseTf($<HTMLInputElement>('#tfIn').value); if (t) setTf(t) });

// ---------- workspace tabs ----------
function renderWsTabs() {
  const bar = $('#tabs');
  bar.innerHTML = st.tabs.map((t, i) => {
    const sym = t.layout.panes[t.layout.active]?.symbol ?? t.layout.panes[0].symbol, px = lastPx[sym];
    const label = t.name && !/^Tab \d+$/.test(t.name) ? t.name : sym;
    return `<span class="tab${i === st.tab ? ' on' : ''}" data-i="${i}" title="Double-click to rename">${esc(label)}${px != null ? `<span class="px">${px}</span>` : ''}${st.tabs.length > 1 ? '<b class="x" data-x="1" title="Close tab">×</b>' : ''}</span>`;
  }).join('') + '<button type="button" id="tabAdd" title="New tab">+</button>';
}
setInterval(renderWsTabs, 3000);
function openWsTab(i: number) {
  if (i === st.tab || !st.tabs[i]) return;
  saveLayout();
  st.tab = i; store.set('tab', i);
  st.layout = st.tabs[i].layout; st.layoutName = 'Unnamed'; store.set('layoutName', 'Unnamed'); // so autosave can't overwrite a named layout
  st.maximized = false; buildLayout(); renderWsTabs();
}
$('#tabs').onclick = e => {
  const el = e.target as HTMLElement;
  if (el.id === 'tabAdd') {
    saveLayout();
    const l = structuredClone(DEFAULT_LAYOUT); l.panes[0].symbol = active().cfg.symbol;
    st.tabs.push({ name: '', layout: l });
    st.tab = st.tabs.length - 1; store.set('tab', st.tab);
    st.layout = l; st.layoutName = 'Unnamed'; st.maximized = false; buildLayout(); renderWsTabs(); return;
  }
  const t = el.closest<HTMLElement>('.tab'); if (!t) return;
  const i = +t.dataset.i!;
  if (!el.dataset.x) return openWsTab(i);
  if (!confirm('Close this tab?')) return;
  st.tabs.splice(i, 1);
  const next = Math.min(i < st.tab ? st.tab - 1 : st.tab, st.tabs.length - 1);
  st.tab = next; store.set('tab', next);
  st.layout = st.tabs[next].layout; st.layoutName = 'Unnamed'; st.maximized = false; buildLayout(); renderWsTabs();
};
$('#tabs').ondblclick = e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('.tab'); if (!t) return;
  const i = +t.dataset.i!, n = prompt('Tab name (empty = symbol)', st.tabs[i].name)?.trim();
  if (n != null) { st.tabs[i].name = n; store.set('tabs', st.tabs); renderWsTabs() }
};
renderWsTabs();

// ---------- layout manager ----------
function renderLayouts() {
  $<HTMLInputElement>('#lyAuto').checked = st.autosave;
  $('#lyT').innerHTML = '<tr><th>Layout</th><th>Charts</th><th>Symbols</th><th></th></tr>' + (Object.entries(st.layouts).map(([n, l]) =>
    `<tr class="click${n === st.layoutName ? ' sel' : ''}" data-n="${esc(n)}"><td><b>${esc(n)}</b></td><td>${esc(l.mode)}</td><td class="muted">${esc([...new Set(l.panes.map(p => p.symbol))].join(', '))}</td>
     <td><button type="button" class="x" data-a="rename">✎</button><button type="button" class="x" data-a="copy">⧉</button><button type="button" class="x" data-a="del">×</button></td></tr>`).join('') || '<tr><td class="muted" colspan="4">No saved layouts yet</td></tr>');
}
function saveAs(name: string) { st.layoutName = name; store.set('layoutName', name); st.layouts[name] = structuredClone(st.layout); store.set('layouts', st.layouts); renderLayouts(); syncUI(); toast(`Layout “${name}” saved`) }
function loadLayout(name: string) {
  const l = st.layouts[name]; if (!l) return;
  st.layout = structuredClone({ ...DEFAULT_LAYOUT, ...l }); st.layoutName = name; store.set('layoutName', name);
  st.maximized = false; buildLayout();
}
$('#layoutsBtn').onclick = () => { renderLayouts(); $<HTMLDialogElement>('#layoutsDlg').showModal() };
$('#lySave').onclick = () => (st.layoutName === 'Unnamed' ? $('#lySaveAs').click() : saveAs(st.layoutName));
$('#lySaveAs').onclick = () => { const n = prompt('Layout name', st.layoutName === 'Unnamed' ? '' : st.layoutName + ' copy')?.trim(); if (n) saveAs(n) };
$('#lyNew').onclick = () => { st.layout = structuredClone(DEFAULT_LAYOUT); st.layoutName = 'Unnamed'; store.set('layoutName', 'Unnamed'); buildLayout(); renderLayouts() };
$('#lyAuto').onchange = e => { st.autosave = (e.target as HTMLInputElement).checked; store.set('autosave', st.autosave) };
const layoutFile = () => {
  const syms = new Set(st.layout.panes.map(p => p.symbol));
  return { name: st.layoutName, layout: st.layout, drawings: Object.fromEntries([...syms].map(s => [s, st.drawings[s] ?? []])) };
};
$('#lyExport').onclick = () => {
  const blob = new Blob([JSON.stringify(layoutFile(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${st.layoutName}.layout.json`; a.click();
};
/** Add a layout file (export, or a share link) as a new saved layout and open it. */
function importLayout(j: { name?: string; layout?: Layout; drawings?: Record<string, Drawing[]> }, suffix: string) {
  if (!j.layout?.panes) throw Error('Not a layout file');
  for (const [s, d] of Object.entries(j.drawings ?? {})) st.drawings[s] = [...(st.drawings[s] ?? []), ...d];
  store.set('drawings', st.drawings);
  const n = `${j.name ?? 'Imported'} (${suffix})`; st.layouts[n] = j.layout; store.set('layouts', st.layouts); loadLayout(n); renderLayouts();
}
$('#lyImport').onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  try { importLayout(JSON.parse(await f.text()), 'imported') } catch (err) { toast((err as Error).message) }
};
$('#lyShare').onclick = async () => {
  try { const r = await api<{ url: string }>('/api/share/layout', { body: layoutFile() }); copyLink(location.origin + r.url, 'Layout') }
  catch (e) { toast((e as Error).message) }
};
$('#lyShare').hidden = !serverMode;
$('#lyT').onclick = e => {
  const el = e.target as HTMLElement, n = el.closest<HTMLElement>('[data-n]')?.dataset.n; if (!n) return;
  if (el.dataset.a === 'del') { if (confirm(`Delete layout “${n}”? This can’t be undone.`)) { delete st.layouts[n]; store.set('layouts', st.layouts); if (st.layoutName === n) { st.layoutName = 'Unnamed'; store.set('layoutName', 'Unnamed'); syncUI() } renderLayouts() } return }
  if (el.dataset.a === 'rename') { const m = prompt('New name', n)?.trim(); if (m && m !== n) { st.layouts[m] = st.layouts[n]; delete st.layouts[n]; if (st.layoutName === n) { st.layoutName = m; store.set('layoutName', m) } store.set('layouts', st.layouts); renderLayouts(); syncUI() } return }
  if (el.dataset.a === 'copy') { st.layouts[`${n} copy`] = structuredClone(st.layouts[n]); store.set('layouts', st.layouts); renderLayouts(); return }
  loadLayout(n); renderLayouts();
};

// ---------- side panel ----------
function showSide(name: string) {
  st.side = st.side === name ? '' : name; store.set('side', st.side);
  $$('#rail [data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === st.side));
  $$('.side').forEach(s => s.classList.toggle('on', s.id === 's-' + st.side));
  $('#body').classList.toggle('no-panel', !st.side);
  if (st.side === 'screener') renderMarket();
  if (st.side === 'journal') renderJournal();
  if (st.side === 'accts') renderAccounts();   // accounts
  if (st.side === 'skills') renderSkills();
  if (SHOW_AI && st.side === 'ai') void refreshAi();
  domSync();
}
$('#rail').onclick = e => { const s = (e.target as HTMLElement).dataset.side; if (s) showSide(s) };
$('#keysBtn').onclick = () => openKeys();

// ---------- watchlists ----------
// Many named lists (src/watchlists.ts holds the pure logic). Synced key `watchLists`; the active list and the combined view
// are device-local (`watchActive`, `watchView`). A list holds symbols plus '###Name' section rows (TradingView's export
// format) and its own colour flags. The old single list (`watch`, `watchFlags`) becomes the list 'Default' at start-up.
let lists = migrate(store.get<unknown>('watchLists', undefined), store.get<unknown>('watch', undefined), store.get<unknown>('watchFlags', undefined));
let watchActive = resolveActive(lists, store.get<string | null>('watchActive', null));
const watchView = store.get<{ multi: boolean; ids: string[] }>('watchView', { multi: false, ids: [] });
const FLAGS = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#2196f3', '#9c27b0', '#00bcd4'], FLAG_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Cyan'];
const watchCols = store.get('watchCols', { chg: false, flag: true });
let watchDetail = store.get<string | null>('watchDetail', null);
let importAsNew = false;
const curList = () => lists[watchActive];
const multiIds = () => (watchView.multi ? (watchView.ids.filter(i => lists[i]).length ? watchView.ids.filter(i => lists[i]) : sortedIds(lists)) : []);
interface WItem { s: string; lists: string[]; i: number }
const watchItems = (): WItem[] => (watchView.multi ? combinedRows(lists, multiIds()).map((r, i) => ({ s: r.sym, lists: r.lists, i })) : curList().syms.map((s, i) => ({ s, lists: [watchActive], i })));
const watchSyms = () => [...new Set(watchItems().filter(x => !isSection(x.s)).map(x => x.s))];
function saveLists() {
  if (!checkBytes(lists).ok) toast(MSG.big, 5000);
  store.set('watchLists', lists); connectTickers(); renderWatch();
}
function selectList(id: string) {
  if (!lists[id]) return;
  watchActive = id; watchView.multi = false; store.set('watchActive', id); store.set('watchView', watchView); renderWatch();
}
/** Shows a toast with an Undo button. */
function undoToast(msg: string, undo: () => void) {
  const d = document.createElement('div'), b = document.createElement('button');
  d.textContent = msg + ' '; b.textContent = 'Undo'; b.onclick = () => { undo(); d.remove() };
  d.append(b); $('#toast').append(d); setTimeout(() => d.remove(), 8000);
}
const dot = (c: string) => `<span class="wldot" style="background:${esc(c)}"></span>`;
function addWatch(s: string, id = watchActive) {
  if (isExpr(s)) return;
  const r = addSymbol(lists, id, s);
  if (!r.ok) return void toast(r.msg);
  saveLists(); toast(`${s} added to ${lists[id].name}`);
}
function newList(name?: string | null, entries: string[] = []) {
  const n = name ?? prompt('Watchlist name')?.trim(); if (!n) return;
  const r = importAsList(lists, n, entries, isExpr);
  if (!r.ok) return void toast(r.msg);
  selectList(r.id!); saveLists();
  if (r.skipped) toast(`${r.added} symbols imported, ${r.skipped} skipped: ${r.msg}`, 6000);
}
function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function listMenu(id: string): MenuItem[] {
  const l = lists[id], ids = sortedIds(lists), at = ids.indexOf(id);
  return [
    { label: 'Rename list…', action: () => { const n = prompt('Watchlist name', l.name)?.trim(); if (n) { const r = renameList(lists, id, n); r.ok ? saveLists() : toast(r.msg) } } },
    { label: 'List colour', sub: COLORS.map(c => ({ label: c, iconHtml: dot(c), checked: l.color === c, action: () => { setColor(lists, id, c); saveLists() } })) },
    { label: 'List icon', sub: [...['⭐', '🔥', '💎', '📈', '📉', '🪙', '🏦', '🌍', '🧪', '💤'].map(e => ({ label: e, checked: l.icon === e, action: () => { setIcon(lists, id, e); saveLists() } })),
      { label: 'Custom…', action: () => { const e = prompt('Emoji or short symbol', l.icon ?? ''); if (e !== null) { setIcon(lists, id, e); saveLists() } } }, { label: 'No icon', action: () => { setIcon(lists, id, ''); saveLists() } }] },
    { label: 'Duplicate list', action: () => { const r = duplicateList(lists, id, '(copy)'); if (r.ok) { selectList(r.id!); saveLists() } else toast(r.msg) } },
    { label: 'Move left', disabled: at <= 0, action: () => { moveBefore(lists, id, ids[at - 1]); saveLists() } },
    { label: 'Move right', disabled: at >= ids.length - 1, action: () => { moveBefore(lists, id, ids[at + 2]); saveLists() } },
    { label: 'Export as text file', action: () => download(`${l.name.replace(/[^\w\- ]+/g, '_')}.txt`, exportText(l)) },
    { label: 'Delete list…', action: () => {
      if (symCount(l) > 0 && !confirm(`Delete the watchlist "${l.name}" with ${symCount(l)} symbols?`)) return;
      const r = deleteList(lists, id); if (!r.ok) return void toast(r.msg);
      const keep = r.removed!, order = ids;
      if (watchActive === id) selectList(resolveActive(lists)); saveLists();
      undoToast(`Deleted "${keep.name}".`, () => { restoreList(lists, id, keep); reorder(lists, order); saveLists() });
    } },
  ];
}
/** Symbol menu: move / copy to another list, remove. `from` = the lists that hold the symbol in the current view. */
function symMenu(x: number, y: number, sym: string, from: string[]) {
  const src = from[0], others = sortedIds(lists).filter(i => i !== src);
  const target = (copy: boolean): MenuItem[] => [...others.map(i => ({ label: lists[i].name, iconHtml: dot(lists[i].color), action: () => { const r = moveSymbol(lists, src, i, sym, copy); r.ok ? (saveLists(), toast(`${sym} ${copy ? 'copied' : 'moved'} to ${lists[i].name}`)) : toast(r.msg) } })),
    { label: 'New list…', action: () => { const n = prompt('Watchlist name')?.trim(); if (!n) return; const c = createList(lists, n); if (!c.ok) return void toast(c.msg); moveSymbol(lists, src, c.id!, sym, copy); saveLists() } }];
  showMenu(x, y, [{ head: sym }, { label: 'Move to list', sub: target(false) }, { label: 'Copy to list', sub: target(true) }, { sep: true },
    ...from.map(i => ({ label: from.length > 1 ? `Remove from ${lists[i].name}` : 'Remove', action: () => { removeSymbol(lists, i, sym); saveLists() } }))]);
}
function renderTabs() {
  const ids = sortedIds(lists), multi = watchView.multi;
  $('#wlTabs').innerHTML = ids.map(id => {
    const l = lists[id], on = !multi && id === watchActive;
    return `<button role="tab" class="wltab${on ? ' on' : ''}" aria-selected="${on}" tabindex="${on ? 0 : -1}" draggable="true" data-wl="${esc(id)}" title="${esc(l.name)} · ${symCount(l)}">${dot(l.color)}${l.icon ? esc(l.icon) : ''}<span>${esc(l.name)}</span></button>`;
  }).join('') + `<button role="tab" class="wltab${multi ? ' on' : ''}" aria-selected="${multi}" tabindex="-1" data-wlall title="Show several lists at once">⊞</button><button class="wltab" data-wlnew title="New watchlist" aria-label="New watchlist">＋</button>`;
}
function renderWatch() {
  renderTabs();
  const items = watchItems(), multi = watchView.multi, cols = 3 + (watchCols.chg ? 1 : 0);
  $('#watchT').innerHTML = `<tr><th>Symbol</th><th>Last</th>${watchCols.chg ? '<th>Chg</th>' : ''}<th>Chg%</th><th></th></tr>` + items.map(({ s, lists: own, i }) => {
    if (isSection(s)) return `<tr class="wsec" data-i="${i}"><td colspan="${cols}"><b>${esc(s.slice(3))}</b></td><td><button class="x" data-ren="${i}" title="Rename section">✎</button><button class="x" data-rm="${esc(s)}" title="Remove section (symbols stay)">×</button></td></tr>`;
    const t = tick24[s] ?? (lastPx[s] ? { c: lastPx[s], o: NaN } : undefined), ch = t && Number.isFinite(t.o) ? ((t.c - t.o) / t.o) * 100 : null;
    const [ex, name] = s.includes(':') ? s.split(':') : ['', s], flag = lists[own[0]]?.flags[s];
    const dots = multi ? `<span class="wldots" title="${esc(own.map(o => lists[o].name).join(', '))}">${own.map(o => `<i style="background:${esc(lists[o].color)}"></i>`).join('')}</span>` : '';
    return `<tr class="click${s === active()?.cfg.symbol ? ' sel' : ''}" draggable="true" data-sym="${esc(s)}" data-from="${esc(own[0])}"><td>${dots}${watchCols.flag ? `<span class="wflag" data-flag="${esc(s)}" title="Flag colour" style="${flag ? `background:${esc(flag)}` : ''}"></span>` : ''}<b>${esc(name.replace(/_?USDT(\.P)?$/, '$1').replace(/_/g, '/'))}</b><span class="muted">${/_?USDT/.test(name) ? 'USDT' : ''}${ex ? ' · ' + esc(ex) : ''}</span></td>
      <td>${t ? t.c.toFixed(calcPrec(t.c)) : '–'}</td>${watchCols.chg ? `<td class="${(ch ?? 0) >= 0 ? 'up' : 'dn'}">${t && ch != null ? (t.c - t.o).toFixed(calcPrec(t.c)) : '–'}</td>` : ''}<td class="${(ch ?? 0) >= 0 ? 'up' : 'dn'}">${ch == null ? '–' : ch.toFixed(2) + '%'}</td>
      <td><button class="x" data-det="${esc(s)}" title="Details: technical rating, seasonals, news">ⓘ</button><button class="x" data-mv="${esc(s)}" title="Move, copy or remove" aria-label="Move, copy or remove ${esc(s)}">⇄</button>${multi ? '' : `<button class="x" data-rm="${esc(s)}" title="Remove">×</button>`}</td></tr>`;
  }).join('');
  const d = $('#watchDet');
  if (!watchDetail || !items.some(x => x.s === watchDetail)) { d.hidden = true; d.dataset.sym = ''; return }
  d.hidden = false;
  if (d.dataset.sym !== watchDetail) { d.dataset.sym = watchDetail; void renderDetails(d, watchDetail) }
}
$<HTMLInputElement>('#watchImport').onchange = async e => {
  const inp = e.target as HTMLInputElement, f = inp.files?.[0]; inp.value = ''; if (!f) return;
  const entries = parseImport(await f.text()), asNew = importAsNew; importAsNew = false;
  if (!entries.some(s => !isSection(s))) return toast('No symbols found in that file');
  if (asNew) return newList(f.name.replace(/\.[^.]+$/, '') || 'Imported', entries);
  const r = importEntries(lists, watchActive, entries, isExpr);
  if (!r.added) return toast(r.msg ?? 'No new symbols in that file');
  saveLists(); toast(`${r.added} symbols imported${r.skipped ? `, ${r.skipped} skipped: ${r.msg}` : ''}`, r.skipped ? 6000 : 3000);
};
$('#watchAdd').onclick = () => addWatch(active().cfg.symbol);
$('#watchMenu').onclick = e => {
  const r = (e.target as HTMLElement).getBoundingClientRect();
  showMenu(r.left, r.bottom, [
    { label: 'Add section…', action: () => { const n = prompt('Section name')?.trim(); if (n) { curList().syms.push('###' + n); saveLists() } } },
    { label: 'Change column', checked: watchCols.chg, action: () => { watchCols.chg = !watchCols.chg; store.set('watchCols', watchCols); renderWatch() } },
    { label: 'Flag column', checked: watchCols.flag, action: () => { watchCols.flag = !watchCols.flag; store.set('watchCols', watchCols); renderWatch() } },
    { label: 'Sort by flag colour', action: () => { const l = curList(); l.syms = sortByFlag(l.syms, l.flags); saveLists() } },
    { sep: true }, { head: curList().name }, ...listMenu(watchActive),
    { sep: true }, { label: 'New list…', action: () => newList() }, { label: 'Import as new list…', action: () => { importAsNew = true; $<HTMLInputElement>('#watchImport').click() } },
  ]);
};
/** Sorts symbols by flag inside each section; sections keep their place. */
function sortByFlag(list: string[], flags: Record<string, string>) {
  const out: string[] = [], rank = (s: string) => (flags[s] ? FLAGS.indexOf(flags[s]) : FLAGS.length);
  let run: string[] = [];
  const flush = () => { out.push(...run.sort((a, b) => rank(a) - rank(b))); run = [] };
  for (const s of list) { if (isSection(s)) { flush(); out.push(s) } else run.push(s) }
  flush();
  return out;
}
$('#watchT').onclick = e => {
  const el = e.target as HTMLElement, rm = el.dataset.rm;
  if (rm) { const l = curList(); l.syms = l.syms.filter(s => s !== rm); delete l.flags[rm]; saveLists(); return }
  if (el.dataset.ren) { const l = curList(), i = +el.dataset.ren, n = prompt('Section name', l.syms[i].slice(3))?.trim(); if (n) { l.syms[i] = '###' + n; saveLists() } return }
  if (el.dataset.det) { watchDetail = watchDetail === el.dataset.det ? null : el.dataset.det; store.set('watchDetail', watchDetail); renderWatch(); return }
  const row = el.closest<HTMLElement>('[data-sym]');
  if (el.dataset.mv && row) { const r = el.getBoundingClientRect(), it = watchItems().find(x => x.s === row.dataset.sym); symMenu(r.left, r.bottom, el.dataset.mv, it?.lists ?? [watchActive]); return }
  if (el.dataset.flag) {
    const s = el.dataset.flag, r = el.getBoundingClientRect(), l = lists[row?.dataset.from ?? watchActive];
    showMenu(r.left, r.bottom, [...FLAGS.map((c, k) => ({ label: FLAG_NAMES[k], iconHtml: `<span class="wflag" style="background:${c}"></span>`, checked: l.flags[s] === c, action: () => { l.flags[s] = c; saveLists() } })), { label: 'No flag', action: () => { delete l.flags[s]; saveLists() } }]);
    return;
  }
  if (row?.dataset.sym) setSymbol(row.dataset.sym);
};
$('#watchT').oncontextmenu = e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]'); if (!row || isSection(row.dataset.sym!)) return;
  e.preventDefault(); symMenu(e.clientX, e.clientY, row.dataset.sym!, watchItems().find(x => x.s === row.dataset.sym)?.lists ?? [watchActive]);
};
// tabs: select, create, combined view, rename on double-click, context menu, drag to reorder, keyboard
$('#wlTabs').onclick = e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.wltab'); if (!el) return;
  if (el.dataset.wl) return selectList(el.dataset.wl);
  if (el.dataset.wlnew !== undefined) return newList();
  const r = el.getBoundingClientRect(), all = sortedIds(lists), cur = multiIds();
  const set = (ids: string[]) => { watchView.multi = ids.length > 0; watchView.ids = ids; store.set('watchView', watchView); renderWatch(); connectTickers() };
  showMenu(r.left, r.bottom, [{ label: 'All lists', checked: watchView.multi && cur.length === all.length, action: () => set(all) },
    ...all.map(id => ({ label: lists[id].name, iconHtml: dot(lists[id].color), checked: watchView.multi && cur.includes(id), action: () => { const n = watchView.multi ? (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]) : [id]; set(n) } })),
    { sep: true }, { label: 'Single list', disabled: !watchView.multi, action: () => set([]) }]);
};
$('#wlTabs').ondblclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-wl]')?.dataset.wl; if (id) { const n = prompt('Watchlist name', lists[id].name)?.trim(); if (n) { const r = renameList(lists, id, n); r.ok ? saveLists() : toast(r.msg) } } };
$('#wlTabs').oncontextmenu = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-wl]')?.dataset.wl; if (id) { e.preventDefault(); showMenu(e.clientX, e.clientY, listMenu(id)) } };
$('#wlTabs').onkeydown = e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tabs = $$<HTMLElement>('.wltab[role=tab]', $('#wlTabs')), i = tabs.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
  const rtl = getComputedStyle($('#wlTabs')).direction === 'rtl', n = tabs[(i + ((e.key === 'ArrowRight') !== rtl ? 1 : -1) + tabs.length) % tabs.length];
  e.preventDefault(); n.focus();
};
// drag: a tab onto a tab reorders lists; a symbol row onto a tab moves it (Ctrl/Alt: copy)
$('#watchT').ondragstart = e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]'); if (!row || !e.dataTransfer) return;
  e.dataTransfer.setData('application/x-wsym', JSON.stringify({ sym: row.dataset.sym, from: row.dataset.from })); e.dataTransfer.setData('text/plain', row.dataset.sym!); e.dataTransfer.effectAllowed = 'copyMove';
};
$('#wlTabs').ondragstart = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-wl]')?.dataset.wl; if (id && e.dataTransfer) { e.dataTransfer.setData('application/x-wlist', id); e.dataTransfer.effectAllowed = 'move' } };
$('#wlTabs').ondragover = e => {
  const t = e.dataTransfer?.types ?? [], el = (e.target as HTMLElement).closest<HTMLElement>('.wltab'); $$('.wltab.drop').forEach(x => x.classList.remove('drop'));
  if (!el || !(t.includes('application/x-wlist') || (t.includes('application/x-wsym') && el.dataset.wl))) return;
  e.preventDefault(); el.classList.add('drop');
};
$('#wlTabs').ondragleave = () => $$('.wltab.drop').forEach(x => x.classList.remove('drop'));
$('#wlTabs').ondrop = e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.wltab'); $$('.wltab.drop').forEach(x => x.classList.remove('drop')); if (!el || !e.dataTransfer) return;
  e.preventDefault();
  const id = e.dataTransfer.getData('application/x-wlist'), sy = e.dataTransfer.getData('application/x-wsym');
  if (id && lists[id]) { moveBefore(lists, id, el.dataset.wl && el.dataset.wl !== id ? el.dataset.wl : undefined); saveLists() }
  else if (sy && el.dataset.wl) {
    const { sym, from } = JSON.parse(sy) as { sym: string; from: string }, copy = e.ctrlKey || e.altKey, r = moveSymbol(lists, from, el.dataset.wl, sym, copy);
    r.ok ? (saveLists(), toast(`${sym} ${copy ? 'copied' : 'moved'} to ${lists[el.dataset.wl].name}`)) : toast(r.msg);
  }
};

function renderAlerts() {
  if (serverMode) return renderAlertsPanel();
  $('#alertT').innerHTML = '<tr><th>Symbol</th><th>Condition</th><th>Status</th><th></th></tr>' + st.alerts.map(a =>
    `<tr><td>${esc(a.sym)}</td><td>${a.note ? esc(a.note) + ' ' : ''}${a.dir === 'up' ? 'Crossing ↑' : 'Crossing ↓'} ${a.drawingId != null ? '' : a.price}</td><td class="${a.on ? '' : 'muted'}">${a.on ? 'Active' : 'Triggered'}</td>
     <td>${a.on ? '' : `<button class="x" data-re="${a.id}" title="Restart">↻</button>`}<button class="x" data-alert="${a.id}" title="Delete">×</button></td></tr>`).join('');
  $('#alertLog').innerHTML = alertLog.slice(0, 30).map(esc).join('<br>') || '—';
}
$('#alertAdd').onclick = () => addAlert({ sym: active().cfg.symbol, price: +$<HTMLInputElement>('#alertPx').value });
if (!serverMode) $('#alertT').onclick = e => {
  const el = e.target as HTMLElement;
  if (el.dataset.re) { const a = st.alerts.find(x => x.id === +el.dataset.re!); if (a) a.on = true }
  if (el.dataset.alert) st.alerts = st.alerts.filter(a => a.id !== +el.dataset.alert!);
  store.set('alerts', st.alerts); panes.forEach(p => p.tradeOverlay()); connectTickers(); renderAlerts();
};

// Script legend: right-click (long-press on phones) a script for its alert and settings.
$('#grid').addEventListener('contextmenu', e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.legend [data-script]'), p = panes.find(x => x.cell.contains(row));
  if (!row || !p) return;
  e.preventDefault(); e.stopPropagation(); hooks.onActivate(p);
  const id = row.dataset.script!;
  showMenu(e.clientX, e.clientY, [
    { label: 'Add alert on this script…', icon: '⏰', disabled: !serverMode, action: () => openAlertDialog({ scriptId: id }) },
    ...(serverMode ? [] : [{ label: 'Script alerts need the server', disabled: true }]),
    { label: 'Settings…', icon: '⚙', action: () => openInputs(p, id) },
  ]);
}, true);

// Object tree + data window
let treeTab = 'tree';
$('#treeTabs').onclick = e => {
  const t = (e.target as HTMLElement).dataset.t; if (!t) return;
  treeTab = t; $$('#treeTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#treeView').hidden = t !== 'tree'; $('#dataView').hidden = t !== 'data'; renderDataWindow();
};
function renderTree() {
  const p = active(), l = p?.layer; if (!l) return;
  const groups = new Map<string, Drawing[]>();
  l.drawings.forEach(d => { const g = d.group ?? ''; groups.set(g, [...(groups.get(g) ?? []), d]) });
  const row = (d: Drawing) => {
    const i = l.drawings.indexOf(d), name = d.name ?? TOOL_MAP.get(d.type)?.name ?? d.type;
    return `<tr class="click${l.selected.has(d) ? ' sel' : ''}" data-i="${i}"><td><span style="color:${esc(d.style.color)}">■</span> ${esc(name)}${d.style.text && !d.name ? ` <span class="muted">“${esc(String(d.style.text).slice(0, 18))}”</span>` : ''}${d.vis ? ' <span class="muted" title="Limited interval visibility">◔</span>' : ''}</td>
     <td><button class="x" data-act="hide" title="Show/hide">${d.hidden ? '◌' : '👁'}</button><button class="x" data-act="lock" title="Lock">${d.locked ? '🔒' : '🔓'}</button><button class="x" data-act="ren" title="Rename">✎</button><button class="x" data-act="grp" title="Group">⊂</button><button class="x" data-act="del" title="Delete">×</button></td></tr>`;
  };
  $('#treeT').innerHTML = `<tr><td><b>${esc(p.cfg.symbol)}</b> <span class="muted">${esc(p.cfg.tf)} · ${esc(CHART_TYPES.find(t => t.id === p.cfg.type)?.name ?? '')}</span></td><td></td></tr>` +
    p.ind.map(e => `<tr><td>ƒx ${esc(e.name)}</td><td><button class="x" data-ind="${esc(e.key)}" title="Remove">×</button></td></tr>`).join('') +
    [...groups].map(([g, ds]) => (g ? `<tr><td class="muted">▾ ${esc(g)}</td><td><button class="x" data-ungroup="${esc(g)}" title="Ungroup">⊄</button></td></tr>` : '') + ds.map(row).join('')).join('') +
    (l.drawings.length ? '' : '<tr><td class="muted">No drawings on this symbol</td><td></td></tr>');
}
$('#treeT').onclick = e => {
  const el = e.target as HTMLElement, l = active().layer;
  if (el.dataset.ind) { applyCfg(active(), { ind: active().cfg.ind.filter(k => k !== el.dataset.ind) }, 'remove indicator'); return }
  if (el.dataset.ungroup) { l.drawings.forEach(d => { if (d.group === el.dataset.ungroup) delete d.group }); l.onChange(); return }
  const row = el.closest<HTMLElement>('[data-i]'); if (!row) return;
  const d = l.drawings[+row.dataset.i!];
  switch (el.dataset.act) {
    case 'del': return l.remove(d);
    case 'hide': d.hidden = !d.hidden; break;
    case 'lock': d.locked = !d.locked; break;
    case 'ren': { const n = prompt('Name', d.name ?? TOOL_MAP.get(d.type)?.name)?.trim(); if (n) d.name = n; break }
    case 'grp': { const g = prompt('Group name (applies to the selected drawings)', d.group ?? 'Group 1')?.trim(); if (g) (l.selected.size ? [...l.selected] : [d]).forEach(x => (x.group = g)); break }
    default: l.select([d], e.ctrlKey); return;
  }
  l.onChange(); l.update();
};
function renderDataWindow() {
  if (treeTab !== 'data' || st.side !== 'tree') return;
  const p = active(); if (!p) return;
  $('#dataT').innerHTML = `<tr><th colspan="2">${esc(p.cfg.symbol)} · ${esc(p.cfg.tf)}</th></tr>` + p.dataWindow().map(r => `<tr><td class="muted">${esc(r.name)}</td><td>${esc(r.value)}</td></tr>`).join('');
}

initMarket({ setSymbol: s => setSymbol(s), addWatch, symbol: () => active().cfg.symbol, refreshCharts: () => panes.forEach(p => p.tradeOverlay()) });
initSkills({
  bars: (sym, tf) => fetchBars(sym, tf),
  account: () => {
    const positions = Object.entries(st.acct.pos).map(([sym, p]) => ({ sym, qty: p.qty, avg: p.avg, px: pxOf(sym) ?? p.avg }));
    return { cash: st.acct.cash, positions, equity: st.acct.cash + positions.reduce((s, p) => s + p.qty * p.px, 0), fills: st.acct.fills.map(f => ({ sym: f.sym, side: f.side, qty: f.qty, px: f.px, fee: f.fee, ts: f.ts })) };
  },
  trades: () => journal().trades.filter(t => t.kind !== 'notrade').map(t => ({ sym: t.sym, dir: t.dir, openTime: t.openTime, closeTime: t.closeTime, net: t.net, r: rMultiple(t), status: t.status, setup: t.setup, mistakes: t.mistakes })),
  json: <T,>(path: string) => serverJson<T>(path),
});
if (SHOW_AI) initAi({ active, trades: () => journal().trades.filter(t => t.kind !== 'notrade').map(t => ({ sym: t.sym, dir: t.dir, openTime: t.openTime, closeTime: t.closeTime, net: t.net, r: rMultiple(t), status: t.status, setup: t.setup, mistakes: t.mistakes })), openPine: src => { openNewScript(src) } });
else document.querySelectorAll('[data-side="ai"], #s-ai').forEach(e => e.remove());   // hidden until the AI features are finished (src/flags.ts)

// ---------- order ticket & trading panel ----------
const ticket = { side: 'buy' as Side, type: 'market' as OrderType };
const brokerLabel = () => activeBroker()?.account.label ?? 'Paper';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Older call sites (quick buttons, chart menu, DOM, position tool, forward test) build engine orders; `px` is unused now. */
function submit(o: Omit<Order, 'id'>, _px: number, p: ChartPane, b?: Broker) { void send(fromOrder(o), p, b) }
/** Every order goes through a Broker (the active one unless given); refusals (e.g. the server's guard) become toasts. */
async function send(r: OrderReq, p: ChartPane, b = activeBroker()) {
  if (r.ocoWith && p.replay) return toast('OCO orders are not available in Replay');
  if (journalReplayOrder(p, toOrder(r))) return;   // journal: a chart in Replay trades a simulated backtest account instead
  if (!b) return toast('No trading account');
  try {
    const o = await b.place(r);
    if (o.status === 'rejected') toast(`${b.account.label} rejected the order: ${o.error ?? 'no reason given'}`, 6000);
    else toast(`${o.status === 'filled' ? 'Order filled' : 'Order placed'} (${b.account.label})${o.error ? ` · ${o.error}` : ''}`, o.error ? 6000 : 3000);
  } catch (e) { toast(`${b.account.label}: ${errMsg(e)}`, 6000) }
}
const tval = (id: string) => +$<HTMLInputElement>(id).value;
const tchk = (id: string) => $<HTMLInputElement>(id).checked;
/** The ticket as an order request, its quantity from the sizing mode; `error` when it can't be built yet. */
function ticketReq(): { req?: OrderReq; info: string; error?: string } {
  const sym = active()?.cfg.symbol ?? '', last = pxOf(sym), k = ticket.type, bs = activeBroker()?.state();
  const stopPrice = k === 'stop' || k === 'stop_limit' ? tval('#tStop') : undefined;
  const price = k === 'limit' || k === 'stop_limit' ? tval('#tPrice') : undefined;
  const entry = price ?? stopPrice ?? last ?? 0;
  const tp = tchk('#tTpOn') ? tval('#tTp') : undefined, plain = tchk('#tSlOn') ? tval('#tSl') : undefined;
  // Exit plan: a stop and a ladder of targets that manage themselves after the entry fills (src/exits.ts).
  let exits: ExitPlan | undefined;
  const planText = $<HTMLInputElement>('#tPlan').value.trim(), fail = (m: string) => ({ info: m, error: m });
  if (planText) {
    try { exits = parseExitPlan(planText) } catch (e) { return fail(`Exit plan: ${(e as Error).message}`) }
    if (tp != null || plain != null) return fail('Use the exit plan or TP / SL, not both');
    if (tchk('#tOcoOn') || k === 'trailing_stop' || tchk('#tReduce')) return fail('An exit plan needs a plain entry order (no OCO, trailing or reduce-only)');
  }
  const sl = exits && entry ? resolvePlan(exits, ticket.side === 'buy' ? 1 : -1, entry).sl : plain;
  const mode = $<HTMLSelectElement>('#tSizeMode').value as SizeMode;
  if (mode !== 'units') {
    const bal = quoteBalance(sym, bs?.balances ?? []);
    const z = sizeQty({ mode, value: tval('#tSize'), price: entry, available: bal?.free ?? 0, equity: bs?.equity ?? bal?.free ?? 0, sl });
    $<HTMLInputElement>('#tQty').value = z.qty ? String(z.qty) : '';
    if (z.error) return { info: z.error, error: z.error };
  }
  const qty = tval('#tQty');
  const req: OrderReq = { sym, side: ticket.side, kind: k, qty, price, stopPrice, ...(exits ? { exits } : { tp, sl }), reduceOnly: tchk('#tReduce') || undefined };
  if (k === 'trailing_stop') req.trail = $<HTMLSelectElement>('#tTrailUnit').value === 'pct' ? { pct: tval('#tTrail') } : { amount: tval('#tTrail') };
  if (tchk('#tOcoOn')) {
    const ok = $<HTMLSelectElement>('#tOcoKind').value as 'limit' | 'stop', opx = tval('#tOcoPx');
    req.ocoWith = { sym, side: ticket.side, kind: ok, qty, ...(ok === 'limit' ? { price: opx } : { stopPrice: opx }), reduceOnly: req.reduceOnly };
  }
  const v = entry * qty, risk = sl != null && sl > 0 ? Math.abs(entry - sl) * qty : null, eq = bs?.equity;
  const info = entry && qty ? `Qty ${qty} · value ≈ ${v.toFixed(2)} · fee ≈ ${(v * 0.001).toFixed(2)}${risk != null ? ` · risk ≈ ${risk.toFixed(2)}${eq ? ` (${((risk / eq) * 100).toFixed(2)}% of equity)` : ''}` : ''}` : '';
  return { req, info: exits ? `${info}${info ? ' · ' : ''}${describePlan(exits)}` : info };
}
function renderTicket() {
  const k = ticket.type, units = $<HTMLSelectElement>('#tSizeMode').value === 'units';
  const show = (id: string, on: boolean) => { $(id).style.display = on ? '' : 'none' };
  $$('#tSide button').forEach(b => b.classList.toggle('on', b.dataset.side === ticket.side));
  $$('#tType button').forEach(b => b.classList.toggle('on', b.dataset.type === k));
  show('#tPriceRow', k === 'limit' || k === 'stop_limit'); show('#tStopRow', k === 'stop' || k === 'stop_limit');
  show('#tTrailRow', k === 'trailing_stop'); show('#tOcoRow', tchk('#tOcoOn')); show('#tSize', !units);
  $<HTMLInputElement>('#tQty').readOnly = !units;
  const btn = $('#tSubmit');
  btn.className = (ticket.side === 'buy' ? 'buyc' : 'sellc') + ' big-btn';
  btn.textContent = `${ticket.side === 'buy' ? 'Buy' : 'Sell'} ${k === 'market' ? 'market' : k.replace('_', ' ')}`;
  $('#tInfo').textContent = ticketReq().info;
}
function renderAcctSel() {
  const cur = activeBroker()?.account.id;
  $('#tAcct').innerHTML = allBrokers().map(({ account: a }) =>
    `<option value="${esc(a.id)}"${a.id === cur ? ' selected' : ''}>${esc(a.label)}${a.id !== 'paper' ? ` · ${esc(a.broker)} testnet` : ''}${a.status !== 'active' ? ` (${esc(a.status)})` : ''}</option>`).join('');
  $('#resetAcct').style.display = cur === 'paper' ? '' : 'none';
}
$('#tAcct').onchange = e => setActiveBroker((e.target as HTMLSelectElement).value);
$('#tSide').onclick = e => { const s = (e.target as HTMLElement).dataset.side; if (s) { ticket.side = s as Side; renderTicket() } };
$('#tType').onclick = e => {
  const t = (e.target as HTMLElement).dataset.type; if (!t) return;
  ticket.type = t as OrderType;
  const px = pxOf(active().cfg.symbol), v = px?.toFixed(active().prec) ?? '';
  if ((t === 'limit' || t === 'stop_limit') && px) $<HTMLInputElement>('#tPrice').value = v;
  if ((t === 'stop' || t === 'stop_limit') && px) $<HTMLInputElement>('#tStop').value = v;
  renderTicket();
};
$('#s-trade').addEventListener('input', renderTicket);
$('#tSubmit').onclick = () => {
  const p = active(), sym = p.cfg.symbol;
  if (!pxOf(sym)) return toast('No price yet');
  if (isExpr(sym)) return toast('Spread symbols cannot be traded');
  const t = ticketReq();
  if (!t.req) return toast(t.error ?? 'Check the order', 5000);
  void send(t.req, p);
};
$('#resetAcct').onclick = () => { if (confirm('Reset paper account to 10,000 USDT?')) { st.acct = newAccount(); saveAcct(); paper.emit() } };
// Lines, panels and the ticket follow the active broker; re-subscribe when it (or the list of accounts) changes.
let unwatch = () => {};
function tradeChanged() { panes.forEach(p => p.tradeOverlay()); later(renderTrading); later(renderTicket); connectTickers() }
function watchBroker() { unwatch(); unwatch = activeBroker()?.onChange(tradeChanged) ?? (() => {}); renderAcctSel(); tradeChanged(); journalBrokers(allBrokers()) }
onBrokers(watchBroker); watchBroker();
function renderTrading() {
  const b = activeBroker(), s = b?.state(), f = (x: number) => x.toFixed(calcPrec(x));
  const empty = (n: number, msg: string) => `<tr><td class="muted" colspan="${n}">${msg}</td></tr>`;
  if (!b || !s) {
    $('#acctLine').textContent = b ? `${b.account.label} · loading…` : '';
    $('#posT').innerHTML = empty(1, 'No account data yet'); $('#ordT').innerHTML = $('#histT').innerHTML = '';
    return;
  }
  const a = b.account, mark = (p: { sym: string; mark?: number }) => p.mark ?? pxOf(p.sym);
  const upnl = (p: (typeof s.positions)[number]) => p.upnl ?? (mark(p) ? (mark(p)! - p.entry) * p.qty : 0);
  const u = s.positions.reduce((t, p) => t + upnl(p), 0), bal = quoteBalance(active()?.cfg.symbol ?? '', s.balances);
  const status = a.status !== 'active' ? ` · <span class="dn">${esc(a.status)}${a.error ? ': ' + esc(a.error) : ''}</span>` : '';
  $('#acctLine').innerHTML = `${esc(a.label)}${status}${s.equity != null ? ` · Equity <b>${s.equity.toFixed(2)}</b>` : ''}${bal ? ` · Balance ${bal.free.toFixed(2)}${bal.asset !== 'USDT' ? ' ' + esc(bal.asset) : ''}` : ''} · uPnL <span class="${u >= 0 ? 'up' : 'dn'}">${u.toFixed(2)}</span>`;
  $('#posT').innerHTML = '<tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Avg price</th><th>Last</th><th>Unrealized PnL</th><th></th></tr>' + (s.positions.filter(p => p.qty).map(p => {
    const px = mark(p), pl = upnl(p);
    return `<tr><td>${esc(p.sym)}</td><td class="${p.qty > 0 ? 'up' : 'dn'}">${p.qty > 0 ? 'Long' : 'Short'}</td><td>${Math.abs(p.qty)}</td><td>${f(p.entry)}</td><td>${px ? f(px) : '–'}</td>
      <td class="${pl >= 0 ? 'up' : 'dn'}">${pl.toFixed(2)} (${((pl / Math.abs(p.entry * p.qty)) * 100).toFixed(2)}%)</td><td><button class="x" data-close="${esc(p.sym)}">Close</button></td></tr>`;
  }).join('') || empty(7, 'No open positions'));
  const kind = (o: (typeof s.orders)[number]) => (o.reduceOnly && o.kind !== 'market' ? (o.kind === 'limit' ? 'Take profit' : 'Stop loss') : o.kind.replace('_', ' '))
    + (o.trail ? ` (${o.trail.pct ? o.trail.pct + '%' : o.trail.amount})` : '') + (o.ocoGroup && !o.reduceOnly ? ' · OCO' : '');
  $('#ordT').innerHTML = '<tr><th>Symbol</th><th>Type</th><th>Side</th><th>Qty</th><th>Price</th><th>Stop</th><th>TP / SL</th><th>Note</th><th></th></tr>' + (s.orders.filter(o => o.status === 'open').map(o =>
    `<tr><td>${esc(o.sym)}</td><td>${esc(kind(o))}</td><td class="${o.side === 'buy' ? 'up' : 'dn'}">${o.side}</td><td>${o.qty}</td><td>${o.price != null ? f(o.price) : '–'}</td><td>${o.stopPrice != null ? f(o.stopPrice) : '–'}</td>
     <td>${o.tp != null || o.sl != null ? `${o.tp != null ? f(o.tp) : '–'} / ${o.sl != null ? f(o.sl) : '–'}` : ''}</td><td class="muted">${esc(o.error ?? '')}</td>
     <td><button class="x" data-cancel="${esc(o.id)}">Cancel</button></td></tr>`).join('') || empty(9, 'No working orders'));
  $('#histT').innerHTML = '<tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Fee</th><th>PnL</th></tr>' + (s.fills.slice(0, 100).map(x =>
    `<tr><td>${new Date(x.ts > 1e11 ? x.ts : x.ts * 1000).toLocaleString()}</td><td>${esc(x.sym)}</td><td class="${x.side === 'buy' ? 'up' : 'dn'}">${x.side}</td><td>${x.qty}</td><td>${f(x.price)}</td><td>${x.fee.toFixed(2)}</td>
     <td class="${(x.realized ?? 0) >= 0 ? 'up' : 'dn'}">${x.realized ? x.realized.toFixed(2) : ''}</td></tr>`).join('') || empty(7, 'No fills yet'));
}
function showBottom(tab: string) {
  $$('#bTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.bpane').forEach(p => p.classList.toggle('on', p.id === 'b-' + tab));
  $('#bottom').classList.remove('collapsed');
  if ((tab === 'pine' || tab === 'python' || tab === 'tester') && $('#bottom').offsetHeight < 300) setBottomHeight(360);
  if (tab === 'tester') renderPineResults(active());
}
function setBottomHeight(h: number) { const v = Math.max(80, Math.min(innerHeight - 200, h)); $('#bottom').style.setProperty('--bottom-h', v + 'px'); store.set('bottomH', v) }
setBottomHeight(store.get('bottomH', 220));
$('#bResize').onmousedown = e => {
  e.preventDefault();
  const y0 = e.clientY, h0 = $('#bottom').offsetHeight;
  const move = (m: MouseEvent) => setBottomHeight(h0 + y0 - m.clientY);
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up) };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
};
$('#bottom').onclick = e => {
  const el = e.target as HTMLElement;
  if (el.dataset.tab) showBottom(el.dataset.tab);
  if (el.id === 'bToggle') { $('#bottom').classList.toggle('collapsed') }
  const s = el.dataset.close, oid = el.dataset.cancel, b = activeBroker();
  const fail = (e: unknown) => toast(`${b?.account.label}: ${errMsg(e)}`, 6000);
  if (b && s) b.closePosition(s).catch(fail);
  if (b && oid) b.cancel(oid).catch(fail);
};

// ---------- chart settings dialog ----------
let settingsTab = 'symbol';
function openSettings(tab = settingsTab) { settingsTab = tab; renderSettings(); $<HTMLDialogElement>('#settingsDlg').showModal() }
function renderSettings() {
  const css = getComputedStyle(document.documentElement), v = (n: string) => css.getPropertyValue(n).trim();
  const fallback: Partial<Record<keyof Settings, string>> = { bgColor: v('--bg'), bgColor2: v('--panel'), gridColor: v('--grid'), scaleTextColor: v('--muted'), separatorColor: v('--line') };
  $('#settingsTabs').innerHTML = SETTINGS_TABS.map(t => `<button type="button" data-tab="${t.id}" class="${t.id === settingsTab ? 'on' : ''}">${esc(t.name)}</button>`).join('');
  $('#settingsForm').innerHTML = renderSettingsForm(st.settings, settingsTab, k => fallback[k] ?? '#000000');
}
function applySettings(patch: Partial<Settings>) {
  Object.assign(st.settings, patch);
  store.set('settings', st.settings);
  document.documentElement.dataset.theme = st.settings.theme;
  panes.forEach(p => p.build());
  syncUI();
}
$('#settingsTabs').onclick = e => { const t = (e.target as HTMLElement).dataset.tab; if (t) { settingsTab = t; renderSettings() } };
$('#settingsForm').oninput = e => { applySettings(readSettingsInput(e.target as HTMLInputElement)); if ((e.target as HTMLElement).dataset.k === 'theme') renderSettings() };
$('#settingsBtn').onclick = () => openSettings();
$('#settingsReset').onclick = e => { e.preventDefault(); if (confirm('Reset all chart settings to defaults?')) { applySettings({ ...DEFAULT_SETTINGS }); renderSettings() } };

// ---------- keyboard ----------
const KEYS: [string, string][] = [
  ['Type letters', 'Symbol search'], ['Type a number or ,', 'Change interval'], ['/', 'Indicators'], ['Ctrl+K', 'Symbol search'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+S', 'Save layout'], ['.', 'Load layout'], ['Alt+R', 'Reset chart'], ['Alt+G', 'Go to date'],
  ['Alt+I / Alt+L / Alt+P', 'Invert / Log / Percent scale'], ['Alt+A', 'Add alert'], ['Alt+W', 'Add to watchlist'], ['Alt+S', 'Copy chart image'],
  ['Ctrl+Alt+S / Ctrl+Shift+S', 'Download / copy snapshot'], ['Alt+T / H / J / V / C / F', 'Trend line / Horizontal line / ray / Vertical / Cross line / Fib'],
  ['Alt+Shift+R', 'Rectangle'], ['Shift+click', 'Measure'], ['Ctrl+Alt+H', 'Hide all drawings'], ['Ctrl+C / Ctrl+V', 'Copy / paste drawings'],
  ['Ctrl+drag', 'Clone drawing'], ['Shift+drag', 'Move along one axis'], ['Ctrl (while drawing)', 'Invert magnet'], ['Arrow keys', 'Nudge selected drawing'],
  ['Del / Backspace', 'Remove selected drawing'], ['Esc', 'Cursor / cancel'], ['← / →', 'Scroll one bar'], ['Ctrl+↑ / Ctrl+↓', 'Zoom in / out'],
  ['Alt+Enter', 'Maximize active chart'], ['Tab / Shift+Tab', 'Next / previous chart'], ['Shift+↓ / Shift+→', 'Replay: play-pause / step'], ['Ctrl+/', 'This list'],
];
function openKeys() { $('#keysT').innerHTML = KEYS.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join(''); $<HTMLDialogElement>('#keysDlg').showModal() }
document.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).matches('input,textarea,select') || document.querySelector('dialog[open]')) return;
  const p = active(), l = p?.layer; if (!p) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  const combo = `${ctrl ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey && (e.altKey || ctrl) ? 'Shift+' : ''}${k.length === 1 ? k.toUpperCase() : k}`;
  const tool = [...TOOL_MAP.values()].find(t => t.key === combo);
  const act = (fn: () => void) => { e.preventDefault(); fn() };
  if (tool) return act(() => setTool(drawHost, tool.id));
  switch (combo) {
    case 'Escape': return act(() => { setTool(drawHost, 'cursor'); l.select([]); if (p.replay?.picking) { p.exitReplay(); syncUI() } });
    case 'Ctrl+Z': return act(() => history.undo());
    case 'Ctrl+Y': case 'Ctrl+Shift+Z': return act(() => history.redo());
    case 'Ctrl+C': return l.selected.size ? act(() => copyDrawings(l)) : undefined;
    case 'Ctrl+V': return act(() => pasteDrawings(l));
    case 'Ctrl+S': return act(() => $('#lySave').click());
    case 'Ctrl+K': return act(() => openSearch(''));
    case 'Ctrl+/': return act(openKeys);
    case 'Ctrl+Alt+H': return act(() => drawHost.hide('drawings'));
    case 'Ctrl+Alt+S': return act(() => downloadShot(p.chart.takeScreenshot(), p));
    case 'Ctrl+Shift+S': case 'Alt+S': return act(() => copyShot(p.chart.takeScreenshot()));
    case 'Alt+R': return act(() => p.resetView());
    case 'Alt+G': return act(openGoto);
    case 'Alt+I': return act(() => applySettings({ invert: !st.settings.invert }));
    case 'Alt+L': return act(() => setScale('log'));
    case 'Alt+P': return act(() => setScale('percent'));
    case 'Alt+A': return act(() => $('#alertBtn').click());
    case 'Alt+W': return act(() => addWatch(p.cfg.symbol));
    case 'Alt+Enter': return act(toggleMaximize);
    case 'Tab': case 'Shift+Tab': return act(() => { if (panes.length > 1) hooks.onActivate(panes[(st.layout.active + (e.shiftKey ? panes.length - 1 : 1)) % panes.length]) });
    case 'Shift+ArrowDown': return p.replay ? act(togglePlay) : undefined;
    case 'Shift+ArrowRight': return p.replay ? act(() => p.stepReplay()) : undefined;
    case 'Delete': case 'Backspace': return l.selected.size ? act(() => l.remove(...l.selected)) : undefined;
    case 'Ctrl+ArrowUp': case 'Ctrl+ArrowDown': return act(() => { const ts = p.chart.timeScale(), r = ts.getVisibleLogicalRange(); if (r) { const w = (r.to - r.from) * (k === 'ArrowUp' ? 0.2 : -0.25); ts.setVisibleLogicalRange({ from: r.from + w, to: r.to }) } });
  }
  if (k.startsWith('Arrow') && !ctrl && !e.altKey) {
    if (l.selected.size) return act(() => l.nudge(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0));
    if (k === 'ArrowLeft' || k === 'ArrowRight') return act(() => p.chart.timeScale().scrollToPosition(p.chart.timeScale().scrollPosition() + (k === 'ArrowLeft' ? -1 : 1), false));
  }
  if (ctrl || e.altKey) return;
  if (k === '/') return act(() => indicatorsMenu($('#indBtn')));
  if (k === '.') return act(() => $('#layoutsBtn').click());
  if (/^[0-9,]$/.test(k)) return act(() => openTfDialog(k === ',' ? '' : k));
  if (/^[a-zA-Z]$/.test(k)) return act(() => openSearch(k.toUpperCase()));
});

initPineUI({ active, panes: () => panes, applyCfg, showTab: showBottom });
initPyUI({ active, panes: () => panes, applyCfg, showTab: showBottom });
initTesterUI({ paper: (p, side, qty) => { const px = pxOf(p.cfg.symbol); if (px) { journalSource('Forward test'); submit({ sym: p.cfg.symbol, side, type: 'market', qty }, px, p, paper); journalSource('') } }, watchlist: () => watchSyms() });
initJournal({
  tfOf: sym => panes.find(p => p.cfg.symbol === sym)?.cfg.tf,
  brokers: allBrokers,
  bracketOf: sym => {
    const ex = st.acct.orders.filter(o => o.sym === sym && o.reduceOnly);
    return { stop: ex.find(o => o.type === 'stop')?.price, target: ex.find(o => o.type === 'limit')?.price };
  },
  shot: () => active()?.chart?.takeScreenshot() ?? null,
  async show(sym, t) {
    if (active().cfg.symbol !== sym) setSymbol(sym);
    for (let i = 0; i < 50 && !(active().cfg.symbol === sym && active().vb().length); i++) await new Promise(r => setTimeout(r, 100));
    active().goTo(t);
  },
  // journal: trade replay and portfolio risk
  async pane(sym, tf) {
    if (active().cfg.symbol !== sym) setSymbol(sym);
    if (active().cfg.tf !== tf) setTf(tf);
    for (let i = 0; i < 100 && !(active().cfg.symbol === sym && active().cfg.tf === tf && active().bars.length); i++) await new Promise(r => setTimeout(r, 100));
    return active();
  },
  portfolio: () => ({ acct: st.acct, price: pxOf, watch: watchSyms() }),
});
journalSync(st.acct);
initDom({
  symbol: () => active()?.cfg.symbol ?? '',
  prec: () => active()?.prec ?? 2,
  last: () => pxOf(active().cfg.symbol), qty: () => +$<HTMLInputElement>('#tQty').value,   // accounts: DOM trades on the active broker
  confirm: msg => st.settings.instantOrders || confirm(msg),
  place: r => send(r, active()),   // the ticket's path, so Replay orders go to the backtest account
  orders: sym => st.acct.orders.filter(o => o.sym === sym && o.price != null).map(o => ({ side: o.side, price: o.price!, qty: o.qty })),
  limit(side, price) {
    const p = active(), last = pxOf(p.cfg.symbol), qty = +$<HTMLInputElement>('#tQty').value;
    if (!last) return toast('No price yet');
    // Below the market a buy rests as a limit, above it as a stop (and the reverse for sells).
    const type = (side === 'buy') === (price < last) ? 'limit' : 'stop';
    if (!st.settings.instantOrders && !confirm(`${side.toUpperCase()} ${type} ${qty} ${p.cfg.symbol} @ ${price} (paper)?`)) return;
    submit({ sym: p.cfg.symbol, side, type, qty, price }, last, p);
  },
});
domSync();
initLiqPanel({ symbol: () => active()?.cfg.symbol ?? '' });   // derivs
initAccountsUI();   // accounts: loads the exchange testnet accounts in server mode

// ---------- boot ----------
document.documentElement.dataset.theme = st.settings.theme;
const side = st.side; st.side = ''; if (side) showSide(side); else $('#body').classList.add('no-panel');
buildLayout();
initSettingsUI();
if (serverMode) {
  initServerAlerts({ ctx: alertCtx, changed: () => panes.forEach(p => p.tradeOverlay()), beep: isPopout ? () => {} : beep, toastMs: () => (st.settings.autoHideToasts ? 20000 : 120000) });
  // One-time move of the old browser alerts to the server; whatever failed stays for the next start.
  if (st.alerts.length) migrateToServer(st.alerts as OldAlert[], st.drawings, active()?.cfg.tf ?? '1h').then(left => { st.alerts = left as Alert[]; store.set('alerts', st.alerts) });
}
renderAlerts();
history.onChange();
// A shared layout link (/?layout=…) opens a copy of that layout, with its drawings, as a new saved layout.
const sharedLayout = new URLSearchParams(location.search).get('layout');
if (serverMode && sharedLayout) {
  window.history.replaceState(null, '', location.pathname);
  api<Parameters<typeof importLayout>[0]>(`/api/share/layout/${encodeURIComponent(sharedLayout)}`).then(j => { importLayout(j, 'shared'); toast('Shared layout opened') }, e => toast((e as Error).message));
}

// ---------- several windows ----------
// Pop-outs (and a second tab) share this browser's storage: what another window saved shows up here at once.
addEventListener('storage', e => {
  if (!e.key?.startsWith('ct.')) return;
  switch (e.key.slice(3)) {
    case 'drawings':
      st.drawings = store.get('drawings', {});
      panes.forEach(p => { p.layer.drawings = (st.drawings[p.cfg.symbol] ??= []); p.layer.select([]); p.layer.update() });
      renderTree(); break;
    case 'watchLists': lists = migrate(store.get<unknown>('watchLists', undefined), undefined, undefined); watchActive = resolveActive(lists, watchActive); saveWatchLocal(); break;
    case 'acct': st.acct = store.get('acct', st.acct); journalSync(st.acct); paper.emit(); renderTrading(); break;
    case 'alerts': if (!serverMode) { st.alerts = store.get('alerts', st.alerts); panes.forEach(p => p.tradeOverlay()); connectTickers(); renderAlerts() } break;
    case 'settings': st.settings = loadSettings(); document.documentElement.dataset.theme = st.settings.theme; panes.forEach(p => p.build()); syncUI(); break;
  }
});
function saveWatchLocal() { connectTickers(); renderWatch() }   // like saveWatch, without writing it back
initConnections({ openMarkets: (ex, perp) => { searchEx = ex; store.set('searchEx', ex); searchQuote = perp ? 'swap' : 'USDT'; openSearch('') } });
$('#menuBtn').onclick = e => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), click = (id: string) => () => $(id).click();
  showMenu(r.right - 220, r.bottom + 2, [
    { label: 'Settings', icon: '⚙', action: click('#settingsBtn') },
    { label: 'New tab', icon: '＋', action: click('#tabAdd') },
    { label: 'Connections (live data)…', icon: '🔌', action: openConnections },
    { label: 'Multi-monitor…', icon: '🖥', action: click('#monBtn') },
    { sep: true },
    { head: 'Theme' },
    ...(['dark', 'light'] as const).map(t => ({ label: t === 'dark' ? 'Dark' : 'Light', checked: st.settings.theme === t, action: () => { if (st.settings.theme !== t) $('#themeBtn').click() } })),
    { head: 'Language' },
    { label: 'English', checked: document.documentElement.lang !== 'fa', action: () => { if (document.documentElement.lang === 'fa') $('#langBtn').click() } },
    { label: 'فارسی', checked: document.documentElement.lang === 'fa', action: () => { if (document.documentElement.lang !== 'fa') $('#langBtn').click() } },
    { sep: true },
    ...(serverMode ? [{ label: 'Back up to Telegram…', icon: '✈', action: () => void import('./tgbackup.ts').then(m => m.backupToTelegram()) }] : []),
    { label: 'Restore from backup file…', icon: '⤒', action: () => void import('./tgbackup.ts').then(m => m.restoreFromFile()) },
    { label: 'Snapshot', icon: '📷', action: click('#shotBtn') },
  ]);
};
$('#monBtn').onclick = e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); void monitorsMenu(r.left, r.bottom + 2) };
initWindows({
  panes: () => panes, active: () => st.layout.active,
  applyCfg: (i, cfg) => panes[i]?.set(cfg as Partial<PaneCfg>),
  select: setSymbol, showBottom,
});

if (import.meta.env.DEV) Object.assign(window, { __ct: { panes: () => panes, st, history } }); // debugging handle, dev server only
if (!bundledOrigin()) void registerServiceWorker().catch(() => {});   // at startup, so Chrome on Android offers 'Install app' without push being enabled first
