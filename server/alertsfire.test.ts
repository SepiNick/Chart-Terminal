// An alert fire: state + log row are one commit, people are told right after it, and a slow channel delays nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-fire-'));
const I = await import('./alerts/index.ts');
const { db } = await import('./core/db.ts');
const { clients } = await import('./core/http.ts');

test('alert.fired goes out at once with the log row committed; deliveries follow as alert.delivered', async () => {
  const got: Record<string, unknown>[] = [];
  clients.add({ ws: { readyState: 1, send: (s: string) => got.push(JSON.parse(s)) }, userId: 1 } as never);
  let cb!: (b: unknown[], closed: boolean) => void, release!: () => void;
  I.deps.watch = (_s, _tf, f) => { cb = f as never; return () => {} };
  I.deps.notify = () => new Promise(r => { release = () => r([{ channel: 'telegram', ok: true }]) });   // a slow channel
  const a = I.createAlert({ sym: 'BTCUSDT', tf: '1m', source: { kind: 'price' }, condition: 'greater', value: 1, frequency: 'every_time', channels: ['telegram'], message: 'hi', active: true });
  cb([{ time: 1_700_000_000, open: 5, high: 5, low: 5, close: 5, volume: 1 }], false);
  const fired = got.find(m => m.type === 'alert.fired') as { log: { id: number; deliveries: unknown[] } };
  assert.ok(fired, 'broadcast before the notice resolved');
  assert.deepEqual(fired.log.deliveries, []);
  assert.ok(!got.some(m => m.type === 'alert.delivered'));
  const row = db.prepare('SELECT deliveries FROM alert_log WHERE id = ?').get(fired.log.id) as { deliveries: string };
  assert.equal(row.deliveries, '[]');
  const saved = JSON.parse((db.prepare('SELECT data FROM alerts WHERE id = ?').get(a.id) as { data: string }).data);
  assert.equal(saved.fireCount, 1); assert.ok(saved.lastFired, 'lastFired is committed together with the log row');
  release(); await new Promise(r => setTimeout(r, 20));
  const d = got.find(m => m.type === 'alert.delivered') as { id: number; deliveries: { channel: string }[] };
  assert.equal(d.id, fired.log.id); assert.equal(d.deliveries[0].channel, 'telegram');
  assert.match((db.prepare('SELECT deliveries FROM alert_log WHERE id = ?').get(fired.log.id) as { deliveries: string }).deliveries, /telegram/);
  clients.clear();
});
