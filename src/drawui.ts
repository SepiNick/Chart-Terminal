// Drawing UI: left toolbar with group flyouts & favorites, floating toolbar, properties dialog, templates, context menu.
import { ALL_TOOLS, CURSORS, GROUPS, TOOL_MAP, groupSections, type CursorMode } from './tools/index.ts';
import type { Drawing, GroupId, Style, ToolDef } from './tools/types.ts';
import { iconSvg } from './tools/icons.ts';
import type { LabelH, LabelV } from './tools/labels.ts';
import { styleFor, type DrawingLayer, type Magnet } from './drawings.ts';
import { showMenu, type MenuItem } from './menu.ts';
import { store, $, $$, esc, toast } from './store.ts';
import { TFS, tfSeconds } from './data.ts';
import { DEFAULT_POS, anchorXY, clampBox, nearestAnchor, orientFor, place, sanitize, snapAnchor, type FavPos, type Rect } from './favbarpos.ts';

export interface DrawUIHost {
  layer(): DrawingLayer;
  layers(): DrawingLayer[];
  tf(): string;
  magnet(): Magnet; setMagnet(m: Magnet): void;
  keepDrawing(): boolean; setKeepDrawing(on: boolean): void;
  hide(what: 'drawings' | 'indicators' | 'positions' | 'all'): void;
  remove(what: 'drawings' | 'indicators' | 'all'): void;
  commit(label: string): void;          // drawings changed outside the layer (dialog etc.)
  alertOn(d: Drawing): void;
  paneLabels(): string[];               // panes of the active chart, for "Move to"
  positionOrder(d: Drawing): void;      // send a Long/Short position drawing as a paper order with TP/SL
}
const isPosition = (d: Drawing) => d.type === 'long' || d.type === 'short';

const fav = new Set(store.get<string[]>('favTools', []));
const lastInGroup = store.get<Record<string, string>>('lastTool', {});
const templates = store.get<Record<string, Record<string, Partial<Style>>>>('drawTemplates', {});
const defaults = store.get<Record<string, Partial<Style>>>('drawDefaults', {});
export const templateFor = (type: string) => defaults[type];
const saveTpl = () => { store.set('drawTemplates', templates); store.set('drawDefaults', defaults) };
const tplOf = (s: Style): Partial<Style> => { const { text: _t, ...rest } = structuredClone(s); return rest };

// ---------- left toolbar ----------
// data-tip / data-key: the hover tooltip (src/tooltip.ts) shows the name and the hotkey, like TradingView's toolbar.
const tip = (name: string, key?: string) => `data-tip="${esc(name)}"${key ? ` data-key="${esc(key)}"` : ''}`;
const CHEVRON = '<svg viewBox="0 0 6 10" width="6" height="10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5L4.5 5 1.5 8.5"/></svg>';
export function renderLeftToolbar(host: DrawUIHost) {
  const el = $('#tools'), l = host.layer();
  if (!l) return; // chart still loading
  const cur = CURSORS.find(c => c.id === l.cursor)!;
  const groupBtn = (g: (typeof GROUPS)[number]) => {
    const tools = ALL_TOOLS.filter(t => t.group === g.id);
    if (!tools.length) return '';
    const shown = TOOL_MAP.get(lastInGroup[g.id]) ?? tools[0];
    return `<div class="tg"><button data-tool="${shown.id}" class="${l.tool === shown.id ? 'on' : ''}" ${tip(shown.name, shown.key)} aria-label="${esc(shown.name)}">${iconSvg(shown.id, shown.icon)}</button><button class="fly" data-group="${g.id}" ${tip(g.name)} aria-label="${esc(g.name)}">${CHEVRON}</button></div>`;
  };
  const act = (id: string, name: string, on = false) => `<button data-act="${id}" class="${on ? 'on' : ''}" ${tip(name)} aria-label="${esc(name)}">${iconSvg(id)}</button>`;
  el.innerHTML =
    `<div class="tg"><button data-cursor="${cur.id}" class="${l.tool === 'cursor' ? 'on' : ''}" ${tip(cur.name)} aria-label="${esc(cur.name)}">${iconSvg(cur.id, cur.icon)}</button><button class="fly" data-group="cursors" ${tip('Cursors')} aria-label="Cursors">${CHEVRON}</button></div>` +
    GROUPS.slice(1).map(groupBtn).join('') +
    `<hr>` +
    act('measure', 'Measure (Shift+click)', l.tool === 'measure') + act('zoom', 'Zoom in (drag a box)', l.tool === 'zoom') + act('zoomout', 'Zoom out') +
    `<hr>` +
    act('magnet', `Magnet: ${host.magnet()}`, host.magnet() !== 'off') + act('keep', 'Stay in drawing mode', host.keepDrawing()) +
    act('lock', 'Lock all drawings', !!l.drawings.length && l.drawings.every(d => d.locked)) + act('hide', 'Hide…', l.hideAll) + act('remove', 'Remove…') +
    `<hr>
    <input type="color" id="drawColor" value="${esc(l.color)}" ${tip('Color for new drawings')}>` +
    act('favbar', 'Favorites toolbar', store.get('favBar', false));
  renderFavBar(host);
}

