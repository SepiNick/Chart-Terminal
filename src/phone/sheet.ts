// Bottom sheet for the phone layout (shared by every phone/tablet module).
//   import { openSheet, sheetMenu } from './phone/sheet.ts'
//   const s = openSheet({ title: 'Timeframe', body: someElementOrHtmlString, full: false, onClose: () => {} });
//   s.close();   // idempotent; also closes on backdrop tap, drag-down on the handle/title, Esc and the Android Back button
//   sheetMenu('More', items)   // showMenu-style items; rows are 48px; an item with `sub` opens its sub-items in the same sheet with a Back row
// body: an HTMLElement (moved into the sheet) or a trusted HTML string (escape data yourself!). Opening a sheet replaces the previous one.
// full: true = a full-height sheet (search, long forms). On tablets (html[data-ui=tablet]) every sheet is a centred 560px card instead.
// CSS: src/phone/sheet.css (.sheet-bd backdrop, .sheet panel, .sheet-i for a ready-made 48px row: <button class="sheet-i on">).
// Android Back: one history entry is pushed while any sheet is open (shared by consecutive sheets), Back closes the sheet, not the app.
import type { MenuItem } from '../menu.ts';
export interface SheetOpts { title?: string; body: HTMLElement | string; full?: boolean; onClose?: () => void }
export interface SheetHandle { close(): void; el: HTMLElement; setBody(body: HTMLElement | string, title?: string): void }

let current: SheetHandle | null = null, uid = 0;

export function openSheet(o: SheetOpts): SheetHandle {
  current?.close();
  const bd = document.createElement('div'); bd.className = 'sheet-bd';
  const el = document.createElement('div'); el.className = 'sheet' + (o.full ? ' full' : ''); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.tabIndex = -1;
  const head = document.createElement('div'); head.className = 'sheet-h';
  head.innerHTML = '<i class="sheet-grip"></i>'; const t = document.createElement('b'); t.id = 'sheet-t' + (++uid); t.textContent = o.title ?? ''; head.append(t); el.setAttribute('aria-labelledby', t.id);
  const opener = document.activeElement as HTMLElement | null;
  const body = document.createElement('div'); body.className = 'sheet-b';
  const setBody = (b: HTMLElement | string, title?: string) => { if (title !== undefined) t.textContent = title; body.replaceChildren(); if (typeof b === 'string') body.innerHTML = b; else body.append(b); body.scrollTop = 0 };
  setBody(o.body);
  el.append(head, body); bd.append(el); document.body.append(bd);
  let done = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    else if (e.key === 'Tab') {   // keep focus inside the sheet
      const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent);
      if (!f.length) { e.preventDefault(); return }
      const i = f.indexOf(document.activeElement as HTMLElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
      e.preventDefault(); f[n].focus();
    }
  };
  const onPop = () => close(true);
  const close = (fromPop = false) => {
    if (done) return; done = true;
    document.removeEventListener('keydown', onKey, true); removeEventListener('popstate', onPop);
    // drop the history entry we pushed, unless a sheet opened meanwhile (an action of this one) and now owns it; Back already consumed it otherwise
    if (!fromPop) setTimeout(() => { if (!current && history.state?.sheet) history.back() });
    el.style.transform = 'translateY(100%)'; bd.style.opacity = '0';
    setTimeout(() => bd.remove(), 180);
    if (current === h) current = null;
    o.onClose?.();
    if (opener?.isConnected && !current) opener.focus?.({ preventScroll: true });
  };
  const h: SheetHandle = { close: () => close(), el, setBody };
  current = h;
  document.addEventListener('keydown', onKey, true);
  try { if (!history.state?.sheet) history.pushState({ sheet: 1 }, '') } catch { /* sandboxed frame: Back just won't close it */ }
  addEventListener('popstate', onPop);
  bd.onclick = e => { if (e.target === bd) close() };
  // drag down on the header (or on the body when scrolled to the top)
  let y0 = 0, dy = 0, drag = false;
  el.addEventListener('touchstart', e => { const onHead = head.contains(e.target as Node); if (onHead || body.scrollTop <= 0) { drag = true; y0 = e.touches[0].clientY; dy = 0 } }, { passive: true });
  el.addEventListener('touchmove', e => { if (!drag) return; dy = e.touches[0].clientY - y0; if (dy > 0) { el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)` } }, { passive: true });
  el.addEventListener('touchend', () => { if (!drag) return; drag = false; el.style.transition = ''; if (dy > 80) close(); else el.style.transform = '' });
  requestAnimationFrame(() => { bd.classList.add('in'); if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>('.sheet-i') ?? el).focus({ preventScroll: true }) });
  return h;
}

function menuRows(items: MenuItem[], h: SheetHandle, title: string, back?: () => void): HTMLElement {
  const box = document.createElement('div');
  if (back) { const b = document.createElement('button'); b.className = 'sheet-i'; b.innerHTML = '<span class="sheet-ic">‹</span>'; b.append('Back'); b.onclick = back; box.append(b) }
  for (const it of items) {
    if (it.sep) continue;
    if (it.head !== undefined) { const s = document.createElement('div'); s.className = 'sheet-sec'; s.textContent = it.head; box.append(s); continue }
    const b = document.createElement('button'); b.className = 'sheet-i' + (it.checked || it.selected ? ' on' : ''); b.disabled = !!it.disabled;
    const ic = document.createElement('span'); ic.className = 'sheet-ic'; if (it.iconHtml) ic.innerHTML = it.iconHtml; else ic.textContent = it.icon ?? ''; b.append(ic, it.label ?? '');
    const s = document.createElement('small'); s.textContent = it.sub ? '›' : it.hint ?? (it.checked ? '✓' : ''); if (s.textContent) b.append(s);
    b.onclick = it.sub ? () => h.setBody(menuRows(it.sub!, h, it.label ?? '', () => h.setBody(menuRows(items, h, title, back), title)), it.label ?? '') : () => { h.close(); it.action?.() };
    box.append(b);
  }
  return box;
}

/** A sheet from showMenu-style items (label, icon, hint, checked, head, sep, sub, action): rows are 48px, the action runs after the sheet has closed. */
export function sheetMenu(title: string, items: MenuItem[]): SheetHandle {
  let h!: SheetHandle;
  const box = document.createElement('div');
  h = openSheet({ title, body: box });
  h.setBody(menuRows(items, h, title), title);
  return h;
}
