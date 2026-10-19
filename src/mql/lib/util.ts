// Shared helpers for the MQL standard library runtime.
import { MqlArray, type Env, type Ref, type Rt } from '../contract.ts';
import type { Bar } from '../../data.ts';

export const isRef = (x: unknown): x is Ref => !!x && typeof x === 'object' && !(x instanceof MqlArray) && 'v' in x && Object.keys(x).length === 1;
/** Value of a possibly-Ref argument. */
export const val = <T = unknown>(x: unknown): T => (isRef(x) ? x.v : x) as T;
/** Write to a Ref argument (no-op for plain values). */
export const put = (x: unknown, v: unknown) => { if (isRef(x)) x.v = v };
export const num = (x: unknown) => { const v = val(x); return typeof v === 'number' ? v : typeof v === 'boolean' ? +v : Number(v) || 0 };

export const DBL_MAX = 1.7976931348623157e308;
export const emptyValue = (env: Env) => (env.dialect === 'mql4' ? 2147483647 : DBL_MAX);
/** WHOLE_ARRAY / missing count test (MQL4 WHOLE_ARRAY = 0, MQL5 = -1). */
export const isWhole = (env: Env, n: unknown) => n == null || (n as number) < 0 || (env.dialect === 'mql4' && n === 0);

/** Default string conversion (Print, concatenation of non-strings). */
export function str(x: unknown): string {
  x = val(x);
  if (typeof x === 'string') return x;
  if (typeof x === 'boolean') return x ? 'true' : 'false';
  if (typeof x === 'number') {
    if (Number.isNaN(x)) return 'nan';
    if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
    if (Number.isInteger(x)) return String(x === 0 ? 0 : x);
    return String(parseFloat(x.toPrecision(16)));
  }
  if (typeof x === 'bigint') return x.toString();
  if (x == null) return '';
  return String(x);
}

/** MQL timeframe value → seconds (0 = chart timeframe). */
export function tfToSec(env: Env, tf: unknown): number {
  const v = num(tf);
  if (!v) return env.tfSec;
  if (env.dialect === 'mql4') return v * 60;
  if ((v & 0xc000) === 0xc000) return (v & 0x3fff) * 2592000;
  if (v & 0x8000) return (v & 0x3fff) * 604800;
  if (v & 0x4000) return (v & 0x3fff) * 3600;
  return v * 60;
}
/** Seconds → MQL timeframe value (MQL4 minutes, MQL5 ENUM_TIMEFRAMES encoding). */
export function secToTf(env: Env, sec: number): number {
  if (env.dialect === 'mql4') return sec / 60;
  if (sec >= 2592000 && sec % 2592000 === 0) return 0xc000 | (sec / 2592000);
  if (sec >= 604800 && sec % 604800 === 0) return 0x8000 | (sec / 604800);
  if (sec >= 3600 && sec % 3600 === 0) return 0x4000 | (sec / 3600);
  return sec / 60;
}

/** A bar source (chart or other symbol/timeframe) with lookahead-safe current index. */
export interface Src { bar(i: number): Bar; cur(): number; time(i: number): number }

const lastLE = (bars: Bar[], t: number) => { let lo = 0, hi = bars.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { r = m; lo = m + 1 } else hi = m - 1 } return r };

export function sources(env: Env) {
  const chart: Src = { bar: i => env.bars[i], cur: () => env.cur(), time: i => env.bars[i]?.time ?? 0 };
  const cache = new Map<string, Src>();
  return (symbol: unknown, tf: unknown): Src => {
    const s = val<string>(symbol), sym = !s || s === '0' || s === env.symbol ? env.symbol : String(s), sec = tfToSec(env, tf);
    if (sym === env.symbol && sec === env.tfSec) return chart;
    const key = `${sym}|${sec}`;
    let src = cache.get(key);
    if (!src) {
      let bars: Bar[] = [], last = -2, live: Bar | null = null;
      const refresh = () => {
        if (!bars.length || env.now() >= bars[bars.length - 1].time + sec) bars = env.barsFor(sym, sec);
        const k = lastLE(bars, env.now());
        // Current higher-timeframe bar: rebuild from closed+current chart bars so its future part never leaks.
        live = null;
        if (k >= 0 && sym === env.symbol && sec > env.tfSec) {
          const B = bars[k], c = env.cur();
          let j = c; while (j > 0 && env.bars[j - 1].time >= B.time) j--;
          if (c >= 0 && env.bars[j].time >= B.time) {
            live = { time: B.time, open: env.bars[j].open, high: -Infinity, low: Infinity, close: env.bars[c].close, volume: 0 };
            for (let q = j; q <= c; q++) { const b = env.bars[q]; live.high = Math.max(live.high, b.high); live.low = Math.min(live.low, b.low); live.volume += b.volume }
          }
        }
        last = k;
      };
      src = {
        cur: () => { refresh(); return last },
        bar: i => (i === last && live ? live : bars[i]),
        time: i => bars[i]?.time ?? 0,
      };
      cache.set(key, src);
    }
    return src;
  };
}
export type Sources = ReturnType<typeof sources>;

/** Last index <= cur whose time <= t (-1 if none). */
export function idxAt(s: Src, t: number): number {
  let lo = 0, hi = s.cur(), r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.time(m) <= t) { r = m; lo = m + 1 } else hi = m - 1 }
  return r;
}
/** Datetime vs position heuristic for Copy* overloads (positions never reach 1e8). */
export const isTime = (x: unknown) => typeof x === 'number' && x >= 1e8;

export const getter = (rt: Rt, name: string, get: () => unknown) => Object.defineProperty(rt, name, { get, configurable: true, enumerable: true });
export const setErr = (rt: Rt, code: number) => { rt.__err = code };
