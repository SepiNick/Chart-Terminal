// Testnet-only guard and secret scrubbing for broker adapters (docs/phase6-contracts.md §0).
// Every URL an adapter will call — REST and WebSocket — must be on this allow-list, or the call throws before any I/O.

/** Hosts that only ever serve test money. OKX has no separate demo REST host: www.okx.com counts only with its demo header. */
const TESTNET_HOSTS = [
  /^(?:[a-z0-9-]+\.)*testnet\.binance\.vision$/,   // Binance spot testnet (REST, streams, ws-api)
  /^(?:[a-z0-9-]+\.)*binancefuture\.com$/,          // Binance futures testnet (the mainnet lives on binance.com)
  /^demo-[a-z-]+\.binance\.com$/,                    // Binance demo trading (CCXT's replacement for the futures testnet)
  /^(?:api|stream)-testnet\.bybit\.com$/,
  /^wspap\.okx\.com$/,                              // OKX demo-trading WebSocket
  /^testnetapiv2\.nobitex\.ir$/,
];

export class MainnetRefused extends Error {}

/** Throws unless `url` is https/wss on a testnet host. `okxDemo`: the OKX request carries `x-simulated-trading: 1`. */
export function assertTestnetUrl(url: string, okxDemo = false) {
  let u: URL;
  try { u = new URL(url) } catch { throw new MainnetRefused(`Refused a malformed exchange URL`) }
  const host = u.hostname.toLowerCase();
  const ok = (u.protocol === 'https:' || u.protocol === 'wss:') && (TESTNET_HOSTS.some(r => r.test(host)) || (okxDemo && host === 'www.okx.com'));
  if (!ok) throw new MainnetRefused(`Refused ${host}: only exchange testnet/sandbox/demo hosts are allowed`);
  return host;
}

/** All string leaves of a CCXT `urls.api` tree. */
export function urlLeaves(x: unknown): string[] {
  if (typeof x === 'string') return [x];
  if (x && typeof x === 'object') return Object.values(x).flatMap(urlLeaves);
  return [];
}

/**
 * Error text that is safe to show or log: no URLs with query strings (CCXT puts signed URLs in errors), none of the
 * account's secrets, no long token-like strings, bounded length.
 */
export function scrub(msg: unknown, secrets: (string | null | undefined)[] = []): string {
  let s = String(msg instanceof Error ? msg.message : msg ?? 'Unknown error');
  for (const k of secrets) if (k && k.length >= 4) s = s.split(k).join('***');
  s = s.replace(/\b(https?|wss?):\/\/([^/\s?"']+)[^\s"']*/gi, (_, p, h) => `${p}://${h}`)
    .replace(/(signature|sign|apikey|api_key|key|secret|passphrase|token|authorization)(["']?\s*[:=]\s*["']?)[^\s"',&}]+/gi, '$1$2***')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '***');
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}
