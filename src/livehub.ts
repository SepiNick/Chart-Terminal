// One set of live connections for all windows of the app. The window holding the Web Lock `ct-live` (the "owner")
// opens the real sockets for the union of what every window displays and relays each update over the window channel;
// the other windows only listen. If the owner closes, the lock passes to another window, which reopens the sockets.
// Without Web Locks or BroadcastChannel every window just opens its own sockets, as before.
import { Peers, type Msg } from './winlink.ts';
import { busOk, myId, onMsg, send } from './winbus.ts';

type Fn = (data: any) => void;   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Starters {
  bar(sym: string, tf: string, cb: Fn): () => void;
  tickers(syms: string[], cb: (sym: string, t: any) => void): () => void;   // eslint-disable-line @typescript-eslint/no-explicit-any
}
let starters: Starters | null = null;
export const setStarters = (s: Starters) => { starters = s };

const shared = busOk && !!globalThis.navigator?.locks;
const subs = new Map<string, Set<Fn>>();
const peers = new Peers();
let owner = false, others = new Set<string>(), timer = 0;
const real = new Map<string, () => void>();   // bar streams the owner keeps open
let tickStop: (() => void) | null = null, tickKey = '';

const deliver = (key: string, data: unknown) => {
  subs.get(key)?.forEach(f => { try { f(data) } catch (e) { console.error(e) } });
  if (others.has(key)) send({ t: 'live', key, data });
};
const wanted = () => new Set([...subs.keys(), ...others]);

function reconcile() {
  others = peers.union(Date.now());
  if (!owner || !starters) return;
  const want = wanted();
  for (const [k, stop] of real) if (!want.has(k)) { stop(); real.delete(k) }
  for (const k of want) if (k.startsWith('b|') && !real.has(k)) { const [, sym, tf] = k.split('|'); real.set(k, starters.bar(sym, tf, b => deliver(k, b))) }
  const syms = [...want].filter(k => k.startsWith('t|')).map(k => k.slice(2)).sort(), tk = syms.join(',');
  if (tk !== tickKey) {
    tickStop?.(); tickStop = null; tickKey = tk;
    if (syms.length) tickStop = starters.tickers(syms, (s, t) => deliver('t|' + s, t));
  }
}
function announce() {
  if (!shared) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => { send({ t: 'wants', id: myId, keys: [...subs.keys()] }); reconcile() }, 50);
}

if (shared) {
  onMsg((m: Msg) => {
    if (m.t === 'live') { subs.get(m.key)?.forEach(f => { try { f(m.data) } catch (e) { console.error(e) } }); return }
    if (m.t === 'wants') peers.wants(m.id, m.keys, Date.now());
    else if (m.t === 'hello') { peers.hello(m.id, m.kind, Date.now()); send({ t: 'wants', id: myId, keys: [...subs.keys()] }) }   // a newcomer asks everyone to report
    else if (m.t === 'bye') peers.bye(m.id);
    else return;
    reconcile();
  });
  // Take the lock if free; otherwise wait for it (the previous owner closed) and take over.
  const hold = () => new Promise<void>(() => {});   // never resolves: the lock is held until this page goes away
  const become = () => { owner = true; send({ t: 'wants', id: myId, keys: [...subs.keys()] }); reconcile(); return hold() };
  navigator.locks.request('ct-live', { ifAvailable: true }, lock => {
    if (lock) return become();
    void navigator.locks.request('ct-live', become);
  }).catch(() => {});
  setInterval(() => { send({ t: 'wants', id: myId, keys: [...subs.keys()] }); reconcile() }, 5000);   // refresh: peers expire after 15 s without news
  addEventListener('pagehide', () => { send({ t: 'bye', id: myId }); real.forEach(s => s()); tickStop?.() });
}

/** Subscribe to one live key. `direct` opens a private connection when sharing is unavailable. */
function sub(key: string, fn: Fn, direct: () => () => void): () => void {
  if (!shared) return direct();
  const set = subs.get(key) ?? new Set();
  subs.set(key, set); set.add(fn); announce();
  return () => { set.delete(fn); if (!set.size) subs.delete(key); announce() };
}
export const hubBar = (sym: string, tf: string, cb: Fn, direct: () => () => void) => sub(`b|${sym}|${tf}`, cb, direct);
export function hubTickers(syms: string[], cb: (sym: string, t: any) => void, direct: () => () => void): () => void {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!shared) return direct();
  const offs = syms.filter(s => !s.includes('|')).map(s => sub('t|' + s, t => cb(s, t), direct));
  return () => offs.forEach(f => f());
}
/** For tests and the diagnostics line: who owns the connections. */
