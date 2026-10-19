// Strings, printf-style formatting and conversions.
import { MqlArray, type Env, type Rt } from '../contract.ts';
import { val, put, num, str } from './util.ts';
import { COLORS, colorName } from './constants.ts';

const fixExp = (s: string) => s.replace(/e([+-])(\d)$/, 'e$10$2');
const special = (x: number) => (Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf');
function gfmt(x: number, p: number, alt: boolean, up: boolean): string {
  if (!Number.isFinite(x)) return special(x);
  if (p === 0) p = 1;
  const e = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(+x.toExponential(p - 1))));
  let s = e < -4 || e >= p ? fixExp(x.toExponential(p - 1)) : x.toFixed(Math.max(0, p - 1 - e));
  if (!alt) s = s.includes('e') ? s.replace(/\.?0+e/, 'e') : s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return up ? s.toUpperCase() : s;
}

/** C/MQL printf formatting. */
export function format(fmt: string, args: unknown[]): string {
  let ai = 0;
  const next = () => val(args[ai++]);
  return String(fmt).replace(/%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|I64|I32|L|q)?([diouxXeEfgGcsS%])/g, (m, flags: string, w: string, pr: string | undefined, len: string | undefined, c: string) => {
    if (c === '%') return '%';
    let width = w === '*' ? num(next()) : w ? +w : 0;
    let prec = pr === '*' ? num(next()) : pr != null ? +pr || 0 : undefined;
    const left = flags.includes('-') || width < 0; width = Math.abs(width);
    const plus = flags.includes('+'), space = flags.includes(' '), alt = flags.includes('#');
    const zero = flags.includes('0') && !left && 'diouxXeEfgG'.includes(c);
    const a = next();
    let body: string, sign = '';
    const n = typeof a === 'number' ? a : typeof a === 'boolean' ? +a : typeof a === 'string' && 'cs'.indexOf(c) < 0 ? Number(a) || 0 : (a as number);
    const signed = (x: number) => { if (x < 0 || Object.is(x, -0)) { sign = '-'; return -x } sign = plus ? '+' : space ? ' ' : ''; return x };
    const big = len === 'll' || len === 'I64' || len === 'q' || len === 'L';
    switch (c) {
      case 'd': case 'i': { const x = Math.trunc(signed(Number(n) || 0)); body = String(x); if (prec != null) body = body.padStart(prec, '0'); break }
      case 'u': case 'o': case 'x': case 'X': {
        let x: number | bigint = Math.trunc(Number(n) || 0);
        if (x < 0) x = big ? BigInt.asUintN(64, BigInt(x)) : x >>> 0;
        body = x.toString(c === 'u' ? 10 : c === 'o' ? 8 : 16);
        if (c === 'X') body = body.toUpperCase();
        if (prec != null) body = body.padStart(prec, '0');
        if (alt && c !== 'u' && x != 0) body = (c === 'o' ? '0' : c === 'x' ? '0x' : '0X') + body;
        break;
      }
      case 'f': { const x = signed(Number(n)); body = Number.isFinite(x) ? x.toFixed(prec ?? 6) : special(x); break }
      case 'e': case 'E': { const x = signed(Number(n)); body = Number.isFinite(x) ? fixExp(x.toExponential(prec ?? 6)) : special(x); if (c === 'E') body = body.toUpperCase(); break }
      case 'g': case 'G': body = gfmt(signed(Number(n)), prec ?? 6, alt, c === 'G'); break;
      case 'c': body = String.fromCharCode(Number(n) || 0); break;
      default: body = str(a); if (prec != null) body = body.slice(0, prec);
    }
    void m;
    const s = sign + body;
    if (s.length >= width) return s;
    if (zero && Number.isFinite(Number(n))) return sign + body.padStart(width - sign.length, '0');
    return left ? s.padEnd(width) : s.padStart(width);
  });
}

