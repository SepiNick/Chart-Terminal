// The channel between this app's windows and tabs (main window + pop-outs). BroadcastChannel is same-origin only, so
// another site cannot join; messages are still validated (winlink.ts) because any page of this origin can post.
import { newWid, parseMsg, type Msg } from './winlink.ts';

/** This window's id: the pop-out's own id (from its URL), or a fresh one for the main window / a plain tab. */
const q = new URLSearchParams(globalThis.location?.search ?? '');
export const popKindParam = q.get('po');
export const myId = (() => { const w = q.get('wid'); return popKindParam && w && /^[a-z0-9]{4,16}$/.test(w) ? w : newWid() })();

const ch = typeof document !== 'undefined' && 'BroadcastChannel' in globalThis ? new BroadcastChannel('ct-win') : null;   // never in Node (tests): an open channel would keep the process alive
const fns = new Set<(m: Msg) => void>();
ch?.addEventListener('message', e => { const m = parseMsg(e.data); if (m) fns.forEach(f => f(m)) });
export const busOk = !!ch;
export const send = (m: Msg) => { try { ch?.postMessage(m) } catch {} };
export function onMsg(f: (m: Msg) => void): () => void { fns.add(f); return () => { fns.delete(f) } }
