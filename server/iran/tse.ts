// Tehran Stock Exchange and Iran Fara Bourse (TSETMC): stocks, funds (ETF), bonds and sukuk (اوراق), rights (حق تقدم),
// futures and options, plus the main indices. Daily history only: TSETMC publishes no intraday candles.
//   search       GET {base}/Instrument/GetInstrumentSearch/{text}              → {instrumentSearch: [{insCode, lVal18AFC, lVal30, …}]}
//   market list  GET {base}/ClosingPrice/GetMarketWatch?market=0&paperTypes[0..8]=…  → {marketwatch: [{insCode, lva, lvc, pcl, pdv, py, qtc, mv, …}]}
//   daily        GET {base}/ClosingPrice/GetClosingPriceDailyList/{insCode}/{n}    → {closingPriceDaily: [{dEven, priceFirst, priceMax, priceMin, pClosing, pDrCotVal, priceYesterday, zTotTran, qTotTran5J, …}]}
//   today        GET {base}/ClosingPrice/GetClosingPriceInfo/{insCode}              → {closingPriceInfo: {…same fields…}}
//   index        GET {base}/Index/GetIndexB2History/{insCode}                       → {indexB2: [{dEven, xNivInuClMresIbs, …}]}
// This is the service tsetmc.com's own pages use. It is unofficial, can change without notice, may refuse
// connections from outside Iran, and has NOT been run from here: `npm run check:ir` tests it, docs/iran-market.md explains.
// Symbols are the Persian ticker with spaces as "_" (فولاد, وبملت, ح.فولاد, شاخص_کل) or the numeric insCode.
import type { Bar } from '../../src/data.ts';
import { deps, fetchJson, toNum } from './http.ts';
import { cleanBars, monthlyJalali, window } from './util.ts';

export const tseBaseUrl = () => process.env['CT_TSE_BASE'] ?? 'https://cdn.tsetmc.com/api';
const H = { referer: 'https://main.tsetmc.com/' };

export type TseType = 'stock' | 'etf' | 'bond' | 'right' | 'futures' | 'option' | 'commodity' | 'index';

/** Arabic letters/digits → Persian/ASCII, no zero-width joiners, "ح . فولاد" → "ح.فولاد", other spaces → "_". */
export function normSym(s: string): string {
  return s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ە|ہ|ۀ/g, 'ه').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[‌‍‏‎]/g, '').replace(/\s*\.\s*/g, '.').trim().replace(/\s+/g, '_').toUpperCase();
}
const isCode = (s: string) => /^\d{10,20}$/.test(s);

const fa = (x: string) => x.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\u200d]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Instrument kind from its short name, full name and group. TSETMC has no single clean "type" field, so this is a
 * heuristic on Persian titles, checked in this order: index, option, right (حق تقدم), commodity certificate, futures/
 * forward (آتی، سلف), fund (صندوق), bond and sukuk (اوراق), otherwise stock. Check unexpected results in the market list.
 */
export function classify(short: string, full = '', group = ''): TseType {
  const s = fa(short), n = fa(full), g = fa(group), all = `${n} ${g}`;
  if (/^شاخص/.test(s) || /^شاخص/.test(n)) return 'index';
  if (/اختیار/.test(all)) return 'option';
  if (/^ح\s*\./.test(n) || /حق\s*تقدم/.test(all)) return 'right';
  if (/گواهی\s*(سپرده|شمش)/.test(all)) return 'commodity';
  if (/آتی|سلف/.test(all)) return 'futures';
  if (/صندوق|\bETF\b/i.test(all)) return 'etf';
  if (/^(اسناد|اوراق|صکوک|مرابحه|اجاره|مشارکت|منفعت|رهنی|گام)/.test(n) || /^(اخزا|اراد|صکوک|مرابحه|اجاره|مشارکت|منفعت|رهنی)/.test(s) || /اوراق\s*(مشارکت|اجاره|بدهی|مرابحه|منفعت)|اسناد\s*خزانه|صکوک/.test(g)) return 'bond';
  return 'stock';
}

