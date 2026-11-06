// What the Python tool sends back (see ml/pyrun.py) → the chart's own script outputs. Plots, markers and hlines become Pine `Outputs`
// (so src/pine/render.ts draws them); a strategy becomes a Pine `Broker` (explicit trades are placed in it as they are; entry/exit
// signals are filled by the same Broker the Strategy Tester uses: orders placed on a bar's close fill at the next bar's open), so the
// Strategy Tester and the fill arrows work unchanged. Pure: no DOM, safe in node tests.
import type { Bar } from '../data.ts';
import type { Outputs, Plot } from '../pine/interp.ts';
import { Broker, defaultProps, type Dir, type Trade } from '../pine/strategy.ts';

const MAX_PLOTS = 40, MAX_MARKERS = 5000, MAX_TRADES = 20_000;
type Num = number | null;
export interface PyPlot { name: string; values: Num[]; color?: string; pane: 'overlay' | 'separate'; style: string; width: number }
export interface PyMarker { time: number; position: 'above' | 'below' | 'inbar'; text: string; shape: 'arrowup' | 'arrowdown' | 'circle' | 'square'; color?: string }
export interface PyHline { price: number; color?: string; pane?: 'overlay' | 'separate' }
export interface PyTrade { entryTime: number; entryPrice: number; exitTime: number | null; exitPrice: number | null; side: Dir; qty: number }
export interface PySignals { position?: Num[]; longEntry?: Num[]; longExit?: Num[]; shortEntry?: Num[]; shortExit?: Num[] }
/** A normalised answer. `times` are the bar times the code saw: every series is aligned to them. */
export interface PyNorm {
  times: number[]; plots: PyPlot[]; markers: PyMarker[]; hlines: PyHline[];
  trades?: PyTrade[]; signals?: PySignals;
  qty: number; initialCapital: number; commissionPct: number;
}
export interface PyRun { id: string; name: string; ms: number; data: PyNorm; cache?: { key: string; parts: Outputs[] } }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const num = (x: unknown): Num => (fin(x) ? x : null);
const color = (x: unknown) => (typeof x === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(x.trim()) ? x.trim() : undefined);
const STYLES: Record<string, string> = { line: 'plot.style_line', histogram: 'plot.style_histogram', columns: 'plot.style_columns', area: 'plot.style_area', step: 'plot.style_stepline', circles: 'plot.style_circles' };
const SHAPES: Record<string, PyMarker['shape']> = { arrow_up: 'arrowup', arrowup: 'arrowup', up: 'arrowup', triangleup: 'arrowup', labelup: 'arrowup', arrow_down: 'arrowdown', arrowdown: 'arrowdown', down: 'arrowdown', triangledown: 'arrowdown', labeldown: 'arrowdown', circle: 'circle', square: 'square' };