export function doubleToString(v: number, d = 8): string {
  v = num(v);
  if (!Number.isFinite(v)) return special(v);
  if (d < 0) return fixExp(v.toExponential(Math.min(16, -d)));
  return v.toFixed(Math.min(16, Math.max(0, Math.trunc(d))));
}
export const normalizeDouble = (v: number, d: number) => {
  v = num(v); d = Math.max(0, Math.min(8, Math.trunc(num(d))));
  if (!Number.isFinite(v)) return v;
  const s = Math.sign(v), r = Number(Math.round(Number(Math.abs(v) + 'e' + d)) + 'e-' + d);
  return s * r;
};
const leadNum = (s: string) => { const m = String(s).trim().match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/); return m ? parseFloat(m[0]) : 0 };
const leadInt = (s: string) => { const t = String(s).trim(), m = t.match(/^[+-]?0[xX][0-9a-fA-F]+/) ?? t.match(/^[+-]?\d+/); return m ? Number(m[0].replace(/^([+-]?)0[xX]/, (_, g) => g + '0x')) || parseInt(m[0]) : 0 };

export function colorToString(c: number, names = false): string {
  c = num(c);
  if (c === -1 || c === 0xffffffff) return names ? 'clrNONE' : 'CLR_NONE';
  if (names) { const n = colorName(c); if (n) return 'clr' + n }
  return `${c & 255},${(c >> 8) & 255},${(c >> 16) & 255}`;
}
export function stringToColor(s: string): number {
  s = String(s).trim();
  const m = s.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
  if (m) return (+m[1] & 255) | ((+m[2] & 255) << 8) | ((+m[3] & 255) << 16);
  const k = s.replace(/^clr/i, '').toLowerCase();
  for (const n in COLORS) if (n.toLowerCase() === k) return COLORS[n];
  if (/^none$/i.test(k)) return -1;
  return leadInt(s);
}

function encode(s: string, cp: number): number[] {
  if (cp === 65001) return [...new TextEncoder().encode(s)];
  return [...s].map(ch => { const c = ch.charCodeAt(0); return c < 256 ? c : 63 });
}
function decode(b: number[], cp: number): string {
  if (cp === 65001) return new TextDecoder().decode(new Uint8Array(b.map(x => x & 255)));
  return String.fromCharCode(...b.map(x => x & 255));
}
/** Logical slice of an MqlArray. */
const items = (a: MqlArray, start = 0, count = -1) => { const n = a.size, e = count < 0 ? n : Math.min(n, start + count), r: unknown[] = []; for (let i = Math.max(0, start); i < e; i++) r.push(a.get(i)); return r };
/** Write values into an array from logical index `start`, growing dynamic arrays. */
export function writeArr(a: MqlArray, start: number, vs: unknown[]): number {
  if (!a.fixed && a.size < start + vs.length) a.resize(start + vs.length);
  const n = Math.min(vs.length, a.size - start);
  for (let i = 0; i < n; i++) a.set(start + i, vs[i]);
  return Math.max(0, n);
}

