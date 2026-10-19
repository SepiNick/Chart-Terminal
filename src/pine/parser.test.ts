import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser.ts';
import { PineSyntaxError } from './ast.ts';

// compact s-expression view of an expression, for precedence assertions
const S = (e: any): string => {
  switch (e.kind) {
    case 'Num': case 'Bool': return String(e.value);
    case 'Str': return JSON.stringify(e.value);
    case 'Color': return e.value;
    case 'Na': return 'na';
    case 'Ident': return e.name;
    case 'Member': return `${S(e.object)}.${e.prop}`;
    case 'Call': return `${S(e.callee)}${e.typeArgs.length ? `<${e.typeArgs.join(',')}>` : ''}(${[...e.args.map(S), ...e.named.map((n: any) => `${n.name}=${S(n.value)}`)].join(' ')})`;
    case 'Index': return `${S(e.object)}[${S(e.index)}]`;
    case 'Unary': return `(${e.op} ${S(e.arg)})`;
    case 'Binary': return `(${e.op} ${S(e.left)} ${S(e.right)})`;
    case 'Ternary': return `(? ${S(e.test)} ${S(e.then)} ${S(e.else)})`;
    case 'Tuple': return `[${e.items.map(S).join(' ')}]`;
    default: return e.kind;
  }
};
const body = (src: string): any[] => parse(src).body;
const ex = (src: string) => S(body(src)[0].expr);
const throwsAt = (src: string, line: number, col: number, re: RegExp) => assert.throws(() => parse(src), (e: any) => {
  assert.ok(e instanceof PineSyntaxError, String(e));
  assert.match(e.message, re);
  assert.deepEqual([e.line, e.col], [line, col], e.message);
  return true;
});

test('operator precedence', () => {
  assert.equal(ex('1 + 2 * 3 - 4 / 2 % 3'), '(- (+ 1 (* 2 3)) (% (/ 4 2) 3))');
  assert.equal(ex('a or b and not c == d'), '(or a (and b (== (not c) d)))');
  assert.equal(ex('a < b == c > d'), '(== (< a b) (> c d))');
  assert.equal(ex('-x[1] * (2 + y)'), '(* (- x[1]) (+ 2 y))');
  assert.equal(ex('a + b > c and d'), '(and (> (+ a b) c) d)');
});

test('ternary chains are right-associative', () => {
  assert.equal(ex('a ? 1 : b ? 2 : 3'), '(? a 1 (? b 2 3))');
  assert.equal(ex('a > b or c ? x + 1 : y'), '(? (or (> a b) c) (+ x 1) y)');
});

test('literals', () => {
  assert.equal(ex('[1, 1.5, .5, 1e3, 1.2e-4]'), '[1 1.5 0.5 1000 0.00012]');
  assert.equal(body(`"a\\n\\t\\'\\"\\\\b"`)[0].expr.value, 'a\n\t\'"\\b');
  assert.equal(body(`'it\\'s'`)[0].expr.value, "it's");
  assert.equal(ex('[#ff0000, #00ff0080, true, false, na]'), '[#ff0000 #00ff0080 true false na]');
  assert.equal(ex('na(x)'), 'na(x)');
});

test('postfix: history, members, named args, generics', () => {
  assert.equal(ex('close[1] + ta.sma(close, 14)[2]'), '(+ close[1] ta.sma(close 14)[2])');
  assert.equal(ex('plot(x, "t", color = color.red, linewidth = 2)'), 'plot(x "t" color=color.red linewidth=2)');
  assert.equal(ex('array.new<float>(10, 0.0)'), 'array.new<float>(10 0)');
  assert.equal(ex('map.new<string, array<int>>()'), 'map.new<string,array<int>>()');
  assert.equal(ex('array.new_float()'), 'array.new_float()');
  assert.equal(ex('a < b'), '(< a b)');
  assert.equal(ex('strategy.position_size > 0'), '(> strategy.position_size 0)');
  assert.equal(ex('syminfo.type'), 'syminfo.type');
});

test('declarations, reassignment, tuples', () => {
  const b = body(`x = 1
var y = 2
varip z = 3
float a = na
var int n = 0
series float s = close
simple int len = 14
const string t = "x"
array<float> arr = array.new<float>()
float[] old = na
[m, sig, _] = ta.macd(close, 12, 26, 9)
x := 5
n += 1
n -= 1
n *= 2
n /= 2
n %= 3`);
  assert.deepEqual(b.slice(0, 10).map(s => [s.kind, s.mode, s.typeName, s.name]), [
    ['VarDecl', null, null, 'x'], ['VarDecl', 'var', null, 'y'], ['VarDecl', 'varip', null, 'z'],
    ['VarDecl', null, 'float', 'a'], ['VarDecl', 'var', 'int', 'n'], ['VarDecl', null, 'float', 's'],
    ['VarDecl', null, 'int', 'len'], ['VarDecl', null, 'string', 't'], ['VarDecl', null, 'array<float>', 'arr'],
    ['VarDecl', null, 'float[]', 'old']]);
  assert.deepEqual([b[10].kind, b[10].names], ['TupleDecl', ['m', 'sig', '_']]);
  assert.deepEqual(b.slice(11).map(s => [s.kind, s.target, s.op]),
    [':=', '+=', '-=', '*=', '/=', '%='].map(op => ['Assign', op === ':=' ? 'x' : 'n', op]));
  assert.equal(ex('[a, b]'), '[a b]');   // tuple literal statement, not a decl
});

