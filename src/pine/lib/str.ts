// str.* builtins and number formatting (Java DecimalFormat / MessageFormat subset, as used by Pine).
import { type Builtin, type PineValue, type PineTuple, arg, num } from '../types.ts';

export const FORMAT_CONSTS: Record<string, PineValue> = { mintick: 'mintick', percent: 'percent', volume: 'volume', price: 'price', inherit: 'inherit' };

/** DecimalFormat-like pattern: '#.##', '#.00', '0.000', '#,###.##', '#.##%', with literal prefix/suffix. */
export function fmtPattern(x: number, pat: string): string {
  if (Number.isNaN(x)) return 'NaN';
  const m = pat.match(/^([^#0,.]*)([#0,.]+)(.*)$/);
  if (!m) return pat;
  const [, pre, body, suf] = m;
  if (suf.includes('%')) x *= 100;
  if (!Number.isFinite(x)) return (x < 0 ? '-' : '') + pre + '∞' + suf;
  const [ip, fp = ''] = body.split('.');
  const minF = fp.replace(/[^0]/g, '').length, maxF = fp.replace(/,/g, '').length;
  const minI = Math.max(1, ip.replace(/[^0]/g, '').length);   // always show a leading 0 (friendlier than Java's '.5')
  const group = ip.includes(',') ? ip.length - ip.lastIndexOf(',') - 1 : 0;
  let [i, f = ''] = Math.abs(x).toFixed(Math.min(maxF, 100)).split('.');
  f = f.replace(/0+$/, '').padEnd(minF, '0');
  i = i.replace(/^0+/, '').padStart(minI, '0');
  if (group) i = i.replace(new RegExp(`\\B(?=(\\d{${group}})+(?!\\d))`, 'g'), ',');
  const neg = x < 0 && /[1-9]/.test(i + f);
  return (neg ? '-' : '') + pre + i + (f ? '.' + f : '') + suf;
}

const decimals = (step: number) => (String(+step.toFixed(10)).split('.')[1] ?? '').length;

/** str.tostring semantics. Default float format is '#.##########' (choice: TradingView does not document it). */
export function tostring(v: PineValue | undefined, format?: PineValue, mintick = 0.01): string {
  if (v === null || v === undefined) return 'NaN';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map(x => tostring(x, format, mintick)).join(', ') + ']';
  if (typeof v !== 'number') return 'tuple' in v ? tostring((v as PineTuple).tuple) : String(v.type);
  if (Number.isNaN(v)) return 'NaN';
  switch (format) {
    case undefined: case null: case 'inherit': case 'price': return fmtPattern(v, '#.##########');
    case 'mintick': return (Math.round(+(v / mintick).toFixed(9)) * mintick).toFixed(decimals(mintick));
    case 'percent': return fmtPattern(v, '#.##') + '%';
    case 'volume': {
      const a = Math.abs(v), [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
      return fmtPattern(v / d, '#.###') + s;
    }
  }
  return typeof format === 'string' ? fmtPattern(v, format) : fmtPattern(v, '#.##########');
}

const msgArg = (v: PineValue | undefined, type: string, style: string): string => {
  if (typeof v !== 'number') return tostring(v);
  if (type && type !== 'number') return tostring(v);
  const pat = !style ? '#,##0.###' : style === 'integer' ? '#,##0' : style === 'percent' ? '#,##0%' : style === 'currency' ? '$#,##0.00' : style;
  return fmtPattern(v, pat);
};

/** MessageFormat subset: {0}, {1,number,#.##}, {0,number,integer|percent|currency}; '' = quote, '...' = literal. */
export function msgFormat(f: string, args: PineValue[]): string {
  let out = '', i = 0;
  while (i < f.length) {
    const c = f[i];
    if (c === "'") {
      if (f[i + 1] === "'") { out += "'"; i += 2; continue }
      const j = f.indexOf("'", i + 1);
      out += f.slice(i + 1, j < 0 ? undefined : j); i = j < 0 ? f.length : j + 1; continue;
    }
    if (c === '{') {
      const j = f.indexOf('}', i);
      if (j < 0) { out += f.slice(i); break }
      const p = f.slice(i + 1, j).split(','), n = +p[0].trim();
      out += n in args ? msgArg(args[n], (p[1] ?? '').trim(), p.slice(2).join(',').trim()) : f.slice(i, j + 1);
      i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

const S = (a: PineValue[], nm: Record<string, PineValue>, i: number, name: string, d?: string): string | null => {
  const v = arg(a, nm, i, name, d); return typeof v === 'string' ? v : null;
};

export const STR: Record<string, Builtin> = {
  tostring: (c, a, nm) => tostring(arg(a, nm, 0, 'value'), arg(a, nm, 1, 'format'), c.mintick),
  format: (_, a, nm) => { const f = S(a, nm, 0, 'formatString'); return f === null ? null : msgFormat(f, a.slice(1)) },
  length: (_, a, nm) => S(a, nm, 0, 'string')?.length ?? NaN,
  contains: (_, a, nm) => { const s = S(a, nm, 0, 'source'), t = S(a, nm, 1, 'str'); return s !== null && t !== null && s.includes(t) },
  startswith: (_, a, nm) => { const s = S(a, nm, 0, 'source'), t = S(a, nm, 1, 'str'); return s !== null && t !== null && s.startsWith(t) },
  endswith: (_, a, nm) => { const s = S(a, nm, 0, 'source'), t = S(a, nm, 1, 'str'); return s !== null && t !== null && s.endsWith(t) },
  pos: (_, a, nm) => { const s = S(a, nm, 0, 'source'), t = S(a, nm, 1, 'str'), i = s === null || t === null ? -1 : s.indexOf(t); return i < 0 ? NaN : i },
  substring: (_, a, nm) => {
    const s = S(a, nm, 0, 'source'), b = num(arg(a, nm, 1, 'begin_pos', 0)), e = arg(a, nm, 2, 'end_pos');
    return s === null || Number.isNaN(b) ? null : s.substring(b, e === undefined || Number.isNaN(num(e)) ? s.length : num(e));
  },
  replace: (_, a, nm) => {
    const s = S(a, nm, 0, 'source'), t = S(a, nm, 1, 'target'), r = S(a, nm, 2, 'replacement'), occ = num(arg(a, nm, 3, 'occurrence', 0));
    if (s === null || t === null || r === null || !t) return s;
    let i = -1;
    for (let k = 0; k <= occ; k++) { i = s.indexOf(t, i + 1); if (i < 0) return s }
    return s.slice(0, i) + r + s.slice(i + t.length);
  },
  replace_all: (_, a, nm) => { const s = S(a, nm, 0, 'source'), t = S(a, nm, 1, 'target'), r = S(a, nm, 2, 'replacement'); return s === null || t === null || r === null || !t ? s : s.split(t).join(r) },
  lower: (_, a, nm) => S(a, nm, 0, 'source')?.toLowerCase() ?? null,
  upper: (_, a, nm) => S(a, nm, 0, 'source')?.toUpperCase() ?? null,
  trim: (_, a, nm) => S(a, nm, 0, 'source')?.trim() ?? null,
  split: (_, a, nm) => { const s = S(a, nm, 0, 'string'), sep = S(a, nm, 1, 'separator', ''); return s === null ? [] : s.split(sep ?? '') },
  tonumber: (_, a, nm) => { const s = S(a, nm, 0, 'string')?.trim(); return s && Number.isFinite(+s) ? +s : NaN },
  repeat: (_, a, nm) => {
    const s = S(a, nm, 0, 'source'), n = num(arg(a, nm, 1, 'repeat')), sep = S(a, nm, 2, 'separator', '') ?? '';
    return s === null || !(n >= 0) ? null : Array(Math.floor(n)).fill(s).join(sep);
  },
  match: (_, a, nm) => { const s = S(a, nm, 0, 'source'), r = S(a, nm, 1, 'regex'); return s === null || r === null ? null : s.match(new RegExp(r))?.[0] ?? '' },
};
