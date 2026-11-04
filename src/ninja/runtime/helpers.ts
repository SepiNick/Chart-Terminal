// .NET flavoured helpers for compiled NinjaScript: indexing, formatting, casts, Math, List, Dictionary, DateTime, TimeSpan.
// Formatting follows .NET Framework (NinjaTrader 8's runtime) with the en-US culture.
export class NtError extends Error {}
export interface Ref<T = unknown> { v: T }

// ---------- enums (string-valued; registry keeps member order for (int) casts) ----------
const ENUMS = new Map<string, string[]>();
export function en(name: string, ...members: string[]): Readonly<Record<string, string>> {
  ENUMS.set(name.toLowerCase(), members);
  return Object.freeze(Object.fromEntries(members.map(m => [m, m])));
}
const enumIndex = (s: string) => { for (const m of ENUMS.values()) { const i = m.indexOf(s); if (i >= 0) return i } return NaN };
export const DayOfWeek = en('DayOfWeek', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday');
export const MidpointRounding = en('MidpointRounding', 'ToEven', 'AwayFromZero', 'ToZero', 'ToNegativeInfinity', 'ToPositiveInfinity');

// ---------- number formatting ----------
/** |x| rounded half away from zero to `frac` decimals via its 15 significant digits (.NET Framework behaviour). */
function toDec(x: number, frac: number): string {
  const [m, e] = Math.abs(x).toExponential(14).split('e');
  let d = m.replace('.', ''), exp = +e + 1;
  if (exp <= 0) { d = '0'.repeat(1 - exp) + d; exp = 1 }
  d = d.padEnd(exp + frac + 1, '0');
  const keep = d.slice(0, exp + frac).split('').map(Number);
  if (+d[exp + frac] >= 5) {
    let i = keep.length - 1;
    while (i >= 0 && ++keep[i] === 10) keep[i--] = 0;
    if (i < 0) { keep.unshift(1); exp++ }
  }
  const s = keep.join(''), ip = s.slice(0, exp).replace(/^0+(?=\d)/, '') || '0';
  return frac ? ip + '.' + s.slice(exp) : ip;
}
const group = (s: string) => s.replace(/^(\d+)/, ip => ip.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const signed = (neg: boolean, s: string) => (neg && /[1-9]/.test(s) ? '-' + s : s);
const expStr = (e: number, digits: number, ch = 'E') => ch + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(digits, '0');

function general(v: number, p = 15, ch = 'E'): string {
  if (v === 0) return '0';
  const [m, es] = Math.abs(v).toExponential(p - 1).split('e'), e = +es;
  let out: string;
  if (e < -5 || e >= p) out = m.replace(/\.?0+$/, '') + expStr(e, 2, ch);
  else out = Number(m + 'e' + e).toFixed(Math.max(0, p - 1 - e)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return v < 0 ? '-' + out : out;
}
function sci(v: number, p: number, ch: string, digits: number) {
  if (v === 0) return toDec(0, p) + expStr(0, digits, ch);
  let e = Math.floor(Math.log10(Math.abs(v))), m = toDec(Math.abs(v) / 10 ** e, p);
  if (m.startsWith('10')) { e++; m = toDec(Math.abs(v) / 10 ** e, p) }
  return signed(v < 0, m) + expStr(e, digits, ch);
}

function splitSections(f: string): string[] {
  const out: string[] = []; let cur = '', q = '';
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (q) { cur += c; if (c === q) q = ''; continue }
    if (c === '\\') { cur += c + (f[++i] ?? ''); continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === ';') { out.push(cur); cur = ''; continue }
    cur += c;
  }
  out.push(cur);
  return out;
}
type Tok = { k: 'lit'; s: string } | { k: '0' | '#' | '.' | ',' | '%' | 'E'; s: string };
function tokenize(f: string): Tok[] {
  const t: Tok[] = [];
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c === '\\') t.push({ k: 'lit', s: f[++i] ?? '' });
    else if (c === '"' || c === "'") { const j = f.indexOf(c, i + 1); t.push({ k: 'lit', s: f.slice(i + 1, j < 0 ? undefined : j) }); i = j < 0 ? f.length : j }
    else if (c === '0' || c === '#' || c === '.' || c === ',' || c === '%') t.push({ k: c, s: c });
    else if ((c === 'E' || c === 'e') && /^[+-]?0/.test(f.slice(i + 1))) { const m = /^[+-]?0+/.exec(f.slice(i + 1))!; t.push({ k: 'E', s: c + m[0] }); i += m[0].length }
    else t.push({ k: 'lit', s: c });
  }
  return t;
}
function customNum(v: number, fmt: string): string {
  const secs = splitSections(fmt);
  let f = secs[0], neg = v < 0;
  if (v < 0 && secs.length > 1 && secs[1] !== '') { f = secs[1]; neg = false }
  else if (v === 0 && secs.length > 2 && secs[2] !== '') f = secs[2];
  const t = tokenize(f);
  const dot = t.findIndex(x => x.k === '.'), eIdx = t.findIndex(x => x.k === 'E');
  const end = eIdx >= 0 ? eIdx : t.length, intEnd = dot >= 0 ? dot : end;
  const isPh = (x: Tok) => x.k === '0' || x.k === '#';
  // scaling commas (immediately before the decimal point / end) and grouping commas
  let scale = 0, j = intEnd - 1;
  while (j >= 0 && t[j].k === ',') { scale++; j-- }
  const intToks = t.slice(0, j + 1), fracToks = dot >= 0 ? t.slice(dot + 1, end) : [];
  const grouping = intToks.some((x, i) => x.k === ',' && intToks.slice(0, i).some(isPh) && intToks.slice(i).some(isPh));
  const intPh = intToks.filter(isPh), first0 = intPh.findIndex(x => x.k === '0');
  const minInt = first0 < 0 ? 0 : intPh.length - first0;
  const fracPh = fracToks.filter(isPh), maxFrac = fracPh.length;
  let minFrac = 0; fracPh.forEach((x, i) => { if (x.k === '0') minFrac = i + 1 });
  let x = Math.abs(v) / 1000 ** scale * 100 ** t.filter(q => q.k === '%').length;
  let expPart = '';
  if (eIdx >= 0 && x !== 0) {
    const tk = t[eIdx].s, digits = tk.replace(/[^0]/g, '').length, plus = tk[1] === '+';
    let e = Math.floor(Math.log10(x)) - Math.max(0, intPh.length - 1);
    x /= 10 ** e;
    if (+toDec(x, maxFrac) >= 10 ** Math.max(1, intPh.length)) { e++; x /= 10 }
    expPart = tk[0] + (e < 0 ? '-' : plus ? '+' : '') + String(Math.abs(e)).padStart(digits, '0');
  } else if (eIdx >= 0) expPart = t[eIdx].s[0] + (t[eIdx].s[1] === '+' ? '+' : '') + '0'.repeat(t[eIdx].s.replace(/[^0]/g, '').length);
  const num = toDec(x, maxFrac);
  let [ip, fp = ''] = num.split('.');
  fp = fp.replace(/0+$/, '').padEnd(minFrac, '0');
  ip = ip.replace(/^0+/, '').padStart(minInt, '0');
  if (grouping) ip = group(ip);
  // integer part: right-align digits into placeholders, extra digits go to the leftmost one
  let out = '', rest = ip;
  const lastPh = intToks.reduce((a, q, i) => (isPh(q) ? i : a), -1), firstPh = intToks.findIndex(isPh);
  for (let i = intToks.length - 1; i >= 0; i--) {
    const q = intToks[i];
    if (q.k === 'lit' || q.k === '%') out = q.s + out;
    else if (isPh(q) && !grouping) { if (i === firstPh) { out = rest + out; rest = '' } else if (rest) { out = rest.slice(-1) + out; rest = rest.slice(0, -1) } }
    else if (isPh(q) && grouping && i === lastPh) { out = ip + out; rest = '' }
  }
  if (firstPh < 0) out = rest + out;
  let fo = '', fi = 0;
  for (const q of fracToks) { if (isPh(q)) { if (fi < fp.length) fo += fp[fi]; fi++ } else if (q.k !== ',') fo += q.s }
  out += (fp.length ? '.' : '') + fo;
  if (eIdx >= 0) { out += expPart; for (const q of t.slice(end + 1)) out += q.s }
  return neg && /[1-9]/.test(num) ? '-' + out : out;
}