/** A group's tools in sections (TradingView-style): section titles, icon + name + hotkey, the current tool highlighted,
 *  and a star that shows on hover (and stays when the tool is a favorite). */
function flyout(host: DrawUIHost, group: string, anchor: HTMLElement) {
  const r = anchor.closest('.tg')!.getBoundingClientRect(), l = host.layer();
  if (group === 'cursors') {
    const m = showMenu(r.right + 4, r.top, CURSORS.map(c => ({ label: c.name, iconHtml: iconSvg(c.id, c.icon), selected: l.tool === 'cursor' && l.cursor === c.id, action: () => setCursor(host, c.id) })));
    m.classList.add('tfly');
    return;
  }
  const rows: ToolDef[] = [], items: MenuItem[] = [];
  for (const s of groupSections(group as GroupId)) {
    if (s.name) items.push({ head: s.name });
    for (const t of s.tools) { rows.push(t); items.push({ label: t.name, iconHtml: iconSvg(t.id, t.icon), hint: t.key ?? '', selected: l.tool === t.id, action: () => setTool(host, t.id) }) }
  }
  const m = showMenu(r.right + 4, r.top, items);
  m.classList.add('tfly');
  // Star toggles favorites without picking the tool.
  $$('.ctx-i', m).forEach((row, i) => {
    const t = rows[i];
    const star = document.createElement('span');
    star.className = 'star' + (fav.has(t.id) ? ' on' : ''); star.innerHTML = iconSvg('favbar'); star.dataset.tip = fav.has(t.id) ? 'Remove from favorites' : 'Add to favorites';
    // Starring shows the favorites bar, as TradingView does; the ★ button at the bottom still hides it.
    star.onclick = e => { e.stopPropagation(); if (fav.has(t.id)) fav.delete(t.id); else { fav.add(t.id); store.set('favBar', true) } store.set('favTools', [...fav]); star.classList.toggle('on'); renderLeftToolbar(host) };
    row.append(star);
  });
}
export function setTool(host: DrawUIHost, id: string) {
  const t = TOOL_MAP.get(id);
  if (t) { lastInGroup[t.group] = id; store.set('lastTool', lastInGroup) }
  host.layers().forEach(l => l.setTool('cursor'));
  host.layer().setTool(id);
  renderLeftToolbar(host);
}
function setCursor(host: DrawUIHost, c: CursorMode) { host.layers().forEach(l => l.setCursor(c)); renderLeftToolbar(host) }

