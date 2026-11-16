// Wires the in-app CCXT source (ccxtapp.ts) into the chart and the symbol search, for the Android standalone app only.
// Importing this module loads nothing: the script bundle is fetched the first time an Android request needs it.
import { CATALOG } from './catalog.ts';
import { DEFAULT_EXCHANGES, createCcxtApp, exchangeIds, ID_RE, setExtra, type CcxtApp, type CcxtEx } from './ccxtapp.ts';
import { barHooks, isRemote, setAppSource, splitSym } from '../data.ts';
import { isStandalone } from '../servers.ts';
import { bundledOrigin } from '../standalone.ts';

/** True in the Android app without a data server (page served from the app's own origin). Desktop and web are never. */
export const appActive = () => isStandalone() && bundledOrigin();
const ls = () => { try { return globalThis.localStorage } catch { return undefined } };

type Lib = Record<string, unknown> & { ids?: string[] };
const loading = new Map<string, Promise<void>>();
const script = (src: string) => { let p = loading.get(src); if (!p) { p = new Promise<void>((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => { loading.delete(src); no(Error(`Could not load ${src}`)) }; document.head.append(s) }); loading.set(src, p) } return p };
/**
 * Contract with the bundle: `ccxt/lite.js` sets `globalThis.ccxtLite` (exchange constructors by id plus `ids`, the list of what it holds);
 * an id it lacks is looked up in `ccxt/full.js`, which replaces `globalThis.ccxtLite` with a superset (every exchange, same shape).
 */
export async function loadCcxt(id: string): Promise<new (o: object) => CcxtEx> {
  const lib = () => (globalThis as { ccxtLite?: Lib }).ccxtLite;
  const find = () => { const l = lib(); return (l && id !== 'ids' && Object.hasOwn(l, id) ? l[id] : undefined) as (new (o: object) => CcxtEx) | undefined };
  if (!lib()) await script('ccxt/lite.js');
  let C = find();
  if (!C) { await script('ccxt/full.js'); C = find() }
  if (!C) throw Error(`Exchange "${id}" is not available in this app`);
  return C;
}

// ---------- IndexedDB key/value for market lists (too big for localStorage); falls back to memory ----------
const mem = new Map<string, string>();
let db: Promise<IDBDatabase | null> | undefined;
export const IDB_TIMEOUT = 3000;   // a blocked or never-answering open falls back to memory
const open = () => (db ??= new Promise(res => {
  const t = setTimeout(() => res(null), IDB_TIMEOUT), ok = (v: IDBDatabase | null) => { clearTimeout(t); res(v) };
  try { const r = indexedDB.open('ctccxt', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); r.onblocked = () => ok(null) } catch { ok(null) }
}));
const kv = {
  async get(k: string) {
    const d = await open(); if (!d) return mem.get(k);
    return new Promise<string | undefined>(ok => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined) });
  },
  async set(k: string, v: string) {
    const d = await open(); if (!d) { mem.set(k, v); return }
    await new Promise<void>(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = () => ok() });
  },
};

let app: CcxtApp | undefined;
const get = () => (app ??= createCcxtApp({ ctor: loadCcxt, now: () => Date.now(), sleep: (ms, sig) => new Promise(r => { const t = setTimeout(r, ms); sig?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true }) }), kv, visible: () => document.visibilityState !== 'hidden' }));

/** Our exchange id behind a symbol prefix (catalog ids such as KRAKENFUTURES map to their CCXT id), or null when it is not a CCXT exchange. */
export const ccxtOf = (ex: string, ids = exchangeIds(ls())) => (ids.includes(ex) ? ex : CATALOG.find(p => p.id === ex)?.ccxt ?? null);

/** Bar hooks for the chart; `active` and `owns` are injectable so routing can be tested without a browser. */
export function ccxtBarHooks(a: () => CcxtApp, active: () => boolean, owns: (ex: string) => string | null) {
  return {
    fetch: (sym: string, tf: string, end?: number) => {
      if (!active() || !isRemote(sym)) return null;
      const { exchange, symbol } = splitSym(sym), id = owns(exchange);
      return id ? a().bars(id, symbol, tf, end) : null;
    },
    stream: (sym: string, tf: string, onBar: Parameters<CcxtApp['stream']>[3]) => {
      if (!active() || !isRemote(sym)) return null;
      const { exchange, symbol } = splitSym(sym), id = owns(exchange);
      return id ? a().stream(id, symbol, tf, onBar) : null;
    },
  };
}
barHooks.push(ccxtBarHooks(get, appActive, ex => ccxtOf(ex)));

const NAMES: Record<string, string> = { bitstamp: 'Bitstamp', gemini: 'Gemini', cryptocom: 'Crypto.com', deribit: 'Deribit', phemex: 'Phemex', bingx: 'BingX', lbank: 'LBank', whitebit: 'WhiteBIT', upbit: 'Upbit', bithumb: 'Bithumb', poloniex: 'Poloniex', bitvavo: 'Bitvavo', bitfinex: 'Bitfinex', hyperliquid: 'Hyperliquid' };
const label = (id: string) => CATALOG.find(p => p.id === id)?.name ?? NAMES[id] ?? id;
setAppSource({
  active: appActive,
  exchanges: async () => exchangeIds(ls()).map(id => ({ id, name: label(id) })),
  markets: async ex => { const id = ccxtOf(ex); if (!id) throw Error(`Unknown exchange ${ex}`); return get().marketList(id) },
});

/** Search-dialog "Add exchange": "bitso" adds it (after its markets load), "-bitso" removes it. Returns what was done. */
export async function changeExchange(input: string): Promise<string> {
  const v = input.trim().toLowerCase(), off = v.startsWith('-'), id = off ? v.slice(1) : v;
  if (off) { if (DEFAULT_EXCHANGES.includes(id)) throw Error(`${id} is a built-in source`); setExtra(ls(), id, false); return `Removed ${id}` }
  if (!ID_RE.test(id)) throw Error('Exchange ids are lower case letters and digits, e.g. bitso');
  await loadCcxt(id);   // unknown to the bundle: throws "not available" before anything is stored
  setExtra(ls(), id, true);
  try { await get().markets(id) } catch { setExtra(ls(), id, false); throw Error(`Could not load markets for ${id} (blocked host or unsupported)`) }
  return `Added ${id}`;
}