function fmtNum(v: number, f?: string): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
  if (!f) return Number.isInteger(v) && Math.abs(v) < 1e21 ? v.toFixed(0) : general(v);
  const m = /^([A-Za-z])(\d{0,2})$/.exec(f);
  if (!m) return customNum(v, f);
  const c = m[1], p = m[2] === '' ? undefined : +m[2], neg = v < 0, a = Math.abs(v);
  switch (c.toUpperCase()) {
    case 'C': { const s = group(toDec(a, p ?? 2)); return neg && /[1-9]/.test(s) ? `($${s})` : '$' + s }
    case 'D': return signed(neg, String(Math.trunc(a)).padStart(p ?? 0, '0'));
    case 'E': return sci(v, p ?? 6, c, 3);
    case 'F': return signed(neg, toDec(a, p ?? 2));
    case 'G': return general(v, p || 15, c === 'g' ? 'e' : 'E');
    case 'N': return signed(neg, group(toDec(a, p ?? 2)));
    case 'P': return signed(neg, group(toDec(a * 100, p ?? 2))) + ' %';
    case 'R': return String(v).replace('e', 'E');
    case 'X': { const s = (v < 0 ? (2 ** 32 + Math.trunc(v)) : Math.trunc(v)).toString(16).padStart(p ?? 0, '0'); return c === 'X' ? s.toUpperCase() : s }
  }
  return customNum(v, f);
}

