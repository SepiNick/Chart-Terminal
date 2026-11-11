// First-run feature tour: a spotlight on one part of the screen at a time, with a short explanation, Back / Next / Skip.
// It runs once per device (device-local key `tourDone`) and can be replayed from the ☰ menu ("Feature tour"). Steps whose
// target is not on screen (a phone shows one page at a time, the desktop-only items) are skipped; `page` brings the right
// page forward first. The text goes through t() / the page translator, so the Persian interface shows it in Persian too.
import { store } from './store.ts';
import { isPopout } from './popout.ts';

interface Step { sel?: string; title: string; body: string; page?: 'chart' | 'side' }
const STEPS: Step[] = [
  { title: 'Welcome to Chart Terminal', body: 'A two-minute tour of what is here. You can skip it any time, and replay it from the ☰ menu › Feature tour.' },
  { sel: '#symBtn', page: 'chart', title: 'Symbol', body: 'Tap to search any coin, forex pair or stock. On the chart you can also just start typing a symbol.' },
  { sel: '#tfs', page: 'chart', title: 'Timeframes', body: 'Switch between 1 minute and 1 week candles. The ▾ button next to them lists every interval, and you can type your own.' },
  { sel: '#indBtn', page: 'chart', title: 'Indicators', body: 'Add moving averages, RSI, MACD and hundreds more, or write your own in Pine, MQL, NinjaScript or Python.' },
  { sel: '#alertBtn', page: 'chart', title: 'Alerts', body: 'Get a notification when price crosses a level or an indicator fires. With a server they keep working while the app is closed.' },
  { sel: '#replayBtn', page: 'chart', title: 'Bar replay', body: 'Rewind the chart and replay the market candle by candle to practise or test an idea without knowing the future.' },
  { sel: '#ofBtn', page: 'chart', title: 'Order flow', body: 'Footprint, delta, big-trade bubbles and the liquidity heatmap. "Quick start" has ready-made views; each can be switched on and off on its own.' },
  { sel: '#tools', page: 'chart', title: 'Drawing tools', body: 'Trend lines, Fibonacci, shapes, text, measure and more. Click a tool, then click on the chart. Right-click a drawing to edit it.' },
  { sel: '#grid', page: 'chart', title: 'The chart', body: 'Scroll to move, pinch or use the wheel to zoom, drag the price scale to stretch. Right-click for the chart menu: buy and sell, alerts, widgets.' },
  { sel: '#tabs', page: 'chart', title: 'Workspace tabs', body: 'Keep several charts open in tabs. Switching tabs is instant: each tab keeps its charts loaded. Double-click a tab to rename it.' },
  { sel: '#layoutBtn', page: 'chart', title: 'Layouts', body: 'Show up to 16 charts at once, link them by symbol, interval, crosshair or time, and save the arrangement.' },
  { sel: '#rail', title: 'Side panels', body: 'Watchlist, alerts, the paper-trading ticket, object tree, market screener, DOM, journal, accounts, skills and the AI assistant live here.' },
  { sel: '#panel', page: 'side', title: 'Watchlist', body: 'Your symbols with live price and change, tabs for several lists, and a mini-chart on desktop widgets. Tap a symbol to open it; right-click for more.' },
  { sel: '#bottom', page: 'chart', title: 'Bottom panel', body: 'Positions, orders and history, the Pine and Python editors and the Strategy Tester. It starts collapsed: tap a tab or the arrow to open it.' },
  { sel: '#srvBtn', page: 'chart', title: 'Server and notifications', body: 'Connect Telegram, email, a webhook or push so alerts reach you anywhere. This needs the app connected to your server.' },
  { sel: '#menuBtn', page: 'chart', title: 'Menu', body: 'Settings, theme, language (English / فارسی), connections, screener, desktop widgets, licences and this tour.' },
  { title: 'You are ready', body: 'Start with the watchlist: pick a symbol, add an indicator, draw a line. Everything is saved automatically.' },
];

const phone = () => matchMedia('(max-width:900px)').matches;
const rectOf = (sel?: string) => { const el = sel ? document.querySelector<HTMLElement>(sel) : null; if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? { el, r } : null };
const click = (sel: string) => document.querySelector<HTMLElement>(sel)?.click();
function bringPage(p?: 'chart' | 'side') {
  const side = !document.querySelector('#body')?.classList.contains('no-panel');
  if (p === 'chart' && side) click('#rail [data-chart]');                       // phone: leave the side page; desktop: the chart is always there
  if (p === 'side' && !side) click('#rail [data-side="watch"]');
}

