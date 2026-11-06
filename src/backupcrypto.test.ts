import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptText, encryptText } from './backupcrypto.ts';

test('a backup decrypts with its passphrase and with nothing else', async () => {
  const file = await encryptText('correct horse battery', '{"layout":{"a":1},"watch":["BTCUSDT"]}');
  assert.ok(!file.includes('BTCUSDT'), 'the file holds no plain text');
  assert.equal(await decryptText('correct horse battery', file), '{"layout":{"a":1},"watch":["BTCUSDT"]}');
  await assert.rejects(decryptText('wrong passphrase!!', file), /Wrong passphrase/);
});
test('two backups of the same text differ (fresh salt and iv)', async () => {
  assert.notEqual(await encryptText('same passphrase 1', 'x'), await encryptText('same passphrase 1', 'x'));
});
test('files that are not backups are refused, and a flipped byte is caught', async () => {
  await assert.rejects(decryptText('whatever pass', 'not json'), /not a Chart Terminal backup/);
  await assert.rejects(decryptText('whatever pass', '{"app":"other"}'), /not a Chart Terminal backup/);
  const j = JSON.parse(await encryptText('whatever pass', 'hello')); j.data = j.data.slice(0, -4) + (j.data.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(decryptText('whatever pass', JSON.stringify(j)), /Wrong passphrase|damaged/);
});
