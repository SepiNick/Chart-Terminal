// MQL lexer: C/C++ tokens plus MQL literals — chars 'A', colors C'r,g,b' (→ BGR int), datetimes D'yyyy.mm.dd hh:mi' (→ seconds).
import type { Diagnostic } from '../contract.ts';

export interface Tok {
  t: 'id' | 'num' | 'str' | 'op' | 'eof';
  v: string;          // identifier / operator text, decoded string, or number source
  n: number;          // numeric value of num tokens
  float: boolean;     // number literal with a fraction or exponent
  file: string; line: number; col: number;
  bol: boolean;       // first token of a logical line (directives end at the next bol token)
  sp: boolean;        // preceded by whitespace
  trail?: string;     // `// comment` following this token on the same line
  angle?: boolean;    // #include <...>
}

const OPS3 = ['>>=', '<<=', '...'];
const OPS2 = ['::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##'];
const OPS1 = '+-*/%<>=!~&|^?:;,.()[]{}#';
const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };
const isId = (c: string) => /[A-Za-z0-9_]/.test(c);

export function lex(src: string, file: string, errors: Diagnostic[]): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 1, col = 1, bol = true, sp = false;
  const err = (msg: string, l = line, c = col) => errors.push({ file, line: l, col: c, msg });
  const adv = (n = 1) => { for (; n > 0; n--) { if (src[i] === '\n') { line++; col = 1 } else col++; i++ } };
  const push = (t: Tok['t'], v: string, l: number, c: number, n = 0, float = false) => {
    out.push({ t, v, n, float, file, line: l, col: c, bol, sp });
    bol = false; sp = false;
    return out[out.length - 1];
  };
  // escape sequence after a backslash at src[i]
  const esc = (): string => {
    const c = src[i];
    if (c === 'x' || c === 'X') {
      let h = ''; adv();
      while (/[0-9a-fA-F]/.test(src[i] ?? '') && h.length < 4) { h += src[i]; adv() }
      return String.fromCharCode(parseInt(h || '0', 16));
    }
    adv();
    return ESC[c] ?? c;
  };
  const quoted = (q: string, l: number, c: number): string | null => {   // src[i] is just past the opening quote
    let s = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\n') { err(`Unterminated ${q === '"' ? 'string' : 'character'} literal`, l, c); return null }
      if (src[i] === '\\') { adv(); s += esc() } else { s += src[i]; adv() }
    }
    if (i >= src.length) { err(`Unterminated ${q === '"' ? 'string' : 'character'} literal`, l, c); return null }
    adv();
    return s;
  };
  while (i < src.length) {
    const c = src[i], l = line, k = col;
    if (c === '\n') { adv(); bol = true; sp = true; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿') { adv(); sp = true; continue }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { adv(src[i + 1] === '\r' ? 3 : 2); sp = true; continue }
    if (c === '/' && src[i + 1] === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      const last = out[out.length - 1];
      if (last && last.line === l && last.file === file) last.trail = src.slice(i + 2, j).trim();
      adv(j - i); sp = true; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) { err('Unterminated block comment'); adv(src.length - i); break }
      if (src.slice(i, j).includes('\n')) bol = true;
      adv(j + 2 - i); sp = true; continue;
    }
    // #include <path> / "path": raw text (backslashes are path separators, not escapes)
    const p1 = out[out.length - 1], p2 = out[out.length - 2];
    if ((c === '<' || c === '"') && p1?.t === 'id' && p1.v === 'include' && p2?.v === '#' && p2.bol && p1.line === l) {
      const close = c === '<' ? '>' : '"', j = src.indexOf(close, i + 1), nl = src.indexOf('\n', i);
      if (j < 0 || (nl >= 0 && nl < j)) { err('Malformed #include path'); adv(); continue }
      const t = push('str', src.slice(i + 1, j).trim(), l, k);
      if (c === '<') t.angle = true;
      adv(j + 1 - i); continue;
    }
    if ((c === 'C' || c === 'D') && src[i + 1] === "'" && !isId(src[i - 1] ?? ' ')) {
      adv(2);
      const body = quoted("'", l, k);
      if (body == null) continue;
      const v = c === 'C' ? colorLit(body) : dateLit(body);
      if (v == null) err(`Invalid ${c === 'C' ? 'color' : 'datetime'} literal ${c}'${body}'`, l, k);
      push('num', `${c}'${body}'`, l, k, v ?? 0);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && isId(src[j])) j++;
      push('id', src.slice(i, j), l, k); adv(j - i); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i, float = false, v: number;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        j += 2; while (/[0-9a-fA-F]/.test(src[j] ?? '')) j++;
        v = parseInt(src.slice(i + 2, j), 16);
      } else {
        while (/[0-9]/.test(src[j] ?? '')) j++;
        if (src[j] === '.') { float = true; j++; while (/[0-9]/.test(src[j] ?? '')) j++ }
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] ?? '')) {
          float = true; j += 2; while (/[0-9]/.test(src[j] ?? '')) j++;
        }
        v = Number(src.slice(i, j));
      }
      while (/[uUlL]/.test(src[j] ?? '')) j++;
      if (/[A-Za-z_]/.test(src[j] ?? '')) err(`Invalid number literal '${src.slice(i, j + 1)}'`, l, k);
      push('num', src.slice(i, j), l, k, v, float); adv(j - i); continue;
    }
    if (c === '"') {
      adv();
      const s = quoted('"', l, k);
      if (s != null) push('str', s, l, k);
      continue;
    }
    if (c === "'") {
      adv();
      const s = quoted("'", l, k);
      if (s == null) continue;
      if (s.length !== 1) err(`Invalid character literal '${s}'`, l, k);
      push('num', `'${s}'`, l, k, s.charCodeAt(0) || 0);
      continue;
    }
    const op = OPS3.find(o => src.startsWith(o, i)) ?? OPS2.find(o => src.startsWith(o, i)) ?? (OPS1.includes(c) ? c : null);
    if (op) { push('op', op, l, k); adv(op.length); continue }
    err(`Unexpected character '${c}'`); adv();
  }
  out.push({ t: 'eof', v: '', n: 0, float: false, file, line, col, bol: true, sp: true });
  return out;
}

// C'r,g,b' (decimal or 0x components) → BGR integer, red in the low byte
function colorLit(s: string): number | null {
  const p = s.split(',').map(x => x.trim());
  if (p.length !== 3) return null;
  const v = p.map(x => /^0x[0-9a-f]+$/i.test(x) ? parseInt(x, 16) : /^\d+$/.test(x) ? Number(x) : NaN);
  if (v.some(x => !(x >= 0 && x <= 255))) return null;
  return v[0] | (v[1] << 8) | (v[2] << 16);
}

// D'yyyy.mm.dd [hh:mi[:ss]]', D'dd.mm.yyyy …', D'hh:mi' (today) → seconds since 1970 (UTC)
function dateLit(s: string): number | null {
  const m = /^\s*(?:(\d{1,4})[.\-/](\d{1,2})[.\-/](\d{1,4}))?\s*(?:(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*$/.exec(s);
  if (!m || (!m[1] && !m[4])) return null;
  let y: number, mo: number, d: number;
  if (m[1]) {
    const a = +m[1], b = +m[2], c = +m[3];
    if (m[1].length === 4) { y = a; mo = b; d = c } else { d = a; mo = b; y = c }
  } else { const n = new Date(); y = n.getUTCFullYear(); mo = n.getUTCMonth() + 1; d = n.getUTCDate() }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
}
