import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseReport, MAX_IMAGES } = await import('./bugreport.ts');

const png = 'data:image/png;base64,' + Buffer.from('x'.repeat(20)).toString('base64');

test('bug report: needs a description, keeps a trimmed contact and info, decodes images', () => {
  assert.throws(() => parseReport({ description: 'no' }), /Describe the problem/);
  assert.throws(() => parseReport(null), /Describe the problem/);
  const r = parseReport({ description: '  The chart is empty  ', contact: ' me@x.org ', info: 'v0.1.3', images: [png] });
  assert.deepEqual([r.description, r.contact, r.info, r.images.length, r.images[0].ext, r.images[0].bytes.length], ['The chart is empty', 'me@x.org', 'v0.1.3', 1, 'png', 20]);
});

test('bug report: images must be jpeg/png/webp data URLs, few and small', () => {
  const d = 'something broke';
  assert.throws(() => parseReport({ description: d, images: ['data:image/svg+xml;base64,AAAA'] }), /jpeg, png or webp/);
  assert.throws(() => parseReport({ description: d, images: ['https://evil.example/x.png'] }), /jpeg, png or webp/);
  assert.throws(() => parseReport({ description: d, images: Array(MAX_IMAGES + 1).fill(png) }), /At most/);
  assert.throws(() => parseReport({ description: d, images: ['data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')] }), /larger than 2 MB/);
});
