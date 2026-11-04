// Standalone mode: the app runs with no server at all (charts, scripts, paper trading and the journal live in this
// browser; market data comes straight from Binance's public API). Decided at boot from GET /api/auth/status: a network
// error, a 404, a timeout or a non-JSON body (static hosting answers index.html) means "no Chart Terminal server here".
// The decision is remembered for the session; a quiet probe with growing delays notices when a server appears later.
// Pure helpers first (tested in standalone.test.ts), browser glue at the bottom. Safe to import in node.
import { authHeaders, isSameOrigin, parseStatus, serverUrl, setStandalone, syncServer, type ServerStatus } from './servers.ts';

const SESSION_KEY = 'ctStandalone';
type Kv = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `/api/auth/status` answer → a status, or null when this is not a Chart Terminal server (HTML, 404, 5xx, garbage). */
export function statusFromResponse(ok: boolean, body: string): ServerStatus | null {
  if (!ok) return null;
  try { return parseStatus(JSON.parse(body)) } catch { return null }
}
/** Delay before probe number `attempt` (0-based): 20 s, 40 s, 80 s … capped at 10 minutes. */
export const retryDelay = (attempt: number) => Math.min(600_000, 20_000 * 2 ** Math.max(0, attempt));
/** Session memory of the decision (sessionStorage). */
export const rememberedStandalone = (serverId: string, kv?: Kv) => { try { return kv?.getItem(SESSION_KEY) === serverId } catch { return false } };   // keyed by sync server: picking another one re-probes
export function remember(on: boolean, serverId: string, kv?: Kv) { try { if (on) kv?.setItem(SESSION_KEY, serverId); else kv?.removeItem(SESSION_KEY) } catch {} }
/** A probe is pointless when the "server" is the page's own origin inside the bundled app (the asset handler answers 404 by design). */
export const bundledOrigin = (origin = globalThis.location?.origin ?? '') => origin === 'https://appassets.androidplatform.net';

const session = (): Kv | undefined => { try { return globalThis.sessionStorage } catch { return undefined } };

/** One GET /api/auth/status of the sync server, with a timeout; null = standalone. Never throws. Bypasses the standalone guard. */
export async function probeSyncServer(timeoutMs = 5000): Promise<ServerStatus | null> {
  try {
    const s = syncServer();
    const r = await fetch(serverUrl(s, '/api/auth/status'), { headers: authHeaders(s), credentials: isSameOrigin(s) ? 'same-origin' : 'omit', signal: AbortSignal.timeout(timeoutMs) });
    return statusFromResponse(r.ok, await r.text());
  } catch { return null }
}

/** Boot decision. A remembered standalone session skips the wait (the background probe keeps looking). */
export async function decideStandalone(): Promise<{ standalone: boolean; status: ServerStatus | null }> {
  if (rememberedStandalone(syncServer().id, session())) { setStandalone(true); return { standalone: true, status: null } }
  const status = await probeSyncServer();
  const standalone = !status;
  setStandalone(standalone); remember(standalone, syncServer().id, session());
  return { standalone, status };
}

/** Background probe while standalone; `found` fires once when a server answers. Returns a stop function. */
export function watchForServer(found: (st: ServerStatus) => void): () => void {
  if (bundledOrigin()) return () => {};
  let attempt = 0, timer = 0, stopped = false;
  const tick = async () => {
    if (stopped) return;
    // a hidden tab waits for the next visit instead of probing
    if (document.visibilityState === 'hidden') { timer = window.setTimeout(tick, retryDelay(attempt)); return }
    const st = await probeSyncServer();
    if (stopped) return;
    if (st) return found(st);
    timer = window.setTimeout(tick, retryDelay(++attempt));
  };
  timer = window.setTimeout(tick, retryDelay(0));
  return () => { stopped = true; clearTimeout(timer) };
}
/** Leave standalone for this session (the page reloads and boots against the server). */
export function leaveStandalone() { remember(false, syncServer().id, session()) }
