// Small popup menu used for context menus and toolbar flyouts.
import { esc } from './store.ts';

export interface MenuItem { label?: string; icon?: string; hint?: string; checked?: boolean; disabled?: boolean; sep?: boolean; action?: () => void; sub?: MenuItem[] }

let open: HTMLElement[] = [];
export function closeMenus() { open.forEach(m => m.remove()); open = [] }
document.addEventListener('mousedown', e => { if (!open.some(m => m.contains(e.target as Node))) closeMenus() });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus() });

export function showMenu(x: number, y: number, items: MenuItem[], level = 0): HTMLElement {
  if (level === 0) closeMenus();
  else open.splice(level).forEach(m => m.remove());
  const m = document.createElement('div');
  m.className = 'ctx';
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' :
    `<div class="ctx-i${it.disabled ? ' dis' : ''}" data-i="${i}"><span class="ci">${it.checked ? '✓' : esc(it.icon ?? '')}</span><span>${esc(it.label ?? '')}</span><span class="ch">${it.sub ? '▸' : esc(it.hint ?? '')}</span></div>`).join('');
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  open.push(m);
  m.addEventListener('mouseover', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.ctx-i'); if (!el) return;
    const it = items[+el.dataset.i!];
    if (it.sub) { const b = el.getBoundingClientRect(); showMenu(b.right, b.top, it.sub, level + 1) }
    else open.splice(level + 1).forEach(x => x.remove());
  });
  m.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.ctx-i'); if (!el) return;
    const it = items[+el.dataset.i!];
    if (it.disabled || it.sub) return;
    closeMenus(); it.action?.();
  });
  return m;
}
