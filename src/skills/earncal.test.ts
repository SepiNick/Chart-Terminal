import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCap, nextReport } from './earncal.ts';

test('next earnings estimate: last report + median recent gap, same timing', () => {
  assert.deepEqual(nextReport([{ date: '2026-11-02', timing: 'amc' }, { date: '2026-07-30', timing: 'amc' }, { date: '2026-04-30', timing: 'amc' }, { date: '2026-01-29', timing: 'amc' }, { date: '2025-10-30', timing: 'amc' }]), { date: '2027-02-01', timing: 'amc', last: '2026-11-02', gap: 91 });
  assert.equal(nextReport([{ date: '2026-11-02', timing: 'bmo' }]), null);
  assert.equal(nextReport([{ date: '2026-11-02', timing: 'bmo' }, { date: '2026-10-20', timing: 'bmo' }]), null, 'gaps under 50 days are not quarterly reports');
  assert.deepEqual([fmtCap(3.2e12), fmtCap(45e9), fmtCap(800e6)], ['$3.2T', '$45.0B', '$800M']);
});
