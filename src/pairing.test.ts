import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCode, countdown, firstReachable, expiresAtMs, orderUrls, parsePair, redeemFirst, scanResult, serializePair, showCode, takePairHash } from './pairing.ts';
import { markSaved, parseDiscovered } from './servers.ts';
import { codeBody, nextLoginStep, parseTwofaStatus, svgSrc } from './twofaapi.ts';

test('pairing payload round trip, https first, bad addresses dropped', () => {
  const p = { code: 'ABCDE23456', name: 'Desk & Pi', urls: ['http://192.168.1.5:8787', 'https://192.168.1.5:8443', 'ftp://x', 'https://192.168.1.5:8443'] };
  const q = parsePair(serializePair(p));
  assert.deepEqual(q, { code: 'ABCDE23456', name: 'Desk & Pi', urls: ['https://192.168.1.5:8443', 'http://192.168.1.5:8787'] });
  assert.deepEqual(orderUrls(['http://10.0.0.2:8787/x', 'https://a.example']), ['https://a.example', 'http://10.0.0.2:8787']);
});
test('typed codes tolerate spaces, dashes and case; garbage is refused', () => {
  assert.equal(cleanCode(' abcde-23456 '), 'ABCDE23456');
  assert.deepEqual(parsePair('abcde 23456'), { code: 'ABCDE23456', name: '', urls: [] });
  assert.equal(showCode('ABCDE23456'), 'ABCDE 23456');
  assert.throws(() => parsePair('short'), /not a pairing code/);
  assert.throws(() => parsePair('chartterminal://pair?c=bad'), /not a valid pairing/);
});
test('scan results: pairing payload, server address, everything else ignored', () => {
  assert.equal(scanResult('chartterminal://pair?c=ABCDE23456&u=https%3A%2F%2Fa.example').kind, 'pair');
  assert.deepEqual(scanResult('https://a.example/foo'), { kind: 'server', url: 'https://a.example' });
  for (const t of ['hello', 'javascript:alert(1)', 'http://user:pw@a.example', '']) assert.equal(scanResult(t).kind, 'ignore', t);
});
test('redeemFirst: next address on network failure / 404, stop on any other answer', async () => {
  const tried: string[] = [];
  const r = await redeemFirst(['https://a', 'http://b'], async b => { tried.push(b); if (b === 'https://a') throw Error('network'); return 'ok' });
  assert.deepEqual([r.base, r.result, tried], ['http://b', 'ok', ['https://a', 'http://b']]);
  await assert.rejects(redeemFirst(['https://a', 'http://b'], async () => { throw Object.assign(Error('Invalid or expired code'), { status: 400 }) }), /Invalid or expired/);
  await assert.rejects(redeemFirst(['https://a'], async () => { throw Object.assign(Error('nf'), { status: 404 }) }), /Could not reach/);
  await assert.rejects(redeemFirst([], async () => 1), /no server address/);
});
test('expiry formats and countdown', () => {
  assert.equal(expiresAtMs(300, 1000), 301_000);
  assert.equal(expiresAtMs(1_800_000_000, 5), 1_800_000_000_000);
  assert.equal(expiresAtMs(1_800_000_000_000, 5), 1_800_000_000_000);
  assert.equal(countdown(272_100), '4:33');
  assert.equal(countdown(-5), '0:00');
});
test('#pair=<code> handoff only accepts a well-formed code', () => {
  assert.equal(takePairHash('#pair=abcde23456'), 'ABCDE23456');
  for (const h of ['#pair=', '#pair=short', '#pair=ABCDE23456<script>', '#x=ABCDE23456', '#pair']) assert.equal(takePairHash(h), null, h);
});

test('beacon list: validated, https first, deduped by shared address, never by id, saved marked', () => {
  const raw = JSON.stringify([
    { ct: 1, id: 'abc', name: 'Desk', urls: ['http://192.168.1.5:8787', 'https://192.168.1.5:8443', 'javascript://x'], v: '1.2.3', mode: 'private', twofa: true },
    { id: 'abc', name: 'Desk again', urls: ['http://192.168.1.9:8787', 'http://192.168.1.5:8787'] },
    { name: 'Pi', urls: ['http://192.168.1.7:8787'] },
    { name: 'bad', urls: ['nope://x'] }, 5, null,
  ]);
  const f = parseDiscovered(raw);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].urls, ['https://192.168.1.5:8443', 'http://192.168.1.5:8787', 'http://192.168.1.9:8787']);
  assert.equal(f[0].twofa, true);
  assert.equal(f[1].name, 'Pi');
  assert.deepEqual(markSaved(f, [{ baseUrl: 'http://192.168.1.7:8787' }]).map(x => x.saved), [false, true]);
  assert.deepEqual(parseDiscovered('not json'), []);
  assert.deepEqual(parseDiscovered({}), []);
});

test('login step machine: password -> code -> (enrol) -> done', () => {
  assert.deepEqual(nextLoginStep({ twofa: true, ticket: 't1' }), { kind: 'code', ticket: 't1' });
  assert.deepEqual(nextLoginStep({ twofa: true }), { kind: 'done' });   // no ticket: nothing to complete
  assert.deepEqual(nextLoginStep({ ok: true, user: {} }), { kind: 'done' });
  assert.deepEqual(nextLoginStep({ ok: true }, parseTwofaStatus({ enabled: false, required: true })), { kind: 'enrol' });
  assert.deepEqual(nextLoginStep({ ok: true }, parseTwofaStatus({ enabled: true, required: true })), { kind: 'done' });
  assert.deepEqual(nextLoginStep({ ok: true, enrol: true }), { kind: 'enrol' });
  assert.deepEqual(nextLoginStep(null, null), { kind: 'done' });
});
test('second-step input', () => {
  assert.deepEqual(codeBody(' 123 456 ', false), { code: '123456' });
  assert.deepEqual(codeBody(' ABCD-1234 ', true), { recovery: 'ABCD-1234' });
  assert.throws(() => codeBody('12345', false), /6 digits/);
  assert.throws(() => codeBody('  ', true), /recovery code/);
  assert.match(svgSrc('<svg onload="x()"/>'), /^data:image\/svg\+xml;utf8,%3Csvg/);
});

test('firstReachable skips unreachable addresses in order', async () => {
  assert.equal(await firstReachable(['https://a', 'http://b', 'http://c'], u => u === 'http://b' || u === 'http://c'), 'http://b');
  assert.equal(await firstReachable(['https://a'], () => false), null);
});
