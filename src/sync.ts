// [agent: sync] Client side of the server connection: one event WebSocket, server messages fanned out by `type`.
// This file is the contract other client modules use (docs/phase5-contracts.md §3); the sync agent implements it fully.
type Handler = (msg: Record<string, unknown>) => void;
const handlers = new Map<string, Set<Handler>>();

/** Subscribe to server messages of one `type` ('notify', 'state', 'alerts', 'alert.fired', 'forward', …). */
export function onServer(type: string, h: Handler): () => void {
  let s = handlers.get(type); if (!s) handlers.set(type, (s = new Set()));
  s.add(h);
  return () => s!.delete(h);
}
/** Called by the socket owner for every incoming message. */
export function dispatchServer(msg: Record<string, unknown>) { handlers.get(String(msg.type))?.forEach(h => h(msg)) }
/** True when the app is connected to (and logged in on) the server; false in offline / server-less mode. */
export let serverMode = false;
export function setServerMode(on: boolean) { serverMode = on }

/** JSON call to the server API; throws Error(message) on failure. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(path, { method: init.method ?? (init.body === undefined ? 'GET' : 'POST'), headers: init.body === undefined ? undefined : { 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body), credentials: 'same-origin' });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
  if (!r.ok) throw Error((j as { error?: string }).error ?? String(r.status));
  return j as T;
}
