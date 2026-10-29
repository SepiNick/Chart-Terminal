import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-rec-'));
process.env.CT_NO_AUTOSTART = '1';
const R = await import('./recorder.ts');
const { db, configSet } = await import('./core/db.ts');
const count = (sym: string) => (db.prepare('SELECT COUNT(*) AS n FROM prints WHERE sym = ?').get(sym) as { n: number }).n;
const DAY = 86400, NOW = 1_800_000_000;   // seconds

test('batches inserts, queries newest-first windows, prunes past retention', () => {
  R.deps.batchRows = 100;
  R.add('BTCUSDT', Array.from({ length: 50 }, (_, i) => ({ t: NOW - 40 * DAY + i, px: 1, qty: 1, buy: true, id: i })));
  assert.equal(count('BTCUSDT'), 0, 'buffered below batchRows');
  R.add('BTCUSDT', Array.from({ length: 60 }, (_, i) => ({ t: NOW - 10 + i * 0.1, px: 2 + i, qty: 0.5, buy: i % 2 === 0, id: 1000 + i })));
  assert.equal(count('BTCUSDT'), 110, 'flushed at batchRows');
  R.add('ETHUSDT', [{ t: NOW, px: 3, qty: 1, buy: false }]);
  R.flush();

  const last5 = R.query('BTCUSDT', undefined, undefined, 5);
  assert.deepEqual(last5.map(p => p.id), [1055, 1056, 1057, 1058, 1059]);
  assert.equal(last5[0].buy, false); assert.equal(last5[1].buy, true);
  assert.deepEqual(R.query('btcusdt', NOW - 40 * DAY, undefined, 3).map(p => p.id), [0, 1, 2], 'from pages forward; symbol normalised');
  assert.equal(R.query('BINANCE:BTCUSDT', NOW - 10, NOW - 9.5).length, 6);
  assert.deepEqual(R.query('ETHUSDT'), [{ t: NOW, px: 3, qty: 1, buy: false }]);

  const before = R.stats(['BTCUSDT']).find(s => s.sym === 'BTCUSDT')!;
  assert.equal(before.count, 110); assert.equal(before.from, NOW - 40 * DAY); assert.ok(before.approxBytes > 0);
  R.prune(NOW * 1000);
  assert.equal(count('BTCUSDT'), 60);
  const after = R.stats(['BTCUSDT', 'SOLUSDT']);
  assert.deepEqual(after.map(s => [s.sym, s.count]), [['BTCUSDT', 60], ['SOLUSDT', 0], ['ETHUSDT', 1]]);
  assert.equal(after[1].from, null);
});

test('apply() starts/stops sources for the configured symbols, backfilling only a recent gap', () => {
  const started: [string, number | undefined][] = [], stopped: string[] = [];
  R.deps.now = () => NOW * 1000 + 60_000;
  R.deps.source = (sym, lastId, on) => { started.push([sym, lastId]); on([{ t: NOW + 1, px: 9, qty: 1, buy: true, id: 2000 }]); return () => stopped.push(sym) };
  configSet('recorder', { symbols: ['BTCUSDT', 'BYBIT:BTC_USDT.P'] });
  R.apply();
  assert.deepEqual(started, [['BTCUSDT', 1059], ['BYBIT:BTC_USDT.P', undefined]]);
  configSet('recorder', { symbols: ['BYBIT:BTC_USDT.P'] });
  R.apply();
  assert.deepEqual(stopped, ['BTCUSDT']);
  R.stopAll();
  assert.equal(R.query('BTCUSDT').at(-1)!.id, 2000);
});

test('page() walks forward with a cursor that never splits or repeats prints sharing a timestamp', () => {
  // 25 prints over 5 timestamps (5 each), ids in insertion order
  R.add('XRPUSDT', Array.from({ length: 25 }, (_, i) => ({ t: NOW + Math.floor(i / 5), px: 1, qty: 1, buy: true, id: i })));
  const seen: number[] = [];
  let cursor: string | undefined, pages = 0;
  for (;;) {
    const pg = R.page('XRPUSDT', NOW + 1, cursor, 7);
    seen.push(...pg.prints.map(p => p.id!)); pages++;
    if (!pg.next) break;
    cursor = pg.next;
  }
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, i) => i + 5), 'from is inclusive, every print exactly once');
  assert.equal(pages, 3);
  assert.deepEqual(R.page('xrpusdt', NOW + 10).prints, []);
  assert.throws(() => R.page('XRPUSDT', NOW, 'x:y'));
});

test('binanceSource backfills the gap after a reconnect without duplicates', async () => {
  const sockets: { onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; close(): void }[] = [];
  class FakeWs { onopen = null; onmessage = null; onclose = null; constructor() { sockets.push(this) } close() {} }
  const agg = (a: number) => ({ a, p: '100', q: '1', T: a * 1000, m: false });
  const urls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const fetch = async (url: string) => { urls.push(url); await gate; const from = +new URL(url).searchParams.get('fromId')!; return { ok: true, json: async () => Array.from({ length: 13 - from }, (_, i) => agg(from + i)) } };
  const got: number[] = [];
  const stop = R.binanceSource('BTCUSDT', undefined, ps => got.push(...ps.map(p => p.id!)), { WebSocket: FakeWs as never, fetch, maxPages: 5, maxDelay: 1 });
  sockets[0].onopen!();                       // first connect: no gap to fill
  sockets[0].onmessage!({ data: JSON.stringify(agg(5)) });
  sockets[0].onmessage!({ data: JSON.stringify(agg(6)) });
  sockets[0].onclose!();
  await new Promise(r => setTimeout(r, 5));   // backoff → reconnect
  assert.equal(sockets.length, 2);
  sockets[1].onopen!();                       // backfill from id 7 starts; live messages are held meanwhile
  sockets[1].onmessage!({ data: JSON.stringify(agg(11)) });
  sockets[1].onmessage!({ data: JSON.stringify(agg(12)) });
  release();
  await new Promise(r => setTimeout(r, 5));
  sockets[1].onmessage!({ data: JSON.stringify(agg(13)) });
  stop();
  assert.match(urls[0], /fromId=7/);
  assert.deepEqual(got, [5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test('recordedBars: activity bars from the whole recording before a time', () => {
  R.add('XRPUSDT', Array.from({ length: 1000 }, (_, i) => ({ t: NOW - 3 * DAY + i * 60, px: 1 + (i % 7) / 100, qty: 1, buy: i % 2 === 0 })));
  R.flush();
  const bars = R.recordedBars('XRPUSDT', '100T', NOW - 3 * DAY + 500 * 60, 7, 0.01);
  assert.equal(bars.length, 5, '500 prints before the cut = five 100-tick bars');
  assert.ok(bars.every(b => b.volume === 100));
  assert.throws(() => R.recordedBars('XRPUSDT', '1h', NOW, 7, 0), /activity interval/);
});
