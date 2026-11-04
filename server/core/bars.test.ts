import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deps, watchSeries, type Bar } from './bars.ts';

/** Poll instead of sleeping a fixed time: the full suite runs many tests at once and 20 ms is not always enough. */
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 10)) };

const bar = (t: number): Bar => ({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });

test('stopping a series before its history arrives leaves no feed behind', async () => {
  let release!: () => void, started = 0, stopped = 0;
  const gate = new Promise<void>(r => (release = r));
  deps.fetchBars = async () => { await gate; return [bar(1)] };
  deps.streamBars = () => { started++; return () => { stopped++ } };
  const off = watchSeries('TESTAAA', '1m', () => {});
  off();                       // before `ready` resolves
  release();
  await new Promise(r => setTimeout(r, 100));   // time for a wrongly started feed to appear
  assert.equal(started - stopped, 0, 'a feed was started and never stopped');
  // a later watcher gets a fresh series that does start its feed
  const off2 = watchSeries('TESTAAA', '1m', () => {});
  await until(() => started === 1);
  assert.equal(started, 1); off2(); assert.equal(stopped, 1);
});
