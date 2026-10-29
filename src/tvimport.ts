// Imports from files TradingView lets you export: a watchlist (.txt), the Paper Trading account history (.csv) and the
// alerts log (.csv). TradingView has no public API for a user's data, so files are the only clean way across.
// shortcut: the formats are matched loosely by column names as TradingView labels them today; a renamed column fails
// with a clear message rather than importing wrong values.
import type { Imported } from './journal/analytics.ts';

/** CSV rows (quoted fields with "" escapes; comma or semicolon). */
export function csvRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  return lines.map(l => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === sep && !q) { out.push(cur.trim()); cur = '' }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}
const cols = (head: string[]) => (re: RegExp) => head.findIndex(h => re.test(h.toLowerCase()));
const time = (s: string) => { const n = +s; return Number.isFinite(n) && s.trim() ? (n > 1e11 ? n / 1000 : n) : Date.parse(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) / 1000 };

// ---------- symbols ----------
const CRYPTO = new Set(['BINANCE', 'BINANCEUS', 'BYBIT', 'OKX', 'KUCOIN', 'COINBASE', 'KRAKEN', 'BITGET', 'MEXC', 'GATEIO', 'BITSTAMP', 'BITFINEX', 'HTX', 'BINGX', 'CRYPTOCOM', 'GEMINI', 'BITMEX', 'DERIBIT', 'PHEMEX', 'POLONIEX', 'WOONETWORK', 'BITVAVO', 'UPBIT', 'NOBITEX']);
const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'USD', 'EUR', 'TRY', 'IRT', 'BTC', 'ETH', 'BNB'];
/** TradingView's EXCHANGE:TICKER → this app's symbol (Binance spot stays plain; other crypto exchanges BASE_QUOTE via CCXT;
 *  everything else — stocks, forex, metals, indices — through the FX/Yahoo feed). */
export function tvSymbol(s: string): string {
  const m = s.trim().toUpperCase().match(/^([A-Z0-9_]+):(.+)$/);
  if (!m) return s.trim().toUpperCase();
  const [, ex, t] = m;
  if (!CRYPTO.has(ex)) return `FX:${t}`;
  const perp = /\.P$/.test(t), base = t.replace(/\.P$/, ''), q = QUOTES.find(x => base.endsWith(x) && base.length > x.length);
  if (ex === 'BINANCE' && !perp) return base;
  if (!q) return `${ex}:${base}`;
  const sym = `${base.slice(0, -q.length)}_${q}${perp ? '.P' : ''}`;
  return `${ex === 'BINANCE' ? 'BINANCEUSDM' : ex}:${sym}`;
}

// ---------- watchlist: "###Section,EXCH:SYM,EXCH:SYM,###Other,…" ----------
/** Entries of an exported watchlist, in order: '###Name' section rows kept, symbols without duplicates. */
export function parseTvWatchlist(text: string): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const x of text.split(/[,\n\r]+/).map(v => v.trim()).filter(Boolean)) {
    if (x.startsWith('###')) { out.push(x); continue }
    const s = tvSymbol(x);
    if (!seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out;
}

// ---------- alerts log: Alert ID, Ticker, Name, Description, Time ----------
export function parseTvAlertLog(text: string): { at: number; message: string }[] {
  const [head, ...rows] = csvRows(text);
  if (!head) return [];
  const c = cols(head), t = c(/^time|date/), tk = c(/ticker|symbol/), nm = c(/^name/), ds = c(/description|message/);
  if (t < 0 || (ds < 0 && nm < 0)) throw Error('Not a TradingView alerts log (needs Time and Description columns)');
  return rows.map(r => ({ at: Math.round(time(r[t] ?? '') * 1000), message: [r[tk], [r[nm], r[ds]].filter(Boolean).join(': ')].filter(Boolean).join(' — ').slice(0, 1000) }))
    .filter(x => Number.isFinite(x.at) && x.message);
}

// ---------- Paper Trading account history: Time, Balance Before, Balance After, Realized P&L, Action ----------
/** Closed trades from the account history's "Close long position for symbol X at price P for Q units. Position AVG Price was A" rows. */
export function parseTvAccountHistory(text: string): Imported[] {
  const [head, ...rows] = csvRows(text);
  if (!head) return [];
  const c = cols(head), t = c(/^time|date/), pnl = c(/realized|p&l|pnl|profit/), act = c(/action|description/);
  if (t < 0 || act < 0) throw Error('Not a TradingView Paper Trading account history (needs Time and Action columns)');
  const out: Imported[] = [];
  for (const r of rows) {
    const m = (r[act] ?? '').match(/close (long|short) position for symbol (\S+) at price ([\d.]+) for ([\d.]+) units?\.? ?position avg price was ([\d.]+)/i);
    if (!m) continue;   // deposits, opens, commissions: not trades
    const at = time(r[t] ?? ''), dir = m[1].toLowerCase() as 'long' | 'short', exit = +m[3], qty = +m[4], entry = +m[5];
    const profit = pnl >= 0 && r[pnl] !== '' && Number.isFinite(+r[pnl]) ? +r[pnl] : (exit - entry) * qty * (dir === 'long' ? 1 : -1);
    if (Number.isFinite(at)) out.push({ sym: tvSymbol(m[2]), dir, openTime: at, closeTime: at, qty, entry, exit, profit, commission: 0, swap: 0 });
  }
  return out;
}
