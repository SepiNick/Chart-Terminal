import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipX, frameOf, labelAt, type Frame } from './labels.ts';

const line: Frame = { top: [[100, 200], [300, 100]], bottom: [[100, 200], [300, 100]] };   // a plain trend line rising to the right
const channel: Frame = frameOf([[100, 300], [300, 200]], [[100, 200], [300, 100]]);   // two parallel edges, given in the "wrong" order

test('frameOf puts the higher edge on top', () => {
  assert.deepEqual(channel.top, [[100, 200], [300, 100]]);
  assert.deepEqual(channel.bottom, [[100, 300], [300, 200]]);
});
test('left / centre / right run along the frame, with a small inset at the ends', () => {
  assert.deepEqual(labelAt(line, 'center', 'middle', 1000), { x: 200, y: 150, align: 'center', baseline: 'middle' });
  assert.deepEqual(labelAt(line, 'left', 'top', 1000), { x: 106, y: 194, align: 'left', baseline: 'bottom' });
  assert.deepEqual(labelAt(line, 'right', 'bottom', 1000), { x: 294, y: 106, align: 'right', baseline: 'top' });
});
test('on a channel, top and bottom follow the two edges and middle sits between them', () => {
  assert.equal(labelAt(channel, 'center', 'top', 1000)!.y, 150 - 6);
  assert.equal(labelAt(channel, 'center', 'bottom', 1000)!.y, 250 + 6);
  assert.equal(labelAt(channel, 'center', 'middle', 1000)!.y, 200);
});
test('a line running off the screen is clipped, so "right" means the visible right end', () => {
  const long: Frame = { top: [[-500, 0], [2000, 250]], bottom: [[-500, 0], [2000, 250]] };
  const r = labelAt(long, 'right', 'top', 1000)!;
  assert.equal(r.x, 1000 - 6); assert.ok(Math.abs(r.y - (150 - 6)) < 1e-9);
  assert.equal(clipX([[-10, 0], [-5, 0]], 100), null, 'entirely off-screen');
  assert.equal(labelAt({ top: [[-10, 0], [-5, 0]], bottom: [[-10, 0], [-5, 0]] }, 'center', 'top', 100), null);
});