test('functions: single/multi-line, defaults, types, method, export', () => {
  const b = body(`f(x, y = 2) => x + y
g(float src, simple int len = 14) =>
    a = ta.sma(src, len)
    [a, a * 2]
method double(array<float> self, int k) => self.size() * k
export h(x) => x
export method m(float self) => self`);
  assert.deepEqual(b.map(s => [s.kind, s.name, s.method, s.exported]), [
    ['FuncDecl', 'f', false, false], ['FuncDecl', 'g', false, false], ['FuncDecl', 'double', true, false],
    ['FuncDecl', 'h', false, true], ['FuncDecl', 'm', true, true]]);
  assert.deepEqual(b[0].params.map((p: any) => [p.name, p.typeName, p.def && S(p.def)]), [['x', null, null], ['y', null, '2']]);
  assert.equal(S(b[0].body[0].expr), '(+ x y)');
  assert.deepEqual(b[1].params.map((p: any) => [p.name, p.typeName, p.def && S(p.def)]), [['src', 'float', null], ['len', 'int', '14']]);
  assert.deepEqual(b[1].body.map((s: any) => s.kind), ['VarDecl', 'ExprStmt']);
  assert.equal(b[2].params[0].typeName, 'array<float>');
});

test('if / else if / else as statement and expression', () => {
  const b = body(`if a
    x := 1
else if b
    x := 2
else if c
    x := 3
else
    x := 4
y = if close > open
    1
else
    -1
plot(y)`);
  assert.equal(b[0].expr.kind, 'If');
  assert.equal(b[0].expr.elifs.length, 2);
  assert.equal(b[0].expr.else[0].op, ':=');
  assert.equal(b[1].kind, 'VarDecl');
  assert.equal(b[1].init.kind, 'If');
  assert.equal(S(b[1].init.else[0].expr), '(- 1)');
  assert.equal(S(b[2].expr), 'plot(y)');
});

test('switch with and without subject', () => {
  const b = body(`t = switch mode
    "EMA" => ta.ema(close, 9)
    "SMA" =>
        v = ta.sma(close, 9)
        v
    => close
switch
    a > b => x := 1
    a < b => x := 2
    => x := 0`);
  const s1 = b[0].init, s2 = b[1].expr;
  assert.equal(S(s1.subject), 'mode');
  assert.deepEqual(s1.cases.map((c: any) => [c.when && S(c.when), c.body.length]), [['"EMA"', 1], ['"SMA"', 2], [null, 1]]);
  assert.equal(s2.subject, null);
  assert.deepEqual(s2.cases.map((c: any) => c.when && S(c.when)), ['(> a b)', '(< a b)', null]);
  assert.equal(s2.cases[2].body[0].kind, 'Assign');
});

test('loops: for/to/by, for-in, tuple for-in, while, break, continue, nesting', () => {
  const b = body(`sum = 0.0
for i = 0 to len - 1 by 2
    if i > 10
        break
    for x in arr
        if na(x)
            continue
        while sum < 100
            sum += x
for [i, v] in arr
    sum += v
z = for i = 1 to 3
    i * 2
done = true`);
  const f = b[1].expr;
  assert.deepEqual([f.kind, f.var, S(f.from), S(f.to), S(f.step)], ['For', 'i', '0', '(- len 1)', '2']);
  assert.equal(f.body[0].expr.then[0].kind, 'Break');
  const fi = f.body[1].expr;
  assert.deepEqual([fi.kind, fi.vars, S(fi.iter)], ['ForIn', ['x'], 'arr']);
  assert.equal(fi.body[0].expr.then[0].kind, 'Continue');
  assert.equal(fi.body[1].expr.kind, 'While');
  assert.deepEqual(b[2].expr.vars, ['i', 'v']);
  assert.equal(b[3].init.kind, 'For');
  assert.equal(b[3].init.step, null);
  assert.equal(b[4].name, 'done');
});

test('line wrapping: non-multiple-of-4 indent and open brackets', () => {
  const b = body(`a = 1 +
  2 *
     3
plot(a,
    title = "x",
        color = color.red)
arr = [1,
2]
if a and
  b
    c = 1`);
  assert.equal(S(b[0].init), '(+ 1 (* 2 3))');
  assert.equal(S(b[1].expr), 'plot(a title="x" color=color.red)');
  assert.equal(S(b[2].init), '[1 2]');
  assert.equal(S(b[3].expr.test), '(and a b)');
  assert.equal(b.length, 4);
});

