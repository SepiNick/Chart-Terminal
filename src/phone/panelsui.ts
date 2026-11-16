// Phone-only behaviour for the side pages and dialogs (styles live in panels.css). Desktop is untouched.
import { uiMode } from './mode.ts';
const phone = { get matches() { return uiMode() === 'phone' } };

let again = false;   // the re-click below must reach the real handler

export function initPanelsUi() {
  // the ✕ drawn by panels.css on a dialog's first heading closes the sheet
  document.addEventListener('click', e => {
    if (!phone.matches) return;
    const h = e.target as HTMLElement;
    const dlg = h.closest('dialog');
    if (h.tagName !== 'H3' || !dlg || h !== dlg.querySelector('h3') || h.querySelector('button')) return;
    if (e.clientX > h.getBoundingClientRect().right - 52) dlg.close();
  });
  // ＋ in the watchlist header opens the symbol search full screen; the picked symbol is added to the list
  document.querySelector('#watchAdd')?.addEventListener('click', e => {
    if (!phone.matches || again) return;
    e.stopImmediatePropagation();
    const sym = document.querySelector<HTMLElement>('#symBtn')!, dlg = document.querySelector<HTMLDialogElement>('#searchDlg')!;
    const before = sym.textContent;
    dlg.addEventListener('close', () => setTimeout(() => {
      if (sym.textContent === before) return;
      again = true; (document.querySelector('#watchAdd') as HTMLElement).click(); again = false;   // the picked symbol is now the chart symbol
    }, 80), { once: true });
    sym.click();
  }, true);
}
