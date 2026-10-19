// No-code strategy builder: a form spec turned into a plain Pine strategy, so the result runs, optimises and
// exports like any other script (every length/level becomes an input).
export type OperandKind = 'close' | 'open' | 'high' | 'low' | 'volume' | 'sma' | 'ema' | 'wma' | 'rsi' | 'macd' | 'macdSignal' | 'bbUpper' | 'bbLower' | 'stoch' | 'vwap' | 'value';
export interface Operand { kind: OperandKind; len?: number; value?: number }
export type Op = 'crossAbove' | 'crossBelow' | 'gt' | 'lt';
export interface Cond { a: Operand; op: Op; b: Operand }
export interface Rule { conds: Cond[]; join: 'and' | 'or' }
export interface NoCodeSpec {
  name: string;
  direction: 'long' | 'short' | 'both';
  longEntry: Rule; longExit: Rule; shortEntry: Rule; shortExit: Rule;
  stopPct: number; takePct: number; trailPct: number;   // 0 = off
  capital: number; sizePct: number; commissionPct: number;
}

export const OPERANDS: { kind: OperandKind; label: string; len?: number }[] = [
  { kind: 'close', label: 'Close' }, { kind: 'open', label: 'Open' }, { kind: 'high', label: 'High' }, { kind: 'low', label: 'Low' }, { kind: 'volume', label: 'Volume' },
  { kind: 'sma', label: 'SMA', len: 20 }, { kind: 'ema', label: 'EMA', len: 20 }, { kind: 'wma', label: 'WMA', len: 20 },
  { kind: 'rsi', label: 'RSI', len: 14 }, { kind: 'macd', label: 'MACD line' }, { kind: 'macdSignal', label: 'MACD signal' },
  { kind: 'bbUpper', label: 'Bollinger upper', len: 20 }, { kind: 'bbLower', label: 'Bollinger lower', len: 20 },
  { kind: 'stoch', label: 'Stochastic %K', len: 14 }, { kind: 'vwap', label: 'VWAP' }, { kind: 'value', label: 'Value' },
];
export const OPS: { op: Op; label: string }[] = [{ op: 'crossAbove', label: 'crosses above' }, { op: 'crossBelow', label: 'crosses below' }, { op: 'gt', label: 'is above' }, { op: 'lt', label: 'is below' }];
const LABEL = Object.fromEntries(OPERANDS.map(o => [o.kind, o.label]));
const MIRROR: Record<Op, Op> = { crossAbove: 'crossBelow', crossBelow: 'crossAbove', gt: 'lt', lt: 'gt' };

/** The short-side version of a long rule: same operands, opposite comparisons; levels on 0–100 oscillators are reflected (30 ↔ 70). */
export function mirror(r: Rule): Rule {
  const osc = (c: Cond) => ['rsi', 'stoch'].includes(c.a.kind) || ['rsi', 'stoch'].includes(c.b.kind);
  const flip = (o: Operand, c: Cond): Operand => (o.kind === 'value' && osc(c) ? { ...o, value: 100 - (o.value ?? 0) } : { ...o });
  return { join: r.join, conds: r.conds.map(c => ({ a: flip(c.a, c), op: MIRROR[c.op], b: flip(c.b, c) })) };
}

export const defaultSpec = (): NoCodeSpec => {
  const longEntry: Rule = { join: 'and', conds: [{ a: { kind: 'ema', len: 9 }, op: 'crossAbove', b: { kind: 'ema', len: 21 } }] };
  return { name: 'My no-code strategy', direction: 'both', longEntry, longExit: { join: 'or', conds: [] }, shortEntry: mirror(longEntry), shortExit: { join: 'or', conds: [] },
    stopPct: 0, takePct: 0, trailPct: 0, capital: 10000, sizePct: 100, commissionPct: 0.1 };
};

const q = (s: string) => JSON.stringify(s);
const num = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));   // float literal keeps input.float a float