// ---- floating favorites toolbar: drag by the grip, snaps to corners / edge midpoints of the chart area ----
let favPos = sanitize(store.get('favBarPos', DEFAULT_POS));
let favDrag: { dx: number; dy: number; start: FavPos; id: number } | null = null;
let hostRef: DrawUIHost | null = null;
const saveFavPos = () => store.set('favBarPos', favPos);
const favRects = () => {
  const g = $('#grid').getBoundingClientRect();
  // dock area: the chart area minus the legend row, the price scale (right) and the time scale (bottom)
  const dock: Rect = { x: g.left, y: g.top + 32, w: Math.max(0, g.width - 72), h: Math.max(0, g.height - 32 - 34) };
  const free: Rect = { x: g.left, y: 0, w: Math.max(0, innerWidth - g.left), h: Math.max(0, innerHeight) };
  return { dock, free };
};
function layoutFavBar() {
  const bar = $('#favBar');
  if (bar.style.display === 'none') return;
  const { dock, free } = favRects(), o = orientFor(favPos.anchor, favPos.orient);
  bar.classList.toggle('v', o === 'v'); bar.classList.toggle('collapsed', favPos.collapsed);
  bar.style.maxWidth = Math.max(40, free.w - 16) + 'px'; bar.style.maxHeight = Math.max(40, free.h - 16) + 'px';
  const p = place(favPos, bar.offsetWidth, bar.offsetHeight, dock, free);
  bar.style.left = p.x + 'px'; bar.style.top = p.y + 'px';
}
function renderFavBar(host: DrawUIHost) {
  if (!host.layer()) return;
  const bar = $('#favBar'), on = store.get('favBar', false) && fav.size > 0;
  bar.style.display = on ? 'flex' : 'none';
  if (!on) $('#favGuide').style.display = 'none';
  const side = favPos.anchor === null || favPos.anchor === 'l' || favPos.anchor === 'r', c = favPos.collapsed;
  const b = (k: string, label: string, ico: string, extra = '') => `<button data-fav="${k}" class="fctl" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${ico}</button>`;
  bar.innerHTML =
    b('grip', 'Drag to move the toolbar (arrow keys move it, Enter snaps, double-click resets)', '⠿', 'tabindex="0" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape"') +
    (c ? '' : [...fav].map(id => TOOL_MAP.get(id)).filter(Boolean).map(t =>
      `<button data-tool="${t!.id}" class="${host.layer().tool === t!.id ? 'on' : ''}" ${tip(t!.name, t!.key)} aria-label="${esc(t!.name)}">${iconSvg(t!.id, t!.icon)}</button>`).join('')) +
    (!c && side ? b('orient', 'Switch between horizontal and vertical', '⇄') : '') +
    b('collapse', c ? 'Expand the toolbar' : 'Collapse the toolbar', c ? '▸' : '◂', `aria-expanded="${!c}"`);
  layoutFavBar();
}
function wireFavBar() {
  const bar = $('#favBar'), guide = $('#favGuide');
  const end = (keep: boolean) => {
    if (!favDrag) return;
    if (!keep) favPos = favDrag.start;
    favDrag = null; guide.style.display = 'none'; bar.classList.remove('drag'); layoutFavBar(); if (keep) saveFavPos();
  };
  bar.addEventListener('pointerdown', e => {
    const g = (e.target as HTMLElement).closest<HTMLElement>('[data-fav=grip]');
    if (!g || e.button > 0) return;
    const r = bar.getBoundingClientRect();
    favDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, start: favPos, id: e.pointerId };
    g.setPointerCapture(e.pointerId); bar.classList.add('drag'); e.preventDefault(); g.focus();
  });
  bar.addEventListener('pointermove', e => {
    if (!favDrag) return;
    const { dock, free } = favRects(), w = bar.offsetWidth, h = bar.offsetHeight;
    const c = clampBox(e.clientX - favDrag.dx, e.clientY - favDrag.dy, w, h, free);
    const a = snapAnchor(c.x, c.y, w, h, dock);
    favPos = { ...favPos, anchor: a, x: c.x, y: c.y };
    const s = a ? anchorXY(a, w, h, dock) : c;
    bar.style.left = c.x + 'px'; bar.style.top = c.y + 'px';
    guide.style.cssText = `display:${a ? 'block' : 'none'};left:${s.x}px;top:${s.y}px;width:${w}px;height:${h}px`;   // snap preview
  });
  bar.addEventListener('pointerup', e => { if (favDrag?.id === e.pointerId) end(true) });
  bar.addEventListener('pointercancel', () => end(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && favDrag) { e.stopPropagation(); end(false) } }, true);
  bar.addEventListener('dblclick', e => {
    if (!(e.target as HTMLElement).closest('[data-fav=grip]')) return;
    favPos = { ...DEFAULT_POS }; saveFavPos(); layoutFavBar();
  });
  bar.addEventListener('keydown', e => {
    if (!(e.target as HTMLElement).matches('[data-fav=grip]')) return;
    const { dock, free } = favRects(), w = bar.offsetWidth, h = bar.offsetHeight, r = bar.getBoundingClientRect();
    if (e.key === 'Enter') { favPos = { ...favPos, anchor: nearestAnchor(r.left, r.top, w, h, dock) }; saveFavPos(); layoutFavBar(); e.preventDefault(); return }
    const step = e.shiftKey ? 64 : 16, d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    const c = clampBox(r.left + d[0], r.top + d[1], w, h, free);
    favPos = { ...favPos, anchor: null, x: c.x, y: c.y }; saveFavPos(); layoutFavBar();
  });
  bar.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fav]'); if (!b) return;
    if (b.dataset.fav === 'collapse') favPos = { ...favPos, collapsed: !favPos.collapsed };
    else if (b.dataset.fav === 'orient') favPos = { ...favPos, orient: orientFor(favPos.anchor, favPos.orient) === 'v' ? 'h' : 'v' };
    else return;
    saveFavPos(); renderFavBar(hostRef!);
    $(`#favBar [data-fav=${b.dataset.fav}]`)?.focus();
  });
  addEventListener('resize', layoutFavBar);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layoutFavBar).observe($('#grid'));
}

