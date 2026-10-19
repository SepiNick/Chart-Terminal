// Built-in script library: classic indicators and strategies written in Pine (public formulas).
export interface LibScript { name: string; kind: 'indicator' | 'strategy'; src: string }

const s = (name: string, kind: LibScript['kind'], src: string): LibScript => ({ name, kind, src: src.trim() + '\n' });

export const BUILTIN_SCRIPTS: LibScript[] = [
  s('Moving Average Cross', 'strategy', `
//@version=6
strategy("MA Cross", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_value = 0.1)
fastLen = input.int(9, "Fast length", minval = 1)
slowLen = input.int(21, "Slow length", minval = 1)
maType = input.string("EMA", "MA type", options = ["EMA", "SMA", "WMA"])
ma(src, len) =>
    switch maType
        "SMA" => ta.sma(src, len)
        "WMA" => ta.wma(src, len)
        => ta.ema(src, len)
fast = ma(close, fastLen)
slow = ma(close, slowLen)
plot(fast, "Fast", color.orange, 2)
plot(slow, "Slow", color.blue, 2)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
`),
  s('RSI Strategy', 'strategy', `
//@version=6
strategy("RSI Strategy", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100)
len = input.int(14, "RSI length")
lower = input.int(30, "Oversold")
upper = input.int(70, "Overbought")
r = ta.rsi(close, len)
if ta.crossover(r, lower)
    strategy.entry("Long", strategy.long, comment = "RSI up")
if ta.crossunder(r, upper)
    strategy.entry("Short", strategy.short, comment = "RSI down")
`),
  s('Bollinger Bands Strategy', 'strategy', `
//@version=6
strategy("BB Strategy", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100)
len = input.int(20, "Length")
mult = input.float(2.0, "StdDev", step = 0.1)
[basis, upper, lower] = ta.bb(close, len, mult)
p1 = plot(upper, "Upper", color.teal)
p2 = plot(lower, "Lower", color.teal)
plot(basis, "Basis", color.orange)
fill(p1, p2, color.new(color.teal, 90))
if ta.crossover(close, lower)
    strategy.entry("BBandLE", strategy.long, stop = lower)
if ta.crossunder(close, upper)
    strategy.entry("BBandSE", strategy.short, stop = upper)
`),
  s('Supertrend Strategy', 'strategy', `
//@version=6
strategy("Supertrend Strategy", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100)
atrPeriod = input.int(10, "ATR length")
factor = input.float(3.0, "Factor", step = 0.1)
slPct = input.float(2.0, "Stop loss %", step = 0.1)
tpPct = input.float(4.0, "Take profit %", step = 0.1)
[st, dir] = ta.supertrend(factor, atrPeriod)
plot(dir < 0 ? st : na, "Up trend", color.green, style = plot.style_linebr)
plot(dir > 0 ? st : na, "Down trend", color.red, style = plot.style_linebr)
if ta.change(dir) < 0
    strategy.entry("Long", strategy.long)
if ta.change(dir) > 0
    strategy.entry("Short", strategy.short)
strategy.exit("XL", "Long", stop = strategy.position_avg_price * (1 - slPct / 100), limit = strategy.position_avg_price * (1 + tpPct / 100))
strategy.exit("XS", "Short", stop = strategy.position_avg_price * (1 + slPct / 100), limit = strategy.position_avg_price * (1 - tpPct / 100))
`),
  s('MACD', 'indicator', `
//@version=6
indicator("MACD", overlay = false)
fastLen = input.int(12, "Fast")
slowLen = input.int(26, "Slow")
sigLen = input.int(9, "Signal")
[m, sig, hist] = ta.macd(close, fastLen, slowLen, sigLen)
plot(hist, "Histogram", hist >= 0 ? (hist > hist[1] ? #26a69a : #b2dfdb) : (hist < hist[1] ? #ff5252 : #ffcdd2), style = plot.style_columns)
plot(m, "MACD", #2962ff)
plot(sig, "Signal", #ff6d00)
hline(0, "Zero", color.gray)
`),
  s('RSI', 'indicator', `
//@version=6
indicator("Relative Strength Index", "RSI", overlay = false, precision = 2)
len = input.int(14, "Length", minval = 1)
src = input.source(close, "Source")
r = ta.rsi(src, len)
plot(r, "RSI", #7e57c2)
h1 = hline(70, "Overbought", #787b86)
h2 = hline(30, "Oversold", #787b86)
fill(h1, h2, color.new(#7e57c2, 90))
plotshape(ta.crossover(r, 30), "Buy", shape.triangleup, location.bottom, color.green)
`),
  s('Ichimoku Cloud', 'indicator', `
//@version=6
indicator("Ichimoku Cloud", overlay = true)
conv = input.int(9, "Conversion")
base = input.int(26, "Base")
spanB = input.int(52, "Lagging span 2")
disp = input.int(26, "Displacement")
donchian(len) => math.avg(ta.lowest(len), ta.highest(len))
c = donchian(conv)
b = donchian(base)
a1 = math.avg(c, b)
b1 = donchian(spanB)
plot(c, "Conversion", #2962ff)
plot(b, "Base", #b71c1c)
plot(close, "Lagging", #43a047, offset = -disp + 1)
p1 = plot(a1, "Leading A", #a5d6a7, offset = disp - 1)
p2 = plot(b1, "Leading B", #ef9a9a, offset = disp - 1)
fill(p1, p2, a1 > b1 ? color.new(#43a047, 90) : color.new(#f44336, 90))
`),
  s('Pivot Points High Low', 'indicator', `
//@version=6
indicator("Pivot Points High Low", overlay = true, max_labels_count = 100)
left = input.int(10, "Left bars")
right = input.int(10, "Right bars")
ph = ta.pivothigh(left, right)
pl = ta.pivotlow(left, right)
if not na(ph)
    label.new(bar_index - right, ph, str.tostring(ph, format.mintick), style = label.style_label_down, color = color.new(color.red, 20))
if not na(pl)
    label.new(bar_index - right, pl, str.tostring(pl, format.mintick), style = label.style_label_up, color = color.new(color.green, 20))
`),
  s('VWAP + Bands', 'indicator', `
//@version=6
indicator("VWAP Bands", overlay = true)
mult = input.float(1.0, "Band multiplier", step = 0.5)
v = ta.vwap(hlc3)
dev = ta.stdev(hlc3, 20)
plot(v, "VWAP", #2962ff, 2)
u = plot(v + dev * mult, "Upper", color.new(#2962ff, 50))
l = plot(v - dev * mult, "Lower", color.new(#2962ff, 50))
fill(u, l, color.new(#2962ff, 92))
`),
  s('Volume Spike Highlighter', 'indicator', `
//@version=6
indicator("Volume Spikes", overlay = true)
len = input.int(20, "Average length")
k = input.float(2.5, "Spike multiple", step = 0.1)
spike = volume > ta.sma(volume, len) * k
bgcolor(spike ? color.new(color.orange, 85) : na)
barcolor(spike ? color.orange : na)
plotchar(spike, "Spike", "⚡", location.abovebar, color.orange)
alertcondition(spike, "Volume spike", "Volume spike on {{ticker}}")
`),
];

export const NEW_INDICATOR = `//@version=6
indicator("My script", overlay = true)
len = input.int(20, "Length")
plot(ta.sma(close, len), "SMA", color.blue)
`;
export const NEW_STRATEGY = `//@version=6
strategy("My strategy", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
plot(fast, color = color.orange)
plot(slow, color = color.blue)
`;