/** Check and clean the harness answer. Bad entries are dropped with a warning; nothing here throws on odd input. */
export function normalize(result: unknown, times: number[]): { data: PyNorm; warnings: string[] } {
  const r = isObj(result) ? result : {}, warnings: string[] = [];
  const series = (k: string): Num[] | undefined => {
    const v = r[k];
    if (v == null) return undefined;
    if (!Array.isArray(v) || v.length !== times.length) { warnings.push(`"${k}" ignored: it needs one value per row of df (${times.length})`); return undefined }
    return v.map(x => (x === true ? 1 : x === false ? 0 : num(x)));
  };
  const list = (k: string): unknown[] => (Array.isArray(r[k]) ? r[k] as unknown[] : r[k] == null ? [] : (warnings.push(`"${k}" ignored: it must be a list`), []));
  const plots: PyPlot[] = [];
  list('plots').slice(0, MAX_PLOTS).forEach((p, i) => {
    if (!isObj(p) || !Array.isArray(p.values) || p.values.length !== times.length) return void warnings.push(`plots[${i}] ignored: "values" must have one number per row of df`);
    plots.push({ name: typeof p.name === 'string' && p.name ? p.name.slice(0, 60) : `Plot ${i + 1}`, values: p.values.map(num), color: color(p.color), pane: p.pane === 'separate' ? 'separate' : 'overlay', style: STYLES[String(p.style)] ?? STYLES.line, width: fin(p.width) ? Math.min(4, Math.max(1, Math.round(p.width))) : 2 });
  });
  if (list('plots').length > MAX_PLOTS) warnings.push(`only the first ${MAX_PLOTS} plots are drawn`);
  const markers: PyMarker[] = [];
  list('markers').forEach((m, i) => {
    if (!isObj(m) || !fin(m.time)) return void (markers.length < MAX_MARKERS && warnings.length < 20 && warnings.push(`markers[${i}] ignored: "time" must be epoch seconds`));
    if (markers.length >= MAX_MARKERS) return;
    const position = m.position === 'below' ? 'below' : m.position === 'inbar' ? 'inbar' : 'above';
    markers.push({ time: m.time, position, text: typeof m.text === 'string' ? m.text.slice(0, 40) : '', shape: SHAPES[String(m.shape).toLowerCase()] ?? (position === 'below' ? 'arrowup' : 'arrowdown'), color: color(m.color) });
  });
  if (list('markers').length > MAX_MARKERS) warnings.push(`only the first ${MAX_MARKERS} markers are drawn`);
  const hlines: PyHline[] = [];
  list('hlines').forEach((h, i) => { if (isObj(h) && fin(h.price)) hlines.push({ price: h.price, color: color(h.color), pane: h.pane === 'separate' ? 'separate' : h.pane === 'overlay' ? 'overlay' : undefined }); else warnings.push(`hlines[${i}] ignored: "price" must be a number`) });
  let trades: PyTrade[] | undefined;
  if (r.trades != null) {
    trades = [];
    list('trades').slice(0, MAX_TRADES).forEach((t, i) => {
      if (!isObj(t) || !fin(t.entryTime) || !fin(t.entryPrice) || (t.exitTime != null && !fin(t.exitTime)) || (t.exitPrice != null && !fin(t.exitPrice))) return void warnings.push(`trades[${i}] ignored: it needs entryTime, entryPrice, exitTime, exitPrice, side`);
      const side = /^(short|sell)$/i.test(String(t.side)) ? 'short' : /^(long|buy)$/i.test(String(t.side ?? 'long')) ? 'long' : null;
      if (!side) return void warnings.push(`trades[${i}] ignored: side must be "long" or "short"`);
      const closed = t.exitTime != null && t.exitPrice != null;
      trades!.push({ entryTime: t.entryTime, entryPrice: t.entryPrice, exitTime: closed ? t.exitTime as number : null, exitPrice: closed ? t.exitPrice as number : null, side, qty: fin(t.qty) && t.qty > 0 ? t.qty : 1 });
    });
  }
  const signals: PySignals = { position: series('position'), longEntry: series('long_entry'), longExit: series('long_exit'), shortEntry: series('short_entry'), shortExit: series('short_exit') };
  const hasSignals = Object.values(signals).some(Boolean);
  if (trades && hasSignals) warnings.push('both "trades" and signals were returned: the explicit trades are used');
  return {
    warnings, data: {
      times, plots, markers, hlines, ...(trades ? { trades } : hasSignals ? { signals } : {}),
      qty: fin(r.qty) && r.qty > 0 ? r.qty : 1, initialCapital: fin(r.initial_capital) && r.initial_capital > 0 ? r.initial_capital : 10000, commissionPct: fin(r.commission_pct) && r.commission_pct >= 0 ? r.commission_pct : 0,
    },
  };
}

// ---------- time alignment: results are keyed by time, never by index (loading older history shifts every index) ----------
/** Index of the last bar whose time is <= t, or -1. */
export function barAt(bars: Bar[], t: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { ans = m; lo = m + 1 } else hi = m - 1 }
  return ans;
}
/** A series the code computed on `times`, laid out on the chart's current bars (missing = null). */
function align<T>(times: number[], bars: Bar[], v: (T | null)[]): (T | null)[] {
  const out: (T | null)[] = new Array(bars.length).fill(null);
  if (times.length === bars.length && times[0] === bars[0]?.time && times.at(-1) === bars.at(-1)?.time) { for (let i = 0; i < v.length; i++) out[i] = v[i]; return out }
  const at = new Map<number, number>(); bars.forEach((b, i) => at.set(b.time, i));
  for (let j = 0; j < times.length; j++) { const i = at.get(times[j]); if (i !== undefined) out[i] = v[j] }
  return out;
}

// ---------- strategy ----------
const props = (d: PyNorm) => defaultProps({ initialCapital: d.initialCapital, qtyValue: d.qty, commissionType: 'percent', commissionValue: d.commissionPct });

