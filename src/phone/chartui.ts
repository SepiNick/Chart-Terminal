// Phone chart screen: a floating pen button that opens the drawing tools as a bottom sheet, a slim bar while a tool is
// active (name, Undo, Done), a chart-type chip in the time-range strip, and indicator chips in the legend that open the
// indicator menu on tap. DOM-driven, phone only (html[data-ui="phone"]); styles in chart.css.
import { openSheet } from './sheet.ts';
import { uiMode, onUiMode } from './mode.ts';
import { GROUPS, TOOL_MAP, groupSections } from '../tools/index.ts';
import { iconSvg } from '../tools/icons.ts';
import { CHART_TYPES } from '../charttypes.ts';
import { esc } from '../store.ts';

const ACTS: Record<string, string> = { measure: 'Measure', zoom: 'Zoom in' };

export function initChartUi(pick: (toolId: string) => void, chartType: { get: () => string; set: (id: string) => void }) {
  const host = document.getElementById('center'), tools = document.getElementById('tools'), bottom = document.getElementById('bottomBar');   // #grid is rebuilt on layout changes
  if (!host || !tools || !bottom) return;
  const isPhone = () => uiMode() === 'phone';

  const fab = document.createElement('button');
  fab.id = 'penFab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Drawing tools'); fab.textContent = '✎';
  const bar = document.createElement('div');
  bar.id = 'toolBar'; bar.hidden = true;
  bar.innerHTML = '<b></b><button type="button" data-a="undo">↶ Undo</button><button type="button" data-a="done">Done</button>';
  const typeChip = document.createElement('button');
  typeChip.id = 'typeChip'; typeChip.type = 'button'; typeChip.setAttribute('aria-label', 'Chart type');
  host.append(fab, bar); bottom.prepend(typeChip);

  const current = () => {
    const b = tools.querySelector<HTMLElement>('button.on[data-tool], button.on[data-act=measure], button.on[data-act=zoom]');
    return b ? (b.dataset.tool ?? b.dataset.act)! : '';
  };
  const sync = () => {
    const id = current();
    bar.hidden = !isPhone() || !id;
    fab.classList.toggle('on', !!id);
    if (id) bar.querySelector('b')!.textContent = TOOL_MAP.get(id)?.name ?? ACTS[id] ?? id;
  };
  new MutationObserver(sync).observe(tools, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  onUiMode(sync); sync();

  // main.ts keeps the desktop #typeBtn label current; mirror it so the chip never needs its own refresh hook
  const typeBtn = document.getElementById('typeBtn');
  const syncType = () => { typeChip.textContent = (CHART_TYPES.find(t => t.id === chartType.get())?.name ?? chartType.get()) + ' ▾' };
  if (typeBtn) new MutationObserver(syncType).observe(typeBtn, { childList: true, characterData: true, subtree: true });
  syncType();
  typeChip.onclick = () => {
    const cur = chartType.get(), body = document.createElement('div');
    const rows = (g: string) => CHART_TYPES.filter(t => t.group === g).map(t => `<button type="button" class="sheet-i${t.id === cur ? ' on' : ''}" data-ct="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    body.innerHTML = rows('time') + '<div class="sheet-sec">Price based</div>' + rows('price');
    const sh = openSheet({ title: 'Chart type', body });
    body.onclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-ct]')?.dataset.ct; if (id) { sh.close(); chartType.set(id) } };
  };

  fab.onclick = () => {
    const cur = current();
    const body = document.createElement('div'); body.className = 'tsh';
    const cell = (id: string, name: string, icon: string) => `<button type="button" class="sheet-i${cur === id ? ' on' : ''}" data-t="${esc(id)}">${icon}<span>${esc(name)}</span></button>`;
    let html = `<div class="g">${cell('cursor', 'Cursor', iconSvg('cross'))}${cell('measure', 'Measure', iconSvg('measure'))}${cell('zoom', 'Zoom in', iconSvg('zoom'))}</div>`;
    for (const g of GROUPS) {
      if (g.id === 'cursors') continue;
      for (const s of groupSections(g.id)) {
        html += `<h4>${esc(s.name ? `${g.name} · ${s.name}` : g.name)}</h4><div class="g">${s.tools.map(t => cell(t.id, t.name, iconSvg(t.id, t.icon))).join('')}</div>`;
      }
    }
    body.innerHTML = html;
    const sh = openSheet({ title: 'Drawing tools', body });
    body.onclick = e => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
      if (!id) return;
      sh.close(); pick(id);
    };
  };

  bar.onclick = e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'undo') document.getElementById('undoBtn')?.click();
    else if (a === 'done') pick('cursor');
  };

  // A tap on an indicator chip opens the same menu as a right click (the hover buttons do not exist on touch).
  document.addEventListener('click', e => {
    if (!isPhone()) return;
    const t = e.target as HTMLElement, chip = t.closest<HTMLElement>('.legend .ind');
    if (!chip || t.closest('button')) return;
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
  });
}
