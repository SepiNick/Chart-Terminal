// index.ts keeps the process alive on a stray rejection after start-up and logs it without long token-like strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (code: string) => spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], {
  cwd: import.meta.dirname, encoding: 'utf8', env: { ...process.env, CT_MODE: '', CT_DATA_DIR: mkdtempSync(join(tmpdir(), 'ct-proc-')), CT_NO_AUTOSTART: '1' },
});
test('an unhandled rejection is logged (masked) and does not end the process', () => {
  const secret = 'S3CR3T' + 'x'.repeat(40);
  const r = run(`await import('./index.ts'); Promise.reject(new Error('boom ${secret}')); setTimeout(() => { console.log('alive'); process.exit(0) }, 300)`);
  assert.match(r.stdout, /alive/);
  assert.match(r.stderr, /unhandledRejection\] boom \*\*\*/);
  assert.ok(!r.stderr.includes(secret));
});
test('an uncaught exception after start-up is survived too', () => {
  const r = run(`const m = await import('./index.ts'); setTimeout(() => { throw new Error('late') }, 50); setTimeout(() => { console.log('alive'); process.exit(0) }, 300)`);
  assert.match(r.stdout, /alive/); assert.match(r.stderr, /uncaughtException\] late/);
});
