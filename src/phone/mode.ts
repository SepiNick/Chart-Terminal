// The single source of truth for the UI mode. CSS keys on html[data-ui="phone"|"tablet"|"desktop"], JS uses uiMode()/onUiMode().
// phone: width <= 700, or a touch device that is short (landscape phone); tablet: touch device 701..1280; desktop: the rest.
// Developer/user override: localStorage 'ct.uiMode' = 'phone' | 'tablet' | 'desktop' (anything else = auto).
export type UiMode = 'phone' | 'tablet' | 'desktop';
export const UI_OVERRIDE_KEY = 'ct.uiMode';

const cbs: ((m: UiMode) => void)[] = [];
let cur: UiMode = 'desktop';

function override(): UiMode | '' {
  try { const v = localStorage.getItem(UI_OVERRIDE_KEY); return v === 'phone' || v === 'tablet' || v === 'desktop' ? v : '' } catch { return '' }
}
function detect(): UiMode {
  const o = override(); if (o) return o;
  const w = innerWidth, h = innerHeight, coarse = matchMedia('(pointer:coarse)').matches;
  if (w <= 700 || (coarse && h <= 500)) return 'phone';
  if (coarse && w <= 1280) return 'tablet';
  return 'desktop';
}
function update() {
  const m = detect();
  document.documentElement.dataset.ui = m;
  if (m === cur) return;
  cur = m; for (const cb of cbs) cb(m);
}
export const uiMode = (): UiMode => cur;
export function onUiMode(cb: (m: UiMode) => void) { cbs.push(cb) }
/** Sets the override ('' = automatic) and re-evaluates now. */
export function setUiOverride(v: UiMode | '') {
  try { v ? localStorage.setItem(UI_OVERRIDE_KEY, v) : localStorage.removeItem(UI_OVERRIDE_KEY) } catch { /* private mode */ }
  update();
}
export const uiOverride = (): UiMode | '' => override();

if (typeof document !== 'undefined') {   // unit tests run in node
  cur = detect(); document.documentElement.dataset.ui = cur;
  addEventListener('resize', update); addEventListener('orientationchange', update);
}