export function installString(rt: Rt, env: Env) {
  const m4 = env.dialect === 'mql4';
  Object.assign(rt, {
    StringFormat: (f: string, ...a: unknown[]) => format(val(f), a),
    StringLen: (s: unknown) => str(s).length,
    StringSubstr: (s: unknown, start: number, len = -1) => { const t = str(s); start = Math.max(0, num(start)); return len < 0 ? t.slice(start) : t.substr(start, num(len)) },
    StringFind: (s: unknown, m: unknown, start = 0) => str(s).indexOf(str(m), Math.max(0, num(start))),
    StringReplace: (r: unknown, find: unknown, rep: unknown) => {
      const s = str(r), f = str(find); if (!f) return -1;
      const parts = s.split(f); put(r, parts.join(str(rep))); return parts.length - 1;
    },
    StringTrimLeft: (r: unknown) => { const s = str(r), t = s.replace(/^[ \t\r\n]+/, ''); if (m4) return t; put(r, t); return s.length - t.length },
    StringTrimRight: (r: unknown) => { const s = str(r), t = s.replace(/[ \t\r\n]+$/, ''); if (m4) return t; put(r, t); return s.length - t.length },
    StringToUpper: (r: unknown) => { put(r, str(r).toUpperCase()); return true },
    StringToLower: (r: unknown) => { put(r, str(r).toLowerCase()); return true },
    StringSplit: (s: unknown, sep: unknown, out: MqlArray<string>) => {
      const t = str(s), d = typeof val(sep) === 'string' ? str(sep) : String.fromCharCode(num(sep));
      if (!t) { out.resize(0); return 0 }
      const parts = t.split(d); if (!out.fixed) out.resize(0); return writeArr(out, 0, parts);
    },
    StringConcatenate: (...a: unknown[]) => {
      if (m4) return a.map(str).join('');
      const s = a.slice(1).map(str).join(''); put(a[0], s); return s.length;
    },
    StringAdd: (r: unknown, add: unknown) => { put(r, str(r) + str(add)); return true },
    StringCompare: (a: unknown, b: unknown, cs = true) => {
      let x = str(a), y = str(b);
      if (!cs) { x = x.toLowerCase(); y = y.toLowerCase() }
      const lx = x.toLowerCase(), ly = y.toLowerCase();
      if (lx !== ly) return lx < ly ? -1 : 1;
      return x === y ? 0 : x > y ? -1 : 1;   // same letters: lowercase sorts after uppercase is reversed in MQL (upper > lower)
    },
    StringGetCharacter: (s: unknown, p: number) => { const t = str(s); return p >= 0 && p < t.length ? t.charCodeAt(p) : 0 },
    StringSetCharacter: (r: unknown, p: number, c: number) => {
      const s = str(r); if (p < 0 || p > s.length) return false;
      put(r, p === s.length ? s + String.fromCharCode(c) : s.slice(0, p) + String.fromCharCode(c) + s.slice(p + 1)); return true;
    },
    StringFill: (r: unknown, c: number) => { put(r, String.fromCharCode(num(c)).repeat(str(r).length)); return true },
    StringInit: (r: unknown, n = 0, c = 0) => { put(r, n > 0 ? (c ? String.fromCharCode(c) : ' ').repeat(n) : ''); return true },
    StringSetLength: (r: unknown, n: number) => { const s = str(r); put(r, n <= s.length ? s.slice(0, n) : s.padEnd(n, ' ')); return true },
    StringReserve: () => true, StringBufferLen: (s: unknown) => str(s).length,
    ShortToString: (c: number) => String.fromCharCode(num(c)),
    CharToString: (c: number) => String.fromCharCode(num(c) & 255),
    CharToStr: (c: number) => String.fromCharCode(num(c) & 255),
    StringToCharArray: (s: unknown, a: MqlArray<number>, start = 0, count = -1, cp = 0) => {
      let b = encode(str(s), cp); b.push(0);
      if (count >= 0) b = b.slice(0, count);
      return writeArr(a, start, b);
    },
    CharArrayToString: (a: MqlArray<number>, start = 0, count = -1, cp = 0) => {
      const b = items(a, start, count) as number[], z = b.indexOf(0);
      return decode(z >= 0 ? b.slice(0, z) : b, cp);
    },
    StringToShortArray: (s: unknown, a: MqlArray<number>, start = 0, count = -1) => {
      let b = [...str(s)].flatMap(ch => [...ch].map((_, i) => ch.charCodeAt(i))); b.push(0);
      if (count >= 0) b = b.slice(0, count);
      return writeArr(a, start, b);
    },
    ShortArrayToString: (a: MqlArray<number>, start = 0, count = -1) => { const b = items(a, start, count) as number[], z = b.indexOf(0); return String.fromCharCode(...(z >= 0 ? b.slice(0, z) : b)) },
    // MQL4 legacy names
    StringGetChar: (s: unknown, p: number) => { const t = str(s); return p >= 0 && p < t.length ? t.charCodeAt(p) : 0 },
    StringSetChar: (s: unknown, p: number, c: number) => { const t = str(s); return p >= t.length ? t + String.fromCharCode(c) : t.slice(0, p) + String.fromCharCode(c) + t.slice(p + 1) },
    // Conversion
    DoubleToString: doubleToString, DoubleToStr: doubleToString, NormalizeDouble: normalizeDouble,
    IntegerToString: (n: number, len = 0, fill = 32) => String(Math.trunc(num(n))).padStart(len, String.fromCharCode(fill)),
    StringToDouble: (s: unknown) => leadNum(str(s)), StrToDouble: (s: unknown) => leadNum(str(s)),
    StringToInteger: (s: unknown) => leadInt(str(s)), StrToInteger: (s: unknown) => leadInt(str(s)),
    ColorToString: colorToString, StringToColor: stringToColor,
    ColorToARGB: (c: number, alpha = 255) => (((alpha & 255) << 24) | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255)) >>> 0,
    CharArrayToStruct: () => false, StructToCharArray: () => false,
  });
}
export { items };
