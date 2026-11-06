// Multi-monitor: pop panels and charts out into their own windows. A pop-out is this same app opened at
// `/?po=<kind>&wid=<id>[&pane=<n>]`: same origin, so it shares the browser storage (drawings, watchlist, paper account,
// scripts), the symbol-link channel and, through livehub.ts, one set of live connections. Chart configs travel over the
// window channel (winlink.ts). Desktop: windows are made by the Electron shell (desktop/main.cjs, one validated IPC);
// web/PWA: window.open, placed on a chosen screen with the Window Management API when the user allows it.
import { aliasKeys, store, toast, $, $$, esc } from './store.ts';
import { showMenu, type MenuItem } from './menu.ts';
import { myId, popKindParam, send, onMsg, busOk } from './winbus.ts';
import { ARR_KEY, isKind, parseArrangement, remove, slotId, upsert, type Arrangement, type Kind, type PopSpec } from './winlink.ts';
import { displayFor, placeOn, restoreRect, snapshot, type Display } from './winplace.ts';

export const popKind: Kind | null = isKind(popKindParam) ? popKindParam : null;
export const isPopout = popKind !== null;
const paneQ = Number(new URLSearchParams(location.search).get('pane'));
export const popPane = Number.isInteger(paneQ) && paneQ >= 0 && paneQ < 16 ? paneQ : 0;
export const LABEL: Record<Kind, string> = { chart: 'Chart', watch: 'Watchlist', dom: 'DOM / Time & Sales', tester: 'Strategy Tester', positions: 'Positions & orders', pine: 'Pine / Python editor', alerts: 'Alerts' };
const SIDE: Partial<Record<Kind, string>> = { watch: 'watch', dom: 'dom', alerts: 'alerts' };

interface Desk { win?(op: string, arg?: unknown): Promise<unknown>; }
const desk = (globalThis as unknown as { ctDesktop?: Desk }).ctDesktop;
const isDesktop = typeof desk?.win === 'function';

// ---- boot (runs before main.ts builds its state): a pop-out keeps its own layout / side panel / sizes ----
if (popKind) {
  aliasKeys(myId, ['layout', 'layoutName', 'layouts', 'autosave', 'side', 'bottomH', 'tsTab', 'watchDetail']);
  document.documentElement.classList.add('po', 'po-' + popKind);
  const rawLayout = (() => { try { return JSON.parse(localStorage.getItem('ct.layout') ?? 'null') } catch { return null } })() as { panes?: Record<string, unknown>[]; active?: number } | null;
  if (rawLayout?.panes?.length && (popKind !== 'chart' || !store.get('layout', null))) {   // panel pop-outs mirror the active chart; a chart keeps its own copy
    const pane = rawLayout.panes[popKind === 'chart' ? popPane : (rawLayout.active ?? 0)] ?? rawLayout.panes[0];
    store.set('layout', { mode: '1', panes: [pane], active: 0, sync: { symbol: false, tf: false, crosshair: true, time: false } });
  }
  store.set('side', SIDE[popKind] ?? '');
}
const tabOf = (k: Kind) => (k === 'pine' ? 'pine' : k === 'tester' ? 'tester' : k === 'positions' ? 'positions' : '');

// ---- arrangement of this device (device-local key, see sync.ts LOCAL_KEYS) ----
export const arrangement = (): Arrangement => parseArrangement(store.get(ARR_KEY, null));
const saveArr = (a: Arrangement) => { store.set(ARR_KEY, a) };
const patchSpec = (s: PopSpec) => saveArr(upsert(arrangement(), s));

// ---- screens ----
interface Raw { raw?: unknown }
type Screen = Display & Raw;
let webScreens: Screen[] | null = null;
type SD = EventTarget & { screens: Array<{ label: string; left: number; top: number; width: number; height: number; availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary: boolean }> };
const mapWeb = (sd: SD): Screen[] => sd.screens.map((s, i) => ({ id: `${s.label || 'screen'}@${s.left},${s.top}`, label: s.label || `Screen ${i + 1}`, primary: s.isPrimary, raw: s,
  bounds: { x: s.left, y: s.top, width: s.width, height: s.height }, workArea: { x: s.availLeft, y: s.availTop, width: s.availWidth, height: s.availHeight } }));