/** Entry/exit signals through the Strategy Tester's own Broker. Signal arrays are for the bar's close; fills happen on the next open. */
export function brokerFromSignals(d: PyNorm, bars: Bar[]): Broker {
  const s = d.signals!, br = new Broker(bars, props(d));
  const a = (v?: Num[]) => (v ? align(d.times, bars, v) : null);
  const pos = a(s.position), le = a(s.longEntry), lx = a(s.longExit), se = a(s.shortEntry), sx = a(s.shortExit);
  let want = 0;
  for (let i = 0; i < bars.length; i++) {
    br.step(i);
    if (pos) {
      const w = Math.sign(pos[i] ?? 0);
      if (w !== want) { if (w === 0) br.close(i, null); else br.entry(i, w > 0 ? 'Long' : 'Short', w > 0 ? 'long' : 'short', {}); want = w }
      continue;
    }
    if (lx?.[i]) br.close(i, 'Long');
    if (sx?.[i]) br.close(i, 'Short');
    if (le?.[i]) br.entry(i, 'Long', 'long', {});
    if (se?.[i]) br.entry(i, 'Short', 'short', {});
  }
  br.finalize();
  return br;
}

/** Trades the code listed itself: placed in a Broker as given (prices are the code's own; the chart does not re-fill them). */
export function brokerFromTrades(d: PyNorm, bars: Bar[]): { broker: Broker; skipped: number } {
  const br = new Broker(bars, props(d)), n = bars.length;
  const dq = new Float64Array(n + 1), dqe = new Float64Array(n + 1), dreal = new Float64Array(n + 1);   // per bar: Σ signed qty and Σ signed qty·entry of open trades; realised profit added at the exit bar
  let skipped = 0, work = 0;
  const list = [...(d.trades ?? [])].sort((x, y) => x.entryTime - y.entryTime);
  for (const t of list) {
    const eb = barAt(bars, t.entryTime), xb = t.exitTime == null ? -1 : barAt(bars, t.exitTime);
    if (eb < 0 || (t.exitTime != null && (xb < eb || t.exitTime < t.entryTime))) { skipped++; continue }
    const sign = t.side === 'long' ? 1 : -1, buy = t.side === 'long', end = t.exitTime == null ? n : xb;
    const id = t.side === 'long' ? 'Long' : 'Short', e = bars[eb];
    br.fills.push({ bar: eb, time: e.time, price: t.entryPrice, qty: t.qty, side: buy ? 'buy' : 'sell', id, comment: '' });
    dq[eb] += sign * t.qty; dqe[eb] += sign * t.qty * t.entryPrice; dq[end] -= sign * t.qty; dqe[end] -= sign * t.qty * t.entryPrice;
    let hi = t.entryPrice, lo = t.entryPrice;
    for (let i = eb; i <= (t.exitTime == null ? n - 1 : xb) && work < 5e6; i++, work++) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low) }
    if (t.exitTime == null) {
      br.open.push({ id, dir: t.side, qty: t.qty, price: t.entryPrice, bar: eb, comment: '', commission: 0, maxPrice: hi, minPrice: lo });
      continue;
    }
    const gross = (t.exitPrice! - t.entryPrice) * t.qty * sign, x = bars[xb];
    const com = (t.entryPrice + t.exitPrice!) * t.qty * d.commissionPct / 100;
    const trade: Trade = {
      entryId: id, exitId: id, dir: t.side, qty: t.qty, entryBar: eb, entryTime: e.time, entryPrice: t.entryPrice, exitBar: xb, exitTime: x.time, exitPrice: t.exitPrice!,
      profit: gross - com, profitPct: gross / (t.entryPrice * t.qty) * 100, commission: com, runup: sign > 0 ? (hi - t.entryPrice) * t.qty : (t.entryPrice - lo) * t.qty, drawdown: sign > 0 ? (t.entryPrice - lo) * t.qty : (hi - t.entryPrice) * t.qty, comment: '',
    };
    br.trades.push(trade);
    br.fills.push({ bar: xb, time: x.time, price: t.exitPrice!, qty: t.qty, side: buy ? 'sell' : 'buy', id, comment: '' });
    dreal[xb] += trade.profit;
  }
  br.trades.sort((a, b) => a.exitBar - b.exitBar);
  br.fills.sort((a, b) => a.bar - b.bar);
  let q = 0, qe = 0, real = 0;
  for (let i = 0; i < n; i++) { q += dq[i]; qe += dqe[i]; real += dreal[i]; br.equity[i] = d.initialCapital + real + q * bars[i].close - qe }
  return { broker: br, skipped };
}

