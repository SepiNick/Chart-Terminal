// Pure alert evaluation: no I/O, no clocks — callers pass bars, times and per-alert state. index.ts wires it to live data.
import type { Bar } from '../../src/data.ts';
import type { Alert, Condition, Frequency, LineRef } from '../../src/alerttypes.ts';
import type { Outputs } from '../../src/pine/interp.ts';

export const CONDITIONS: Condition[] = ['crossing', 'crossing_up', 'crossing_down', 'greater', 'less', 'entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel', 'moving_up', 'moving_down', 'moving_up_pct', 'moving_down_pct'];
export const FREQUENCIES: Frequency[] = ['once', 'once_per_bar', 'once_per_bar_close', 'every_time', 'once_per_minute'];
export const isChannel = (c?: Condition) => !!c && c.endsWith('_channel');
export const isMoving = (c?: Condition) => !!c && c.startsWith('moving_');

/** Price of a line at time `t` (seconds). Trend lines extrapolate linearly; outside their span only where extended. NaN = no line there. */
export function linePrice(l: LineRef, t: number): number {
  if (l.type === 'hline') return l.price;
  if (l.t1 === l.t2) return t === l.t1 ? l.p1 : NaN;
  const lo = Math.min(l.t1, l.t2), hi = Math.max(l.t1, l.t2);
  // extendLeft/Right are relative to the drawing's points as drawn (t1 → t2); map them onto earlier/later time.
  const [extEarly, extLate] = l.t1 < l.t2 ? [l.extendLeft, l.extendRight] : [l.extendRight, l.extendLeft];
  if ((t < lo && !extEarly) || (t > hi && !extLate)) return NaN;
  return l.p1 + (l.p2 - l.p1) * (t - l.t1) / (l.t2 - l.t1);
}

/** One evaluation point: value x (previous px), level(s) lo/hi now and before (plo/phi), value `bars` back for moving_*. */
export interface Sample { x: number; px?: number; lo: number; plo?: number; hi?: number; phi?: number; back?: number }

export function conditionMet(c: Condition, s: Sample, amount = 0): boolean {
  const { x, px, back } = s, ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
  if (!ok(x)) return false;
  if (isMoving(c)) {
    if (!ok(back)) return false;
    const d = x - back, pct = back ? d / Math.abs(back) * 100 : NaN;
    return c === 'moving_up' ? d >= amount : c === 'moving_down' ? -d >= amount : c === 'moving_up_pct' ? pct >= amount : -pct >= amount;
  }
  if (isChannel(c)) {
    if (!ok(s.lo) || !ok(s.hi)) return false;
    const inside = (v: number, a: number, b: number) => v >= Math.min(a, b) && v <= Math.max(a, b);
    const now = inside(x, s.lo, s.hi);
    if (c === 'inside_channel') return now;
    if (c === 'outside_channel') return !now;
    const pl = s.plo ?? s.lo, ph = s.phi ?? s.hi;
    if (!ok(px) || !ok(pl) || !ok(ph)) return false;
    const before = inside(px, pl, ph);
    return c === 'entering_channel' ? !before && now : before && !now;
  }
  if (!ok(s.lo)) return false;
  if (c === 'greater') return x > s.lo;
  if (c === 'less') return x < s.lo;
  const pl = s.plo ?? s.lo;
  if (!ok(px) || !ok(pl)) return false;
  const up = px < pl && x >= s.lo, down = px > pl && x <= s.lo;
  return c === 'crossing_up' ? up : c === 'crossing_down' ? down : up || down;
}

/** Per-alert memory between evaluations (in memory only; a restart starts fresh). */
export interface EvalState { prev?: number; plo?: number; phi?: number; firedBar?: number; lastFireAt?: number; fires: number[]; seen: Set<string> }
export const newState = (): EvalState => ({ fires: [], seen: new Set() });

/** Frequency gate for a hit on bar `barTime` at `now` (ms). once_per_bar_close hits only come from closed bars (see `pick`). */
export function frequencyAllows(f: Frequency, st: EvalState, barTime: number, now: number): boolean {
  if (f === 'once_per_bar' || f === 'once_per_bar_close') return st.firedBar !== barTime;
  if (f === 'once_per_minute') return st.lastFireAt === undefined || now - st.lastFireAt >= 60_000;
  return true;   // once (deactivated by the caller after firing) and every_time
}

/** Record a fire; returns a stop reason when auto-stop (fired more than count times within minutes) kicks in. */
export function recordFire(st: EvalState, barTime: number, now: number, auto = { count: 15, minutes: 3 }): string | undefined {
  st.firedBar = barTime; st.lastFireAt = now;
  st.fires = st.fires.filter(t => now - t < auto.minutes * 60_000);
  st.fires.push(now);
  if (st.fires.length > auto.count) return `auto-stopped: fired more than ${auto.count} times in ${auto.minutes} min`;
}

export const expired = (a: Pick<Alert, 'expires'>, now: number) => a.expires != null && now >= a.expires;

