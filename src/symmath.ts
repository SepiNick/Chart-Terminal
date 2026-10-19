// Symbol math ("spread charts"): expressions like BTCUSDT/ETHUSDT or 2*BTCUSDT-ETHUSDT^1.
// A tiny recursive-descent parser; no eval. Each OHLC field is computed by applying the
// expression to that field of every symbol, then high/low are re-derived.
import type { Bar } from './data.ts';

type Node = { k: 'num'; v: number } | { k: 'sym'; s: string } | { k: 'op'; op: string; a: Node; b: Node } | { k: 'neg'; a: Node };

export const isExpr = (s: string) => /[+\-*/^()]/.test(s) || /^\d/.test(s.trim());

export function parse(src: string): Node {
  const toks = src.toUpperCase().match(/\d+(\.\d+)?|[A-Z][A-Z0-9.:_]*|[+\-*/^()]/g) ?? [];
  if (toks.join('') !== src.toUpperCase().replace(/\s+/g, '')) throw Error('Invalid character in expression');
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const atom = (): Node => {
    const t = next();
    if (t === undefined) throw Error('Unexpected end of expression');
    if (t === '(') { const e = expr(); if (next() !== ')') throw Error('Missing )'); return e }
    if (t === '-') return { k: 'neg', a: atom() };
    if (/^\d/.test(t)) return { k: 'num', v: +t };
    if (/^[A-Z]/.test(t)) return { k: 'sym', s: t };
    throw Error(`Unexpected "${t}"`);
  };
  const pow = (): Node => { const a = atom(); return peek() === '^' ? (next(), { k: 'op', op: '^', a, b: pow() }) : a };
  const term = (): Node => { let a = pow(); while (peek() === '*' || peek() === '/') a = { k: 'op', op: next()!, a, b: pow() }; return a };
  const expr = (): Node => { let a = term(); while (peek() === '+' || peek() === '-') a = { k: 'op', op: next()!, a, b: term() }; return a };
  const n = expr();
  if (i < toks.length) throw Error(`Unexpected "${toks[i]}"`);
  return n;
}
export function symbols(n: Node, out = new Set<string>()): string[] {
  if (n.k === 'sym') out.add(n.s);
  if (n.k === 'op') { symbols(n.a, out); symbols(n.b, out) }
  if (n.k === 'neg') symbols(n.a, out);
  return [...out];
}
function evalNode(n: Node, v: (s: string) => number): number {
  switch (n.k) {
    case 'num': return n.v;
    case 'sym': return v(n.s);
    case 'neg': return -evalNode(n.a, v);
    case 'op': {
      const a = evalNode(n.a, v), b = evalNode(n.b, v);
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : a ** b;
    }
  }
}
/** Combine per-symbol bars (aligned on common timestamps only) into synthetic bars. */
export function combine(n: Node, data: Record<string, Bar[]>): Bar[] {
  const syms = symbols(n), maps = syms.map(s => new Map(data[s].map(b => [b.time, b])));
  const times = (data[syms[0]] ?? []).map(b => b.time).filter(t => maps.every(m => m.has(t)));
  return times.flatMap(t => {
    const f = (k: 'open' | 'high' | 'low' | 'close') => evalNode(n, s => maps[syms.indexOf(s)].get(t)![k]);
    const o = f('open'), h = f('high'), l = f('low'), c = f('close');
    if (![o, h, l, c].every(Number.isFinite)) return [];
    return [{ time: t, open: o, high: Math.max(o, h, l, c), low: Math.min(o, h, l, c), close: c, volume: 0 }];
  });
}