// ---------- → chart outputs ----------
const blank = (title: string, overlay: boolean): Outputs => ({
  meta: { kind: 'indicator', title, shorttitle: '', overlay }, inputs: [], plots: [], hlines: [], fills: [], bgcolors: [], barcolors: [],
  alertconditions: [], alerts: [], drawings: [], logs: [], warnings: [], tables: [],
});
const plotOf = (id: string, title: string, values: number[], p: Partial<Plot>): Plot => ({
  id, title, kind: 'line', values, colors: [], style: STYLES.line, linewidth: 2, offset: 0, histbase: 0, display: true, trackprice: false, ...p,
});
const nan = (v: Num) => (v == null ? NaN : v);

/**
 * The outputs to draw on `bars`: one for the price pane (lines, markers, strategy) and one for a separate pane (when any plot asks for it).
 * Pine styles are per script, not per plot, hence two Outputs.
 */
export function buildOutputs(d: PyNorm, bars: Bar[], title: string): { parts: Outputs[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!bars.length) return { parts: [], warnings };
  const over = blank(title, true), sep = blank(title + ' · lower pane', false);
  d.plots.forEach((p, i) => {
    const out = p.pane === 'separate' ? sep : over;
    out.plots.push(plotOf(`py${i}`, p.name, align(d.times, bars, p.values).map(nan), { style: p.style, linewidth: p.width, colors: p.color ? [p.color] : [] }));
  });
  const lower = sep.plots.length > 0, upper = over.plots.length > 0;
  for (const h of d.hlines) {
    const out = (h.pane ?? (lower && !upper ? 'separate' : 'overlay')) === 'separate' ? sep : over;
    out.hlines.push({ id: `h${out.hlines.length}`, title: '', price: h.price, color: h.color ?? '#787b86', linestyle: 'hline.style_dashed', linewidth: 1, display: true } as Outputs['hlines'][number]);
  }
  // markers: one shape plot per (position, shape); a bar holds one marker of a kind
  const last = bars.at(-1)!.time, step = bars.length > 1 ? last - bars[bars.length - 2].time : 0;
  const groups = new Map<string, Plot>();
  let dropped = 0;
  for (const m of d.markers) {
    const i = barAt(bars, m.time);
    if (i < 0 || m.time > last + step) { dropped++; continue }
    const key = `${m.position}|${m.shape}`;
    let g = groups.get(key);
    if (!g) {
      const loc = m.position === 'below' ? 'belowbar' : m.position === 'inbar' ? 'absolute' : 'abovebar';
      g = plotOf(`m${groups.size}`, 'Markers', new Array(bars.length).fill(NaN), { kind: 'shape', shape: m.shape === 'arrowup' ? 'arrowup' : m.shape === 'arrowdown' ? 'arrowdown' : m.shape, location: loc, size: 'small', texts: new Array(bars.length).fill(null) });
      g.colors = new Array(bars.length).fill(null);
      groups.set(key, g); over.plots.push(g);
    }
    g.values[i] = 1; g.texts![i] = m.text || null; g.colors[i] = m.color ?? (m.position === 'below' ? '#26a69a' : m.position === 'above' ? '#ef5350' : '#2962ff');
  }
  if (dropped) warnings.push(`${dropped} marker(s) are outside the bars on the chart`);
  if (d.trades || d.signals) {
    over.meta.kind = 'strategy';
    if (d.trades) { const r = brokerFromTrades(d, bars); over.broker = r.broker; if (r.skipped) warnings.push(`${r.skipped} trade(s) are outside the bars on the chart or end before they start`) }
    else over.broker = brokerFromSignals(d, bars);
    over.meta.strategy = over.broker.props;
  }
  const parts = [over, ...(lower || sep.hlines.length ? [sep] : [])];
  return { parts: over.plots.length || over.hlines.length || over.broker ? parts : parts.slice(1), warnings };
}

/** buildOutputs, remembered until the bars change shape (the chart asks on every redraw). */
export function partsFor(run: PyRun, bars: Bar[]): Outputs[] {
  const key = `${bars.length}|${bars[0]?.time}|${bars.at(-1)?.time}`;
  if (run.cache?.key !== key) run.cache = { key, parts: buildOutputs(run.data, bars, run.name).parts };
  return run.cache.parts;
}

/** One line for the console: what the code produced. */
export function summary(d: PyNorm): string {
  const bits = [`${d.plots.length} line(s)`, `${d.markers.length} marker(s)`];
  if (d.trades) bits.push(`${d.trades.length} trade(s)`); else if (d.signals) bits.push('entry/exit signals');
  return bits.join(', ');
}
