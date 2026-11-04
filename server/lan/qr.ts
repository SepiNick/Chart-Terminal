// Tiny QR encoder for the startup banner: byte mode, error correction L, versions 1-5 (single block, up to 106 bytes), mask 0.
// shortcut: fixed mask, no penalty scoring and no multi-block versions; every decoder accepts any mask, and URLs are far below the cap.
const EC = [0, 7, 10, 15, 20, 26], DATA = [0, 19, 34, 55, 80, 108];   // EC / data codewords per version (level L)
const ALIGN = [0, 0, 18, 22, 26, 30];                                 // alignment centre of versions 2-5 (besides 6)

const EXP: number[] = [], LOG: number[] = [];
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d }
const mul = (a: number, b: number) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);

/** Reed-Solomon remainder of `data` for `n` error-correction codewords. */
export function rsRemainder(data: number[], n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]) }); g = next }
  const r = new Array(n).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); if (f) for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f) }
  return r;
}

/** 15 format bits for level L + mask 0 (BCH-protected, XOR 0x5412) = 0x77C4. */
export function formatBits(): number {
  const d = 0b01000; let r = d << 10;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return ((d << 10) | r) ^ 0x5412;
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = [...Buffer.from(text, 'utf8')];
  const v = [1, 2, 3, 4, 5].find(k => bytes.length <= DATA[k] - 2);
  if (!v) throw Error('QR: text too long');
  let bits = '0100' + bytes.length.toString(2).padStart(8, '0') + bytes.map(b => b.toString(2).padStart(8, '0')).join('');
  bits += '0'.repeat(Math.min(4, DATA[v] * 8 - bits.length));
  bits += '0'.repeat((8 - bits.length % 8) % 8);
  const cw = bits.match(/.{8}/g)!.map(b => parseInt(b, 2));
  for (let pad = 0xec; cw.length < DATA[v]; pad ^= 0xec ^ 0x11) cw.push(pad);
  const all = [...cw, ...rsRemainder(cw, EC[v])];

  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fn[y][x] = true };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, d !== 2 && d !== 4);
    }
  if (v > 1) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ALIGN[v] + dx, ALIGN[v] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  const f = formatBits(), bit = (i: number) => ((f >>> i) & 1) === 1;
  for (let i = 0; i < 6; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (fn[y][x]) continue;
      m[y][x] = n < all.length * 8 && ((all[n >> 3] >>> (7 - (n & 7))) & 1) === 1;
      if ((x + y) % 2 === 0) m[y][x] = !m[y][x];
      n++;
    }
  }
  return m;
}

/** Terminal rendering: half-block characters, black on white, with a 2-module quiet zone. */
export function qrText(text: string): string {
  const m = qrMatrix(text), q = 2, size = m.length + 2 * q;
  const dark = (x: number, y: number) => !!m[y - q]?.[x - q];
  const rows: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let s = '';
    for (let x = 0; x < size; x++) { const t = dark(x, y), b = dark(x, y + 1); s += t && b ? '█' : t ? '▀' : b ? '▄' : ' ' }
    rows.push(`\x1b[30;47m${s}\x1b[0m`);
  }
  return rows.join('\n');
}
