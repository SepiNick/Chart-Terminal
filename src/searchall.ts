// The all-exchanges symbol search: loads each source's market list once (a few at a time, failures skipped), then ranks across them.
import { allSources, binanceEntries, kindOf, rank, type Kind, type SearchEntry } from './symsearch.ts';
import type { RemoteMarket } from './data.ts';

const PARALLEL = 4, TIMEOUT = 15000;
const pending = new Set<string>(), failed = new Set<string>(), queue: string[] = [];
let running = 0;
let cfg: { cache: Map<string, RemoteMarket[]>; fetch: (ex: string) => Promise<RemoteMarket[]>; tick: () => void } | null = null;

function pump() {
  while (cfg && running < PARALLEL && queue.length) {
    const id = queue.shift()!, c = cfg;
    running++;
    Promise.race([c.fetch(id), new Promise<never>((_, no) => setTimeout(() => no(Error('timeout')), TIMEOUT))])
      .then(ms => { c.cache.set(id, ms) }, () => { failed.add(id) })
      .finally(() => { pending.delete(id); running--; c.tick(); pump() });
  }
}
/** Forget failed sources (a new search session retries them). */
export const retryFailed = () => failed.clear();

export interface AllResult { list: SearchEntry[]; loading: number; failed: number }
/** Matches for `q` across Binance spot, the dominance symbols and every source in `ids`; starts loading what is not cached yet. */
export function searchAll(q: string, o: {
  ids: string[]; isCcxt: (id: string) => boolean; kind?: Kind; binance: string[]; extra: SearchEntry[];
  cache: Map<string, RemoteMarket[]>; fetch: (ex: string) => Promise<RemoteMarket[]>; tick: () => void;
}): AllResult {
  cfg = { cache: o.cache, fetch: o.fetch, tick: o.tick };
  const src = allSources(o.ids, o.isCcxt);
  for (const id of src) if (!o.cache.has(id) && !pending.has(id) && !failed.has(id)) { pending.add(id); queue.push(id) }
  pump();
  const all = [...binanceEntries(o.binance), ...o.extra];
  for (const id of src) for (const m of o.cache.get(id) ?? []) all.push({ ex: id, ...m });
  const list = rank(o.kind ? all.filter(e => kindOf(e) === o.kind) : all, q, { perEx: 6, limit: 100 });
  return { list, loading: src.filter(id => pending.has(id)).length, failed: src.filter(id => failed.has(id)).length };
}