export function wireLeftToolbar(host: DrawUIHost) {
  hostRef = host; wireFavBar();
  const click = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.dataset.group) return flyout(host, b.dataset.group, b);
    if (b.dataset.tool) return setTool(host, host.layer().tool === b.dataset.tool ? 'cursor' : b.dataset.tool);
    if (b.dataset.cursor) return setCursor(host, b.dataset.cursor as CursorMode);
    const r = b.getBoundingClientRect(), l = host.layer();
    switch (b.dataset.act) {
      case 'measure': case 'zoom': setTool(host, l.tool === b.dataset.act ? 'cursor' : b.dataset.act); break;
      case 'zoomout': zoomOut(host); break;
      case 'magnet': showMenu(r.right + 2, r.top, (['off', 'weak', 'strong'] as Magnet[]).map(m => ({ label: m === 'off' ? 'Magnet off' : `${m[0].toUpperCase()}${m.slice(1)} magnet`, checked: host.magnet() === m, action: () => { host.setMagnet(m); renderLeftToolbar(host) } }))); break;
      case 'keep': host.setKeepDrawing(!host.keepDrawing()); renderLeftToolbar(host); break;
      case 'lock': { const all = l.drawings.every(d => d.locked); l.drawings.forEach(d => (d.locked = !all)); l.onChange(); l.update(); renderLeftToolbar(host); break }
      case 'hide': showMenu(r.right + 2, r.top, [
        { label: 'Hide drawings', checked: l.hideAll, action: () => host.hide('drawings') },
        { label: 'Hide indicators', action: () => host.hide('indicators') },
        { label: 'Hide positions & orders', action: () => host.hide('positions') },
        { label: 'Hide all', hint: 'Ctrl+Alt+H', action: () => host.hide('all') },
      ]); break;
      case 'remove': showMenu(r.right + 2, r.top, [
        { label: `Remove ${l.drawings.length} drawings`, action: () => host.remove('drawings') },
        { label: 'Remove indicators', action: () => host.remove('indicators') },
        { label: 'Remove drawings & indicators', action: () => host.remove('all') },
      ]); break;
      case 'favbar': store.set('favBar', !store.get('favBar', false)); renderLeftToolbar(host); if (!fav.size) toast('Star tools in the toolbar flyouts to add favorites'); break;
    }
  };
  $('#tools').addEventListener('click', click);
  $('#favBar').addEventListener('click', click);
  $('#tools').addEventListener('input', e => {
    const i = e.target as HTMLInputElement; if (i.id !== 'drawColor') return;
    host.layers().forEach(l => (l.color = i.value));
    const l = host.layer();
    if (l.selected.size) { l.selected.forEach(d => { d.style.color = i.value; d.style.textColor = i.value; d.style.fillColor = i.value }); l.onChange(); l.update() }
  });
}
let zoomOut = (_h: DrawUIHost) => {};
export function setZoomOut(fn: (h: DrawUIHost) => void) { zoomOut = fn }