// ---------- DateTime / TimeSpan ----------
const MS_DAY = 86400000, EPOCH_TICKS = 621355968000000000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) {
  const dt = new Date(0); dt.setUTCFullYear(y, mo - 1, d); dt.setUTCHours(h, mi, s, ms); return dt.getTime();
}
const DSTD: Record<string, string> = {
  d: 'M/d/yyyy', D: 'dddd, MMMM d, yyyy', t: 'h:mm tt', T: 'h:mm:ss tt', f: 'dddd, MMMM d, yyyy h:mm tt', F: 'dddd, MMMM d, yyyy h:mm:ss tt',
  g: 'M/d/yyyy h:mm tt', G: 'M/d/yyyy h:mm:ss tt', s: "yyyy'-'MM'-'dd'T'HH':'mm':'ss", u: "yyyy'-'MM'-'dd HH':'mm':'ss'Z'",
  o: "yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffff", O: "yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffff", M: 'MMMM d', m: 'MMMM d', Y: 'MMMM yyyy', y: 'MMMM yyyy',
  r: "ddd, dd MMM yyyy HH':'mm':'ss 'GMT'", R: "ddd, dd MMM yyyy HH':'mm':'ss 'GMT'",
};
function fmtDate(dt: NtDateTime, f?: string): string {
  if (!f) f = 'G';
  if (f.length === 1) f = DSTD[f] ?? f;
  else if (f[0] === '%') f = f.slice(1);
  const d = new Date(dt.ms), Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds(), ms = d.getUTCMilliseconds();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return f.replace(/'[^']*'|"[^"]*"|\\.|d{1,4}|M{1,4}|y{1,5}|H{1,2}|h{1,2}|m{1,2}|s{1,2}|f{1,7}|F{1,7}|t{1,2}|z{1,3}|K/g, (t: string) => {
    if (t[0] === "'" || t[0] === '"') return t.slice(1, -1);
    if (t[0] === '\\') return t[1];
    const n = t.length;
    switch (t[0]) {
      case 'd': return n === 1 ? String(D) : n === 2 ? p2(D) : n === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()];
      case 'M': return n === 1 ? String(M + 1) : n === 2 ? p2(M + 1) : n === 3 ? MONTHS[M].slice(0, 3) : MONTHS[M];
      case 'y': return n === 1 ? String(Y % 100) : n === 2 ? p2(Y % 100) : String(Y).padStart(n, '0');
      case 'H': return n === 1 ? String(h) : p2(h);
      case 'h': return n === 1 ? String(h % 12 || 12) : p2(h % 12 || 12);
      case 'm': return n === 1 ? String(mi) : p2(mi);
      case 's': return n === 1 ? String(s) : p2(s);
      case 'f': return String(ms).padStart(3, '0').padEnd(7, '0').slice(0, n);
      case 'F': return String(ms).padStart(3, '0').padEnd(7, '0').slice(0, n).replace(/0+$/, '');
      case 't': return n === 1 ? (h < 12 ? 'A' : 'P') : h < 12 ? 'AM' : 'PM';
      case 'z': return n === 3 ? '+00:00' : n === 2 ? '+00' : '+0';
      default: return '';   // K: unspecified kind
    }
  });
}

