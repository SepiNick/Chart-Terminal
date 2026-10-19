// Writes the PWA icons into public/ (run: node server/lan/make-icons.ts). The PNGs are committed; rerun only to redesign.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type RGBA = [number, number, number, number];
const BG: RGBA = [0x13, 0x17, 0x22, 255], UP: RGBA = [0x26, 0xa6, 0x9a, 255], DN: RGBA = [0xef, 0x53, 0x50, 255], WHITE: RGBA = [255, 255, 255, 255];

function png(w: number, h: number, px: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Three candles centred in the inner `safe` fraction; `round` = corner radius fraction (0 = full bleed). */
function icon(s: number, { safe = 0.6, round = 0, bg = BG as RGBA | null, mono = false } = {}): Buffer {
  const px = new Uint8Array(s * s * 4);
  const put = (x: number, y: number, c: RGBA) => px.set(c, (y * s + x) * 4);
  const rect = (x0: number, y0: number, x1: number, y1: number, c: RGBA) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, c);
  };
  if (bg) {
    const r = round * s;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = Math.max(r - x - 0.5, x + 0.5 - (s - r), 0), dy = Math.max(r - y - 0.5, y + 0.5 - (s - r), 0);
      const a = r ? Math.min(1, Math.max(0, r - Math.hypot(dx, dy) + 0.5)) : 1;
      put(x, y, [bg[0], bg[1], bg[2], Math.round(255 * a)]);
    }
  }
  const box = s * safe, o = (s - box) / 2, u = box / 10;
  // [centre x, wick top, body top, body bottom, wick bottom] in units of the safe box (0..10)
  const candles: [number, number, number, number, number, RGBA][] = [[2, 3.5, 4.5, 8, 9.5, UP], [5, 0.5, 2, 6, 7.5, DN], [8, 1, 2.5, 5, 6.5, UP]];
  for (const [cx, wt, bt, bb, wb, c] of candles) {
    const col = mono ? WHITE : c, x = o + cx * u;
    rect(x - u * 0.15, o + wt * u, x + u * 0.15, o + wb * u, col);
    rect(x - u * 0.9, o + bt * u, x + u * 0.9, o + bb * u, col);
  }
  return png(s, s, px);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
writeFileSync(join(out, 'icon-192.png'), icon(192, { round: 0.18 }));
writeFileSync(join(out, 'icon-512.png'), icon(512, { round: 0.18 }));
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, { safe: 0.5 }));   // maskable: full bleed, art inside the 80% safe zone
writeFileSync(join(out, 'apple-touch-icon.png'), icon(180));                   // iOS rounds the corners itself
writeFileSync(join(out, 'badge-96.png'), icon(96, { safe: 0.8, bg: null, mono: true }));   // Android status bar: alpha only