/** Which bar to evaluate: the forming one (last) or, for once_per_bar_close, the one that just closed. null = skip this update. */
export function pick(f: Frequency, bars: Bar[], closed: boolean): number | null {
  if (f === 'once_per_bar_close') return closed && bars.length >= 2 ? bars.length - 2 : null;
  return bars.length ? bars.length - 1 : null;
}

/**
 * Evaluate a price / indicator / drawing alert on bar `i`. `values` is the series the condition reads (closes or plot values),
 * `tNow` the time (seconds) at which line levels are read. Forming bar: the previous point is the previously evaluated one
 * (kept in `st`). Closed bar (pass `tPrev` = the previous bar's time): the previous point is bar i-1.
 */
export function evalLevel(a: Alert, st: EvalState, values: number[], i: number, tNow: number, tPrev?: number): boolean {
  const src = a.source, x = values[i];
  const levels = (t: number): [number, number | undefined] => src.kind === 'drawing'
    ? [linePrice(src.line, t), src.line2 ? linePrice(src.line2, t) : undefined]
    : [a.value ?? NaN, a.value2];
  const [lo, hi] = levels(tNow);
  const s: Sample = { x, lo, hi, back: values[i - Math.max(1, a.bars ?? 1)] };
  if (tPrev !== undefined) { s.px = values[i - 1]; [s.plo, s.phi] = levels(tPrev) }
  else { s.px = st.prev; s.plo = st.plo; s.phi = st.phi }
  st.prev = x; st.plo = lo; st.phi = hi;
  return conditionMet(a.condition!, s, a.value ?? 0);
}

// Price is left out on purpose: a fill on the forming bar (process_orders_on_close) may move while the bar forms.
const fillKey = (f: { time: number; id: string; side: string }) => `${f.time}|${f.id}|${f.side}`;

type Deal = { time: number; type: string; volume: number; price?: number; comment?: string; ticket?: number };
/** The strategy's fills as MQL deals / NinjaScript executions; undefined for Pine and non-strategies. */
export const dealsOf = (out: Outputs) => (out as Outputs & { mqlDeals?: Deal[] }).mqlDeals;
const seenOnce = (st: EvalState, k: string) => {
  if (st.seen.has(k)) return false;
  st.seen.add(k); if (st.seen.size > 500) st.seen.delete(st.seen.values().next().value!);
  return true;
};

/**
 * Script events on bar `i` (time `barTime`): alertcondition[index] fired, alert() calls (Pine alert(), MQL / NinjaScript
 * Alert()), or strategy fills (Pine broker fills, MQL deals, NinjaScript executions; each fill fires once).
 */
export function scriptHits(a: Alert, st: EvalState, out: Outputs, i: number, closedMode: boolean, barTime = -Infinity): { message?: string; vars: Record<string, string> }[] {
  const src = a.source;
  if (src.kind !== 'script') return [];
  if (src.event === 'alertcondition') {
    const ac = out.alertconditions[src.index ?? 0];
    return ac?.fired[i] ? [{ message: ac.message || ac.title, vars: {} }] : [];
  }
  if (src.event === 'alert') {
    return out.alerts.filter(x => x.bar === i && (closedMode || !x.freq.includes('close'))).map(x => ({ message: x.message, vars: {} }));
  }
  const deals = dealsOf(out);
  if (!out.broker && deals) return deals.filter(d => (d.type === 'buy' || d.type === 'sell') && d.time >= barTime && seenOnce(st, `${d.time}|${d.ticket ?? ''}|${d.type}|${d.volume}`))
    .map(d => ({ message: d.comment || undefined, vars: { 'strategy.order.action': d.type, 'strategy.order.contracts': String(d.volume), 'strategy.order.price': d.price != null ? String(d.price) : '', 'strategy.order.comment': d.comment ?? '' } }));
  const pos = out.broker?.positionSize ?? 0;
  return (out.broker?.fills ?? []).filter(f => f.bar >= i && seenOnce(st, fillKey(f))).map(f => ({ message: f.comment || undefined, vars: { 'strategy.order.action': f.side, 'strategy.order.contracts': String(f.qty), 'strategy.order.price': String(f.price), 'strategy.order.id': f.id, 'strategy.order.comment': f.comment, 'strategy.position_size': String(pos) } }));
}

// Same contract as notify's `render` (§4); kept local so this module stays pure (importing notify would open the database).
/** Replace {{name}} placeholders; unknown names stay as they are. */
export const render = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);

/** Placeholder values for a fire on bar i. */
export function barVars(a: Alert, bars: Bar[], i: number, now: number, out?: Outputs): Record<string, string> {
  const b = bars[i], c = a.sym.indexOf(':');
  const v: Record<string, string> = {
    ticker: c < 0 ? a.sym : a.sym.slice(c + 1), exchange: c < 0 ? 'BINANCE' : a.sym.slice(0, c), interval: a.tf,
    open: String(b.open), high: String(b.high), low: String(b.low), close: String(b.close), volume: String(b.volume),
    time: new Date(b.time * 1000).toISOString(), timenow: new Date(now).toISOString(),
  };
  out?.plots.forEach((p, n) => { const x = p.values[i]; if (x !== undefined && x !== null && Number.isFinite(x)) v[`plot_${n}`] = String(x) });
  return v;
}
