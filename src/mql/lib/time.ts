// Date/time functions. Datetime = seconds since 1970 (server time = env.now()).
import type { Env, Rt } from '../contract.ts';
import { num, setErr, secToTf, tfToSec, getter, val } from './util.ts';

const D = (t: number) => new Date(Math.trunc(num(t)) * 1000);
const p2 = (n: number) => String(n).padStart(2, '0');
export function timeToString(t: number, flags = 3): string {
  const d = D(t), out: string[] = [];
  if (flags & 1) out.push(`${d.getUTCFullYear()}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}`);
  if (flags & 4) out.push(`${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`);
  else if (flags & 2) out.push(`${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`);
  return out.join(' ');
}
/** Parses "yyyy.mm.dd [hh:mi[:ss]]", "yyyymmdd [hh:mi]" or "hh:mi[:ss]" (today); null if invalid. */
export function parseTime(s: string, now: number): number | null {
  s = String(s).trim();
  let m = s.match(/^(\d{4})[.\-/]?(\d{1,2})[.\-/]?(\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) / 1000;
  m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return Math.floor(now / 86400) * 86400 + +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0);
  return null;
}
const doy = (d: Date) => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);

export function installTime(rt: Rt, env: Env) {
  const now = () => env.now();
  const fill = (s: unknown, t: number) => {
    const o = val<Record<string, number> | undefined>(s); if (!o || typeof o !== 'object') return;
    const d = D(t);
    Object.assign(o, { year: d.getUTCFullYear(), mon: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), min: d.getUTCMinutes(), sec: d.getUTCSeconds(), day_of_week: d.getUTCDay(), day_of_year: doy(d) });
  };
  const withStruct = (s?: unknown) => { const t = now(); if (s) fill(s, t); return t };
  const part = (f: (d: Date) => number) => (t: number) => f(D(t));
  const Y = part(d => d.getUTCFullYear()), Mo = part(d => d.getUTCMonth() + 1), Dd = part(d => d.getUTCDate()), H = part(d => d.getUTCHours()),
    Mi = part(d => d.getUTCMinutes()), S = part(d => d.getUTCSeconds()), W = part(d => d.getUTCDay()), DY = part(d => doy(d) + 1);
  Object.assign(rt, {
    TimeCurrent: withStruct, TimeLocal: withStruct, TimeGMT: withStruct, TimeTradeServer: withStruct,
    TimeDaylightSavings: () => 0, TimeGMTOffset: () => 0,
    TimeToStruct: (t: number, s: unknown) => { fill(s, t); return true },
    StructToTime: (s: Record<string, number>) => { const o = val<Record<string, number>>(s); return Date.UTC(o.year, (o.mon || 1) - 1, o.day || 1, o.hour || 0, o.min || 0, o.sec || 0) / 1000 },
    TimeToString: timeToString, TimeToStr: timeToString,
    StringToTime: (s: string) => { const t = parseTime(val(s), now()); if (t == null) { setErr(rt, env.dialect === 'mql4' ? 4051 : 5031); return 0 } return t },
    StrToTime: (s: string) => parseTime(val(s), now()) ?? 0,
    Year: () => Y(now()), Month: () => Mo(now()), Day: () => Dd(now()), Hour: () => H(now()), Minute: () => Mi(now()), Seconds: () => S(now()),
    DayOfWeek: () => W(now()), DayOfYear: () => DY(now()),
    TimeYear: Y, TimeMonth: Mo, TimeDay: Dd, TimeHour: H, TimeMinute: Mi, TimeSeconds: S, TimeDayOfWeek: W, TimeDayOfYear: DY,
    Period: () => secToTf(env, env.tfSec), Symbol: () => env.symbol,
    PeriodSeconds: (tf = 0) => tfToSec(env, tf),
    GetTickCount: () => Math.trunc(performance.now()) >>> 0, GetTickCount64: () => Math.trunc(performance.now()), GetMicrosecondCount: () => Math.trunc(performance.now() * 1000),
    Sleep: () => {},
  });
  getter(rt, '_Period', () => secToTf(env, env.tfSec));
  getter(rt, '_Symbol', () => env.symbol);
}
