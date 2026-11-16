// The phone shell (html[data-ui=phone]): its own top bar and bottom tab bar, built once and inserted into the DOM. The desktop #top and #rail are
// hidden by shell.css on a phone; every control here calls the same handlers the desktop buttons use (a click on the hidden button, or a dep below).
//   #pTop   symbol + live price + change (tap = symbol search) | timeframe (sheet) | ƒx chart sheet | alert | ☰ menu
//   #pTabs  Chart, Watchlist, Alerts, Community, More. 56px, labelled, safe-area aware. The active tab follows the app state through syncShell().
// document.body.dataset.screen = 'chart' | 'side' lets the CSS hide the top bar on side pages.
import { sheetMenu } from './sheet.ts';
import { onUiMode, uiMode } from './mode.ts';
import type { MenuItem } from '../menu.ts';

export interface Quote { sym: string; px: number | null; pct: number | null }
export interface ShellDeps {
  quote(): Quote | null;                 // the active chart's symbol, last price and 24h change in %
  tf(): string;                          // the active chart's interval
  side(): string;                        // the open side page ('' = the chart)
  alerts(): number;                      // number of active alerts, for the badge
  show(page: string): void;              // 'chart' or a side page id: open it (no toggle)
  more(): MenuItem[];                    // the pages and tools under the More tab
}

const svg = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  chart: svg('<path d="M3 17l5-6 4 3 6-8 3 4"/><path d="M3 21h18"/>'),
  watch: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  alerts: svg('<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>'),
  community: svg('<path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-5.4A8 8 0 1121 12z"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};
const TABS: [string, string, string][] = [['chart', 'Chart', ICON.chart], ['watch', 'Watchlist', ICON.watch], ['alerts', 'Alerts', ICON.alerts], ['community', 'Community', ICON.community], ['more', 'More', ICON.more]];

const hit = (sel: string) => () => document.querySelector<HTMLElement>(sel)?.click();
/** The chart actions sheet (ƒx): indicators, chart type and everything else that lives in the desktop toolbar. */
const chartItems = (): MenuItem[] => [
  { head: 'Chart' },
  { label: 'Indicators', icon: 'ƒx', action: hit('#indBtn') },
  { label: 'Chart type', icon: '🕯', hint: '›', action: hit('#typeBtn') },
  { label: 'Compare or add symbol', icon: '⊕', action: hit('#cmpBtn') },
  { label: 'Templates', icon: '▤', action: hit('#tplBtn') },
  { head: 'Tools' },
  { label: 'Replay', icon: '⏪', action: hit('#replayBtn') },
  { label: 'Order flow', icon: '▦', action: hit('#ofBtn') },
  { label: 'Undo', icon: '↶', action: hit('#undoBtn') },
  { label: 'Redo', icon: '↷', action: hit('#redoBtn') },
  { head: 'Layout' },
  { label: 'Chart layout', icon: '⊞', action: hit('#layoutBtn') },
  { label: 'Sync across charts', icon: '🔗', action: hit('#syncBtn') },
  { label: 'Saved layouts', icon: '💾', action: hit('#layoutsBtn') },
  { label: 'Fullscreen', icon: '⛶', action: hit('#fullBtn') },
];

const fmtPx = (x: number) => x.toLocaleString('en', { maximumFractionDigits: x >= 100 ? 2 : x >= 1 ? 4 : 8 });
let built = false, deps: ShellDeps, el: { sym: HTMLElement; px: HTMLElement; chg: HTMLElement; tf: HTMLElement; badge: HTMLElement; tabs: HTMLElement[] };

function set(n: HTMLElement, text: string) { if (n.textContent !== text) n.textContent = text }

/** Refreshes the symbol, price, timeframe, alert badge and the active tab. Cheap; call it whenever any of them may have changed. */
export function syncShell() {
  if (!built) return;
  const q = deps.quote(), side = deps.side();
  set(el.sym, q?.sym ?? ''); set(el.px, q?.px != null ? fmtPx(q.px) : '—');
  set(el.chg, q?.pct != null ? `${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%` : '');
  el.chg.className = q?.pct == null ? '' : q.pct >= 0 ? 'up' : 'dn';
  set(el.tf, deps.tf());
  const n = deps.alerts(); set(el.badge, n > 99 ? '99+' : n ? String(n) : ''); el.badge.hidden = !n;
  const active = !side ? 'chart' : ['watch', 'alerts', 'community'].includes(side) ? side : 'more';
  el.tabs.forEach(b => { const on = b.dataset.t === active; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current') });
  document.body.dataset.screen = side ? 'side' : 'chart';
}

export function initShell(d: ShellDeps) {
  if (built) return;
  deps = d;
  const top = document.createElement('div'); top.id = 'pTop';
  top.innerHTML = `<button type="button" class="p-sym" data-a="sym" aria-label="Symbol search"><b></b><span><i class="px"></i><i></i></span></button>
    <button type="button" class="p-tf" data-a="tf" aria-label="Timeframe"></button>
    <button type="button" data-a="ind" aria-label="Indicators and chart" title="Indicators">ƒx</button>
    <button type="button" data-a="alert" aria-label="Create alert">${ICON.alerts}</button>
    <button type="button" data-a="menu" aria-label="Menu">${ICON.menu}</button>`;
  top.onclick = e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'sym') hit('#symBtn')();
    else if (a === 'tf') hit('#tfNow')();
    else if (a === 'ind') sheetMenu('Chart', chartItems());
    else if (a === 'alert') hit('#alertBtn')();
    else if (a === 'menu') hit('#menuBtn')();
  };
  const bar = document.createElement('nav'); bar.id = 'pTabs'; bar.setAttribute('aria-label', 'Main');
  for (const [id, label, icon] of TABS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.t = id;
    b.innerHTML = `${icon}<span>${label}</span>${id === 'alerts' ? '<em hidden></em>' : ''}`;
    b.onclick = () => id === 'more' ? sheetMenu('More', deps.more()) : deps.show(id);
    bar.append(b);
  }
  document.body.insertBefore(top, document.getElementById('top'));
  document.body.append(bar);
  const q = (s: string) => top.querySelector<HTMLElement>(s)!;
  el = { sym: q('.p-sym b'), px: q('.p-sym .px'), chg: q('.p-sym span i:last-child'), tf: q('.p-tf'), badge: bar.querySelector<HTMLElement>('em')!, tabs: [...bar.querySelectorAll<HTMLElement>('[data-t]')] };
  built = true;
  setInterval(() => { if (uiMode() === 'phone') syncShell() }, 1000);
  onUiMode(() => syncShell());
  syncShell();
}