// ---------- floating toolbar ----------
const WIDTHS = [1, 2, 3, 4], DASHES = ['solid', 'dashed', 'dotted'] as const;
const floatCtx = new WeakMap<HTMLElement, { cell: HTMLElement; host: DrawUIHost; l: DrawingLayer }>();
export function renderFloating(cell: HTMLElement, host: DrawUIHost, l: DrawingLayer) {
  let bar = cell.querySelector<HTMLElement>('.ftb');
  if (!bar) {
    bar = document.createElement('div'); bar.className = 'ftb'; cell.append(bar);
    bar.addEventListener('mousedown', e => e.stopPropagation());
    bar.addEventListener('input', e => {
      const { l } = floatCtx.get(bar!)!, i = e.target as HTMLInputElement, k = i.dataset.k!;
      l.selected.forEach(d => {
        if (k === 'color') { d.style.color = i.value; d.style.textColor = i.value }
        else if (k === 'fill') { d.style.fillColor = i.value; if (!d.style.fillAlpha) d.style.fillAlpha = 0.2 }
        else if (k === 'width') d.style.width = +i.value;
        else if (k === 'dash') d.style.dash = i.value as Style['dash'];
      });
      l.onChange(); l.update();
    });
    bar.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      const { cell, host, l } = floatCtx.get(bar!)!, d = l.primary; if (!d) return;
      const r = b.getBoundingClientRect();
      switch (b.dataset.act) {
        case 'tpl': templateMenu(r.left, r.bottom + 2, d, l); break;
        case 'props': openProps(d, l, host); break;
        case 'alert': host.alertOn(d); break;
        case 'order': host.positionOrder(d); break;
        case 'lock': { const on = !d.locked; l.selected.forEach(x => (x.locked = on)); l.onChange(); renderFloating(cell, host, l); break }
        case 'clone': cloneDrawings(l); break;
        case 'more': drawingMenu(r.left, r.bottom + 2, d, l, host); break;
        case 'text': textPanel(b, d, l, cell); break;
        case 'del': l.remove(...l.selected); break;
      }
    });
  }
  floatCtx.set(bar, { cell, host, l });
  const d = l.primary;
  bar.style.display = d ? 'flex' : 'none';
  const pop = cell.querySelector<HTMLElement>('.ftb-pop');
  if (pop && (!d || pop.dataset.id !== String(d.id))) pop.remove();   // the text panel belongs to one drawing
  if (!d) return;
  const def = TOOL_MAP.get(d.type);
  bar.innerHTML = `<button data-act="tpl" title="Template">▤</button>
    <label title="Line color" class="sw"><input type="color" data-k="color" value="${esc(d.style.color)}"></label>
    <label title="Fill color" class="sw fillsw"><input type="color" data-k="fill" value="${esc(d.style.fillColor)}"></label>
    <select data-k="width" title="Width">${WIDTHS.map(w => `<option ${w === d.style.width ? 'selected' : ''} value="${w}">${w}px</option>`).join('')}</select>
    <select data-k="dash" title="Style">${DASHES.map(s => `<option ${s === d.style.dash ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <button data-act="props" title="Settings">⚙</button>
    ${def?.priceAt ? '<button data-act="alert" title="Add alert on this drawing">⏰</button>' : ''}
    ${isPosition(d) ? '<button data-act="order" title="Place as paper order with TP/SL">📤</button>' : ''}
    ${def?.frame ? '<button data-act="text" class="tbtn" title="Write text on this drawing">T</button>' : ''}
    <button data-act="lock" class="${d.locked ? 'on' : ''}" title="${d.locked ? 'Unlock' : 'Lock'}">${d.locked ? '🔒' : '🔓'}</button>
    <button data-act="clone" title="Clone (Ctrl+drag)">⧉</button>
    <button data-act="more" title="More">⋯</button>
    <button data-act="del" class="del" title="Delete this drawing (Del)" aria-label="Delete">🗑 Delete</button>`;
}
const POS: [LabelV, LabelH, string, string][] = [
  ['top', 'left', '↖', 'Top left'], ['top', 'center', '↑', 'Top center'], ['top', 'right', '↗', 'Top right'],
  ['middle', 'left', '←', 'Middle left'], ['middle', 'center', '●', 'Middle'], ['middle', 'right', '→', 'Middle right'],
  ['bottom', 'left', '↙', 'Bottom left'], ['bottom', 'center', '↓', 'Bottom center'], ['bottom', 'right', '↘', 'Bottom right'],
];
const SIZES = [10, 12, 14, 16, 20, 24, 32, 40];
/** The "T" panel: write text on a line or channel, choose where it goes, its color and size. Changes apply as you type. */
function textPanel(anchor: HTMLElement, d: Drawing, l: DrawingLayer, cell: HTMLElement) {
  const old = cell.querySelector<HTMLElement>('.ftb-pop');
  if (old) { old.remove(); if (old.dataset.id === String(d.id)) return }   // a second click on T closes it
  const s = d.style, h = (s.lblH as LabelH) ?? 'center', v = (s.lblV as LabelV) ?? 'top', size = Number(s.lblSize) || 14, color = typeof s.lblColor === 'string' ? s.lblColor : s.color;
  const pop = document.createElement('div'); pop.className = 'ftb-pop'; pop.dataset.id = String(d.id);
  pop.innerHTML = `<textarea data-t="text" rows="2" maxlength="200" placeholder="Write something…" aria-label="Text">${esc(typeof s.lbl === 'string' ? s.lbl : '')}</textarea>
    <div class="row"><label>Color <input type="color" data-t="color" value="${esc(color)}"></label>
      <label>Size <select data-t="size">${SIZES.map(n => `<option ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-t="bold" ${s.lblBold ? 'checked' : ''}> Bold</label><span class="grow"></span><button type="button" data-t="clear">Clear</button></div>
    <div class="posgrid" role="group" aria-label="Position">${POS.map(([pv, ph, ch, name]) => `<button type="button" data-pv="${pv}" data-ph="${ph}" class="${pv === v && ph === h ? 'on' : ''}" title="${name}" aria-label="${name}">${ch}</button>`).join('')}</div>`;
  cell.append(pop);
  const br = (anchor.closest('.ftb') ?? anchor).getBoundingClientRect(), cr = cell.getBoundingClientRect();   // the bar is centred with a transform: measure, don't use offsetLeft
  pop.style.top = `${br.bottom - cr.top + 6}px`; pop.style.left = `${Math.max(4, Math.min(br.left - cr.left, cr.width - 304))}px`;
  pop.addEventListener('mousedown', e => e.stopPropagation());
  pop.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') pop.remove() });
  const apply = (patch: Record<string, unknown>) => { for (const x of l.selected) if (TOOL_MAP.get(x.type)?.frame) Object.assign(x.style, patch); l.onChange(); l.update() };
  const text = pop.querySelector<HTMLTextAreaElement>('[data-t="text"]')!;
  text.addEventListener('input', () => apply({ lbl: text.value, lblH: (d.style.lblH as string) ?? 'center', lblV: (d.style.lblV as string) ?? 'top', lblSize: Number(d.style.lblSize) || 14, lblColor: typeof d.style.lblColor === 'string' ? d.style.lblColor : d.style.color }));
  pop.addEventListener('input', e => {
    const t = (e.target as HTMLInputElement).dataset.t;
    if (t === 'color') apply({ lblColor: (e.target as HTMLInputElement).value });
    else if (t === 'size') apply({ lblSize: +(e.target as HTMLSelectElement).value });
    else if (t === 'bold') apply({ lblBold: (e.target as HTMLInputElement).checked });
  });
  pop.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    if (b.dataset.t === 'clear') { apply({ lbl: '' }); text.value = ''; text.focus(); return }
    if (b.dataset.pv) { apply({ lblV: b.dataset.pv, lblH: b.dataset.ph }); pop.querySelectorAll('.posgrid button').forEach(x => x.classList.toggle('on', x === b)) }
  });
  text.focus();
}
function cloneDrawings(l: DrawingLayer, offsetBars = 3) {
  const copies = [...l.selected].map(d => ({ ...structuredClone(d), id: Date.now() + Math.random(), locked: false }));
  const g = l.geo();
  copies.forEach(c => (c.pts = c.pts.map(p => ({ t: g.timeAt(g.logical(p.t) + offsetBars), p: p.p }))));
  l.drawings.push(...copies); l.select(copies); l.onChange();
}

