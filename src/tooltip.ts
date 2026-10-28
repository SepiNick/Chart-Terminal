// Hover tooltips for toolbar buttons, as in TradingView: a dark label with the name (and hotkey) next to the button,
// shown quickly instead of the browser's slow `title`. Elements opt in with data-tip / data-key; toolbar buttons that
// only have a `title` are taken over too (the title moves to data-tip so the native tooltip doesn't show as well).
const TOOLBARS = '#tools, #favBar, #rail, #top';
let tip: HTMLDivElement | null = null, timer = 0, target: HTMLElement | null = null;

function el() {
  if (!tip) { tip = document.createElement('div'); tip.className = 'ttip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip) }
  return tip;
}
function hide() { clearTimeout(timer); target = null; if (tip) tip.style.display = 'none' }

function show(t: HTMLElement) {
  const box = el(), name = t.dataset.tip ?? '', key = t.dataset.key;
  box.textContent = name;
  if (key) { const k = document.createElement('kbd'); k.textContent = key; box.append(k) }
  box.style.display = 'block';
  const r = t.getBoundingClientRect(), b = box.getBoundingClientRect(), gap = 6;
  let x: number, y: number;
  if (t.closest('#top')) { x = r.left + r.width / 2 - b.width / 2; y = r.bottom + gap }   // horizontal bar: below
  else {                                                                                    // vertical bars: beside
    x = r.right + gap; y = r.top + r.height / 2 - b.height / 2;
    if (x + b.width > innerWidth - 4) x = r.left - gap - b.width;                          // right rail: to the left
  }
  box.style.left = Math.max(4, Math.min(x, innerWidth - b.width - 4)) + 'px';
  box.style.top = Math.max(4, Math.min(y, innerHeight - b.height - 4)) + 'px';
}

document.addEventListener('mouseover', e => {
  // A title set (or updated) by the app since the last hover wins over an older data-tip.
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[title]');
  if (b && b.title && b.closest(TOOLBARS)) { b.dataset.tip = b.title; b.removeAttribute('title') }
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
  if (t === target) return;
  hide();
  if (!t || !t.dataset.tip) return;
  target = t;
  timer = window.setTimeout(() => { if (target === t && t.isConnected) show(t) }, 120);
});
document.addEventListener('mouseout', e => { if (target && !target.contains(e.relatedTarget as Node)) hide() });
for (const ev of ['mousedown', 'wheel', 'keydown', 'blur'] as const) addEventListener(ev, hide, true);