export interface TseInstr { code: string; sym: string; name: string; type: TseType; group?: string }
// ---- market list ----
interface MwRow { insCode?: unknown; lva?: unknown; lvc?: unknown; lVal18AFC?: unknown; lVal30?: unknown; pcl?: unknown; pClosing?: unknown; pdv?: unknown; pDrCotVal?: unknown; py?: unknown; priceYesterday?: unknown; mv?: unknown; qtc?: unknown; cgrValCotTitle?: unknown; flowTitle?: unknown; [k: string]: unknown }
export function parseMarketWatch(j: unknown): { instr: TseInstr; last: number; yesterday: number; value: number }[] {
  const rows = (j as { marketwatch?: MwRow[] })?.marketwatch;
  if (!Array.isArray(rows)) throw Error('TSETMC: unexpected market list');
  return rows.flatMap(r => {
    const code = String(r.insCode ?? ''), short = String(r.lva ?? r.lVal18AFC ?? ''), full = String(r.lvc ?? r.lVal30 ?? '');
    if (!isCode(code) || !short) return [];
    const group = String(r.cgrValCotTitle ?? r.flowTitle ?? '');
    return [{ instr: { code, sym: normSym(short), name: full || short, type: classify(short, full, group), ...(group ? { group } : {}) }, last: toNum(r.pcl ?? r.pClosing ?? r.pdv ?? r.pDrCotVal), yesterday: toNum(r.py ?? r.priceYesterday), value: toNum(r.mv) || 0 }];
  });
}
let mwCache: { at: number; rows: ReturnType<typeof parseMarketWatch> } | null = null;
const MW = (base: string) => `${base}/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n, i) => `paperTypes%5B${i}%5D=${n}`).join('&')}&showTraded=false&withBestLimits=false`;
export async function marketWatch() {
  if (mwCache && deps.now() - mwCache.at < 300_000) return mwCache.rows;
  const { data } = await fetchJson<unknown>(MW(tseBaseUrl()), { ttl: 60_000, gap: 500, headers: H, timeout: 30_000 });
  const rows = parseMarketWatch(data);
  if (!rows.length) throw Error('TSETMC: the market list is empty');
  mwCache = { at: deps.now(), rows };
  return rows;
}
export const resetTse = () => { mwCache = null; byName.clear() };

// ---- indices (best effort; the check script prints the name each code resolves to) ----
export const INDICES: Record<string, { code: string; name: string }> = {
  'شاخص_کل': { code: '32097828799138957', name: 'شاخص کل بورس' },
  'شاخص_کل_هم_وزن': { code: '67130298613737946', name: 'شاخص کل (هم وزن)' },
  'شاخص_فرابورس': { code: '43685683301327984', name: 'شاخص کل فرابورس' },
};

// ---- symbol → insCode ----
const byName = new Map<string, TseInstr>();
export async function resolve(sym: string): Promise<{ code: string; index: boolean; instr?: TseInstr }> {
  const s = normSym(sym);
  if (INDICES[s]) return { code: INDICES[s].code, index: true };
  if (Object.values(INDICES).some(i => i.code === s)) return { code: s, index: true };
  if (isCode(s)) return { code: s, index: false };
  const hit = byName.get(s) ?? (await marketWatch().catch(() => []) as { instr: TseInstr }[]).find(r => r.instr.sym === s)?.instr;
  if (hit) { byName.set(s, hit); return { code: hit.code, index: false, instr: hit } }
  const { data } = await fetchJson<{ instrumentSearch?: { insCode?: unknown; lVal18AFC?: unknown; lVal30?: unknown }[] }>(`${tseBaseUrl()}/Instrument/GetInstrumentSearch/${encodeURIComponent(s.replace(/_/g, ' '))}`, { ttl: 3600_000, gap: 500, headers: H });
  const r = (data.instrumentSearch ?? []).find(x => normSym(String(x.lVal18AFC ?? '')) === s);
  if (!r || !isCode(String(r.insCode))) throw Error(`Unknown symbol TSE:${sym}`);
  const instr: TseInstr = { code: String(r.insCode), sym: s, name: String(r.lVal30 ?? s), type: classify(String(r.lVal18AFC), String(r.lVal30 ?? '')) };
  byName.set(s, instr);
  return { code: instr.code, index: false, instr };
}

// ---- daily candles ----
interface Daily { dEven?: unknown; priceFirst?: unknown; priceMax?: unknown; priceMin?: unknown; pClosing?: unknown; pDrCotVal?: unknown; priceYesterday?: unknown; zTotTran?: unknown; qTotTran5J?: unknown }
const dateOf = (d: unknown) => { const n = String(d ?? ''); return /^\d{8}$/.test(n) ? Date.UTC(+n.slice(0, 4), +n.slice(4, 6) - 1, +n.slice(6, 8)) / 1000 : NaN };
/** A day with trades → bar. The close is the final (weighted-average) price; CT_TSE_CLOSE=last uses the last trade instead. */
export function dailyToBar(r: Daily): (Bar & { yesterday: number }) | null {
  const last = process.env['CT_TSE_CLOSE'] === 'last', c = toNum(last ? r.pDrCotVal ?? r.pClosing : r.pClosing ?? r.pDrCotVal), time = dateOf(r.dEven);
  const o = toNum(r.priceFirst), h = toNum(r.priceMax), l = toNum(r.priceMin), trades = toNum(r.zTotTran);
  if (!Number.isFinite(time) || !(c > 0) || !(h > 0) || !(l > 0) || trades === 0) return null;
  return { time, open: o > 0 ? o : c, high: Math.max(h, o || 0, c), low: Math.min(l, o > 0 ? o : l, c), close: c, volume: toNum(r.qTotTran5J) || 0, yesterday: toNum(r.priceYesterday) };
}
/**
 * Adjust for capital increases and dividends (تعدیل). When a day's reference price ("yesterday") differs from the
 * previous bar's close, everything before it is scaled by the ratio. Without this a rights issue shows as a crash.
 * Differences under 0.05% are rounding; ratios outside 0.05…20 are taken as bad data and left alone.
 */
