// Small popup menu used for context menus and toolbar flyouts.
import { esc } from './store.ts';
import { place, type Anchor } from './menuplace.ts';

/** head: a section title row. iconHtml: trusted markup from our own icon set (never data). selected: highlighted row (tool flyouts). */
export interface MenuItem { label?: string; icon?: string; iconHtml?: string; hint?: string; checked?: boolean; selected?: boolean; disabled?: boolean; sep?: boolean; head?: string; action?: () => void; sub?: MenuItem[] }

let open: HTMLElement[] = [];
let opener: HTMLElement | null = null, byKey = false;   // what had focus before the first menu opened; whether the last input was the keyboard
function closeMenus(refocus = false) {
  open.forEach(m => m.remove()); open = [];
  if (refocus && opener?.isConnected) opener.focus();
  opener = null;
}
const rows = (m: HTMLElement) => [...m.querySelectorAll<HTMLElement>('.ctx-i:not(.dis)')];
document.addEventListener('mousedown', e => { byKey = false; if (!open.some(m => m.contains(e.target as Node))) closeMenus() });
// Keyboard: Up/Down/Home/End move, Right opens a submenu, Left closes it, Enter/Space activates, Esc closes and gives focus back.
document.addEventListener('keydown', e => {
  if (!open.length) { byKey = true; return }
  byKey = true;
  const m = open[open.length - 1], list = rows(m), cur = list.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => { list[(i + list.length) % list.length]?.focus(); e.preventDefault() };
  if (e.key === 'Escape') { closeMenus(true); e.preventDefault() }
  else if (e.key === 'ArrowDown') go(cur < 0 ? 0 : cur + 1);
  else if (e.key === 'ArrowUp') go(cur < 0 ? -1 : cur - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(-1);
  else if (e.key === 'ArrowRight' && cur >= 0 && list[cur].getAttribute('aria-haspopup')) { list[cur].click(); open[open.length - 1]?.querySelector<HTMLElement>('.ctx-i:not(.dis)')?.focus(); e.preventDefault() }
  else if (e.key === 'ArrowLeft' && open.length > 1) { open.pop()!.remove(); open[open.length - 1]?.querySelector<HTMLElement>('.ctx-i:focus, .ctx-i')?.focus(); e.preventDefault() }
  else if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) { list[cur].click(); e.preventDefault() }
  else if (e.key === 'Tab') closeMenus();
});

export function showMenu(x: number, y: number, items: MenuItem[], level = 0, anchor?: Anchor): HTMLElement {
  if (level === 0) { const was = opener; closeMenus(); opener = was ?? (document.activeElement as HTMLElement | null) }
  else open.splice(level).forEach(m => m.remove());
  if (level === 0 && !opener) opener = document.activeElement as HTMLElement | null;
  const m = document.createElement('div');
  m.className = 'ctx'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : it.head !== undefined ? `<div class="ctx-h" role="presentation">${esc(it.head)}</div>` :
    `<div class="ctx-i${it.disabled ? ' dis' : ''}${it.selected ? ' sel' : ''}" data-i="${i}" role="${it.checked != null ? 'menuitemcheckbox' : 'menuitem'}" tabindex="-1"${it.checked != null ? ` aria-checked="${it.checked}"` : ''}${it.disabled ? ' aria-disabled="true"' : ''}${it.sub ? ' aria-haspopup="menu"' : ''}><span class="ci">${it.iconHtml ?? (it.checked ? '✓' : esc(it.icon ?? ''))}</span><span>${esc(it.label ?? '')}</span><span class="ch">${it.sub ? '▸' : esc(it.hint ?? '')}</span></div>`).join('');
  document.body.append(m);
  const r = m.getBoundingClientRect();
  const at = place(x, y, r.width, r.height, innerWidth, innerHeight, anchor);
  m.style.left = at.left + 'px'; m.style.top = at.top + 'px'; m.style.maxHeight = at.maxH + 'px';
  open.push(m);
  if (byKey && level === 0) rows(m)[0]?.focus();   // opened from the keyboard: land on the first item
  m.addEventListener('mouseover', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.ctx-i'); if (!el) return;
    const it = items[+el.dataset.i!];
    if (it.sub) { const b = el.getBoundingClientRect(); showMenu(b.right, b.top, it.sub, level + 1, { left: el.closest('.ctx')!.getBoundingClientRect().left, bottom: b.bottom }) }
    else open.splice(level + 1).forEach(x => x.remove());
  });
  m.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.ctx-i'); if (!el) return;
    const it = items[+el.dataset.i!];
    if (it.disabled || it.sub) return;
    closeMenus(true); it.action?.();
  });
  return m;
}