let root: HTMLElement | null = null;
export function startTour() {
  if (root || isPopout) return;
  let i = 0, dir = 1;
  root = document.createElement('div');
  root.id = 'tour'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Feature tour');
  root.innerHTML = '<div class="tr-hl"></div><div class="tr-card" tabindex="-1"><b class="tr-t"></b><p class="tr-b"></p><div class="tr-n"></div><div class="tr-btns"><button data-a="skip" class="x">Skip</button><span class="grow"></span><button data-a="back">Back</button><button data-a="next" class="on">Next</button></div></div>';
  document.body.append(root);
  const hl = root.querySelector<HTMLElement>('.tr-hl')!, card = root.querySelector<HTMLElement>('.tr-card')!;
  const end = () => { store.set('tourDone', true); root?.remove(); root = null; removeEventListener('keydown', key, true); removeEventListener('resize', place); if (phone()) bringPage('side') };
  const place = () => {
    const s = STEPS[i], t = rectOf(s.sel);
    if (t) {
      const pad = 4;
      hl.style.cssText = `display:block;left:${t.r.left - pad}px;top:${t.r.top - pad}px;width:${t.r.width + 2 * pad}px;height:${t.r.height + 2 * pad}px`;
    } else hl.style.display = 'none';
    root?.classList.toggle('tr-nohl', !t);   // no spotlight: dim the whole screen instead
    const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = (vw - cw) / 2, y = (vh - ch) / 2;
    if (t) {
      if (vh - t.r.bottom > ch + 20) y = t.r.bottom + 14;                       // below
      else if (t.r.top > ch + 20) y = t.r.top - ch - 14;                          // above
      else if (vw - t.r.right > cw + 20) { x = t.r.right + 14; y = Math.min(Math.max(8, t.r.top), vh - ch - 8) }   // beside, right
      else if (t.r.left > cw + 20) { x = t.r.left - cw - 14; y = Math.min(Math.max(8, t.r.top), vh - ch - 8) }     // beside, left
      if (y === (vh - ch) / 2 && x === (vw - cw) / 2) y = vh - ch - 12;       // a target as large as the window (the chart): card at the bottom
      else if (vh - t.r.bottom > ch + 20 || t.r.top > ch + 20) x = Math.min(Math.max(8, t.r.left + t.r.width / 2 - cw / 2), vw - cw - 8);
    }
    card.style.left = `${Math.max(8, Math.min(x, vw - cw - 8))}px`; card.style.top = `${Math.max(8, Math.min(y, vh - ch - 8))}px`;
  };
  const show = () => {
    const s = STEPS[i];
    bringPage(s.page);
    setTimeout(() => {
      if (!root) return;
      if (s.sel && !rectOf(s.sel)) { i += dir; if (i < 0 || i >= STEPS.length) return end(); return show() }   // not on this screen
      const el = s.sel ? document.querySelector<HTMLElement>(s.sel) : null;
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      card.querySelector('.tr-t')!.textContent = s.title; card.querySelector('.tr-b')!.textContent = s.body;
      card.querySelector('.tr-n')!.textContent = `${i + 1} / ${STEPS.length}`;
      card.querySelector<HTMLElement>('[data-a=back]')!.hidden = i === 0;
      card.querySelector('[data-a=next]')!.textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
      requestAnimationFrame(() => { place(); card.focus() });
    }, s.page && s.sel ? 160 : 0);
  };
  const go = (d: number) => { dir = d; i += d; if (i < 0) i = 0; if (i >= STEPS.length) return end(); show() };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); end() } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(e.target as HTMLElement).closest('button'))) { e.preventDefault(); e.stopPropagation(); go(1) } else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1) }
  };
  card.onclick = e => { const a = (e.target as HTMLElement).dataset.a; if (a === 'next') go(1); else if (a === 'back') go(-1); else if (a === 'skip') end() };
  addEventListener('keydown', key, true); addEventListener('resize', place);
  show();
}

/** First run only: waits for the app (and a login dialog, if any) to be ready. */
export function initTour() {
  if (isPopout || store.get('tourDone', false)) return;
  let tries = 0;
  const t = setInterval(() => {
    if (++tries > 40) return clearInterval(t);
    if (document.querySelector('dialog[open]') || !rectOf('#grid')?.r && !phone()) return;   // a dialog is up, or the chart is not drawn yet
    clearInterval(t); startTour();
  }, 1500);
}
