// What the AI panel sends to the local model: a compact, factual picture of the chart (prices, standard indicators
// computed here, the rule-based auto analysis, the indicators on the chart), the journal in figures, and Pine requests
// that are compiled by the app's own Pine engine and sent back with the error until they compile. The model only
// explains and drafts; numbers come from the app, and nothing here places an order.
import type { Bar } from '../data.ts';
import { compile, isError, runScript } from '../pine/engine.ts';
import { analyze } from './analyze.ts';

export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }
const sma = (v: number[], n: number) => (v.length < n ? null : v.slice(-n).reduce((a, b) => a + b, 0) / n);
export function rsi(c: number[], n = 14) {
  if (c.length < n + 1) return null;
  let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d }
  g /= n; l /= n; for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
export function atr(b: Bar[], n = 14) { if (b.length < n + 1) return null; const t = b.slice(1).map((x, i) => Math.max(x.high - x.low, Math.abs(x.high - b[i].close), Math.abs(x.low - b[i].close))); let a = t.slice(0, n).reduce((x, y) => x + y, 0) / n; for (const v of t.slice(n)) a = (a * (n - 1) + v) / n; return a }
const pc = (a: number, b: number) => `${((a / b - 1) * 100).toFixed(2)}%`;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
/** The chart as text: everything computed by the app, so the model never has to guess a number. */
export function chartContext(o: { symbol: string; tf: string; bars: Bar[]; prec: number; indicators?: string[] }) {
  const b = o.bars, c = b.map(x => x.close), f = (x: number | null) => (x == null ? 'n/a' : x.toFixed(o.prec)), last = b.at(-1);
  if (!last) return `Symbol ${o.symbol}, timeframe ${o.tf}: no bars loaded.`;
  const w = b.slice(-100), hi = Math.max(...w.map(x => x.high)), lo = Math.min(...w.map(x => x.low)), v20 = sma(b.map(x => x.volume), 20);
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c), a = atr(b), an = analyze(b);
  const lines = [
    `Symbol ${o.symbol}, timeframe ${o.tf}, ${b.length} bars from ${iso(b[0].time)} to ${iso(last.time)} UTC.`,
    `Last close ${f(last.close)} (${b.length > 1 ? pc(last.close, b.at(-2)!.close) : 'n/a'} vs previous bar, ${b.length > 20 ? pc(last.close, b.at(-21)!.close) : 'n/a'} over 20 bars). 100-bar range ${f(lo)} – ${f(hi)}.`,
    `SMA20 ${f(s20)}, SMA50 ${f(s50)}, SMA200 ${f(s200)}; price is ${[s20, s50, s200].map((s, i) => (s == null ? null : `${last.close >= s ? 'above' : 'below'} SMA${[20, 50, 200][i]}`)).filter(Boolean).join(', ') || 'n/a'}.`,
    `RSI14 ${r == null ? 'n/a' : r.toFixed(1)}, ATR14 ${f(a)}${a ? ` (${(a / last.close * 100).toFixed(2)}% of price)` : ''}, volume ${v20 ? `${(last.volume / v20).toFixed(2)}× its 20-bar average` : 'n/a'}.`,
    `Auto analysis (rule-based): ${an.levels.length ? `levels ${an.levels.map(l => `${l.kind} ${f(l.price)} ×${l.touches}`).join(', ')}` : 'no clear levels'}; ${an.lines.length ? `trend lines ${an.lines.map(l => `${l.kind} through ${f(l.a.p)} → ${f(l.b.p)} (${l.touches} touches)`).join(', ')}` : 'no unbroken trend lines'}; ${an.patterns.length ? `patterns ${an.patterns.map(p => `${p.name} (${p.dir})`).join(', ')}` : 'no patterns'}.`,
    ...(o.indicators?.length ? [`Indicators on the chart: ${o.indicators.join(', ')}.`] : []),
    'Last 20 bars (time UTC, open, high, low, close, volume):',
    ...b.slice(-20).map(x => `${iso(x.time)} ${f(x.open)} ${f(x.high)} ${f(x.low)} ${f(x.close)} ${Math.round(x.volume)}`),
  ];
  return lines.join('\n');
}
export interface JT { sym: string; dir: 'long' | 'short'; openTime: number; closeTime?: number; net: number; r?: number | null; status: string; setup?: string; mistakes?: string[] }
/** The journal in figures: totals, by setup and by mistake, and the last trades. */
export function journalContext(ts: JT[], n = 40) {
  const c = ts.filter(t => t.status === 'closed'); if (!c.length) return 'The journal has no closed trades yet.';
  const wins = c.filter(t => t.net > 0), rs = c.map(t => t.r).filter((x): x is number => x != null), sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const by = (k: (t: JT) => string[]) => { const m = new Map<string, JT[]>(); for (const t of c) for (const x of k(t)) m.set(x, [...(m.get(x) ?? []), t]); return [...m].sort((a, b) => b[1].length - a[1].length).map(([x, v]) => `${x}: ${v.length} trades, win rate ${(v.filter(t => t.net > 0).length / v.length * 100).toFixed(0)}%, net ${sum(v.map(t => t.net)).toFixed(2)}`) };
  return [
    `${c.length} closed trades: win rate ${(wins.length / c.length * 100).toFixed(1)}%, net ${sum(c.map(t => t.net)).toFixed(2)}, average win ${wins.length ? (sum(wins.map(t => t.net)) / wins.length).toFixed(2) : 'n/a'}, average loss ${c.length - wins.length ? (sum(c.filter(t => t.net <= 0).map(t => t.net)) / (c.length - wins.length)).toFixed(2) : 'n/a'}${rs.length ? `, average R ${(sum(rs) / rs.length).toFixed(2)}` : ''}.`,
    `Long ${c.filter(t => t.dir === 'long').length}, short ${c.filter(t => t.dir === 'short').length}.`,
    'By setup:', ...by(t => [t.setup || '(no setup)']),
    'By mistake:', ...(by(t => t.mistakes?.length ? t.mistakes : []).length ? by(t => t.mistakes ?? []) : ['(no mistakes tagged)']),
    `Last ${Math.min(n, c.length)} trades (closed UTC, symbol, direction, net, R, setup, mistakes):`,
    ...c.slice(-n).map(t => `${iso(t.closeTime ?? t.openTime)} ${t.sym} ${t.dir} ${t.net.toFixed(2)} ${t.r == null ? '-' : t.r.toFixed(2)} ${t.setup || '-'} ${t.mistakes?.join('/') || '-'}`),
  ].join('\n');
}
export const SYSTEM = 'You are the analysis assistant inside a charting and trading app. Answer in the language the user writes in (Persian if they write Persian). Use only the numbers given in the context; if something is not there, say so instead of inventing it. Be concise and concrete. You never place orders and never give personal financial advice: describe the picture, the scenarios, the levels that would invalidate them, and the risks.';
export const PINE_SYSTEM = 'You write TradingView Pine Script (version 5 or 6) for an app that runs a large Pine subset: indicator() and strategy(), input.*, ta.*, math.*, str.*, array.*, request.security, plot/plotshape/hline/fill/bgcolor, strategy.entry/exit/close, label/line/box. Always start with //@version=5 (or 6), declare indicator() or strategy(), and reply with ONE ```pine code block followed by two or three short lines explaining it. No placeholders, no external libraries.';
/** The first fenced code block (```pine preferred), or null. */
export function extractCode(text: string) {
  const all = [...text.matchAll(/```([\w-]*)\s*\n([\s\S]*?)```/g)];
  const m = all.find(x => /^(pine|pinescript)$/i.test(x[1])) ?? all[0];
  return m ? m[2].replace(/\s+$/, '') + '\n' : null;
}
/** A script's first error: syntax from the compiler, then runtime from a dry run on `bars` (when given). */
export function pineError(code: string, bars?: Bar[], symbol = 'TEST', tf = '1d', tfSec = 86400) {
  const r = compile(code); if (isError(r)) return r;
  if (!bars?.length) return null;
  const x = runScript(code, bars, { symbol, tf, tfSec, mintick: 0.01, maxLoop: 100_000 });
  return x.error ?? null;
}
/** Ask for Pine, check the answer with the app's engine, and feed any error back, up to `tries` answers. */
export async function writePine(ask: (m: Msg[]) => Promise<string>, request: string, o: { history?: Msg[]; tries?: number; bars?: Bar[]; symbol?: string; tf?: string; tfSec?: number } = {}) {
  const history = o.history ?? [], tries = o.tries ?? 3;
  const msgs: Msg[] = [{ role: 'system', content: PINE_SYSTEM }, ...history, { role: 'user', content: request }];
  let last = '', code: string | null = null, error: string | null = null;
  for (let k = 0; k < tries; k++) {
    last = await ask(msgs); code = extractCode(last);
    if (!code) { error = 'no code block in the answer'; msgs.push({ role: 'assistant', content: last }, { role: 'user', content: 'Reply with the complete script in one ```pine code block.' }); continue }
    const r = pineError(code, o.bars, o.symbol, o.tf, o.tfSec);
    if (!r) return { ok: true as const, text: last, code, attempts: k + 1 };
    error = `${r.kind} error at line ${r.line}:${r.col}: ${r.msg}`;
    msgs.push({ role: 'assistant', content: last }, { role: 'user', content: `The app's Pine engine rejects it (${error}). Fix it and reply with the full corrected script in one \`\`\`pine block.` });
  }
  return { ok: false as const, text: last, code, error, attempts: tries };
}
