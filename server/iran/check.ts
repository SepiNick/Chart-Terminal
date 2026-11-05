// Live check of the Iranian data sources. Run from a machine that can reach them (inside Iran for most):
//   npm run check:ir                  → one line per check, exit code 1 if any failed
//   npm run check:ir -- --capture     → also saves every raw reply to server/iran/fixtures/live/ (attach these when something differs)
//   npm run check:ir -- --only=tse    → nobitex, tgju or tse only
// The parsers were written from third-party descriptions of these services, never run against them from the build
// environment, so this is the first thing to run after installing, and again whenever a chart goes empty.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deps } from './http.ts';
import { irtDivisor, nobitexBars, nobitexMarkets, nobitexTickers } from './nobitex.ts';
import { tgjuBars } from './tgju.ts';
import { INDICES, tseBars, tseMarkets, tseTickers } from './tse.ts';

const args = process.argv.slice(2), capture = args.includes('--capture'), only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const raw: Record<string, string> = {};
const real = deps.fetch;
deps.fetch = async (url, init) => {
  const r = await real(url, init);
  if (capture) raw[`${init?.method ?? 'GET'} ${url}`] = (await r.clone().text()).slice(0, 400_000);
  return r;
};

type Check = { src: string; name: string; run: () => Promise<string> };
const f = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const last = (r: { bars: { close: number; time: number }[] }) => !r.bars.length ? '0 bars (the instrument has no trades in this range)' : `${r.bars.length} bars, last ${new Date(r.bars.at(-1)!.time * 1000).toISOString().slice(0, 10)} close ${f(r.bars.at(-1)!.close)}`;
const range = (v: number, lo: number, hi: number, what: string) => (v >= lo && v <= hi ? '' : `  ⚠ ${what} looks wrong (expected ${f(lo)}–${f(hi)})`);

const checks: Check[] = [
  { src: 'nobitex', name: 'Rial or Toman', run: async () => { const d = await irtDivisor(); return d === 10 ? 'the candle API quotes IRT in Rial (÷10 applied)' : 'the candle API quotes IRT in Toman (no conversion)' } },
  { src: 'nobitex', name: 'USDTIRT 1h candles', run: async () => { const r = await nobitexBars('USDTIRT', '1h', undefined, 20); return last(r) + ' Toman' + range(r.bars.at(-1)!.close, 30_000, 2_000_000, 'the Tether price in Toman') } },
  { src: 'nobitex', name: 'BTCIRT 1d candles', run: async () => { const r = await nobitexBars('BTCIRT', '1d', undefined, 30); return last(r) } },
  { src: 'nobitex', name: 'BTCUSDT 15m candles', run: async () => last(await nobitexBars('BTCUSDT', '15m', undefined, 50)) },
  { src: 'nobitex', name: 'markets', run: async () => { const m = await nobitexMarkets(); return `${m.length} markets${m.length < 100 ? ' (probably the built-in list: /v2/orderbook/all did not answer)' : ''}` } },
  { src: 'nobitex', name: 'tickers', run: async () => { const t = await nobitexTickers(); return `${t.length} tickers, first ${t[0]?.sym} ${f(t[0]?.last ?? 0)}` } },
  { src: 'tgju', name: 'USD daily', run: async () => { const r = await tgjuBars('USD', '1d', undefined, 60); return last(r) + ' Toman' + range(r.bars.at(-1)!.close, 30_000, 2_000_000, 'the free-market dollar') } },
  { src: 'tgju', name: 'GOLD18 daily', run: async () => last(await tgjuBars('GOLD18', '1d', undefined, 60)) },
  { src: 'tgju', name: 'SEKKEH daily', run: async () => last(await tgjuBars('SEKKEH', '1d', undefined, 60)) },
  { src: 'tgju', name: 'ONS daily (USD)', run: async () => { const r = await tgjuBars('ONS', '1d', undefined, 60); return last(r) + range(r.bars.at(-1)!.close, 500, 20_000, 'the gold ounce in dollars') } },
  { src: 'tse', name: 'market list', run: async () => { const m = await tseMarkets(), by: Record<string, number> = {}; for (const x of m) by[x.type] = (by[x.type] ?? 0) + 1; return `${m.length} instruments: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}${m.length < 100 ? '  ⚠ only the built-in indices: the list endpoint did not answer' : ''}` } },
  { src: 'tse', name: 'tickers', run: async () => { const t = await tseTickers(); return `${t.length} tickers` } },
  { src: 'tse', name: 'فولاد daily', run: async () => last(await tseBars('فولاد', '1d', undefined, 60)) },
  { src: 'tse', name: 'ح.فولاد (right) daily', run: async () => last(await tseBars('فولادح', '1d', undefined, 30)) },
  { src: 'tse', name: 'first bond in the list', run: async () => { const b = (await tseMarkets()).find(x => x.type === 'bond'); if (!b) throw Error('no instrument was classified as a bond: check classify() against the market list'); return `${b.sym} (${b.name}): ${last(await tseBars(b.sym, '1d', undefined, 30))}` } },
  { src: 'tse', name: 'first ETF in the list', run: async () => { const b = (await tseMarkets()).find(x => x.type === 'etf'); if (!b) throw Error('no fund found'); return `${b.sym}: ${last(await tseBars(b.sym, '1d', undefined, 30))}` } },
  ...Object.keys(INDICES).map((k): Check => ({ src: 'tse', name: `index ${k}`, run: async () => last(await tseBars(k, '1d', undefined, 60)) })),
  { src: 'tse', name: 'فولاد monthly (Jalali)', run: async () => last(await tseBars('فولاد', '1M', undefined, 12)) },
];

let bad = 0;
for (const c of checks.filter(c => !only || only.includes(c.src))) {
  try { console.log(`✔ ${c.src.padEnd(7)} ${c.name.padEnd(26)} ${await c.run()}`) }
  catch (e) { bad++; console.log(`✘ ${c.src.padEnd(7)} ${c.name.padEnd(26)} ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 200)}`) }
}
if (capture) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'live');
  mkdirSync(dir, { recursive: true });
  Object.entries(raw).forEach(([k, v], i) => writeFileSync(join(dir, `${String(i).padStart(2, '0')}.json`), JSON.stringify({ request: k, reply: v }, null, 1)));
  console.log(`\nSaved ${Object.keys(raw).length} raw replies to ${dir}`);
}
console.log(bad ? `\n${bad} check(s) failed. Failed ones usually mean the endpoint moved or is blocked from this network (see docs/iran-market.md).` : '\nAll checks passed.');
process.exit(bad ? 1 : 0);