export const canAskScreens = () => !isDesktop && typeof (window as unknown as { getScreenDetails?: unknown }).getScreenDetails === 'function';
/** Detected screens, or null when unknown. `ask` may show the browser's permission prompt (needs a click). */
export async function screens(ask: boolean): Promise<Screen[] | null> {
  if (isDesktop) { try { const r = await desk!.win!('displays'); return Array.isArray(r) ? (r as Screen[]) : null } catch { return null } }
  if (!canAskScreens()) return null;
  try {
    if (!ask) { const p = await navigator.permissions.query({ name: 'window-management' as PermissionName }); if (p.state !== 'granted') return webScreens }
    const sd = await (window as unknown as { getScreenDetails(): Promise<SD> }).getScreenDetails();
    webScreens = mapWeb(sd);
    if (!watched) { watched = true; sd.addEventListener('screenschange', () => { webScreens = mapWeb(sd); reflowWeb() }) }
    return webScreens;
  } catch { return webScreens }   // refused or unsupported: a normal popup still works
}
let watched = false;
const dim = (d: Display) => `${d.bounds.width}×${d.bounds.height}`;
const sName = (d: Display, i: number) => `${i + 1} · ${d.label && d.label !== `Screen ${i + 1}` ? d.label + ' · ' : ''}${dim(d)}${d.primary ? ' · primary' : ''}`;

// ---- who is open ----
interface Known { kind: Kind | 'main'; pane?: number; seen: number }
const known = new Map<string, Known>();
const wins = new Map<string, Window>();   // web: windows this page opened
const TTL = 12_000;
const live = () => { const now = Date.now(); for (const [k, v] of known) if (now - v.seen > TTL) known.delete(k); return known };
const mainAlive = () => [...live().values()].some(v => v.kind === 'main');
export const kindOf = (id: string) => known.get(id)?.kind;
export const popouts = () => [...live()].filter(([, v]) => v.kind !== 'main').map(([id, v]) => ({ id, kind: v.kind as Kind, pane: v.pane }));
const hello = () => send({ t: 'hello', id: myId, kind: popKind ?? 'main', ...(popKind ? { pane: popPane } : {}) });

// ---- host (main.ts) ----
export interface WinHost {
  panes(): { cfg: object; cell: HTMLElement }[];
  active(): number;
  applyCfg(i: number, cfg: Record<string, unknown>): void;
  select(symbol: string): void;
  showBottom(tab: string): void;
}
let host: WinHost | null = null;
const sent = new Map<string, string>();
const plain = (cfg: object) => { const c = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>; delete c.link; return c };
/** Tell the other windows what this window's charts look like now (only what changed since last time). */
export function pushCfg() {
  if (!host || !busOk || (!isPopout && !popouts().length)) return;
  const act = host.active();
  host.panes().forEach((p, i) => {
    if (isPopout && i > 0) return;
    const pane = isPopout ? popPane : i, active = isPopout ? popKind !== 'chart' : i === act, key = `${pane}|${active}`, c = plain(p.cfg), js = JSON.stringify(c);
    if (sent.get(key) === js) return;
    sent.set(key, js); send({ t: 'cfg', id: myId, pane, active, cfg: c });
  });
}
/** Panel pop-outs have no chart of their own to pick a symbol on: the main window does it (colour groups included). */
export function redirectSelect(symbol: string): boolean {
  if (!isPopout || popKind === 'chart' || !mainAlive()) return false;
  send({ t: 'select', symbol }); return true;
}

function refreshUi() {
  if (!host) return;
  const ps = popouts();
  document.body.dataset.popped = [...new Set(ps.map(p => p.kind))].join(' ');
  host.panes().forEach((p, i) => p.cell.classList.toggle('popped', ps.some(x => x.kind === 'chart' && x.pane === i)));
  $$('.po-ph').forEach(el => { const k = el.dataset.kind as Kind; el.classList.toggle('on', ps.some(x => x.kind === k)) });
}
/** After the grid is rebuilt: put the "popped out" notice back into every chart cell. */
export function decorateCells() {
  if (!host || isPopout) return;
  host.panes().forEach((p, i) => {
    if (p.cell.querySelector('.popbtn')) return;
    const b = document.createElement('button');
    b.className = 'popbtn'; b.title = 'Pop out to its own window'; b.textContent = '⧉';
    b.onclick = e => { e.stopPropagation(); void popMenu('chart', i, b) };
    const ph = document.createElement('div');
    ph.className = 'po-ph cell-ph'; ph.innerHTML = `<span>Popped out to its own window</span><button data-bb>Bring back</button>`;
    ph.querySelector('button')!.onclick = e => { e.stopPropagation(); bringBack(slotId('chart', i)) };
    p.cell.append(b, ph);
  });
  refreshUi();
}

