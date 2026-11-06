// Live check of the crypto market series. Run from the machine the server runs on:
//   npm run check:dominance            → one line per check, exit code 1 if any failed
//   npm run check:dominance -- --capture   → also saves the raw CoinGecko replies to server/dominance/fixtures/live/
// CoinGecko's keyless API is rate limited (about 10-30 calls a minute) and some networks / VPN exits are blocked: a failure
// here says which HTTP status came back. Nothing is written to the database.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOM_SYMS, fmtDom, valueOf, compNow } from '../../src/market/dominance.ts';
import { dom, io } from './index.ts';

const capture = process.argv.includes('--capture'), raw: Record<string, string> = {};
const real = io.fetch;
io.fetch = async (url, init) => {
  const r = await real(url, init);
  console.log(`  GET ${url.replace('https://api.coingecko.com/api/v3', '')} → HTTP ${r.status}, access-control-allow-origin: ${r.headers.get('access-control-allow-origin') ?? '(none)'}`);
  if (capture) raw[url] = (await r.clone().text()).slice(0, 400_000);
  return r;
};
type Check = { name: string; run: () => Promise<string> };
const checks: Check[] = [
  { name: 'CoinGecko /global + /coins/markets', run: async () => { const s = await dom.snapshot(); return `total ${fmtDom('TOTAL', s.total)}, ${s.coins.length} coins, top: ${s.coins.slice(0, 5).map(c => c.sym).join(' ')}${s.stale ? ' (STALE copy)' : ''}` } },
  { name: 'dominance right now', run: async () => { const s = await dom.snapshot(), c = compNow(s.total, s.coins); return DOM_SYMS.map(x => `${x.sym} ${fmtDom(x.sym, valueOf(x.sym, c))}`).join(' · ') } },
  ...['BTC.D', 'OTHERS.D', 'TOTAL', 'STABLE.D'].map((sym): Check => ({ name: `${sym} 1d (approximation)`, run: async () => { const r = await dom.bars(sym, '1d', undefined, 60, null); const l = r.bars.at(-1)!; return `${r.bars.length} bars, last ${fmtDom(sym, l.close)} on ${new Date(l.time * 1000).toISOString().slice(0, 10)}, first ${fmtDom(sym, r.bars[0].close)}, ${r.bars.filter(b => b.approx).length} approximated` } })),
  { name: 'TOTAL2 1h (approximation)', run: async () => { const r = await dom.bars('TOTAL2', '1h', undefined, 100, null); return `${r.bars.length} bars, last ${fmtDom('TOTAL2', r.bars.at(-1)!.close)}` } },
];
let bad = 0;
for (const c of checks) {
  try { console.log(`✔ ${c.name.padEnd(36)} ${await c.run()}`) }
  catch (e) { bad++; console.log(`✘ ${c.name.padEnd(36)} ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 220)}`) }
}
if (capture) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'live');
  mkdirSync(dir, { recursive: true });
  Object.entries(raw).forEach(([k, v], i) => writeFileSync(join(dir, `${String(i).padStart(2, '0')}.json`), JSON.stringify({ request: k, reply: v }, null, 1)));
  console.log(`\nSaved ${Object.keys(raw).length} raw replies to ${dir}`);
}
console.log(bad ? `\n${bad} check(s) failed. HTTP 429 = wait a minute; 403/451 = this network is blocked (try another VPN exit); see docs/dominance.md.` : '\nAll checks passed.');
process.exit(bad ? 1 : 0);
