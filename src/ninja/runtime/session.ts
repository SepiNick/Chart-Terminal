// Trading-hours templates: which bars belong to which session (trading day), for Bars.IsFirstBarOfSession,
// SessionIterator and exit-on-session-close. Times are exchange-local (IANA time zone, DST via Intl).
// Bars outside the session are still processed (the chart keeps them); they just belong to no session.
import type { Bar } from '../../data.ts';
import { NtDateTime } from './helpers.ts';

export interface Session { name: string; start: number; end: number; tz: string }   // start/end in local minutes; end <= start = overnight
export const DEFAULT_SESSION = 'Default 24 x 7';
export const TEMPLATES: Record<string, Omit<Session, 'name'> | null> = {
  [DEFAULT_SESSION]: null,
  'CME US Index Futures RTH': { start: 510, end: 915, tz: 'America/Chicago' },
  'CME US Index Futures ETH': { start: 1020, end: 960, tz: 'America/Chicago' },
  'CME FX Futures ETH': { start: 1020, end: 960, tz: 'America/Chicago' },
  'US Equities RTH': { start: 570, end: 960, tz: 'America/New_York' },
  'US Equities ETH': { start: 240, end: 1200, tz: 'America/New_York' },
  'Forex': { start: 1020, end: 1020, tz: 'America/New_York' },
  'EUREX Futures RTH': { start: 480, end: 1320, tz: 'Europe/Berlin' },
};

/** Template name, or a custom "HH:mm-HH:mm[ Time/Zone]" (UTC when no zone); null = 24/7 calendar days (UTC). */
export function parseSession(s?: unknown): Session | null {
  const name = String(s ?? '').trim();
  if (!name || name === DEFAULT_SESSION || /^24\s*[x/]\s*7$/i.test(name)) return null;
  const t = Object.entries(TEMPLATES).find(([k]) => k.toLowerCase() === name.toLowerCase());
  if (t) return t[1] ? { name: t[0], ...t[1] } : null;
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?:\s+(\S+))?$/.exec(name);
  if (!m) throw new Error(`Unknown trading hours template '${name}'`);
  return { name, start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4], tz: m[5] ?? 'UTC' };
}

const fmts = new Map<string, Intl.DateTimeFormat>();
/** Local calendar day (days since epoch) and minute of day of unix time t in tz. */
function local(t: number, tz: string): { day: number; min: number } {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })));
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t * 1000))) if (x.type !== 'literal') p[x.type] = +x.value;
  return { day: Date.UTC(p.year, p.month - 1, p.day) / 86400000, min: p.hour * 60 + p.minute };
}
/** Unix time of local (day, minute) in tz (two fixed-point steps cover DST changes). */
function toUtc(day: number, min: number, tz: string): number {
  const want = day * 86400 + min * 60;
  let t = want;
  for (let k = 0; k < 2; k++) { const l = local(t, tz); t += want - (l.day * 86400 + l.min * 60) }
  return t;
}
const weekend = (day: number) => { const w = new Date(day * 86400000).getUTCDay(); return w === 0 || w === 6 };

/** Trading day (days since epoch) of the session containing unix time t, or -1 outside every session. */
function tradingDay(t: number, s: Session | null): number {
  if (!s) return Math.floor(t / 86400);
  const { day, min } = local(t, s.tz), night = s.end <= s.start;
  const inside = night ? min >= s.start || min < s.end : min >= s.start && min < s.end;
  const td = night && min >= s.start ? day + 1 : day;
  return inside && !weekend(td) ? td : -1;
}
/** [begin, end) of trading day td in unix seconds. */
function bounds(td: number, s: Session | null): [number, number] {
  if (!s) return [td * 86400, (td + 1) * 86400];
  return [toUtc(s.end <= s.start ? td - 1 : td, s.start, s.tz), toUtc(td, s.end, s.tz)];
}
/** Session id (trading day or -1) of each bar, by its open time. */
export const sessionIds = (bars: Bar[], s: Session | null) => bars.map(b => tradingDay(b.time, s));
/** First session ending after t (or at t when includesEnd). */
function nextSession(t: number, s: Session | null, includesEnd = false): { td: number; begin: number; end: number } {
  const d0 = Math.floor(t / 86400) - 1;
  for (let td = d0; td < d0 + 10; td++) {
    if (s && weekend(td)) continue;
    const [begin, end] = bounds(td, s);
    if (end > t || (includesEnd && end === t)) return { td, begin, end };
  }
  const [begin, end] = bounds(d0 + 1, s);
  return { td: d0 + 1, begin, end };
}

/** NinjaScript SessionIterator over a Bars object's trading hours. */
export class SessionIterator {
  ActualSessionBegin: NtDateTime; ActualSessionEnd: NtDateTime; ActualTradingDayExchange: NtDateTime; ActualTradingDayEndLocal: NtDateTime;
  private s: Session | null;
  constructor(bars?: any) {
    this.s = bars?.__ctx?.session ?? null;
    this.ActualSessionBegin = this.ActualSessionEnd = this.ActualTradingDayExchange = this.ActualTradingDayEndLocal = new NtDateTime();
  }
  /** Session containing `time` (or the next one); sets the Actual* properties. */
  GetNextSession(time: NtDateTime, includesEndTimeStamp = false) {
    const r = nextSession(time.ms / 1000, this.s, includesEndTimeStamp), d = (x: number) => NtDateTime.of(x * 1000);
    this.ActualSessionBegin = d(r.begin); this.ActualSessionEnd = d(r.end);
    this.ActualTradingDayExchange = this.ActualTradingDayEndLocal = d(r.td * 86400);
    return true;
  }
  CalculateTradingDay(time: NtDateTime, includesEndTimeStamp = false) { return this.GetNextSession(time, includesEndTimeStamp) }
  IsInSession(time: NtDateTime, includesEndTimeStamp = true, _isBar = true) { return tradingDay(time.ms / 1000 - (includesEndTimeStamp ? 0.001 : 0), this.s) >= 0 }
  GetTradingDay(time: NtDateTime) { return NtDateTime.of(nextSession(time.ms / 1000, this.s).td * 86400000) }
}
