import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePkce, parseOAuthFragment, safeProviderUrl, savePending, takeFragment, takePending } from './oauthcore.ts';

const CODE = 'abcdefghij0123456789_-ABCD';
test('fragment parsing: web code, app code, errors, foreign hashes', () => {
  assert.deepEqual(parseOAuthFragment('#oauth=' + CODE), { found: true, code: CODE });
  assert.deepEqual(parseOAuthFragment('#code=' + CODE), { found: true, code: CODE });
  assert.deepEqual(parseOAuthFragment('#error=denied'), { found: true, error: 'denied' });
  assert.deepEqual(parseOAuthFragment('#error=<script>'), { found: true, error: 'failed' });
  assert.deepEqual(parseOAuthFragment('#error=unreachable'), { found: true, error: 'unreachable' });
  assert.deepEqual(parseOAuthFragment('#oauth=short'), { found: true, error: 'failed' });
  assert.deepEqual(parseOAuthFragment('#oauth=' + CODE + '";alert(1)//'), { found: true, error: 'failed' });
  for (const h of ['', '#', '#chart', '#sym=BTC']) assert.equal(parseOAuthFragment(h).found, false);
});
test('the code is scrubbed from the URL at once; other fragments are left alone', () => {
  const calls: string[] = [];
  const h = { replaceState: (_s: unknown, _t: string, u: string) => void calls.push(u) };
  assert.equal(takeFragment({ hash: '#oauth=' + CODE, pathname: '/app', search: '?a=1' }, h)!.code, CODE);
  assert.deepEqual(calls, ['/app?a=1']);
  assert.equal(takeFragment({ hash: '#x', pathname: '/', search: '' }, h), null);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes(CODE));
});
test('PKCE pair: challenge is base64url(sha256(verifier))', async () => {
  const { verifier, challenge } = await makePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const { createHash } = await import('node:crypto');
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.notEqual((await makePkce()).verifier, verifier);
});
test('pending verifier: single use, expires, bound to the server', () => {
  const m = new Map<string, string>(), kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  const p = { verifier: 'v', server: 's', intent: 'login' };
  savePending(kv, p, 1000);
  assert.equal(takePending(kv, 's', 1000 + 599_000)?.verifier, 'v');
  assert.equal(takePending(kv, 's', 1000), null);
  savePending(kv, p, 1000); assert.equal(takePending(kv, 's', 1000 + 601_000), null);
  savePending(kv, p, 1000); assert.equal(takePending(kv, 'other', 1001), null);
  assert.equal(m.size, 0);
});
test('provider URL must be https (or local http)', () => {
  assert.ok(safeProviderUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
  assert.ok(safeProviderUrl('http://127.0.0.1:5000/x'));
  for (const u of ['javascript:alert(1)', 'http://evil.example/', 'data:text/html,x', '', null]) assert.equal(safeProviderUrl(u), null);
});
