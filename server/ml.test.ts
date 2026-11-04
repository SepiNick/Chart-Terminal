import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-ml-'));
process.env.CT_NO_AUTOSTART = '1';
const M = await import('./ml.ts');

const bars = Array.from({ length: 300 }, (_, i) => { const c = 100 + i * 0.1 + Math.sin(i / 5) * 2; return { time: 1.7e9 + i * 3600, open: c - 0.2, high: c + 1, low: c - 1, close: c, volume: 1 } });
test('runs the python engine through stdin/stdout, and reports engine errors', async () => {
  const r = await M.run('regime', { bars }) as { current: string; labels: unknown[] };
  assert.ok(['Uptrend', 'Downtrend', 'Range'].includes(r.current)); assert.equal(r.labels.length, 300);
  await assert.rejects(M.run('regime', { bars: bars.slice(0, 20) }), /at least 120/);
  await assert.rejects(M.run('rm -rf', {}), /Unknown/);
});
test('a missing interpreter is explained, not a stack trace', async () => {
  process.env.CT_PYTHON = 'definitely-not-python';
  await assert.rejects(M.run('regime', { bars }), /Python 3 was not found/);
  delete process.env.CT_PYTHON;
});