// ---- opening ----
const HINT = 'Pop-up blocked. Allow pop-ups for this site (icon at the right of the address bar), then try again.';
const urlOf = (s: PopSpec) => `${location.origin}/?po=${s.kind}&wid=${s.id}${s.pane != null ? `&pane=${s.pane}` : ''}`;

function openWeb(s: PopSpec, d?: Display): boolean {
  const old = wins.get(s.id);
  if (old && !old.closed) { old.focus(); return true }
  const ds = webScreens;
  const r = d ? (s.rect && s.displayId === d.id ? restoreRect({ rect: s.rect, displayId: d.id }, [d]).rect : placeOn(d, s.rect, wins.size))
    : s.rect ? (ds ? restoreRect({ rect: s.rect, displayId: s.displayId ?? null }, ds).rect : s.rect)
      : { x: screenX + 60, y: screenY + 60, width: 1000, height: 700 };
  const w = window.open(urlOf(s), '_ct_' + s.id, `popup=yes,left=${Math.round(r.x)},top=${Math.round(r.y)},width=${Math.round(r.width)},height=${Math.round(r.height)}`);
  if (!w) { toast(HINT, 9000); return false }
  wins.set(s.id, w);
  return true;
}

/** Open (or focus) a pop-out. Must run inside a click: the browser only allows the window then. */
export function popOut(kind: Kind, o: { pane?: number; display?: Display } = {}): boolean {
  const pane = kind === 'chart' ? o.pane ?? 0 : undefined, id = slotId(kind, pane);
  const prev = arrangement().wins.find(w => w.id === id), spec: PopSpec = { ...prev, id, kind, ...(pane != null ? { pane } : {}), open: true };
  if (isDesktop) {
    void desk!.win!('pop', { id, kind, pane, displayId: o.display?.id }).then(ok => { if (ok) patchSpec(spec); else toast('Could not open the window') }, () => toast('Could not open the window'));
    return true;
  }
  if (!openWeb(spec, o.display)) return false;
  patchSpec(spec);
  if (!o.display && !prev?.rect && canAskScreens()) void screens(false);   // learn the screens quietly when already allowed
  setTimeout(refreshUi, 600);
  return true;
}
export async function popMenu(kind: Kind, pane: number | undefined, el: HTMLElement) {
  const r = el.getBoundingClientRect(), id = slotId(kind, pane), here = popouts().find(p => p.id === id);
  if (here) return showMenu(r.left, r.bottom + 2, [{ label: 'Bring back to this window', icon: '↩', action: () => bringBack(id) }, { label: 'Move to a screen…', icon: '🖥', action: () => void monitorsMenu(r.left, r.bottom + 2) }]);
  const ds = await screens(false), items: MenuItem[] = [{ label: 'Pop out to a new window', icon: '⧉', action: () => void popOut(kind, { pane }) }];
  if (ds) ds.forEach((d, i) => items.push({ label: `Pop out to screen ${sName(d, i)}`, icon: '🖥', action: () => void popOut(kind, { pane, display: d }) }));
  else if (canAskScreens()) items.push({ label: 'Choose a screen… (asks permission)', icon: '🖥', action: async () => { if (await screens(true)) void popMenu(kind, pane, el); else toast('Screen access was not allowed: the window opens where the browser puts it') } });
  showMenu(r.left, r.bottom + 2, items);
}

export function bringBack(id: string) {
  const w = wins.get(id); send({ t: 'dock', id });
  setTimeout(() => { if (w && !w.closed) w.close() }, 800);   // fallback if the window did not hear us
  saveArr(remove(arrangement(), id)); known.delete(id); refreshUi();
}
export function bringBackAll() { popouts().forEach(p => bringBack(p.id)) }
export async function restoreAll() {
  const ds = await screens(false);
  if (!isDesktop && ds) reflowWeb();
  let n = 0;
  for (const w of arrangement().wins) if (!known.has(w.id)) { if (!popOut(w.kind, { pane: w.pane })) break; n++ }
  if (isDesktop) void desk!.win!('reflow');
  toast(n ? `Restored ${n} window${n > 1 ? 's' : ''}` : 'All windows are open');
}
/** A screen was unplugged or changed: put every window this page opened back on a screen that exists. */
function reflowWeb() {
  const ds = webScreens; if (!ds?.length) return;
  const a = arrangement();
  for (const [id, w] of wins) {
    if (w.closed) continue;
    const spec = a.wins.find(x => x.id === id), cur = { x: w.screenX, y: w.screenY, width: w.outerWidth, height: w.outerHeight };
    const res = restoreRect({ rect: cur, displayId: displayFor(cur, ds)?.id ?? spec?.displayId ?? null }, ds);
    if (res.moved || (res.rect.x !== cur.x || res.rect.y !== cur.y)) try { w.moveTo(res.rect.x, res.rect.y); w.resizeTo(res.rect.width, res.rect.height) } catch {}
  }
}

