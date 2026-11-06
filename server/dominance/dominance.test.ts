// The crypto market source through market.ts and the recorder (no network: fetch and candles are replaced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['CT_DATA_DIR'] = mkdtempSync(join(tmpdir(), 'ct-dom-'));
process.env['CT_NO_AUTOSTART'] = '1';
const { io } = await import('./index.ts');
const M = await import('../market.ts');
const { validSym } = await import('../alerts/validate.ts');
const R = await import('./record.ts');

const row = (id: string, symbol: string, cap: number, price: number, supply: number) => ({ id, symbol, market_cap: cap, current_price: price, circulating_supply: supply });
const MARKETS = [row('bitcoin', 'btc', 1e6, 100, 1e4), row('ethereum', 'eth', 3e5, 30, 1e4), row('tether', 'usdt', 1.5e5, 1, 1.5e5), row('ripple', 'xrp', 1e5, 2, 5e4), row('usd-coin', 'usdc', 6e4, 1, 6e4),
  row('binancecoin', 'bnb', 5e4, 50, 1e3), row('solana', 'sol', 3e4, 15, 2e3), row('dogecoin', 'doge', 2e4, 0.2, 1e5), row('tron', 'trx', 1.5e4, 0.3, 5e4), row('cardano', 'ada', 1e4, 0.5, 2e4)];
const NOW = Date.UTC(2026, 10, 10);
io.now = () => NOW; io.sleep = async () => {};
io.fetch = async url => new Response(JSON.stringify(url.includes('/global') ? { data: { total_market_cap: { usd: 2e6 } } } : url.includes('market_chart') ? { market_caps: [[NOW - 1000, 1.5e5]] } : MARKETS));
io.candles = async (pair, tf) => { const p = pair === 'BTCUSDT' ? 100 : pair === 'ETHUSDT' ? 30 : 1, t0 = Math.floor(NOW / 1000 / 3600) * 3600; return [0, 1, 2].map(i => ({ time: t0 - (2 - i) * 3600, open: p, high: p, low: p, close: p, volume: 1 })).map(b => (tf === '1h' ? b : { ...b, time: b.time - (b.time % 86400) })); };

test('exchange list, markets with the approximation flag, bars through /api/bars logic', async () => {
  assert.ok(M.SRC['cryptocap'] && Object.keys(M.SRC).includes('cryptocap'));
  const ms = (await M.SRC['cryptocap'].markets()) as { sym: string; approxUntil: number | null; note: string; type: string }[];
  assert.deepEqual(ms.map(m => m.sym), ['BTC.D', 'ETH.D', 'USDT.D', 'USDC.D', 'OTHERS.D', 'STABLE.D', 'TOTAL', 'TOTAL2', 'TOTAL3']);
  assert.ok(ms.every(m => m.approxUntil === null && /approximation from price × current supply/.test(m.note)));
  const r = await M.bars('cryptocap', 'BTC.D', '1h', undefined, 1000);
  assert.equal(r.bars.length, 3);
  assert.ok(Math.abs(r.bars[2].close - (100 * 1e4 * (2e6 / 2.72e6 > 0 ? 1 : 1)) / 2e6 * 100 * 1) < 5 && r.bars[2].close > 40);
  await assert.rejects(M.bars('cryptocap', 'NOPE', '1h'), /Unknown symbol/);
});

test('symbols are validated: only the table, alerts accept them', () => {
  assert.equal(validSym('CRYPTOCAP:BTC.D'), 'CRYPTOCAP:BTC.D');
  assert.equal(validSym('CRYPTOCAP:TOTAL3'), 'CRYPTOCAP:TOTAL3');
  assert.throws(() => validSym('CRYPTOCAP:EVIL'), /Unknown crypto market symbol/);
  assert.ok(M.SYM_RE.test('OTHERS.D'));
});

test('recorder: bounded table, merge into the series with a flag on recorded bars', async () => {
  assert.equal(R.first(), null);
  const t0 = Math.floor(NOW / 1000 / 3600) * 3600 - 3600 + 60;   // inside the second bar
  R.add({ t: t0, c: { total: 2e6, btc: 1.2e6, eth: 3e5, usdt: 1.5e5, usdc: 6e4, stable: 2.1e5, top10: 1.8e6 } });
  R.add({ t: t0 + 300, c: { total: 2e6, btc: 1.22e6, eth: 3e5, usdt: 1.5e5, usdc: 6e4, stable: 2.1e5, top10: 1.8e6 } });
  assert.equal(R.first()!.t, t0);
  assert.equal(R.read(0, 1e12).length, 2);
  assert.equal(R.read(t0 + 1, 1e12).length, 1);
  const ms = (await M.SRC['cryptocap'].markets()) as { approxUntil: number | null }[];
  assert.equal(ms[0].approxUntil, t0);
  const r = await M.bars('cryptocap', 'BTC.D', '1h', undefined, 1000);
  assert.deepEqual(r.bars.map(b => (b as { approx?: boolean }).approx), [true, false, true]);
  assert.equal(r.bars[1].close, 61);
  assert.ok(Math.abs(r.bars[0].close - 60) < 1e-6, 'no seam');
  // a snapshot with a repeated second replaces, it does not grow the table
  R.add({ t: t0, c: { total: 2e6, btc: 1.2e6, eth: 3e5, usdt: 1.5e5, usdc: 6e4, stable: 2.1e5, top10: 1.8e6 } });
  assert.equal(R.read(0, 1e12).length, 2);
});