export function toPine(s: NoCodeSpec): string {
  const inputs: string[] = [], vars: string[] = [], seen = new Map<string, string>();
  let n = 0, macd = false;
  const used = new Map<string, number>();
  const title = (t: string) => { const k = (used.get(t) ?? 0) + 1; used.set(t, k); return k > 1 ? `${t} ${k}` : t };   // "EMA length", "EMA length 2"
  // One variable per distinct operand, its length/level an input named after it.
  const operand = (o: Operand): string => {
    if (['close', 'open', 'high', 'low', 'volume'].includes(o.kind)) return o.kind;
    if (o.kind === 'macd' || o.kind === 'macdSignal') {
      if (!macd) { macd = true; inputs.push('macdFast = input.int(12, "MACD fast", minval = 1)', 'macdSlow = input.int(26, "MACD slow", minval = 1)', 'macdSig = input.int(9, "MACD signal", minval = 1)'); vars.push('macdLine = ta.ema(close, macdFast) - ta.ema(close, macdSlow)', 'macdSignalLine = ta.ema(macdLine, macdSig)') }
      return o.kind === 'macd' ? 'macdLine' : 'macdSignalLine';
    }
    const key = `${o.kind}:${o.len ?? ''}:${o.value ?? ''}`;
    if (seen.has(key)) return seen.get(key)!;
    const v = `v${++n}`, L = `len${n}`;
    seen.set(key, v);
    const len = () => inputs.push(`${L} = input.int(${Math.max(1, Math.round(o.len ?? 14))}, ${q(title(`${LABEL[o.kind]} length`))}, minval = 1)`);
    switch (o.kind) {
      case 'sma': case 'ema': case 'wma': case 'rsi': len(); vars.push(`${v} = ta.${o.kind}(close, ${L})`); break;
      case 'bbUpper': case 'bbLower': len(); vars.push(`${v} = ta.sma(close, ${L}) ${o.kind === 'bbUpper' ? '+' : '-'} 2 * ta.stdev(close, ${L})`); break;
      case 'stoch': len(); vars.push(`${v} = ta.sma(ta.stoch(close, high, low, ${L}), 3)`); break;
      case 'vwap': vars.push(`${v} = ta.vwap(hlc3)`); break;
      case 'value': inputs.push(`${v} = input.float(${num(o.value ?? 0)}, ${q(title('Level'))})`); break;
    }
    return v;
  };
  const cond = (c: Cond) => {
    const a = operand(c.a), b = operand(c.b);
    return c.op === 'crossAbove' ? `ta.crossover(${a}, ${b})` : c.op === 'crossBelow' ? `ta.crossunder(${a}, ${b})` : `${a} ${c.op === 'gt' ? '>' : '<'} ${b}`;
  };
  const rule = (r: Rule) => (r.conds.length ? r.conds.map(c => `(${cond(c)})`).join(` ${r.join} `) : 'false');
  const long = s.direction !== 'short', short = s.direction !== 'long';
  const lines = [
    `longEntry = ${long ? rule(s.longEntry) : 'false'}`, `longExit = ${long ? rule(s.longExit) : 'false'}`,
    `shortEntry = ${short ? rule(s.shortEntry) : 'false'}`, `shortExit = ${short ? rule(s.shortExit) : 'false'}`,
  ];
  if (s.stopPct > 0) inputs.push(`stopPct = input.float(${num(s.stopPct)}, "Stop loss %", minval = 0.01)`);
  if (s.takePct > 0) inputs.push(`takePct = input.float(${num(s.takePct)}, "Take profit %", minval = 0.01)`);
  if (s.trailPct > 0) inputs.push(`trailPct = input.float(${num(s.trailPct)}, "Trailing stop %", minval = 0.01)`);
  const exitArgs = (dir: 1 | -1) => [
    s.stopPct > 0 ? `stop = strategy.position_avg_price * (1 ${dir > 0 ? '-' : '+'} stopPct / 100)` : '',
    s.takePct > 0 ? `limit = strategy.position_avg_price * (1 ${dir > 0 ? '+' : '-'} takePct / 100)` : '',
    s.trailPct > 0 ? 'trail_points = close * trailPct / 100 / syminfo.mintick, trail_offset = close * trailPct / 100 / syminfo.mintick' : '',
  ].filter(Boolean).join(', ');
  const ex = exitArgs(1);
  return [
    '//@version=6',
    `// Generated by the no-code strategy builder — edit freely, or rebuild from the builder.`,
    `strategy(${q(s.name || 'No-code strategy')}, overlay = true, initial_capital = ${s.capital}, default_qty_type = strategy.percent_of_equity, default_qty_value = ${s.sizePct}, commission_type = strategy.commission.percent, commission_value = ${s.commissionPct})`,
    ...inputs, ...vars, ...lines,
    ...['sma', 'ema', 'wma', 'bbUpper', 'bbLower', 'vwap'].flatMap(k => [...seen.entries()].filter(([key]) => key.startsWith(k + ':')).map(([key, v]) => `plot(${v}, ${q(`${LABEL[k]}${key.split(':')[1] ? ' ' + key.split(':')[1] : ''}`)})`)),
    'if longEntry', '    strategy.entry("Long", strategy.long)',
    'if shortEntry', '    strategy.entry("Short", strategy.short)',
    'if longExit', '    strategy.close("Long")',
    'if shortExit', '    strategy.close("Short")',
    ...(ex ? ['if strategy.position_size > 0', `    strategy.exit("Long exit", "Long", ${ex})`, 'if strategy.position_size < 0', `    strategy.exit("Short exit", "Short", ${exitArgs(-1)})`] : []),
    '',
  ].join('\n');
}