export function adjust(bars: (Bar & { yesterday: number })[]): Bar[] {
  const out: Bar[] = new Array(bars.length);
  let f = 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    const { yesterday, ...b } = bars[i];
    out[i] = f === 1 ? b : { ...b, open: b.open * f, high: b.high * f, low: b.low * f, close: b.close * f };
    const prev = bars[i - 1]?.close, r = yesterday / prev;
    if (i > 0 && prev > 0 && yesterday > 0 && Math.abs(r - 1) > 0.0005 && r > 0.05 && r < 20) f *= r;
  }
  return out;
}
const adjusting = () => process.env['CT_TSE_ADJUST'] !== '0';

export function parseIndex(j: unknown): Bar[] {
  const rows = (j as { indexB2?: Record<string, unknown>[] })?.indexB2;
  if (!Array.isArray(rows)) throw Error('TSETMC: unexpected index history');
  let prev = NaN;
  return cleanBars(rows.slice().sort((a, b) => toNum(a['dEven']) - toNum(b['dEven'])).flatMap(r => {
    const c = toNum(r['xNivInuClMresIbs']), h = toNum(r['xNivInuPhMresIbs']), l = toNum(r['xNivInuPbMresIbs']), time = dateOf(r['dEven']), o = toNum(r['xNivInuPxMresIbs']);
    const open = o > 0 ? o : Number.isFinite(prev) ? prev : c;
    prev = c;
    return c > 0 && Number.isFinite(time) ? [{ time, open, high: Math.max(h > 0 ? h : c, open, c), low: Math.min(l > 0 ? l : c, open, c), close: c, volume: 0 }] : [];
  }));
}

export async function tseBars(sym: string, tf: string, until?: number, limit = 1000): Promise<{ bars: Bar[]; base: string }> {
  if (!/^(\d+[dw]|1M)$/.test(tf)) throw Error(`TSE has daily data only: use 1D or longer (not ${tf})`);
  const r = await resolve(sym);
  let bars: Bar[];
  if (r.index) {
    const { data } = await fetchJson<unknown>(`${tseBaseUrl()}/Index/GetIndexB2History/${r.code}`, { ttl: 120_000, gap: 500, headers: H, timeout: 30_000 });
    bars = parseIndex(data);
  } else {
    const n = Math.min(6000, Math.max(60, Math.ceil(limit * (tf === '1M' ? 31 : /w$/.test(tf) ? 7 : 1)) + 40));
    const { data } = await fetchJson<{ closingPriceDaily?: Daily[] }>(`${tseBaseUrl()}/ClosingPrice/GetClosingPriceDailyList/${r.code}/${n}`, { ttl: 20_000, gap: 500, headers: H, timeout: 30_000 });
    if (!Array.isArray(data.closingPriceDaily)) throw Error('TSETMC: unexpected daily list');
    const days = [...new Map(data.closingPriceDaily.flatMap(d => dailyToBar(d) ?? []).sort((a, b) => a.time - b.time).map(b => [b.time, b])).values()];
    // Today's bar is in the daily list only after the close: while the market is open, ask for the live figures.
    const live = await todayBar(r.code).catch(() => null);
    if (live && (!days.length || live.time >= days.at(-1)!.time)) { if (days.length && live.time === days.at(-1)!.time) days.pop(); days.push(live) }
    bars = adjusting() ? adjust(days) : days.map(({ yesterday: _y, ...b }) => b);
  }
  if (tf === '1M') return { bars: window(monthlyJalali(bars), until, limit), base: '1M' };
  return { bars: window(bars, until, Math.max(limit, 40)), base: '1d' };
}
async function todayBar(code: string): Promise<(Bar & { yesterday: number }) | null> {
  const { data } = await fetchJson<{ closingPriceInfo?: Daily }>(`${tseBaseUrl()}/ClosingPrice/GetClosingPriceInfo/${code}`, { ttl: 5_000, gap: 300, headers: H });
  return data.closingPriceInfo ? dailyToBar(data.closingPriceInfo) : null;
}

export interface TseMarket { sym: string; base: string; quote: string; type: TseType; name: string }
export async function tseMarkets(): Promise<TseMarket[]> {
  const idx = Object.entries(INDICES).map(([sym, i]): TseMarket => ({ sym, base: sym, quote: 'IRR', type: 'index', name: i.name }));
  const rows = await marketWatch().catch(() => []);
  const seen = new Set<string>();
  return [...idx, ...rows.flatMap(r => (seen.has(r.instr.sym) ? [] : (seen.add(r.instr.sym), [{ sym: r.instr.sym, base: r.instr.sym, quote: 'IRR', type: r.instr.type, name: r.instr.name }])))];
}
export async function tseTickers(): Promise<{ sym: string; last: number; change: number; quoteVolume: number }[]> {
  const rows = await marketWatch(), seen = new Set<string>();
  return rows.flatMap(r => (r.last > 0 && !seen.has(r.instr.sym) ? (seen.add(r.instr.sym), [{ sym: r.instr.sym, last: r.last, change: r.yesterday > 0 ? ((r.last - r.yesterday) / r.yesterday) * 100 : 0, quoteVolume: r.value }]) : []));
}
