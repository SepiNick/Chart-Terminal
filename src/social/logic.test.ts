import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, isRoom, linkify, mergeById, symbolRoom, timeAgo, validatePost } from './logic.ts';

test('timeAgo', () => {
  const now = 1_700_000_000_000;
  assert.equal(timeAgo(now / 1000 - 10, now), 'now');
  assert.equal(timeAgo(now / 1000 - 300, now), '5m');
  assert.equal(timeAgo(now - 3 * 3600_000, now), '3h');   // milliseconds work too
  assert.equal(timeAgo(now / 1000 - 2 * 86400, now), '2d');
  assert.equal(timeAgo(now / 1000 + 50, now), 'now');   // clock skew never shows the future
});

test('linkify escapes everything and links only http(s)', () => {
  assert.equal(linkify('<img src=x onerror=1>'), '&#60;img src=x onerror=1&#62;');
  const h = linkify('see https://example.com/a?x=1&y=2, ok');
  assert.match(h, /<a href="https:\/\/example\.com\/a\?x=1&#38;y=2" target="_blank" rel="noopener noreferrer nofollow">/);
  assert.ok(h.endsWith('</a>, ok'));
  assert.equal(linkify('javascript:alert(1) and ftp://x'), 'javascript:alert(1) and ftp://x');
  assert.doesNotMatch(linkify('https://a.com/"onmouseover="x'), /onmouseover="x/);
});

test('cleanText strips controls and collapses blank lines', () => {
  assert.equal(cleanText('  a\u0000b\u0007\n\n\n\n\n\nc \r\n'), 'ab\n\n\nc');
});

test('symbolRoom / isRoom', () => {
  assert.equal(symbolRoom(' btcusdt '), 'sym:BTCUSDT');
  assert.ok(isRoom('general') && isRoom('sym:BINANCE:BTCUSDT'));
  assert.ok(!isRoom('sym:') && !isRoom('sym:a b') && !isRoom('x'));
});

test('validatePost', () => {
  const ok = { symbol: 'btcusdt', tf: '1h', dir: 'long', body: ' text ' };
  const r = validatePost(ok);
  assert.equal(r.error, ''); assert.equal(r.value.symbol, 'BTCUSDT'); assert.equal(r.value.body, 'text');
  assert.ok(validatePost({ ...ok, body: '  ' }).error);
  assert.ok(validatePost({ ...ok, dir: 'up' }).error);
  assert.ok(validatePost({ ...ok, tf: 'abc' }).error);
  assert.equal(validatePost({ ...ok, tf: '7m' }).error, '');   // custom timeframe pattern
  assert.ok(validatePost({ ...ok, symbol: '' }).error);
  assert.ok(validatePost({ ...ok, title: 'x'.repeat(121) }).error);
  assert.ok(validatePost({ ...ok, body: 'x'.repeat(5001) }).error);
});

test('mergeById dedupes, newest first, later copy wins', () => {
  const a = [{ id: 5, n: 'old' }, { id: 3, n: 'x' }], b = [{ id: 7, n: 'new' }, { id: 5, n: 'upd' }];
  assert.deepEqual(mergeById(a, b), [{ id: 7, n: 'new' }, { id: 5, n: 'upd' }, { id: 3, n: 'x' }]);
  assert.deepEqual(mergeById([], []), []);
});