export class NtTimeSpan {
  ms: number;
  constructor(...a: number[]) {
    this.ms = a.length === 0 ? 0 : a.length === 1 ? a[0] / 1e4 : a.length === 3 ? ((a[0] * 60 + a[1]) * 60 + a[2]) * 1000
      : (((a[0] * 24 + a[1]) * 60 + a[2]) * 60 + a[3]) * 1000 + (a[4] ?? 0);
  }
  static of(ms: number) { const t = new NtTimeSpan(); t.ms = ms; return t }
  static FromDays(n: number) { return NtTimeSpan.of(n * MS_DAY) }
  static FromHours(n: number) { return NtTimeSpan.of(n * 3600000) }
  static FromMinutes(n: number) { return NtTimeSpan.of(n * 60000) }
  static FromSeconds(n: number) { return NtTimeSpan.of(n * 1000) }
  static FromMilliseconds(n: number) { return NtTimeSpan.of(n) }
  static FromTicks(n: number) { return NtTimeSpan.of(n / 1e4) }
  static get Zero() { return NtTimeSpan.of(0) }
  static get MaxValue() { return NtTimeSpan.of(922337203685477) }
  static get MinValue() { return NtTimeSpan.of(-922337203685477) }
  static Parse(s: string) {
    const m = /^\s*(-)?(?:(\d+)\.)?(\d+):(\d+)(?::(\d+)(?:\.(\d+))?)?\s*$/.exec(s);
    if (!m) throw new NtError(`String '${s}' was not recognized as a valid TimeSpan.`);
    const t = new NtTimeSpan(+(m[2] ?? 0), +m[3], +m[4], +(m[5] ?? 0), m[6] ? +('0.' + m[6]) * 1000 : 0);
    if (m[1]) t.ms = -t.ms;
    return t;
  }
  private part(div: number, mod: number) { return Math.trunc(this.ms / div) % mod }
  get Days() { return Math.trunc(this.ms / MS_DAY) }
  get Hours() { return this.part(3600000, 24) }
  get Minutes() { return this.part(60000, 60) }
  get Seconds() { return this.part(1000, 60) }
  get Milliseconds() { return this.part(1, 1000) }
  get Ticks() { return this.ms * 1e4 }
  get TotalDays() { return this.ms / MS_DAY }
  get TotalHours() { return this.ms / 3600000 }
  get TotalMinutes() { return this.ms / 60000 }
  get TotalSeconds() { return this.ms / 1000 }
  get TotalMilliseconds() { return this.ms }
  Add(t: NtTimeSpan) { return NtTimeSpan.of(this.ms + t.ms) }
  Subtract(t: NtTimeSpan) { return NtTimeSpan.of(this.ms - t.ms) }
  Negate() { return NtTimeSpan.of(-this.ms) }
  Duration() { return NtTimeSpan.of(Math.abs(this.ms)) }
  CompareTo(t: NtTimeSpan) { return Math.sign(this.ms - t.ms) }
  Equals(t: NtTimeSpan) { return t instanceof NtTimeSpan && t.ms === this.ms }
  valueOf() { return this.ms }
  toString() { return this.ToString() }
  ToString(f?: string): string {
    const a = Math.abs(this.ms), p2 = (n: number) => String(n).padStart(2, '0');
    const D = Math.floor(a / MS_DAY), H = Math.floor(a / 3600000) % 24, M = Math.floor(a / 60000) % 60, S = Math.floor(a / 1000) % 60, F = a % 1000;
    if (!f || f === 'c' || f === 'g' || f === 'G') {
      return (this.ms < 0 ? '-' : '') + (D ? D + '.' : '') + `${p2(H)}:${p2(M)}:${p2(S)}` + (F ? '.' + String(F * 1e4).padStart(7, '0') : '');
    }
    return f.replace(/'[^']*'|\\.|d+|h{1,2}|m{1,2}|s{1,2}|f{1,7}|F{1,7}/g, t =>
      t[0] === "'" ? t.slice(1, -1) : t[0] === '\\' ? t[1] : t[0] === 'd' ? String(D).padStart(t.length, '0')
        : t[0] === 'h' ? (t.length === 2 ? p2(H) : String(H)) : t[0] === 'm' ? (t.length === 2 ? p2(M) : String(M))
          : t[0] === 's' ? (t.length === 2 ? p2(S) : String(S)) : String(F).padStart(3, '0').padEnd(7, '0').slice(0, t.length));
  }
}