// ---------- templates ----------
function templateMenu(x: number, y: number, d: Drawing, l: DrawingLayer) {
  const own = templates[d.type] ?? {};
  showMenu(x, y, [
    { label: 'Save drawing template as…', action: () => { const n = prompt('Template name'); if (n) { (templates[d.type] ??= {})[n] = tplOf(d.style); saveTpl() } } },
    { label: 'Save as default', action: () => { defaults[d.type] = tplOf(d.style); saveTpl(); toast('Saved as default for new drawings') } },
    { label: 'Apply default', action: () => { const def = TOOL_MAP.get(d.type); if (def) { d.style = { ...styleFor(def, d.style.color), ...defaults[d.type], text: d.style.text }; l.onChange(); l.update() } } },
    ...(Object.keys(own).length ? [{ sep: true }] : []),
    ...Object.entries(own).map(([n, s]) => ({ label: n, action: () => { l.selected.forEach(x => (x.style = { ...x.style, ...structuredClone(s) })); l.onChange(); l.update() } })),
  ]);
}

// ---------- context menu ----------
export function visibilityPreset(d: Drawing, tf: string, how: 'only' | 'above' | 'below' | 'all') {
  const s = tfSeconds(tf);
  d.vis = how === 'all' ? undefined : how === 'only' ? { min: s, max: s } : how === 'above' ? { min: s, max: 1e12 } : { min: 0, max: s };
}
export function drawingMenu(x: number, y: number, d: Drawing, l: DrawingLayer, host: DrawUIHost) {
  const sel = [...l.selected], vis = (how: Parameters<typeof visibilityPreset>[2]) => () => { sel.forEach(s => visibilityPreset(s, host.tf(), how)); l.onChange(); l.update() };
  const order = (how: 'front' | 'back' | 'forward' | 'backward') => () => l.reorder(d, how);
  showMenu(x, y, [
    { label: 'Settings…', icon: '⚙', action: () => openProps(d, l, host) },
    { label: 'Clone', icon: '⧉', hint: 'Ctrl+drag', action: () => cloneDrawings(l) },
    { label: 'Copy', hint: 'Ctrl+C', action: () => copyDrawings(l) },
    { label: d.locked ? 'Unlock' : 'Lock', icon: '🔒', action: () => { sel.forEach(s => (s.locked = !d.locked)); l.onChange(); l.update() } },
    { label: 'Hide', icon: '👁', action: () => { sel.forEach(s => (s.hidden = true)); l.select([]); l.onChange() } },
    ...(TOOL_MAP.get(d.type)?.priceAt ? [{ label: 'Add alert', icon: '⏰', action: () => host.alertOn(d) }] : []),
    ...(isPosition(d) ? [{ label: 'Place paper order (TP/SL)…', icon: '📤', action: () => host.positionOrder(d) }] : []),
    { sep: true },
    { label: 'Move to', sub: host.paneLabels().map((name, k) => ({
      label: name, checked: l.paneOf(d) === k,
      action: () => { sel.forEach(s => { if (k) s.pane = k; else delete s.pane }); l.onChange(); l.update() },
    })) },
    { label: 'Visual order', sub: [
      { label: 'Bring to front', action: order('front') }, { label: 'Send to back', action: order('back') },
      { label: 'Bring forward', action: order('forward') }, { label: 'Send backward', action: order('backward') },
    ] },
    { label: 'Visibility on intervals', sub: [
      { label: 'Current interval only', action: vis('only') }, { label: 'Current interval and above', action: vis('above') },
      { label: 'Current interval and below', action: vis('below') }, { label: 'All intervals', checked: !d.vis, action: vis('all') },
    ] },
    { label: 'Template', sub: [
      { label: 'Save as default', action: () => { defaults[d.type] = tplOf(d.style); saveTpl() } },
      { label: 'Save template as…', action: () => { const n = prompt('Template name'); if (n) { (templates[d.type] ??= {})[n] = tplOf(d.style); saveTpl() } } },
    ] },
    { sep: true },
    { label: 'Remove', icon: '🗑', hint: 'Del', action: () => l.remove(...sel) },
  ]);
}

