// While a chart is loading (and it takes more than a moment): a grey skeleton of candles with a meme coin dancing in the middle.
// Pure DOM; the pane calls show() when a load starts and hide() when it ends. The overlay never blocks the mouse.
const LINES = ['much loading…', 'very candles…', 'wow, so data…', 'such patience…', 'to the moon (after loading)…'];
const DELAY_MS = 250;   // a fast load never shows it

/** Deterministic wandering candles: the same skeleton every time, no random flicker between charts. */
function candles(): string {
  let y = 52, out = '';
  for (let i = 0; i < 34; i++) {
    const step = Math.sin(i * 1.7) * 7 + Math.cos(i * 0.6) * 5, o = y, c = Math.max(14, Math.min(86, y + step)), hi = Math.min(o, c) - 4 - (i % 4), lo = Math.max(o, c) + 4 + (i % 3);
    out += `<line x1="${i * 3 + 1.5}" x2="${i * 3 + 1.5}" y1="${hi}" y2="${lo}"/><rect x="${i * 3 + 0.4}" y="${Math.min(o, c)}" width="2.2" height="${Math.max(1.5, Math.abs(c - o))}" rx=".4"/>`;
    y = c;
  }
  return out;
}

const COIN = `<svg class="ld-coin" viewBox="0 0 120 150" width="120" height="150" aria-hidden="true">
  <ellipse class="ld-shadow" cx="60" cy="144" rx="30" ry="5"/>
  <g class="ld-legs"><path class="ld-limb ld-legl" d="M50 108 L44 134"/><path class="ld-limb ld-legr" d="M70 108 L76 134"/><ellipse cx="42" cy="136" rx="8" ry="4" fill="#3b2a12"/><ellipse cx="78" cy="136" rx="8" ry="4" fill="#3b2a12"/></g>
  <g class="ld-body">
    <path class="ld-limb ld-arml" d="M22 70 L6 52"/><path class="ld-limb ld-armr" d="M98 70 L114 52"/>
    <circle cx="60" cy="68" r="42" fill="#f5b50a" stroke="#b9820a" stroke-width="4"/>
    <circle cx="60" cy="68" r="33" fill="none" stroke="#d99a06" stroke-width="2.5" stroke-dasharray="3 4"/>
    <rect x="30" y="52" width="26" height="15" rx="6" fill="#111"/><rect x="64" y="52" width="26" height="15" rx="6" fill="#111"/><rect x="54" y="56" width="12" height="3" fill="#111"/>
    <rect x="34" y="55" width="8" height="3" rx="1.5" fill="#fff" opacity=".35"/><rect x="68" y="55" width="8" height="3" rx="1.5" fill="#fff" opacity=".35"/>
    <path d="M42 82 Q60 100 78 82" fill="#fff" stroke="#6b4a06" stroke-width="3" stroke-linejoin="round"/><path d="M46 85 Q60 93 74 85" fill="none" stroke="#c9a" stroke-width="0"/>
    <text x="60" y="40" text-anchor="middle" font-size="15" font-weight="800" fill="#b9820a" font-family="system-ui,sans-serif">$</text>
  </g>
</svg>`;

export interface Loader { show(name: string): void; hide(): void }

export function createLoader(cell: HTMLElement): Loader {
  const el = document.createElement('div');
  el.className = 'ld'; el.hidden = true; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<svg class="ld-sk" viewBox="0 0 102 100" preserveAspectRatio="none" aria-hidden="true">${candles()}</svg><div class="ld-mid">${COIN}<div class="ld-txt"></div></div>`;
  cell.append(el);
  const txt = el.querySelector<HTMLElement>('.ld-txt')!;
  let delay = 0, tick = 0, i = 0;
  const stop = () => { clearTimeout(delay); clearInterval(tick); delay = 0; tick = 0 };
  return {
    show(name) {
      stop();
      delay = window.setTimeout(() => {
        el.hidden = false; i = 0;
        const say = () => { txt.textContent = `${name} · ${LINES[i++ % LINES.length]}`; el.setAttribute('aria-label', `Loading ${name}`) };
        say(); tick = window.setInterval(say, 1500);
      }, DELAY_MS);
    },
    hide() { stop(); el.hidden = true },
  };
}