/** DateTime with unspecified kind: the UTC fields of `ms` are its wall-clock fields. */
export class NtDateTime {
  ms: number;
  constructor(...a: number[]) {
    this.ms = a.length === 0 ? -62135596800000 : a.length === 1 ? (a[0] - EPOCH_TICKS) / 1e4 : utc(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
  }
  static of(ms: number) { const d = new NtDateTime(); d.ms = ms; return d }
  static get Now() { const n = new Date(); return NtDateTime.of(n.getTime() - n.getTimezoneOffset() * 60000) }
  static get UtcNow() { return NtDateTime.of(Date.now()) }
  static get Today() { return NtDateTime.Now.Date }
  static get MinValue() { return NtDateTime.of(-62135596800000) }
  static get MaxValue() { return NtDateTime.of(253402300799999) }
  static Parse(s: string) {
    const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s) ?? /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i.exec(s);
    if (!m) throw new NtError(`String '${s}' was not recognized as a valid DateTime.`);
    if (m[1].length === 4) return new NtDateTime(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    let h = +(m[4] ?? 0); if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return new NtDateTime(+m[3], +m[1], +m[2], h, +(m[5] ?? 0), +(m[6] ?? 0));
  }
  static TryParse(s: string, r: Ref) { try { r.v = NtDateTime.Parse(s); return true } catch { r.v = NtDateTime.MinValue; return false } }
  static Compare(a: NtDateTime, b: NtDateTime) { return Math.sign(a.ms - b.ms) }
  static DaysInMonth(y: number, m: number) { return new Date(utc(y, m + 1, 0)).getUTCDate() }
  static IsLeapYear(y: number) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 }
  static SpecifyKind(d: NtDateTime) { return d }
  private get d() { return new Date(this.ms) }
  get Year() { return this.d.getUTCFullYear() }
  get Month() { return this.d.getUTCMonth() + 1 }
  get Day() { return this.d.getUTCDate() }
  get Hour() { return this.d.getUTCHours() }
  get Minute() { return this.d.getUTCMinutes() }
  get Second() { return this.d.getUTCSeconds() }
  get Millisecond() { return this.d.getUTCMilliseconds() }
  get DayOfWeek() { return DAYS[this.d.getUTCDay()] }
  get DayOfYear() { return Math.floor((this.ms - utc(this.Year, 1, 1)) / MS_DAY) + 1 }
  get Date() { return NtDateTime.of(Math.floor(this.ms / MS_DAY) * MS_DAY) }
  get TimeOfDay() { return NtTimeSpan.of(this.ms - Math.floor(this.ms / MS_DAY) * MS_DAY) }
  get Ticks() { return this.ms * 1e4 + EPOCH_TICKS }
  get Kind() { return 'Unspecified' }
  AddMilliseconds(n: number) { return NtDateTime.of(this.ms + n) }
  AddSeconds(n: number) { return NtDateTime.of(this.ms + n * 1000) }
  AddMinutes(n: number) { return NtDateTime.of(this.ms + n * 60000) }
  AddHours(n: number) { return NtDateTime.of(this.ms + n * 3600000) }
  AddDays(n: number) { return NtDateTime.of(this.ms + n * MS_DAY) }
  AddTicks(n: number) { return NtDateTime.of(this.ms + n / 1e4) }
  AddMonths(n: number) {
    const d = this.d, m = d.getUTCMonth() + n, y = d.getUTCFullYear() + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    const day = Math.min(d.getUTCDate(), NtDateTime.DaysInMonth(y, mm + 1));
    return NtDateTime.of(utc(y, mm + 1, day) + (this.ms - Math.floor(this.ms / MS_DAY) * MS_DAY));
  }
  AddYears(n: number) { return this.AddMonths(12 * n) }
  Add(t: NtTimeSpan) { return NtDateTime.of(this.ms + t.ms) }
  Subtract(x: NtDateTime | NtTimeSpan): NtDateTime | NtTimeSpan { return x instanceof NtDateTime ? NtTimeSpan.of(this.ms - x.ms) : NtDateTime.of(this.ms - x.ms) }
  CompareTo(o: NtDateTime) { return Math.sign(this.ms - o.ms) }
  Equals(o: NtDateTime) { return o instanceof NtDateTime && o.ms === this.ms }
  ToShortDateString() { return fmtDate(this, 'd') }
  ToShortTimeString() { return fmtDate(this, 't') }
  ToLongDateString() { return fmtDate(this, 'D') }
  ToLongTimeString() { return fmtDate(this, 'T') }
  ToString(f?: string) { return fmtDate(this, f) }
  valueOf() { return this.ms }
  toString() { return this.ToString() }
}

/** value.ToString(format) for any value. */
export function fmt(v: unknown, f?: string): string {
  if (v == null) return '';
  if (typeof v === 'number') return fmtNum(v, f);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string') return v;
  if (v instanceof NtDateTime || v instanceof NtTimeSpan) return v.ToString(f);
  const o = v as { ToString?: (f?: string) => string };
  return typeof o.ToString === 'function' ? o.ToString(f) : String(v);
}
/** string.Format composite formatting: {index[,alignment][:format]} with {{ }} escapes. */
export function format(f: string, ...rest: unknown[]): string {
  const args = rest.length === 1 && Array.isArray(rest[0]) ? rest[0] as unknown[] : rest;
  return String(f).replace(/\{\{|\}\}|\{(\d+)(?:\s*,\s*(-?\d+))?(?::([^}]*))?\}/g, (m, i, al, ff) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    if (+i >= args.length) throw new NtError('Index (zero based) must be greater than or equal to zero and less than the size of the argument list.');
    const s = fmt(args[+i], ff);
    return al == null ? s : +al < 0 ? s.padEnd(-al) : s.padStart(+al);
  });
}