// ---------- copy / paste ----------
let clipboard: Drawing[] = [];
export function copyDrawings(l: DrawingLayer) { clipboard = structuredClone([...l.selected]); if (clipboard.length) toast(`Copied ${clipboard.length} drawing(s)`) }
export function pasteDrawings(l: DrawingLayer) {
  if (!clipboard.length) return;
  const copies = structuredClone(clipboard).map(d => ({ ...d, id: Date.now() + Math.random() }));
  l.drawings.push(...copies); l.select(copies); l.onChange();
}

// ---------- properties dialog ----------
const VIS_TFS = TFS.map(tf => ({ tf, s: tfSeconds(tf) }));
export function openProps(d: Drawing, l: DrawingLayer, host: DrawUIHost, tab = 'style') {
  const dlg = $<HTMLDialogElement>('#drawDlg'), def = TOOL_MAP.get(d.type);
  const before = structuredClone(d);
  let cur = tab;
  const field = (k: string, label: string, type: string, extra = '') => {
    const v = d.style[k];
    const id = `dp-${k}`;
    if (type === 'bool') return `<label for="${id}">${esc(label)}</label><input id="${id}" type="checkbox" data-k="${k}" ${v ? 'checked' : ''}>`;
    if (type === 'textarea') return `<label for="${id}">${esc(label)}</label><textarea id="${id}" data-k="${k}" rows="4">${esc(v ?? '')}</textarea>`;
    if (type === 'image') return `<label for="${id}">${esc(label)}</label><input id="${id}" type="file" accept="image/*" data-k="${k}" data-img="1">`;
    if (type.startsWith('[')) return `<label for="${id}">${esc(label)}</label><select id="${id}" data-k="${k}">${(JSON.parse(type) as string[]).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" data-k="${k}" value="${esc(v ?? '')}" ${extra}>`;
  };
  const tabs: Record<string, () => string> = {
    style: () => [
      field('color', 'Line color', 'color'), field('width', 'Line width', 'number', 'min="1" max="10"'),
      field('dash', 'Line style', JSON.stringify(DASHES)),
      field('fillColor', 'Fill color', 'color'), field('fillAlpha', 'Fill opacity (0–1)', 'number', 'min="0" max="1" step="0.05"'),
      field('extendLeft', 'Extend left', 'bool'), field('extendRight', 'Extend right', 'bool'),
      ...(def?.props ?? []).map(p => field(p.key, p.label, p.type === 'select' ? JSON.stringify(p.options) : p.type === 'bool' || p.type === 'textarea' || p.type === 'image' ? p.type : p.type === 'color' ? 'color' : p.type === 'number' ? 'number' : 'text',
        p.type === 'number' ? `min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.step ?? 'any'}"` : '')),
      d.style.levels ? `<h4>Levels</h4><div class="levels">${d.style.levels.map((lv, i) =>
        `<span><input type="checkbox" data-lv="${i}" data-f="on" ${lv.on ? 'checked' : ''}><input type="number" step="any" data-lv="${i}" data-f="v" value="${lv.v}"><input type="color" data-lv="${i}" data-f="color" value="${esc(lv.color)}"></span>`).join('')}</div>` : '',
    ].join(''),
    text: () => [field('text', 'Text', 'textarea'), field('textColor', 'Text color', 'color'), field('fontSize', 'Font size', 'number', 'min="8" max="72"'), field('bold', 'Bold', 'bool'), field('italic', 'Italic', 'bool')].join(''),
    coords: () => d.pts.map((p, i) => def?.screenAnchored
      ? `<label>#${i + 1} X % / Y %</label><span><input type="number" data-pt="${i}" data-f="t" value="${(p.t * 100).toFixed(1)}" step="0.1" style="width:80px"><input type="number" data-pt="${i}" data-f="p" value="${(p.p * 100).toFixed(1)}" step="0.1" style="width:80px"></span>`
      : `<label>#${i + 1} Price / Time</label><span><input type="number" step="any" data-pt="${i}" data-f="p" value="${p.p}" style="width:110px"><input type="datetime-local" data-pt="${i}" data-f="t" value="${new Date(p.t * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></span>`).join(''),
    vis: () => {
      const min = d.vis?.min ?? 0, max = d.vis?.max ?? 1e12;
      const minTf = [...VIS_TFS].reverse().find(x => x.s <= min) ?? VIS_TFS[0], maxTf = VIS_TFS.find(x => x.s >= max) ?? VIS_TFS.at(-1)!;
      const sel = (which: string, pick: (typeof VIS_TFS)[number]) => `<select data-vis="${which}">${VIS_TFS.map(x => `<option value="${x.s}" ${x === pick ? 'selected' : ''}>${x.tf}</option>`).join('')}</select>`;
      return `<label>Visible from</label>${sel('min', minTf)}<label>Visible to</label>${sel('max', maxTf)}
        <label>Presets</label><span class="row"><button type="button" data-vp="only">Current only</button><button type="button" data-vp="above">&amp; above</button><button type="button" data-vp="below">&amp; below</button><button type="button" data-vp="all">All</button></span>`;
    },
  };
  const render = () => {
    $('#drawDlgTitle').textContent = def?.name ?? d.type;
    $$('#drawTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === cur));
    $('#drawForm').innerHTML = tabs[cur]();
  };
  const apply = () => { l.update(); l.onChange() };
  $('#drawTabs').onclick = e => { const t = (e.target as HTMLElement).dataset.tab; if (t) { cur = t; render() } };
  $('#drawForm').oninput = async e => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.lv) { const lv = d.style.levels![+i.dataset.lv]; const f = i.dataset.f as 'on' | 'v' | 'color'; (lv as unknown as Record<string, unknown>)[f] = f === 'on' ? i.checked : f === 'v' ? +i.value : i.value; return apply() }
    if (i.dataset.pt) {
      const p = d.pts[+i.dataset.pt];
      if (def?.screenAnchored) p[i.dataset.f as 't' | 'p'] = +i.value / 100;
      else if (i.dataset.f === 'p') p.p = +i.value; else p.t = new Date(i.value).getTime() / 1000;
      return apply();
    }
    if (i.dataset.vis) { const min = +$<HTMLSelectElement>('[data-vis=min]').value, max = +$<HTMLSelectElement>('[data-vis=max]').value; d.vis = min <= VIS_TFS[0].s && max >= VIS_TFS.at(-1)!.s ? undefined : { min, max: max >= VIS_TFS.at(-1)!.s ? 1e12 : max }; return apply() }
    const k = i.dataset.k; if (!k) return;
    if (i.dataset.img && i.files?.[0]) { d.style[k] = await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(i.files![0]) }); return apply() }
    d.style[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value;
    apply();
  };
  $('#drawForm').onclick = e => { const vp = (e.target as HTMLElement).dataset.vp; if (vp) { visibilityPreset(d, host.tf(), vp as 'only'); apply(); render() } };
  $('#drawCancel').onclick = () => { Object.assign(d, structuredClone(before)); apply(); dlg.close() };
  $('#drawTpl').onclick = () => templateMenu($('#drawTpl').getBoundingClientRect().left, $('#drawTpl').getBoundingClientRect().top - 120, d, l);
  render();
  dlg.showModal();
}
