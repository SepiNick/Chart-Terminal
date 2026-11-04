// MQL preprocessor over token streams: #define (object/function-like, # and ##), #undef, #ifdef/#ifndef/#if/#else/#endif,
// #include (once per file), #property, #import (rejected), #resource (ignored).
import type { Diagnostic, Dialect } from '../contract.ts';
import { lex, type Tok } from './lexer.ts';

export type PropVal = string | number | boolean | { id: string };
export interface PPResult { toks: Tok[]; props: Record<string, PropVal>; errors: Diagnostic[]; warnings: Diagnostic[] }
interface Macro { params: string[] | null; variadic: boolean; body: Tok[] }

const normPath = (p: string) => {
  const out: string[] = [];
  for (const s of p.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
};
const dirOf = (p: string) => { const n = normPath(p), k = n.lastIndexOf('/'); return k < 0 ? '' : n.slice(0, k) };
const baseOf = (p: string) => { const n = normPath(p); return n.slice(n.lastIndexOf('/') + 1) };

export function preprocess(mainPath: string, files: Record<string, string>, dialect: Dialect, nativeIncludes: string[]): PPResult {
  const errors: Diagnostic[] = [], warnings: Diagnostic[] = [];
  const out: Tok[] = [], props: Record<string, PropVal> = {};
  const byKey = new Map<string, string>();
  for (const k of Object.keys(files)) byKey.set(normPath(k), k);
  const natives = nativeIncludes.map(normPath);
  const included = new Set<string>();
  const macros = new Map<string, Macro>();
  const def = (name: string, v: string) => macros.set(name, { params: null, variadic: false, body: lex(v, '<builtin>', errors).slice(0, -1) });
  def(dialect === 'mql4' ? '__MQL4__' : '__MQL5__', '1');
  def('__MQL__', '1');
  def('__MQLBUILD__', '4000'); def('__MQL5BUILD__', '4000'); def('__MQL4BUILD__', '1400');
  const now = Math.floor(Date.now() / 1000);
  def('__DATE__', String(now - now % 86400)); def('__DATETIME__', String(now));
  const at = (t: Tok, msg: string, list = errors) => list.push({ file: t.file, line: t.line, col: t.col, msg });

  const resolve = (path: string, from: string, angle: boolean): string | 'native' | null => {
    const n = normPath(path);
    if (natives.some(x => x === n || x.endsWith('/' + n) || n.endsWith('/' + x))) return 'native';
    const cands = [...(angle ? [] : [normPath(dirOf(from) + '/' + path)]), n, 'include/' + n, 'mql5/include/' + n, 'mql4/include/' + n];
    for (const c of cands) if (byKey.has(c)) return c;
    for (const k of byKey.keys()) if (k.endsWith('/' + n)) return k;
    const b = baseOf(path);
    for (const k of byKey.keys()) if (baseOf(k) === b) return k;
    return null;
  };

  // ── macro expansion ──
  const expand = (toks: Tok[], hide: Set<string>, site?: Tok): Tok[] => {
    const res: Tok[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const m = t.t === 'id' && !hide.has(t.v) ? macros.get(t.v) : undefined;
      const pos = site ?? t;
      if (t.t === 'id' && (t.v === '__LINE__' || t.v === '__FILE__')) {
        res.push(t.v === '__LINE__' ? { ...t, t: 'num', v: String(pos.line), n: pos.line, float: false } : { ...t, t: 'str', v: pos.file });
        continue;
      }
      if (!m) { res.push(site ? { ...t, file: site.file, line: site.line, col: site.col } : t); continue }
      let args: Tok[][] = [];
      if (m.params) {
        if (toks[i + 1]?.v !== '(' || toks[i + 1].t !== 'op') { res.push(t); continue }
        let depth = 0, j = i + 1, cur: Tok[] = [];
        for (; j < toks.length; j++) {
          const x = toks[j];
          if (x.t === 'op' && (x.v === '(' || x.v === '[' || x.v === '{')) { if (depth++ === 0) continue }
          else if (x.t === 'op' && (x.v === ')' || x.v === ']' || x.v === '}')) { if (--depth === 0) break }
          else if (x.t === 'op' && x.v === ',' && depth === 1 && (!m.variadic || args.length < m.params.length - 1)) { args.push(cur); cur = []; continue }
          cur.push(x);
        }
        if (j >= toks.length) { at(t, `Unterminated argument list for macro '${t.v}'`); return res }
        if (cur.length || args.length) args.push(cur);
        if (args.length !== m.params.length && !(m.params.length === 1 && args.length === 0) && !(m.variadic && args.length === m.params.length - 1)) {
          at(t, `Macro '${t.v}' expects ${m.params.length} argument(s) but got ${args.length}`);
        }
        i = j;
      }
      const h2 = new Set(hide); h2.add(t.v);
      res.push(...expand(subst(m, args, h2, pos), h2, pos));
    }
    return res;
  };
  const subst = (m: Macro, args: Tok[][], hide: Set<string>, site: Tok): Tok[] => {
    const b = m.body, res: Tok[] = [];
    const argOf = (t: Tok) => t.t === 'id' && m.params ? m.params.indexOf(t.v === '__VA_ARGS__' && m.variadic ? m.params[m.params.length - 1] : t.v) : -1;
    for (let i = 0; i < b.length; i++) {
      const t = b[i];
      if (t.t === 'op' && t.v === '#' && m.params && argOf(b[i + 1] ?? t) >= 0) {
        const a = args[argOf(b[++i])] ?? [];
        res.push({ ...site, t: 'str', v: a.map((x, k) => (k && x.sp ? ' ' : '') + (x.t === 'str' ? JSON.stringify(x.v) : x.v)).join(''), bol: false });
        continue;
      }
      const k = argOf(t);
      if (k < 0) { res.push(t); continue }
      const raw = args[k] ?? [];
      const pasted = b[i - 1]?.v === '##' || b[i + 1]?.v === '##';
      res.push(...(pasted ? raw : expand(raw, hide, site)));
    }
    // token pasting
    for (let i = 0; i < res.length; i++) {
      if (res[i].t !== 'op' || res[i].v !== '##') continue;
      const a = res[i - 1], c = res[i + 1];
      if (!a || !c) { at(site, "'##' cannot appear at either end of a macro body"); res.splice(i, 1); i--; continue }
      const lx = lex(a.v + c.v, site.file, errors).slice(0, -1).map(x => ({ ...x, file: site.file, line: site.line, col: site.col }));
      res.splice(i - 1, 3, ...lx);
      i -= 2;
    }
    return res;
  };

  // ── #if expressions ──
  const evalIf = (toks: Tok[], site: Tok): boolean => {
    const pre: Tok[] = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].v === 'defined' && toks[i].t === 'id') {
        const paren = toks[i + 1]?.v === '(', n = toks[i + (paren ? 2 : 1)];
        pre.push({ ...toks[i], t: 'num', v: '', n: n && macros.has(n.v) ? 1 : 0 });
        i += paren ? 3 : 1;
      } else pre.push(toks[i]);
    }
    const T = expand(pre, new Set());
    let i = 0;
    const PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    const prim = (): number => {
      const t = T[i++];
      if (!t) throw 0;
      if (t.t === 'num') return t.n;
      if (t.t === 'id') return t.v === 'true' ? 1 : 0;
      if (t.v === '(') { const v = bin(0); if (T[i++]?.v !== ')') throw 0; return v }
      if (t.v === '!') return prim() ? 0 : 1;
      if (t.v === '-') return -prim();
      if (t.v === '+') return prim();
      if (t.v === '~') return ~prim();
      throw 0;
    };
    const bin = (min: number): number => {
      let a = prim();
      for (;;) {
        const op = T[i]?.v, p = op != null && T[i].t === 'op' ? PREC[op] : undefined;
        if (p == null || p <= min) break;
        i++;
        const b = bin(p);
        a = op === '||' ? +(!!a || !!b) : op === '&&' ? +(!!a && !!b) : op === '|' ? a | b : op === '^' ? a ^ b : op === '&' ? a & b
          : op === '==' ? +(a === b) : op === '!=' ? +(a !== b) : op === '<' ? +(a < b) : op === '>' ? +(a > b) : op === '<=' ? +(a <= b)
          : op === '>=' ? +(a >= b) : op === '<<' ? a << b : op === '>>' ? a >> b : op === '+' ? a + b : op === '-' ? a - b
          : op === '*' ? a * b : op === '/' ? (b ? Math.trunc(a / b) : 0) : (b ? a % b : 0);
      }
      return a;
    };
    try {
      const v = bin(0);
      if (i < T.length) throw 0;
      return !!v;
    } catch { at(site, 'Invalid #if expression'); return false }
  };

  const property = (d: Tok[], site: Tok) => {
    const key = d[0];
    if (!key || key.t !== 'id') { at(site, '#property expects a name'); return }
    const vals: PropVal[] = [];
    const v = expand(d.slice(1), new Set());
    for (let i = 0; i < v.length; i++) {
      const t = v[i];
      if (t.t === 'op' && t.v === ',') continue;
      if (t.t === 'str') { let s = t.v; while (v[i + 1]?.t === 'str') s += v[++i].v; vals.push(s) }
      else if (t.t === 'num') vals.push(t.n);
      else if (t.t === 'op' && t.v === '-' && v[i + 1]?.t === 'num') vals.push(-v[++i].n);
      else if (t.t === 'id') vals.push(t.v === 'true' ? true : t.v === 'false' ? false : { id: t.v });
      else { at(t, `Unexpected '${t.v}' in #property ${key.v}`); return }
    }
    const k = key.v;
    if (!vals.length) { props[k] = true; return }
    if (k === 'description' && typeof props[k] === 'string') props[k] += '\n' + String(vals[0]);
    else props[k] = vals[0];
    for (let j = 1; j < vals.length; j++) props[`${k}_${j}`] = vals[j];
  };

  const processFile = (key: string, display: string) => {
    included.add(key);
    const toks = lex(files[byKey.get(key)!], display, errors);
    const cond: { active: boolean; taken: boolean; outer: boolean; tok: Tok }[] = [];
    let chunk: Tok[] = [], importing: Tok | null = null;
    const active = () => cond.length === 0 || cond[cond.length - 1].active;
    const flush = () => { if (chunk.length) out.push(...expand(chunk, new Set())); chunk = [] };
    for (let i = 0; toks[i].t !== 'eof';) {
      const t = toks[i];
      if (!(t.bol && t.t === 'op' && t.v === '#')) { if (active() && !importing) chunk.push(t); i++; continue }
      flush();
      let j = i + 1;
      while (toks[j].t !== 'eof' && !toks[j].bol) j++;
      const d = toks.slice(i + 1, j), name = d[0]?.v ?? '', arg = d[1];
      i = j;
      if (name === 'ifdef' || name === 'ifndef') {
        const on = arg?.t === 'id' && macros.has(arg.v) === (name === 'ifdef');
        if (arg?.t !== 'id') at(t, `#${name} expects a macro name`);
        cond.push({ active: active() && on, taken: on, outer: active(), tok: t });
        continue;
      }
      if (name === 'if') { const on = active() && evalIf(d.slice(1), t); cond.push({ active: on, taken: on, outer: active(), tok: t }); continue }
      if (name === 'elif' || name === 'else') {
        const c = cond[cond.length - 1];
        if (!c) { at(t, `#${name} without #if`); continue }
        const on = !c.taken && (name === 'else' || (c.outer && evalIf(d.slice(1), t)));
        c.active = c.outer && on; c.taken ||= on;
        continue;
      }
      if (name === 'endif') { if (!cond.pop()) at(t, '#endif without #if'); continue }
      if (!active()) continue;
      if (name === 'import') {
        if (importing) { if (!arg) importing = null; else at(t, '#import blocks cannot be nested'); continue }
        if (!arg) { at(t, '#import without an opening library'); continue }
        const lib = arg.t === 'str' ? arg.v : arg.v;
        at(t, /\.dll$/i.test(lib) || !/\.ex[45]$/i.test(lib) ? `DLL imports are not supported ('${lib}')` : `Library imports are not supported ('${lib}')`);
        importing = t;
        continue;
      }
      if (importing) continue;
      if (name === 'define') {
        if (arg?.t !== 'id') { at(t, '#define expects a macro name'); continue }
        let params: string[] | null = null, variadic = false, k = 2;
        if (d[2]?.v === '(' && !d[2].sp) {
          params = []; k = 3;
          while (k < d.length && d[k].v !== ')') {
            if (d[k].v === '...') { params.push('__VA_ARGS__'); variadic = true }
            else if (d[k].t === 'id') params.push(d[k].v);
            else if (d[k].v !== ',') { at(d[k], `Unexpected '${d[k].v}' in macro parameter list`); break }
            k++;
          }
          if (d[k]?.v !== ')') at(t, "Expected ')' to close the macro parameter list");
          k++;
        }
        macros.set(arg.v, { params, variadic, body: d.slice(k).map(x => ({ ...x, bol: false })) });
      } else if (name === 'undef') macros.delete(arg?.v ?? '');
      else if (name === 'include') {
        if (arg?.t !== 'str') { at(t, '#include expects <file> or "file"'); continue }
        const r = resolve(arg.v, display, !!arg.angle);
        if (r === 'native') continue;
        if (r == null) { at(arg, `Include file '${arg.v}' not found`); continue }
        if (!included.has(r)) processFile(r, byKey.get(r)!);
      } else if (name === 'property') property(d.slice(1), t);
      else if (name === 'resource') at(t, '#resource is ignored', warnings);
      else if (name === 'pragma') at(t, '#pragma is ignored', warnings);
      else at(t, `Unknown preprocessor directive '#${name}'`);
    }
    flush();
    for (const c of cond) at(c.tok, 'Unterminated #if/#ifdef (missing #endif)');
    if (importing) at(importing, "Unterminated #import block (missing closing '#import')");
  };

  const mk = normPath(mainPath);
  if (!byKey.has(mk)) errors.push({ file: mainPath, line: 1, col: 1, msg: `File '${mainPath}' not found` });
  else processFile(mk, byKey.get(mk)!);
  const last = out[out.length - 1];
  out.push({ t: 'eof', v: '', n: 0, float: false, file: last?.file ?? mainPath, line: (last?.line ?? 1), col: (last?.col ?? 1) + 1, bol: true, sp: true });
  return { toks: out, props, errors, warnings };
}