// ---------- collections ----------
const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);
export class NtList<T = any> extends Array<T> {
  static get [Symbol.species]() { return Array }
  constructor(init?: unknown) {
    super();
    if (init != null && typeof init === 'object' && Symbol.iterator in init) for (const x of init as Iterable<T>) this.push(x);
  }
  get Count() { return this.length }
  get Capacity() { return this.length }
  set Capacity(_: number) { }
  private chk(i: number) { if (!(i >= 0 && i < this.length)) throw new NtError('Index was out of range. Must be non-negative and less than the size of the collection.') }
  __item(i: number) { this.chk(i); return this[i] }
  __setItem(i: number, v: T) { this.chk(i); this[i] = v }
  Add(x: T) { this.push(x) }
  AddRange(xs: Iterable<T>) { for (const x of xs) this.push(x) }
  Insert(i: number, x: T) { this.splice(i, 0, x) }
  InsertRange(i: number, xs: Iterable<T>) { this.splice(i, 0, ...xs) }
  Remove(x: T) { const i = this.IndexOf(x); if (i < 0) return false; this.splice(i, 1); return true }
  RemoveAt(i: number) { this.chk(i); this.splice(i, 1) }
  RemoveRange(i: number, n: number) { this.splice(i, n) }
  RemoveAll(p: (x: T) => boolean) { let n = 0; for (let i = this.length - 1; i >= 0; i--) if (p(this[i])) { this.splice(i, 1); n++ } return n }
  Clear() { this.length = 0 }
  Contains(x: T) { return this.IndexOf(x) >= 0 }
  IndexOf(x: T, start = 0) { for (let i = start; i < this.length; i++) if (eq(this[i], x)) return i; return -1 }
  LastIndexOf(x: T) { for (let i = this.length - 1; i >= 0; i--) if (eq(this[i], x)) return i; return -1 }
  Sort(c?: (a: T, b: T) => number) { this.sort(c ?? cmp); }
  Reverse(i?: number, n?: number) { if (i == null) this.reverse(); else this.splice(i, n!, ...this.slice(i, i + n!).reverse()) }
  ToArray() { return Array.from(this) }
  ToList() { return new NtList<T>(this) }
  GetRange(i: number, n: number) { return new NtList<T>(this.slice(i, i + n)) }
  Find(p: (x: T) => boolean) { return this.find(p) ?? null }
  FindLast(p: (x: T) => boolean) { return this.findLast(p) ?? null }
  FindIndex(p: (x: T) => boolean) { return this.findIndex(p) }
  FindLastIndex(p: (x: T) => boolean) { return this.findLastIndex(p) }
  FindAll(p: (x: T) => boolean) { return new NtList<T>(this.filter(p)) }
  Exists(p: (x: T) => boolean) { return this.some(p) }
  TrueForAll(p: (x: T) => boolean) { return this.every(p) }
  ForEach(f: (x: T) => void) { for (const x of [...this]) f(x) }
  // LINQ-style
  private sel(f?: (x: T) => number): number[] { return this.map(x => (f ? f(x) : x as unknown as number)) }
  Sum(f?: (x: T) => number) { return this.sel(f).reduce((a, b) => a + b, 0) }
  Max(f?: (x: T) => number) { if (!this.length) throw new NtError('Sequence contains no elements'); return Math.max(...this.sel(f)) }
  Min(f?: (x: T) => number) { if (!this.length) throw new NtError('Sequence contains no elements'); return Math.min(...this.sel(f)) }
  Average(f?: (x: T) => number) { if (!this.length) throw new NtError('Sequence contains no elements'); return this.Sum(f) / this.length }
  Any(p?: (x: T) => boolean) { return p ? this.some(p) : this.length > 0 }
  All(p: (x: T) => boolean) { return this.every(p) }
  Where(p: (x: T) => boolean) { return new NtList<T>(this.filter(p)) }
  Select<U>(f: (x: T, i: number) => U) { return new NtList<U>(this.map(f)) }
  First(p?: (x: T) => boolean) { const r = p ? this.filter(p) : this; if (!r.length) throw new NtError('Sequence contains no elements'); return r[0] }
  FirstOrDefault(p?: (x: T) => boolean) { const r = p ? this.filter(p) : this; return r.length ? r[0] : null }
  Last(p?: (x: T) => boolean) { const r = p ? this.filter(p) : this; if (!r.length) throw new NtError('Sequence contains no elements'); return r[r.length - 1] }
  LastOrDefault(p?: (x: T) => boolean) { const r = p ? this.filter(p) : this; return r.length ? r[r.length - 1] : null }
  OrderBy(f: (x: T) => any) { return new NtList<T>([...this].sort((a, b) => cmp(f(a), f(b)))) }
  OrderByDescending(f: (x: T) => any) { return new NtList<T>([...this].sort((a, b) => cmp(f(b), f(a)))) }
  Take(n: number) { return new NtList<T>(this.slice(0, n)) }
  Skip(n: number) { return new NtList<T>(this.slice(n)) }
  Distinct() { return new NtList<T>([...new Set(this)]) }
  ElementAt(i: number) { return this.__item(i) }
}
const eq = (a: unknown, b: unknown) => a === b || (Number.isNaN(a) && Number.isNaN(b)) || ((a instanceof NtDateTime || a instanceof NtTimeSpan) && (a as NtDateTime).Equals(b as NtDateTime));
const keyOf = (k: unknown) => (k instanceof NtDateTime ? 'ʘd' + k.ms : k instanceof NtTimeSpan ? 'ʘt' + k.ms : k);

