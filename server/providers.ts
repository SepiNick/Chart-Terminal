// Connections page backend: the provider catalog, encrypted API keys, a "test this connection" call, and referral links.
// Private servers only (like brokers): keys live in the secrets table, never go back to the browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, providerById, type Provider } from '../src/providers/catalog.ts';
import * as cx from './ccxt.ts';
import { DATA_DIR } from './core/db.ts';
import { secretDel, secretGet, secretHas, secretSet } from './core/secrets.ts';
import { bad, route } from './core/http.ts';
import { keyName } from './providerkeys.ts';
export { providerKeys } from './providerkeys.ts';

const name = keyName;
const KEY_RE = /^[\x21-\x7e]{4,300}$/;   // printable ASCII, no spaces or control characters: safe in a URL or header

/** Referral links the server owner set in data/referrals.json: { "bybit": "https://…" }. Only https links are used. */
function referrals(): Record<string, string> {
  try {
    const j = JSON.parse(readFileSync(join(DATA_DIR, 'referrals.json'), 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string' && /^https:\/\//.test(v)) as [string, string][]);
  } catch { return {} }
}

function view(p: Provider, refs: Record<string, string>) {
  const keys = p.keys?.map(k => ({ ...k, saved: secretHas(name(p.id, k.name)) }));
  return {
    id: p.id, name: p.name, category: p.category, live: p.live, free: p.free, plans: p.plans, about: p.about,
    url: refs[p.id] ?? p.site, sponsored: !!refs[p.id],
    available: p.ccxt ? cx.isExchange(p.ccxt) : true,
    perp: p.category === 'perp', ccxt: p.ccxt ?? null, keys: keys ?? [], testable: !!p.test || !!p.ccxt,
  };
}

function fill(s: string, id: string, p: Provider): string {
  return s.replace(/\{(\w+)\}/g, (_, f: string) => {
    const v = secretGet(name(id, f));
    if (v == null) throw bad(`Save the ${p.keys?.find(k => k.name === f)?.label ?? f} first`);
    return v;
  });
}

async function test(p: Provider): Promise<{ ok: boolean; message: string }> {
  const t0 = Date.now();
  try {
    if (p.ccxt) {
      const { list } = await cx.markets(p.ccxt);
      const act = list.filter(m => m.active);
      const m = (p.category === 'perp' ? act.find(x => x.type === 'swap' && /^BTC_USD/.test(x.sym)) ?? act.find(x => x.type === 'swap') : act.find(x => x.sym === 'BTC_USDT' || x.sym === 'BTC_USD')) ?? act[0];
      if (!m) return { ok: false, message: 'No active markets' };
      const r = await cx.ohlcv(p.ccxt, m.sym, '1h', undefined, 20);
      return r.bars.length ? { ok: true, message: `Live: ${act.length} markets, ${m.sym} candles received (${Date.now() - t0} ms)` } : { ok: false, message: `${m.sym}: no candles` };
    }
    if (p.test) {
      const url = fill(p.test.url, p.id, p), headers = Object.fromEntries(Object.entries(p.test.headers ?? {}).map(([k, v]) => [k, fill(v, p.id, p)]));
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      const body = await r.text();
      if (!r.ok) return { ok: false, message: r.status === 401 || r.status === 403 ? 'The provider rejected this key' : `The provider answered ${r.status}` };
      if (p.test.badBody && body.includes(p.test.badBody)) return { ok: false, message: 'The provider rejected this key' };
      return { ok: true, message: `Key accepted (${Date.now() - t0} ms)${p.live ? '' : '. Live streaming for this provider is not built yet: the key is stored for when it is'}` };
    }
    return { ok: false, message: 'No test available for this provider' };
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    return { ok: false, message: m.startsWith('Save the') ? m : `Could not reach the provider: ${m.slice(0, 120)}` };
  }
}

const get = (id: string) => providerById(id) ?? (() => { throw bad('Unknown provider') })();

route('GET', '/api/providers', () => { const refs = referrals(); return CATALOG.map(p => view(p, refs)) });
route('PUT', '/api/providers/:id/keys', c => {
  const p = get(c.params.id), vals = (c.body as { values?: Record<string, unknown> } | null)?.values ?? {};
  if (!p.keys) throw bad('This provider takes no keys');
  for (const k of p.keys) {
    const v = vals[k.name];
    if (v === undefined || v === '') continue;   // blank keeps what is already saved
    if (typeof v !== 'string' || !KEY_RE.test(v)) throw bad(`${k.label}: use the key exactly as the provider shows it (no spaces)`);
    secretSet(name(p.id, k.name), v);
  }
  return view(p, referrals());
}, { limit: 8 * 1024 });
route('DELETE', '/api/providers/:id/keys', c => { const p = get(c.params.id); for (const k of p.keys ?? []) secretDel(name(p.id, k.name)); return view(p, referrals()) });
route('POST', '/api/providers/:id/test', c => test(get(c.params.id)));
