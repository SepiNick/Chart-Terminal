import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrarianGate } from './contrarian.ts';

test('contrarian gate follows the precedence table', () => {
  assert.equal(contrarianGate('INVALID', 'CONFIRMED', 'CONFIRMED', 1).status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(contrarianGate('NEUTRAL', 'CONFIRMED', 'CONFIRMED', 1).status, 'REJECTED');
  assert.deepEqual([contrarianGate('CROWDED_LONG', 'PENDING', 'PENDING').status, contrarianGate('CROWDED_LONG', 'PENDING', 'PENDING').direction], ['CROWDED', 'SHORT']);
  assert.equal(contrarianGate('CROWDED_SHORT', 'CONFIRMED', 'PENDING').status, 'WATCHING_PRICE');
  assert.equal(contrarianGate('CROWDED_SHORT', 'CONFIRMED', 'CONFIRMED', 1.21).status, 'READY_FOR_PLAN');
  assert.equal(contrarianGate('CROWDED_SHORT', 'CONFIRMED', 'CONFIRMED').status, 'INSUFFICIENT_EVIDENCE', 'no invalidation level');
  assert.equal(contrarianGate('CROWDED_LONG', 'NOT_CONFIRMED', 'CONFIRMED', 1).status, 'REJECTED', 'news first, price never inspected');
  assert.equal(contrarianGate('CROWDED_LONG', 'INVALID', 'NOT_CONFIRMED').status, 'INSUFFICIENT_EVIDENCE');
  const out = contrarianGate('CROWDED_LONG', 'PENDING', 'CONFIRMED', 1);
  assert.equal(out.status, 'CROWDED'); assert.match(out.warnings[0], /capped/);
  assert.equal(contrarianGate('CROWDED_LONG', 'PENDING', 'NOT_CONFIRMED').status, 'REJECTED', 'out of order NOT_CONFIRMED still rejects');
});