// ---- the Monitors menu ----
export async function monitorsMenu(x: number, y: number) {
  const ds = await screens(false), items: MenuItem[] = [];
  if (ds) {
    items.push({ head: `Screens (${ds.length})` }, ...ds.map((d, i) => ({ label: sName(d, i), icon: '🖥', disabled: true })));
    const move = (d: Screen) => {
      if (isDesktop) return void desk!.win!('move', { displayId: d.id });
      if (isPopout) { const r = placeOn(d, { width: outerWidth, height: outerHeight }); try { moveTo(r.x, r.y); resizeTo(r.width, r.height) } catch {} patchSpec({ id: myId, kind: popKind!, open: true, rect: r, displayId: d.id }); return }
      const raw = d.raw; if (raw && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen({ screen: raw } as FullscreenOptions).catch(() => toast('The browser did not allow it: drag the window to that screen'));
      else toast('Drag the window to that screen: browsers do not let a page move its own main window');
    };
    items.push({ sep: true }, { label: isPopout || isDesktop ? 'Move this window to…' : 'Fullscreen this window on…', icon: '⇄', sub: ds.map((d, i) => ({ label: `Screen ${sName(d, i)}`, action: () => move(d) })) });
    if (!isPopout) items.push({ label: 'Pop out to screen…', icon: '⧉', sub: (Object.keys(LABEL) as Kind[]).map(k => ({ label: LABEL[k] + (k === 'chart' ? ' (active)' : ''), sub: ds.map((d, i) => ({ label: `Screen ${sName(d, i)}`, action: () => void popOut(k, { pane: k === 'chart' ? host?.active() : undefined, display: d }) })) })) });
  } else if (canAskScreens()) items.push({ label: 'Detect screens… (asks permission)', icon: '🖥', action: async () => { if (await screens(true)) void monitorsMenu(x, y); else toast('Screen access was not allowed') } });
  else items.push({ label: 'This browser cannot list screens: pop-outs open where it puts them', disabled: true });
  const ps = popouts();
  if (ps.length) items.push({ sep: true }, { head: 'Open pop-outs' }, ...ps.map(p => ({ label: LABEL[p.kind] + (p.kind === 'chart' ? ` ${(p.pane ?? 0) + 1}` : ''), icon: '↩', hint: 'Bring back', action: () => bringBack(p.id) })));
  items.push({ sep: true }, { label: 'Restore all windows', icon: '⟲', action: () => void restoreAll() });
  if (ps.length) items.push({ label: 'Bring all back', icon: '↩', action: bringBackAll });
  showMenu(x, y, items);
}

// ---- init ----
function buttons() {
  const add = (h: Element | null, kind: Kind | (() => Kind)) => {
    if (!h || h.querySelector('.po-btn')) return;
    const b = document.createElement('button');
    b.className = 'x po-btn'; b.title = 'Pop out to its own window (another monitor)'; b.textContent = '⧉';
    b.onclick = () => void popMenu(typeof kind === 'function' ? kind() : kind, undefined, b);
    h.append(b);
  };
  add($('#s-watch h3'), 'watch'); add($('#s-alerts h3'), 'alerts'); add($('#s-dom h3'), 'dom');
  const bt = $('#bToggle'); if (bt && !$('#bTabs .po-btn')) {
    const b = document.createElement('button');
    b.className = 'x po-btn'; b.title = 'Pop out this panel to its own window (another monitor)'; b.textContent = '⧉';
    b.onclick = () => { const t = $('#bTabs button.on[data-tab]')?.dataset.tab; void popMenu(t === 'pine' ? 'pine' : t === 'tester' ? 'tester' : 'positions', undefined, b) };
    bt.before(b);
  }
  // Placeholders: what a panel shows in the main window while it lives in a pop-out.
  for (const [sel, kind] of [['#s-watch', 'watch'], ['#s-alerts', 'alerts'], ['#s-dom', 'dom'], ['#b-pine', 'pine'], ['#b-tester', 'tester'], ['#b-positions', 'positions'], ['#b-orders', 'positions'], ['#b-history', 'positions']] as const) {
    const el = $(sel); if (!el || el.querySelector(':scope > .po-ph')) continue;
    const ph = document.createElement('div'); ph.className = 'po-ph'; ph.dataset.kind = kind;
    ph.innerHTML = `<span>Popped out to its own window</span><button>Bring back</button>`;
    ph.querySelector('button')!.onclick = () => bringBack(slotId(kind));
    el.prepend(ph);
  }
}
function bar() {
  const d = document.createElement('div'); d.id = 'poBar';
  d.innerHTML = `<b>⧉ ${esc(LABEL[popKind!])}</b><span class="grow"></span><span id="poMsg" class="muted"></span><button id="poMove" title="Move this window to another screen">🖥 Screen ▾</button><button id="poBack" title="Close this window and show the panel in the main window again">↩ Bring back</button>`;
  document.body.prepend(d);
  $('#poMove').onclick = e => { const r = (e.target as HTMLElement).getBoundingClientRect(); void monitorsMenu(r.left, r.bottom + 2) };
  $('#poBack').onclick = () => dock();
  document.title = `${LABEL[popKind!]} · Chart Terminal`;
}
let docking = false;
function dock() { docking = true; saveArr(remove(arrangement(), myId)); closeSoon() }
function closeSoon() { pushCfg(); setTimeout(() => window.close(), 50) }

export function initWindows(h: WinHost) {
  host = h;
  buttons();
  hello();
  setInterval(() => { hello(); refreshUi() }, 4000);
  addEventListener('pagehide', () => { send({ t: 'bye', id: myId }); if (!isPopout) send({ t: 'closing' }); if (isPopout && !isDesktop) saveGeometry(false) });
  onMsg(m => {
    const now = Date.now();
    if (m.t === 'hello') {
      if (m.id === myId) return;
      const fresh = !known.has(m.id);
      known.set(m.id, { kind: m.kind, pane: m.pane, seen: now });
      if (fresh) hello();   // a newcomer learns who is here
      closedNote(false); refreshUi(); return;
    }
    if (m.t === 'bye') { known.delete(m.id); refreshUi(); return }
    if (m.t === 'closing') { if (isPopout) setTimeout(() => { if (!mainAlive()) closedNote(true) }, 4000); known.forEach((v, k) => { if (v.kind === 'main') known.delete(k) }); return }
    if (m.t === 'dock') { if (m.id === myId) dock(); return }
    if (m.t === 'select') { if (!isPopout) h.select(m.symbol); return }
    if (m.t === 'cfg') {
      if (m.id === myId) return;
      const from = known.get(m.id);
      let i = -1;
      if (!isPopout) { if (from && from.kind !== 'main') i = from.kind === 'chart' ? (from.pane === m.pane ? m.pane : -1) : m.active ? h.active() : -1 }
      else if (from?.kind === 'main') i = popKind === 'chart' ? (m.pane === popPane ? 0 : -1) : m.active ? 0 : -1;
      const p = h.panes()[i];
      if (!p) return;
      if (JSON.stringify(plain(p.cfg)) === JSON.stringify(m.cfg)) return;
      h.applyCfg(i, m.cfg);
    }
  });
  if (isPopout) {
    bar();
    if (tabOf(popKind!)) h.showBottom(tabOf(popKind!));
    if (!isDesktop) { setInterval(() => saveGeometry(true), 2500); void screens(false) }
    pushCfg();
  } else {
    decorateCells();
    // Leaving the page with pop-outs open: ask first (the browser shows its own dialog).
    addEventListener('beforeunload', e => { if (popouts().length) { e.preventDefault(); e.returnValue = '' } });
    // The desktop shell asks "keep, bring back or close the pop-outs?" when the main window closes.
    (window as unknown as { __ctDock?: () => void }).__ctDock = bringBackAll;
  }
  refreshUi();
}
let lastGeo = '';
function saveGeometry(open: boolean) {
  const rect = { x: screenX, y: screenY, width: outerWidth, height: outerHeight };
  if (docking || rect.width < 100 || rect.height < 80) return;
  const sn = snapshot(rect, webScreens ?? []), js = JSON.stringify(sn) + open;
  if (js === lastGeo) return;
  lastGeo = js; patchSpec({ id: myId, kind: popKind!, open, rect, displayId: sn.displayId });
}
/** The main window is gone: say so (once it is clear it is not just reloading) and let the user decide. */
function closedNote(on: boolean) {
  const m = $('#poMsg'); if (!m) return;
  if (!on) { m.textContent = ''; return }
  m.innerHTML = 'Main window closed. <button id="poKeep">Keep open</button> <button id="poShut">Close this window</button>';
  $('#poKeep').onclick = () => { m.textContent = 'Running on its own' };
  $('#poShut').onclick = () => window.close();
}
