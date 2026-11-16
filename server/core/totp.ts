// TOTP (RFC 6238 over RFC 4226): HMAC-SHA1, 30 s steps, 6 digits. Pure: no database, no clock of its own, so tests can use the RFC vectors.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PERIOD = 30;

export function b32encode(b: Uint8Array): string {
  let bits = 0, v = 0, out = '';
  for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5 } v &= 0xff }
  if (bits) out += A[(v << (5 - bits)) & 31];
  return out;
}
export function b32decode(s: string): Buffer {
  let bits = 0, v = 0; const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, '')) {
    const i = A.indexOf(ch); if (i < 0) throw Error('Not base32');
    v = ((v << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out);
}
/** 160-bit secret as base32 (32 characters), the size authenticator apps expect. */
export const newSecret = () => b32encode(randomBytes(20));

/** HOTP value for a counter (RFC 4226 section 5.3). */
export function hotp(secret: string, counter: number, digits = 6): string {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', b32decode(secret)).update(c).digest(), o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const stepOf = (ms: number) => Math.floor(ms / 1000 / PERIOD);
export const totp = (secret: string, ms: number, digits = 6) => hotp(secret, stepOf(ms), digits);

/** Step number of the accepted code (now +- `window` steps), or null. Every candidate is compared, in constant time, whatever matches. */
export function verify(secret: string, code: unknown, ms = Date.now(), window = 1): number | null {
  const c = typeof code === 'string' ? code.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(c)) return null;   // the shape is not secret
  const given = Buffer.from(c), cur = stepOf(ms);
  let hit: number | null = null;
  for (let s = cur - window; s <= cur + window; s++) if (timingSafeEqual(given, Buffer.from(hotp(secret, s))) && hit === null) hit = s;
  return hit;
}

export const otpauth = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${PERIOD}`;
