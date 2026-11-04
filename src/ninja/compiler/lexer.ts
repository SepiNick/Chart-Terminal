// C# lexer: identifiers (@verbatim), numeric literals with suffixes/hex/binary/_ separators, regular, verbatim (@"") and
// interpolated ($"", $@"") strings, chars. preprocess() runs first: #region/#pragma lines are dropped and #if/#elif/#else
// keep the branch that is not clearly false (undefined symbols count as true). '>' is always a single token so generic
// argument lists close cleanly; the parser joins adjacent '>' '>' into a shift.
import type { Diagnostic } from '../contract.ts';

interface Hole { toks: Tok[]; align: Tok[] | null; fmt: string | null }
export interface Tok {
  t: 'id' | 'num' | 'str' | 'char' | 'interp' | 'op' | 'eof';
  v: string;              // identifier/operator text, decoded string/char, or number source
  n: number;              // numeric value
  suf: string;            // number kind: int long uint ulong double float decimal
  verb: boolean;          // @identifier: never a keyword
  parts: (string | Hole)[] | null;
  file: string; line: number; col: number;
  sp: boolean;            // preceded by whitespace
}

const OPS3 = ['??=', '<<='];
const OPS2 = ['??', '?.', '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '::', '->'];
const OPS1 = '+-*/%<>=!~&|^?:;,.()[]{}';
const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };
const idStart = (c: string) => /[\p{L}_]/u.test(c);
const idPart = (c: string) => /[\p{L}\p{Nd}_]/u.test(c);

function evalCond(s: string, defs: Map<string, boolean>): boolean {
  const toks = s.replace(/\/\/.*$/, '').match(/&&|\|\||==|!=|[!()]|[A-Za-z_]\w*/g) ?? [];
  let p = 0;
  const atom = (): boolean => {
    const t = toks[p++];
    if (t === '!') return !atom();
    if (t === '(') { const v = or(); p++; return v }
    return t === 'false' ? false : t === 'true' || t == null ? true : defs.get(t) ?? true;
  };
  const eq = () => { let v = atom(); while (toks[p] === '==' || toks[p] === '!=') { const o = toks[p++], b = atom(); v = o === '==' ? v === b : v !== b } return v };
  const and = () => { let v = eq(); while (toks[p] === '&&') { p++; v = eq() && v } return v };
  const or = (): boolean => { let v = and(); while (toks[p] === '||') { p++; v = and() || v } return v };
  return toks.length ? or() : true;
}

function preprocess(src: string, file: string, errors: Diagnostic[]): string {
  const lines = src.split('\n'), defs = new Map<string, boolean>();
  const st: { on: boolean; taken: boolean }[] = [];
  const active = () => st.every(s => s.on);
  lines.forEach((ln, k) => {
    const m = /^\s*#\s*(\w+)(.*)$/.exec(ln);
    if (!m) { if (!active()) lines[k] = ''; return }
    const d = m[1], rest = m[2].trim(), top = st[st.length - 1];
    if (d === 'if') { const on = active() && evalCond(rest, defs); st.push({ on, taken: on }) }
    else if (d === 'elif' || d === 'else') {
      if (!top) errors.push({ file, line: k + 1, col: 1, msg: `Unexpected #${d}` });
      else { top.on = !top.taken && (d === 'else' || evalCond(rest, defs)); top.taken ||= top.on }
    } else if (d === 'endif') { if (!st.pop()) errors.push({ file, line: k + 1, col: 1, msg: 'Unexpected #endif' }) }
    else if ((d === 'define' || d === 'undef') && active()) defs.set(rest.split(/\s/)[0], d === 'define');
    lines[k] = '';
  });
  if (st.length) errors.push({ file, line: lines.length, col: 1, msg: 'Missing #endif' });
  return lines.join('\n');
}