test('comments, blank lines, version, CRLF, tabs', () => {
  const p = parse('// header\r\n//@version=6\r\nindicator("x") // trailing\r\n\r\nif a\r\n    // comment inside block\r\n\r\n\tx = 1 // tab indent\r\n    y = "// not a comment"\r\nplot(close)\r\n');
  assert.equal(p.version, 6);
  assert.equal(p.body.length, 3);
  const blk = (p.body[1] as any).expr.then;
  assert.equal(blk.length, 2);
  assert.equal(blk[1].init.value, '// not a comment');
  assert.equal(parse('x = 1').version, null);
});

test('node ids are unique and positions 1-based', () => {
  const p = parse('x = 1\nif x\n    plot(x + 1)');
  const ids: number[] = [];
  const walk = (n: any) => { if (n && typeof n === 'object') { if (typeof n.id === 'number') ids.push(n.id); Object.values(n).forEach(walk) } };
  walk(p);
  assert.equal(new Set(ids).size, ids.length);
  const call = (p.body[1] as any).expr.then[0].expr;
  assert.deepEqual([call.kind, call.line, call.col], ['Call', 3, 5]);
});

test('syntax errors carry locations', () => {
  throwsAt('x = 1\nplot(close, color = color.red\ny = 2', 2, 5, /'\(' was never closed/);
  throwsAt('a = (1 + 2]', 1, 11, /Mismatched/);
  throwsAt('x = 1\n    y = 2', 2, 5, /Unexpected indentation/);
  throwsAt('if a\n        b = 1', 2, 9, /Bad indentation/);
  throwsAt('if a\nb = 1', 1, 5, /indented block/);
  throwsAt('x = 1\ntype Point\n    float x', 2, 1, /not supported yet/);
  throwsAt('enum Dir\n    up', 1, 1, /not supported yet/);
  throwsAt('import user/lib/1 as l', 1, 1, /not supported yet/);
  throwsAt('x = 1 +', 1, 8, /Unexpected end of line/);
  throwsAt('s = "abc', 1, 5, /Unterminated string/);
  throwsAt('x = a ? b', 1, 10, /':' in ternary/);
  throwsAt('c = #12345', 1, 5, /color literal/);
  throwsAt('x = 1 y', 1, 7, /Unexpected 'y'/);
});

test('realistic EMA-cross strategy parses', () => {
  const src = `//@version=6
strategy("EMA Cross", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity,
     default_qty_value = 10, commission_type = strategy.commission.percent, commission_value = 0.05)

// ── inputs ──
fastLen = input.int(9, "Fast EMA", minval = 1, group = "EMAs")
slowLen = input.int(21, "Slow EMA", minval = 1, group = "EMAs")
src = input.source(close, "Source")
useStop = input.bool(true, "Use stop loss", inline = "sl")
stopPct = input.float(2.0, "%", step = 0.1, inline = "sl") / 100
maType = input.string("EMA", "MA type", options = ["EMA", "SMA", "WMA"])

ma(float s, simple int len) =>
    switch maType
        "EMA" => ta.ema(s, len)
        "SMA" => ta.sma(s, len)
        => ta.wma(s, len)

fast = ma(src, fastLen)
slow = ma(src, slowLen)
longCond = ta.crossover(fast, slow)
shortCond = ta.crossunder(fast, slow)

var int trades = 0
var float entryPrice = na
trend = fast > slow ? 1 : fast < slow ? -1 : 0

if longCond
    strategy.entry("Long", strategy.long, comment = "L")
    entryPrice := close
    trades += 1
else if shortCond
    strategy.entry("Short", strategy.short)
    entryPrice := close
    trades += 1

if useStop and strategy.position_size != 0
    stop = strategy.position_size > 0 ? entryPrice * (1 - stopPct) : entryPrice * (1 + stopPct)
    strategy.exit("SL", stop = stop)

// visuals
fastColor = trend == 1 ? color.new(color.green, 0) : color.new(#ff5252, 20)
plot(fast, "Fast", color = fastColor, linewidth = 2)
plot(slow, "Slow", color = color.orange)
plotshape(longCond, title = "Buy", style = shape.triangleup, location = location.belowbar,
  color = color.green, size = size.small)
plotshape(shortCond, title = "Sell", style = shape.triangledown, location = location.abovebar, color = color.red)
bgcolor(trend == 1 ? color.new(color.green, 90) : na)

counts = array.new<int>()
for i = 0 to 9 by 3
    array.push(counts, i)
total = 0
for [idx, c] in counts
    if idx == 0
        continue
    total += c
alertcondition(longCond, "Long", "EMA cross up")
`;
  const p = parse(src);
  assert.equal(p.version, 6);
  assert.equal((p.body[0] as any).expr.named.length, 6);
  assert.ok(p.body.length > 25);
});
