import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMsg, Peers, WANT_TTL, parseArrangement, upsert, remove, newWid, isWid, isLiveKey } from './winlink.ts';

test('parseMsg accepts well-formed messages and rebuilds them', () => {
  assert.deepEqual(parseMsg({ t: 'hello', id: 'abcd1234', kind: 'main', evil: 1 }), { t: 'hello', id: 'abcd1234', kind: 'main' });
  assert.deepEqual(parseMsg({ t: 'select', symbol: 'BTCUSDT' }), { t: 'select', symbol: 'BTCUSDT' });
  assert.deepEqual(parseMsg({ t: 'wants', id: 'abcd1234', keys: ['t|BTCUSDT', 'junk', 'b|ETHUSDT|1h'] }), { t: 'wants', id: 'abcd1234', keys: ['t|BTCUSDT', 'b|ETHUSDT|1h'] });
  const c = parseMsg({ t: 'cfg', id: 'abcd1234', pane: 2, active: true, cfg: { symbol: 'ETHUSDT', tf: '1h', link: '#f00', ind: ['rsi'] } });
  assert.ok(c && c.t === 'cfg' && c.pane === 2 && !('link' in c.cfg) && c.cfg.symbol === 'ETHUSDT');
});
test('parseMsg rejects malformed or hostile messages', () => {
  for (const bad of [null, 'x', [], {}, { t: 'nope' }, { t: 'hello', id: 'x', kind: 'main' }, { t: 'hello', id: 'abcd1234', kind: 'admin' },
    { t: 'select', symbol: '<img onerror=1>' }, { t: 'cfg', id: 'abcd1234', pane: -1, cfg: { symbol: 'BTCUSDT' } }, { t: 'cfg', id: 'abcd1234', pane: 1.5, cfg: { symbol: 'BTCUSDT' } },
    { t: 'cfg', id: 'abcd1234', pane: 1, cfg: [] }, { t: 'cfg', id: 'abcd1234', pane: 1, cfg: { symbol: 5 } }, { t: 'live', key: 'x', data: 1 }, { t: 'live', key: 't|BTC' }, { t: 'bye', id: '../x' }])
    assert.equal(parseMsg(bad), null, JSON.stringify(bad));
});
test('wid and live keys', () => {
  assert.ok(isWid(newWid())); assert.ok(!isWid('A_B')); assert.ok(isLiveKey('t|BTCUSDT')); assert.ok(!isLiveKey('t|'));
});
test('Peers: union of wants, TTL expiry, bye', () => {
  const p = new Peers();
  p.hello('aaaa', 'main', 0); p.wants('aaaa', ['t|A', 't|B'], 0);
  p.wants('bbbb', ['t|B', 'b|C|1h'], 1000);
  assert.deepEqual([...p.union(2000)].sort(), ['b|C|1h', 't|A', 't|B']);
  p.bye('bbbb');
  assert.deepEqual([...p.union(2000)].sort(), ['t|A', 't|B']);
  assert.equal(p.has('aaaa', WANT_TTL + 1), false);   // a crashed window drops out
  assert.equal(p.union(WANT_TTL + 1).size, 0);
  p.hello('cccc', 'watch', 20000);
  assert.ok(p.hasKind('watch', 20001)); assert.ok(!p.hasKind('main', 20001));
});
test('arrangement: sanitises, upserts, removes', () => {
  const a = parseArrangement({ v: 1, wins: [
    { id: 'abcd1234', kind: 'chart', pane: 1, open: true, rect: { x: 1, y: 2, width: 800, height: 600 }, displayId: 'screen 2' },
    { id: 'abcd1234', kind: 'dom', open: true }, { id: 'bad id', kind: 'dom' }, { id: 'zzzz9999', kind: 'bogus' },
    { id: 'wxyz5678', kind: 'watch', pane: 99, rect: { x: 0, y: 0, width: 5, height: 5 } }] });
  assert.equal(a.wins.length, 2);
  assert.deepEqual(a.wins[0], { id: 'abcd1234', kind: 'chart', pane: 1, open: true, rect: { x: 1, y: 2, width: 800, height: 600 }, displayId: 'screen 2' });
  assert.deepEqual(a.wins[1], { id: 'wxyz5678', kind: 'watch', open: false });
  const b = upsert(a, { id: 'abcd1234', kind: 'chart', open: false });
  assert.equal(b.wins[0].open, false); assert.equal(b.wins[0].pane, 1);
  assert.equal(remove(b, 'abcd1234').wins.length, 1);
  assert.deepEqual(parseArrangement('garbage'), { v: 1, wins: [] });
});
