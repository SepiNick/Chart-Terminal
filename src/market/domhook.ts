// Standalone mode (no data server): the browser builds the crypto market series itself from Binance candles and
// CoinGecko (its public API answers cross-origin requests). With a server the symbols come from /api/bars instead, which
// also blends in the server's recorded history; here every bar is an approximation (nothing is recorded).
import { barHooks, fetchBars, type Bar } from '../data.ts';
import { isStandalone } from '../servers.ts';
import { createDominance } from './domsource.ts';
import { isDomSym } from './dominance.ts';

const dom = createDominance({
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  candles: (pair, tf, until) => fetchBars(pair, tf, until),
});
const bare = (s: string) => s.slice(s.indexOf(':') + 1).toUpperCase();

barHooks.push({
  fetch: (sym, tf, end) => (isStandalone() && isDomSym(sym) ? dom.bars(bare(sym), tf, end).then(r => r.bars) : null),
  stream: (sym, tf, onBar) => {
    if (!isStandalone() || !isDomSym(sym)) return null;
    let alive = true;
    const poll = () => dom.bars(bare(sym), tf, undefined, 2).then(r => { if (alive) r.bars.forEach((b: Bar) => onBar(b)) }).catch(() => {});
    const timer = setInterval(poll, 60_000);
    return () => { alive = false; clearInterval(timer) };
  },
});
