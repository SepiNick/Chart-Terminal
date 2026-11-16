// QR code as an SVG string, for the 2FA and pairing screens. Byte mode, error correction L, versions 1-9 (up to 230 bytes), mask 0.
// Standalone on purpose: lan/qr.ts (terminal banner, versions 1-5) is a LAN module and must never load on a public server.
// shortcut: fixed mask 0, no penalty scoring (every decoder accepts any mask); upgrade only if a scanner struggles with a big code.
const BLOCKS: [number, number, number][] = [   // per version 1-9, level L: [EC codewords per block, blocks, data codewords per block]
  [7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108], [18, 2, 68], [20, 2, 78], [24, 2, 97], [30, 2, 116]];
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];

const EXP: number[] = [], LOG: number[] = [];
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d }
const mul = (a: number, b: number) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
function rs(data: number[], n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]) }); g = next }
  const r = new Array(n).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); if (f) for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f) }
  return r;
}
const bch = (d: number, bitsData: number, poly: number, polyLen: number) => { let r = d << (polyLen - 1); for (let i = bitsData + polyLen - 2; i >= polyLen - 1; i--) if ((r >>> i) & 1) r ^= poly << (i - polyLen + 1); return r };

export const qrCapacity = 230;
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...Buffer.from(text, 'utf8')];
  const v = BLOCKS.findIndex(([, k, d]) => bytes.length <= k * d - 2) + 1;
  if (!v) throw Error('QR: text too long');
  const [ecLen, k, dLen] = BLOCKS[v - 1];
  let bits = '0100' + bytes.length.toString(2).padStart(8, '0') + bytes.map(b => b.toString(2).padStart(8, '0')).join('');
  bits += '0'.repeat(Math.min(4, k * dLen * 8 - bits.length));
  bits += '0'.repeat((8 - bits.length % 8) % 8);
  const cw = bits.match(/.{8}/g)!.map(b => parseInt(b, 2));
  for (let pad = 0xec; cw.length < k * dLen; pad ^= 0xec ^ 0x11) cw.push(pad);
  const blocks = Array.from({ length: k }, (_, i) => cw.slice(i * dLen, (i + 1) * dLen)), ecs = blocks.map(b => rs(b, ecLen));
  const all: number[] = [];
  for (let i = 0; i < dLen; i++) for (const b of blocks) all.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) all.push(e[i]);

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
  const al = ALIGN[v], last = al.length - 1;
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;   // those would sit on a finder
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const f = (0b01000 << 10 | bch(0b01000, 5, 0x537, 11)) ^ 0x5412, bit = (i: number) => ((f >>> i) & 1) === 1;   // level L, mask 0
  for (let i = 0; i < 6; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  if (v >= 7) {
    const info = (v << 12) | bch(v, 6, 0x1f25, 13);
    for (let i = 0; i < 18; i++) { const d = ((info >>> i) & 1) === 1, a = Math.floor(i / 3), b = (i % 3) + size - 11; set(b, a, d); set(a, b, d) }
  }
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

/** Black on white SVG with a 4-module quiet zone (what scanners expect). */
export function qrSvg(text: string): string {
  const m = qrMatrix(text), q = 4, n = m.length + 2 * q;
  let d = '';
  m.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x]) { let e = x; while (e < row.length && row[e]) e++; d += `M${x + q} ${y + q}h${e - x}v1h-${e - x}z`; x = e } });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