export function lex(src0: string, file: string, errors: Diagnostic[], line0 = 1, col0 = 1, pp = true): Tok[] {
  const src = pp ? preprocess(src0, file, errors) : src0;
  const out: Tok[] = [];
  let i = 0, line = line0, col = col0, sp = true;
  const err = (msg: string, l = line, c = col) => errors.push({ file, line: l, col: c, msg });
  const adv = (n = 1) => { for (; n > 0; n--) { if (src[i] === '\n') { line++; col = 1 } else col++; i++ } };
  const push = (t: Tok['t'], v: string, l: number, c: number, extra: Partial<Tok> = {}) => {
    out.push({ t, v, n: 0, suf: '', verb: false, parts: null, file, line: l, col: c, sp, ...extra });
    sp = false;
  };
  const esc = (): string => {   // src[i] is just past a backslash
    const c = src[i];
    if (c === 'u' || c === 'U' || c === 'x') {
      const max = c === 'u' ? 4 : c === 'U' ? 8 : 4;
      let h = ''; adv();
      while (/[0-9a-fA-F]/.test(src[i] ?? '') && h.length < max) { h += src[i]; adv() }
      return String.fromCodePoint(parseInt(h || '0', 16));
    }
    adv();
    if (!(c in ESC)) err(`Unrecognized escape sequence '\\${c}'`);
    return ESC[c] ?? c;
  };
  const plain = (verbatim: boolean, l: number, c: number): string => {   // after the opening quote
    let s = '';
    for (;;) {
      if (i >= src.length || (!verbatim && src[i] === '\n')) { err('Unterminated string literal', l, c); return s }
      const ch = src[i];
      if (ch === '"') { if (verbatim && src[i + 1] === '"') { s += '"'; adv(2); continue } adv(); return s }
      if (ch === '\\' && !verbatim) { adv(); s += esc(); continue }
      s += ch; adv();
    }
  };
  const interp = (verbatim: boolean, l: number, c: number): (string | Hole)[] => {
    const parts: (string | Hole)[] = [];
    let s = '';
    for (;;) {
      if (i >= src.length || (!verbatim && src[i] === '\n')) { err('Unterminated string literal', l, c); break }
      const ch = src[i];
      if (ch === '"') { if (verbatim && src[i + 1] === '"') { s += '"'; adv(2); continue } adv(); break }
      if (ch === '\\' && !verbatim) { adv(); s += esc(); continue }
      if (ch === '}') { if (src[i + 1] === '}') { s += '}'; adv(2); continue } err("Unexpected '}' in interpolated string"); adv(); continue }
      if (ch !== '{') { s += ch; adv(); continue }
      if (src[i + 1] === '{') { s += '{'; adv(2); continue }
      adv();
      if (s) parts.push(s);
      s = '';
      const hl = line, hc = col, start = i;
      let depth = 0, comma = -1, colon = -1, al = 0, ac = 0;
      while (i < src.length && !(src[i] === '}' && depth === 0)) {
        const d = src[i];
        if (colon >= 0) { if (d === '\n' && !verbatim) break; adv(); continue }
        if (d === '"' || d === "'") {
          adv();
          while (i < src.length && src[i] !== d && src[i] !== '\n') { if (src[i] === '\\') adv(); adv() }
          adv(); continue;
        }
        if (d === '\n' && !verbatim) break;
        if (d === '(' || d === '[' || d === '{') depth++;
        else if (d === ')' || d === ']' || d === '}') depth--;
        else if (depth === 0 && d === ',' && comma < 0) { comma = i; al = line; ac = col + 1 }
        else if (depth === 0 && d === ':' && src[i + 1] !== ':' && src[i - 1] !== ':') colon = i;
        adv();
      }
      if (src[i] !== '}') { err('Unterminated interpolation hole', hl, hc); break }
      const end = comma >= 0 ? comma : colon >= 0 ? colon : i;
      const toks = lex(src.slice(start, end), file, errors, hl, hc, false);
      const align = comma >= 0 ? lex(src.slice(comma + 1, colon >= 0 ? colon : i), file, errors, al, ac, false) : null;
      if (toks.length === 1) err('Empty interpolation hole', hl, hc);
      parts.push({ toks, align, fmt: colon >= 0 ? src.slice(colon + 1, i) : null });
      adv();
    }
    if (s || !parts.length) parts.push(s);
    return parts;
  };
  while (i < src.length) {
    const c = src[i], l = line, k = col;
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿') { adv(); sp = true; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(); sp = true; continue }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) { err('Unterminated block comment'); adv(src.length - i); break }
      adv(j + 2 - i); sp = true; continue;
    }
    if ((c === '$' && (src[i + 1] === '"' || (src[i + 1] === '@' && src[i + 2] === '"'))) || (c === '@' && src[i + 1] === '$' && src[i + 2] === '"')) {
      const verbatim = src[i + 1] === '@' || c === '@';
      adv(verbatim ? 3 : 2);
      push('interp', '', l, k, { parts: interp(verbatim, l, k) });
      continue;
    }
    if (c === '"' && src[i + 1] === '"' && src[i + 2] === '"') { err('Raw string literals are not supported'); adv(3); continue }
    if (c === '@' && src[i + 1] === '"') { adv(2); push('str', plain(true, l, k), l, k); continue }
    if (c === '"') { adv(); push('str', plain(false, l, k), l, k); continue }
    if (c === "'") {
      adv();
      let s = '';
      while (i < src.length && src[i] !== "'" && src[i] !== '\n') { if (src[i] === '\\') { adv(); s += esc() } else { s += src[i]; adv() } }
      if (src[i] !== "'") { err('Unterminated character literal', l, k); continue }
      adv();
      if ([...s].length !== 1) err('Character literal must contain exactly one character', l, k);
      push('char', s, l, k);
      continue;
    }
    if (idStart(c) || (c === '@' && idStart(src[i + 1] ?? ''))) {
      const verb = c === '@';
      let j = verb ? i + 1 : i;
      while (j < src.length && idPart(src[j])) j++;
      push('id', src.slice(verb ? i + 1 : i, j), l, k, { verb });
      adv(j - i); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i, v: number, real = false;
      const lower = src[i + 1]?.toLowerCase();
      if (c === '0' && (lower === 'x' || lower === 'b')) {
        j += 2;
        const re = lower === 'x' ? /[0-9a-fA-F_]/ : /[01_]/;
        while (re.test(src[j] ?? '')) j++;
        v = parseInt(src.slice(i + 2, j).replace(/_/g, ''), lower === 'x' ? 16 : 2);
      } else {
        while (/[0-9_]/.test(src[j] ?? '')) j++;
        if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) { real = true; j++; while (/[0-9_]/.test(src[j] ?? '')) j++ }
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] ?? '')) { real = true; j += 2; while (/[0-9]/.test(src[j] ?? '')) j++ }
        v = Number(src.slice(i, j).replace(/_/g, ''));
      }
      const sm = /^(ul|lu|u|l|d|f|m)/i.exec(src.slice(j, j + 2));
      let suf = real ? 'double' : 'int';
      if (sm) {
        const s = sm[1].toLowerCase();
        suf = s === 'd' ? 'double' : s === 'f' ? 'float' : s === 'm' ? 'decimal' : s === 'u' ? 'uint' : s === 'l' ? 'long' : 'ulong';
        j += sm[1].length;
      } else if (!real && v > 2147483647) suf = 'long';
      if (idPart(src[j] ?? '')) err(`Invalid number literal '${src.slice(i, j + 1)}'`, l, k);
      push('num', src.slice(i, j), l, k, { n: v, suf });
      adv(j - i); continue;
    }
    if (c === '#') { err('Preprocessor directives must start a line'); while (i < src.length && src[i] !== '\n') adv(); continue }
    let op = OPS3.find(o => src.startsWith(o, i)) ?? OPS2.find(o => src.startsWith(o, i)) ?? (OPS1.includes(c) ? c : null);
    if (op === '?.' && /[0-9]/.test(src[i + 2] ?? '')) op = '?';
    if (op) { push('op', op, l, k); adv(op.length); continue }
    err(`Unexpected character '${c}'`); adv();
  }
  out.push({ t: 'eof', v: '', n: 0, suf: '', verb: false, parts: null, file, line, col, sp: true });
  return out;
}