export class NtDictionary<K = any, V = any> {
  #m = new Map<unknown, [K, V]>();
  constructor(init?: NtDictionary<K, V>) { if (init instanceof NtDictionary) for (const kv of init) this.Add(kv.Key, kv.Value) }
  get Count() { return this.#m.size }
  get Keys() { return new NtList<K>([...this.#m.values()].map(e => e[0])) }
  get Values() { return new NtList<V>([...this.#m.values()].map(e => e[1])) }
  __item(k: K): V {
    const e = this.#m.get(keyOf(k));
    if (!e) throw new NtError(`The given key '${fmt(k)}' was not present in the dictionary.`);
    return e[1];
  }
  __setItem(k: K, v: V) { this.#m.set(keyOf(k), [k, v]) }
  Add(k: K, v: V) { if (this.#m.has(keyOf(k))) throw new NtError('An item with the same key has already been added.'); this.#m.set(keyOf(k), [k, v]) }
  ContainsKey(k: K) { return this.#m.has(keyOf(k)) }
  ContainsValue(v: V) { return [...this.#m.values()].some(e => eq(e[1], v)) }
  TryGetValue(k: K, r: Ref) { const e = this.#m.get(keyOf(k)); r.v = e ? e[1] : null; return !!e }
  Remove(k: K) { return this.#m.delete(keyOf(k)) }
  Clear() { this.#m.clear() }
  *[Symbol.iterator]() { for (const [k, v] of this.#m.values()) yield { Key: k, Value: v } }
}

// ---------- indexing ----------
const oob = () => new NtError('Index was outside the bounds of the array.');
export function get(x: any, i: any): any {
  if (x == null) throw new NtError('Object reference not set to an instance of an object.');
  if (typeof x.__item === 'function') return x.__item(i);
  if (typeof x === 'string' || Array.isArray(x)) { if (!(i >= 0 && i < x.length)) throw oob(); return x[i] }
  return x[i];
}
export function set(x: any, i: any, v: any): any {
  if (x == null) throw new NtError('Object reference not set to an instance of an object.');
  if (typeof x.__setItem === 'function') x.__setItem(i, v);
  else if (Array.isArray(x)) { if (!(i >= 0 && i < x.length)) throw oob(); x[i] = v }
  else x[i] = v;
  return v;
}

// ---------- casts & primitive statics ----------
const INTS: Record<string, (n: number) => number> = {
  int: n => n | 0, int32: n => n | 0, uint: n => n >>> 0, uint32: n => n >>> 0, short: n => (n << 16) >> 16, int16: n => (n << 16) >> 16,
  ushort: n => n & 0xffff, uint16: n => n & 0xffff, byte: n => n & 255, sbyte: n => (n << 24) >> 24, long: n => n, int64: n => n, ulong: n => n, uint64: n => n,
};
export function cast(type: unknown, v: any): any {
  const t = String(type).replace(/^(global::)?System\./, '').toLowerCase();
  if (t in INTS) {
    if (typeof v === 'string') return v.length === 1 ? v.charCodeAt(0) : enumIndex(v);
    if (typeof v === 'boolean') return +v;
    if (!Number.isFinite(v)) return t === 'long' || t === 'int64' ? -9223372036854775808 : -2147483648;
    return INTS[t](Math.trunc(v));
  }
  if (t === 'double' || t === 'decimal') return typeof v === 'string' && v.length === 1 ? v.charCodeAt(0) : Number(v);
  if (t === 'float' || t === 'single') return Math.fround(Number(v));
  if (t === 'string') return v == null ? null : fmt(v);
  if (t === 'char') return typeof v === 'number' ? String.fromCharCode(v) : v;
  if (t === 'bool' || t === 'boolean') return Boolean(v);
  const members = ENUMS.get(t.split('.').pop()!);
  if (members && typeof v === 'number') return members[v] ?? v;
  return v;
}
const parseNum = (s: string) => {
  const t = String(s).trim().replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) { if (/^(NaN|[+-]?Infinity)$/.test(t)) return Number(t); throw new NtError('Input string was not in a correct format.') }
  return Number(t);
};
const parseInt32 = (s: string) => { if (!/^\s*[+-]?\d+\s*$/.test(String(s))) throw new NtError('Input string was not in a correct format.'); return Number(s) };
const tryP = (p: (s: string) => number) => (s: string, r: Ref) => { try { r.v = p(s); return true } catch { r.v = 0; return false } };
export const Double = {
  MaxValue: Number.MAX_VALUE, MinValue: -Number.MAX_VALUE, NaN: NaN, Epsilon: 5e-324, PositiveInfinity: Infinity, NegativeInfinity: -Infinity,
  IsNaN: (x: number) => Number.isNaN(x), IsInfinity: (x: number) => x === Infinity || x === -Infinity,
  IsPositiveInfinity: (x: number) => x === Infinity, IsNegativeInfinity: (x: number) => x === -Infinity,
  Parse: parseNum, TryParse: tryP(parseNum),
};
export const Int = { MaxValue: 2147483647, MinValue: -2147483648, Parse: parseInt32, TryParse: tryP(parseInt32) };
export const Long = { MaxValue: 9223372036854775807, MinValue: -9223372036854775808, Parse: parseInt32, TryParse: tryP(parseInt32) };
const parseBool = (s: string) => { const t = String(s).trim().toLowerCase(); if (t !== 'true' && t !== 'false') throw new NtError('String was not recognized as a valid Boolean.'); return t === 'true' };
export const Bool = { Parse: parseBool, TryParse: (s: string, r: Ref) => { try { r.v = parseBool(s); return true } catch { r.v = false; return false } }, TrueString: 'True', FalseString: 'False' };

// ---------- System.Math ----------
function roundMode(y: number, mode: string): number {
  switch (mode) {
    case 'AwayFromZero': { const f = Math.trunc(y); return Math.abs(y - f) >= 0.5 ? f + Math.sign(y) : f }
    case 'ToZero': return Math.trunc(y);
    case 'ToNegativeInfinity': return Math.floor(y);
    case 'ToPositiveInfinity': return Math.ceil(y);
    default: { const f = Math.floor(y), d = y - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1 }
  }
}
export const NtMath = {
  PI: Math.PI, E: Math.E,
  Abs: Math.abs, Max: (a: number, b: number) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.max(a, b)), Min: (a: number, b: number) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : Math.min(a, b)),
  Round(x: number, a?: number | string, b?: string) {
    let d = 0, mode = 'ToEven';
    if (typeof a === 'string') mode = a; else if (a != null) { d = a; if (typeof b === 'string') mode = b }
    if (!d) return roundMode(x, mode);
    const p = 10 ** d; return Math.abs(x) < 1e16 ? roundMode(x * p, mode) / p : x;
  },
  Floor: Math.floor, Ceiling: Math.ceil, Truncate: Math.trunc, Sqrt: Math.sqrt, Pow: Math.pow, Exp: Math.exp, Cbrt: Math.cbrt,
  Log: (x: number, b?: number) => (b == null ? Math.log(x) : Math.log(x) / Math.log(b)), Log10: Math.log10, Log2: Math.log2,
  Sign: (x: number) => { if (Number.isNaN(x)) throw new NtError('Function does not accept floating point Not-a-Number values.'); return Math.sign(x) },
  Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Asin: Math.asin, Acos: Math.acos, Atan: Math.atan, Atan2: Math.atan2,
  Sinh: Math.sinh, Cosh: Math.cosh, Tanh: Math.tanh,
  Clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
  IEEERemainder: (x: number, y: number) => x - y * roundMode(x / y, 'ToEven'),
  BigMul: (a: number, b: number) => a * b,
};

// ---------- System.String / Convert ----------
export const NtString = {
  Empty: '',
  IsNullOrEmpty: (s: string | null) => s == null || s === '',
  IsNullOrWhiteSpace: (s: string | null) => s == null || s.trim() === '',
  Format: (f: string, ...a: unknown[]) => format(f, ...a),
  Join: (sep: string, ...items: unknown[]) => (items.length === 1 && items[0] != null && typeof items[0] === 'object' && Symbol.iterator in (items[0] as object) ? [...items[0] as Iterable<unknown>] : items).map(x => fmt(x)).join(sep),
  Concat: (...a: unknown[]) => a.map(x => fmt(x)).join(''),
  Compare: (a: string, b: string, ignoreCase?: boolean) => (ignoreCase ? cmp(a?.toLowerCase(), b?.toLowerCase()) : cmp(a, b)),
  Equals: (a: string, b: string) => a === b,
};
export const Convert = {
  ToDouble: (x: unknown) => (typeof x === 'string' ? parseNum(x) : Number(x)),
  ToSingle: (x: unknown) => Math.fround(typeof x === 'string' ? parseNum(x) : Number(x)),
  ToDecimal: (x: unknown) => (typeof x === 'string' ? parseNum(x) : Number(x)),
  ToInt32: (x: unknown) => (typeof x === 'string' ? parseInt32(x) : typeof x === 'boolean' ? +x : roundMode(Number(x), 'ToEven') | 0),
  ToInt64: (x: unknown) => (typeof x === 'string' ? parseInt32(x) : typeof x === 'boolean' ? +x : roundMode(Number(x), 'ToEven')),
  ToBoolean: (x: unknown) => (typeof x === 'string' ? parseBool(x) : Boolean(x)),
  ToString: (x: unknown, f?: string) => fmt(x, f),
};
