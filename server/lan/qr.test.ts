import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrText, formatBits, rsRemainder } from './qr.ts';

test('format bits for L / mask 0 and a known Reed-Solomon vector', () => {
  assert.equal(formatBits(), 0b111011111000100);
  // ISO 18004 annex I example: "01234567" version 1-M data codewords -> 10 EC codewords
  assert.deepEqual(rsRemainder([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11], 10),
    [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test('matrix reads back to the same text (unmask, zigzag, Reed-Solomon check)', () => {
  for (const text of ['hi', 'https://192.168.1.20:8443', 'https://192.168.100.200:8443/ca.crt', 'x'.repeat(106)]) {
    const m = qrMatrix(text), size = m.length;
    const v = (size - 17) / 4;
    assert.ok(size === 21 + 4 * (v - 1) && Number.isInteger(v));
    const out: number[] = [];
    let n = 0, cur = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (isFunction(x, y, size, v)) continue;
        const b = m[y][x] !== ((x + y) % 2 === 0);
        cur = (cur << 1) | (b ? 1 : 0);
        if (++n % 8 === 0) { out.push(cur); cur = 0 }
      }
    }
    const EC = [0, 7, 10, 15, 20, 26], DATA = [0, 19, 34, 55, 80, 108];
    const data = out.slice(0, DATA[v]), ec = out.slice(DATA[v], DATA[v] + EC[v]);
    assert.deepEqual(rsRemainder(data, EC[v]), ec);
    assert.equal(data[0] >> 4, 4);                                  // byte mode
    const len = ((data[0] & 15) << 4) | (data[1] >> 4);
    const got = Buffer.from(data.slice(1, 1 + len + 1).map((b, i, a) => ((b & 15) << 4) | ((a[i + 1] ?? 0) >> 4)).slice(0, len));
    assert.equal(got.toString(), text);
  }
});

// Structural (non-data) modules of versions 1-5, derived independently from the QR spec.
function isFunction(x: number, y: number, size: number, v: number): boolean {
  if (x === 6 || y === 6) return true;
  if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true;
  if (y === 8 && x >= size - 8) return true;
  if (x === 8 && y >= size - 8) return true;
  const a = [0, 0, 18, 22, 26, 30][v];
  return v > 1 && Math.abs(x - a) <= 2 && Math.abs(y - a) <= 2;
}

test('too long text is rejected and rendering has the quiet zone', () => {
  assert.throws(() => qrMatrix('x'.repeat(107)), /too long/);
  const lines = qrText('hi').split('\n');
  assert.equal(lines.length, Math.ceil((21 + 4) / 2));
});
