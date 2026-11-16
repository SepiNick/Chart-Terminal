// Tablet shell (html[data-ui="tablet"], see mode.ts). The desktop DOM is re-laid-out by tablet.css (CSS grid); this file adds only what CSS cannot:
// the side-column button + slide-over drawer (portrait), the edge swipe, the "More" sheet and the 2-chart limit of the layout picker.
import { onUiMode, uiMode } from './mode.ts';
import { sheetMenu } from './sheet.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
const portrait = () => innerHeight > innerWidth;
const PRIMARY = ['watch', 'alerts', 'trade', 'screener', 'community'];
const LABELS: Record<string, string> = { trade: 'Trade', screener: 'Market' };

export function initTablet() {
  const body = $('#body'), rail = $('#rail'), top = $('#top');
  if (!body || !rail || !top) return;

  // rail: the five main pages + More are the switcher; everything else is under More
  for (const b of rail.querySelectorAll<HTMLElement>('[data-side]')) {
    if (PRIMARY.includes(b.dataset.side!)) b.classList.add('pri');
    if (!b.dataset.l && LABELS[b.dataset.side!]) b.dataset.l = LABELS[b.dataset.side!];
  }
  $('#railMore')?.classList.add('pri');

  const btn = document.createElement('button');
  btn.id = 'tSideBtn'; btn.type = 'button'; btn.textContent = '◧'; btn.title = 'Side panel'; btn.setAttribute('aria-label', 'Side panel');
  top.prepend(btn);
  const bd = document.createElement('div'); bd.id = 'tBd'; document.body.append(bd);

  const isOpen = () => document.body.classList.contains('tdrawer');
  const setOpen = (v: boolean) => {
    if (v && uiMode() !== 'tablet') v = false;
    document.body.classList.toggle('tdrawer', v);
    if (v && !rail.querySelector('[data-side].on')) rail.querySelector<HTMLElement>('[data-side=watch]')?.click();
  };
  btn.onclick = () => {
    if (portrait()) return setOpen(!isOpen());
    // landscape: the column is always there; the button collapses / restores it (tapping the active page does the same)
    (rail.querySelector<HTMLElement>('[data-side].on') ?? rail.querySelector<HTMLElement>('[data-side=watch]'))?.click();
  };
  bd.onclick = () => setOpen(false);
  addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) setOpen(false) });

  // portrait: the active page cannot be toggled off (the drawer would be empty); choosing a symbol closes the drawer
  rail.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-side].on');
    if (b && portrait() && uiMode() === 'tablet') e.stopPropagation();
  }, true);
  $('#panel')?.addEventListener('click', e => { if (portrait() && (e.target as HTMLElement).closest('#watchT tr[data-sym]')) setOpen(false) });

  // edge swipe: from the left edge opens, a swipe back to the left closes
  let x0 = -1, y0 = 0;
  addEventListener('touchstart', e => { const t = e.touches[0]; x0 = isOpen() || t.clientX < 24 ? t.clientX : -1; y0 = t.clientY }, { passive: true });
  addEventListener('touchend', e => {
    if (x0 < 0 || uiMode() !== 'tablet' || !portrait()) return;
    const t = e.changedTouches[0], dx = t.clientX - x0;
    if (Math.abs(dx) > 70 && Math.abs(t.clientY - y0) < 60) setOpen(dx > 0);
    x0 = -1;
  }, { passive: true });

  // More: a sheet with the other pages (the desktop popover would open off-screen next to the rail)
  $('#railMore')?.addEventListener('click', e => {
    if (uiMode() !== 'tablet') return;
    e.stopImmediatePropagation();
    const items = [...rail.querySelectorAll<HTMLElement>('[data-side]:not(.pri)')].filter(b => !b.hidden)
      .map(b => ({ label: b.title.split(':')[0], icon: b.textContent ?? '', checked: b.classList.contains('on'), action: () => { if (!b.classList.contains('on')) b.click() } }));
    sheetMenu('More', items);
  }, true);

  // up to 2 charts on a tablet: trim the layout picker after the desktop menu has opened
  $('#layoutBtn')?.addEventListener('click', () => {
    if (uiMode() !== 'tablet') return;
    setTimeout(() => document.querySelectorAll<HTMLElement>('.ctx .ctx-i').forEach(i => { if (!/^(1|2|2v) —/.test(i.textContent ?? '')) i.style.display = 'none' }));
  });

  // the drawer sits below the top bar (and the replay bar when open): keep --bt in sync
  const place = () => document.documentElement.style.setProperty('--bt', body.getBoundingClientRect().top + 'px');
  new ResizeObserver(place).observe(body); place();
  const reset = () => { if (uiMode() !== 'tablet' || !portrait()) setOpen(false) };
  addEventListener('resize', reset); addEventListener('orientationchange', reset); onUiMode(reset);
}
