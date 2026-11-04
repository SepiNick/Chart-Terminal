import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkName, checkPassword, codesOf, formatRecoveryCodes } from './authrules.ts';

test('username rules mirror the server', () => {
  assert.equal(checkName('  Ali.R_1 '), 'ali.r_1');
  for (const b of ['ab', 'a b c', 'x'.repeat(33), 'ünï']) assert.throws(() => checkName(b), /Username: 3 to 32/);
});
test('password rules mirror the server messages', () => {
  assert.throws(() => checkPassword('short', 'ali'), /at least 10/);
  assert.throws(() => checkPassword('x'.repeat(201), 'ali'), /at most 200/);
  assert.throws(() => checkPassword('aaaaaaaaaaaa', 'ali'), /too easy/);
  assert.throws(() => checkPassword('xaliceyyyyyy', 'alice'), /too easy/);
  assert.equal(checkPassword('correct horse battery', 'ali'), 'correct horse battery');
});
test('recovery codes', () => {
  assert.deepEqual(codesOf({ recoveryCodes: ['a', 'b', 3] }), ['a', 'b']);
  assert.deepEqual(codesOf(null), []);
  assert.deepEqual(codesOf({}), []);
  const t = formatRecoveryCodes(['AAAA-1', 'BBBB-2'], 'ali');
  assert.match(t, /for ali/);
  assert.match(t, /1\. AAAA-1\n2\. BBBB-2\n$/);
});
