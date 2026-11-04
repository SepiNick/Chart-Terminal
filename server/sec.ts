// SEC EDGAR (no key) for the fundamental skills: ticker → CIK, XBRL company facts, cross-company "frames",
// filing lists, and filing folders (13F information tables, 8-K exhibits). Fixed SEC hosts, every path built here
// from validated parameters, at most ~8 requests a second as SEC asks, cached, stale copy on upstream failure.
// SEC wants a User-Agent with a contact: set CT_SEC_USER_AGENT="Your Name you@example.com" to use your own.
import { gunzipSync } from 'node:zlib';
import { HttpError, bad, route } from './core/http.ts';

const UA = () => process.env.CT_SEC_USER_AGENT?.trim() || 'ChartTerminal/0.1 (personal research app; contact admin@chartterminal.local)';
/** Swappable for tests. */
export const deps = { fetch: (url: string) => fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': UA(), 'accept-encoding': 'gzip' } }), now: () => Date.now(), gap: 125 };

let last = 0, chain: Promise<unknown> = Promise.resolve();
/** One SEC request at a time, ≥ `gap` ms apart. */
let waiting = 0;
const MAX_QUEUE = process.env.CT_MODE === 'public' ? 40 : 1000;   // requests waiting for their turn; beyond this callers are told to come back
function polite<T>(f: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_QUEUE) return Promise.reject(new HttpError(503, 'Too many SEC requests are waiting. Try again in a moment'));
  waiting++;
  const run = chain.then(async () => { const w = last + deps.gap - deps.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); last = deps.now(); return f() });
  chain = run.catch(() => undefined);
  void chain.then(() => { waiting-- });
  return run;
}
const cache = new Map<string, { at: number; data: unknown }>();
async function get<T>(url: string, ttl: number, kind: 'json' | 'text' = 'json'): Promise<T> {
  const c = cache.get(url);
  if (c && deps.now() - c.at < ttl) return c.data as T;
  try {
    const data = await polite(async () => {
      const r = await deps.fetch(url);
      if (r.status === 404) throw new HttpError(404, 'SEC has no data for this request');
      if (!r.ok) throw new HttpError(502, `SEC returned ${r.status}`);
      let buf = Buffer.from(await r.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      return kind === 'json' ? JSON.parse(buf.toString('utf8')) : buf.toString('utf8');
    });
    cache.set(url, { at: deps.now(), data });
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
    return data as T;
  } catch (e) {
    if (c && !(e instanceof HttpError && e.status === 404)) return c.data as T;
    throw e instanceof HttpError ? e : new HttpError(502, `SEC unreachable: ${(e as Error).message}`);
  }
}
const H = 3600_000;
export async function tickers() {
  const d = await get<Record<string, { cik_str: number; ticker: string; title: string }>>('https://www.sec.gov/files/company_tickers.json', 24 * H);
  const out: Record<string, { cik: string; name: string }> = {};
  for (const v of Object.values(d)) { const t = v.ticker.toUpperCase().replace(/-/g, '.'); if (!out[t]) out[t] = { cik: String(v.cik_str).padStart(10, '0'), name: v.title.replace(/\s*\/[A-Z]{2,5}\/?\s*$/, '').trim() } }
  return out;
}
/** A ticker (AAPL, BRK.B) or a CIK (digits) → the 10-digit CIK. */
export async function cikOf(q: string) {
  const s = q.trim().toUpperCase();
  if (/^\d{1,10}$/.test(s)) return s.padStart(10, '0');
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) throw bad('Give a ticker or a CIK');
  const c = (await tickers())[s.replace(/-/g, '.')]?.cik;
  if (!c) throw new HttpError(404, `No SEC filer for ${s} (ETFs and many foreign companies have no XBRL facts)`);
  return c;
}
export const facts = async (q: string) => get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${await cikOf(q)}.json`, 12 * H);
export const submissions = async (q: string) => get(`https://data.sec.gov/submissions/CIK${await cikOf(q)}.json`, H);
export function frame(taxonomy: string, concept: string, unit: string, period: string) {
  if (!/^(us-gaap|dei|ifrs-full|srt)$/.test(taxonomy) || !/^[A-Za-z0-9]{2,120}$/.test(concept) || !/^[A-Za-z0-9-]{1,30}$/.test(unit) || !/^CY\d{4}(Q[1-4])?I?$/.test(period)) throw bad('Bad frame request');
  return get(`https://data.sec.gov/api/xbrl/frames/${taxonomy}/${concept}/${unit}/${period}.json`, 24 * H);
}
/** A file inside one filing's folder: index.json, or a document named in it. */
export async function filingFile(cik: string, acc: string, name: string) {
  if (!/^\d{1,10}$/.test(cik) || !/^\d{10}-?\d{2}-?\d{6}$/.test(acc) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name)) throw bad('Bad filing path');
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${name}`;
  return name.endsWith('.json') ? get(url, 24 * H) : get<string>(url, 24 * H, 'text');
}
const q = (c: { url: URL }, k: string) => { const v = c.url.searchParams.get(k); if (!v) throw bad(`${k} is required`); return v };
route('GET', '/api/sec/facts', c => facts(q(c, 'q')));
route('GET', '/api/sec/submissions', c => submissions(q(c, 'q')));
route('GET', '/api/sec/cik', async c => ({ cik: await cikOf(q(c, 'q')) }));
route('GET', '/api/sec/frame', c => frame(c.url.searchParams.get('taxonomy') ?? 'us-gaap', q(c, 'concept'), q(c, 'unit'), q(c, 'period')));
route('GET', '/api/sec/file', c => filingFile(q(c, 'cik'), q(c, 'acc'), q(c, 'name')));
/** Earnings releases: 8-Ks with item 2.02, timed by SEC's acceptance stamp in New York time (before 9:30 → BMO, from 16:00 → AMC). */
export async function earnings8k(q: string) {
  const r = ((await submissions(q)) as { filings?: { recent?: Record<string, string[]> } }).filings?.recent ?? {}, out: { date: string; accepted: string; timing: 'bmo' | 'amc' | 'unknown' }[] = [];
  (r.form ?? []).forEach((f, i) => {
    if (f !== '8-K' || !(r.items?.[i] ?? '').includes('2.02')) return;
    const acc = r.acceptanceDateTime?.[i] ?? '', ny = acc ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(acc)) : '';
    const m = ny ? +ny.slice(0, 2) * 60 + +ny.slice(3, 5) : NaN;
    out.push({ date: r.filingDate[i], accepted: acc, timing: !Number.isFinite(m) ? 'unknown' : m < 570 ? 'bmo' : m >= 960 ? 'amc' : 'unknown' });
  });
  return out;
}
route('GET', '/api/sec/earnings', c => earnings8k(q(c, 'q')));
/** SEC's ticker file as rows [cik, ticker, title], in its own order (13F name matching needs every row). */
export const tickerRows = async () => Object.values(await get<Record<string, { cik_str: number; ticker: string; title: string }>>('https://www.sec.gov/files/company_tickers.json', 24 * H)).map(v => [String(v.cik_str).padStart(10, '0'), v.ticker, v.title]);
route('GET', '/api/sec/tickers', () => tickerRows());
