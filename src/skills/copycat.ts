// trader-copycat: rebuild a fund's portfolio from its 13F-HR on SEC EDGAR — positions and weights, what it bought,
// added, trimmed and sold since the previous quarter, CUSIPs matched to tickers by SEC company name (plus the
// bundled share-class table), and copy weights for the budget skill. The original's parsing and matching rules.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { FILERS, SHARE_CLASSES } from './filers13f.ts';

export interface Filing { form: string; accession: string; filed: string; period: string; primary: string }
export interface Row { issuer: string; title: string; cusip: string; value: number; shares: number; share_type: string; put_call: string }
export interface Pos extends Row { rows: number; pct: number; cusips: string[]; ticker?: string | null; ticker_source?: string; check?: boolean; name?: string; tickers?: string[]; classes?: string[] }
export const cik10 = (v: string | number) => { const d = String(v).replace(/\D/g, ''); if (!d) throw new Error(`not a CIK: ${v}`); return d.padStart(10, '0') };
export function findBundled(q: string) {
  const s = q.toLowerCase().trim();
  if (/^\d{1,10}$/.test(s)) return FILERS.filter(f => f.cik === cik10(s));
  const w = s.split(/\s+/);
  return FILERS.filter(f => { const hay = [f.name, f.person ?? '', ...(f.aliases ?? [])].join(' ').toLowerCase(); return w.every(x => hay.includes(x)) });
}
export function listFilings(sub: { filings?: { recent?: Record<string, string[]> } }): Filing[] {
  const r = sub.filings?.recent ?? {}, out: Filing[] = [];
  (r.form ?? []).forEach((f, i) => { if (f === '13F-HR' || f === '13F-HR/A') out.push({ form: f, accession: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate?.[i] ?? '', primary: r.primaryDocument?.[i] ?? '' }) });
  return out.sort((a, b) => (b.filed + b.accession).localeCompare(a.filed + a.accession));
}
export function pickFiling(fs: Filing[], { period = null as string | null, before = null as string | null } = {}) {
  let o = fs.filter(f => f.form === '13F-HR'); if (period) o = o.filter(f => f.period === period); if (before) o = o.filter(f => f.period < before);
  if (!o.length) throw new Error(`no 13F-HR found${period ? ` for period ${period}` : ''}`);
  const c = [...o].sort((a, b) => (b.period + b.filed).localeCompare(a.period + a.filed))[0];
  return { chosen: c, amendments: fs.filter(f => f.form === '13F-HR/A' && f.period === c.period) };
}
export function infoTableName(index: { directory?: { item?: { name: string }[] } }) {
  const xml = (index.directory?.item ?? []).map(i => i.name).filter(n => n.toLowerCase().endsWith('.xml') && !['primary_doc.xml', 'filingsummary.xml'].includes(n.toLowerCase()));
  if (!xml.length) throw new Error('no information table XML in this filing (plain-text filings before mid 2013 are not supported)');
  return xml.find(n => /info|table|13f/i.test(n)) ?? xml[0];
}
export const valueMultiplier = (filed: string) => (/^\d{4}-\d{2}-\d{2}/.test(filed) ? (filed.slice(0, 10) >= '2023-01-03' ? 1 : 1000) : 1);
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
/** The info table's rows; for each field the first element of that (local) name wins, as in the original. */
export function parseInfoTable(xml: string, mult = 1): Row[] {
  const rows: Row[] = [];
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?infoTable>/g)) {
    const f: Record<string, string> = {};
    for (const t of m[1].matchAll(/<(?:[\w.-]+:)?(\w+)\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?\1>/g)) if (!(t[1] in f) && t[2].trim()) f[t[1]] = unesc(t[2].trim());
    const value = Number((f.value ?? '0').replace(/,/g, '')) * mult, shares = Number((f.sshPrnamt ?? '0').replace(/,/g, ''));
    if (!Number.isFinite(value) || !Number.isFinite(shares)) throw new Error(`bad number in row for ${f.nameOfIssuer}`);
    rows.push({ issuer: f.nameOfIssuer ?? '', title: f.titleOfClass ?? '', cusip: (f.cusip ?? '').toUpperCase(), value, shares, share_type: (f.sshPrnamtType ?? 'SH').toUpperCase(), put_call: (f.putCall ?? '').toUpperCase() });
  }
  if (!rows.length) throw new Error('no infoTable rows found. Is this a 13F information table?');
  return rows;
}
export const isStock = (p: Pick<Row, 'share_type' | 'put_call'>) => p.share_type === 'SH' && !p.put_call;
const byValue = (a: Pos, b: Pos) => b.value - a.value || (a.cusip < b.cusip ? -1 : a.cusip > b.cusip ? 1 : 0);
export function aggregate(rows: Row[]) {
  const total = rows.reduce((a, r) => a + r.value, 0), g = new Map<string, Pos>();
  for (const r of rows) { const k = `${r.cusip}|${r.put_call}|${r.share_type}`; if (!g.has(k)) g.set(k, { ...r, value: 0, shares: 0, rows: 0, pct: 0, cusips: [r.cusip] }); const p = g.get(k)!; p.value += r.value; p.shares += r.shares; p.rows++ }
  const ps = [...g.values()]; for (const p of ps) p.pct = total ? pyRoundN(100 * p.value / total, 2) : 0;
  return { positions: ps.sort(byValue), total };
}
export function combineClasses(ps: Pos[], total: number) {
  const out: Pos[] = [], by = new Map<string, Pos>();
  for (const p of ps) {
    if (!isStock(p)) { out.push({ ...p }); continue }
    const k = p.cusip.slice(0, 6), q = by.get(k);
    if (!q) { const n = { ...p, cusips: [p.cusip], tickers: p.ticker ? [p.ticker] : [], classes: [p.title] }; by.set(k, n); out.push(n); continue }
    q.value += p.value; q.shares += p.shares; q.rows += p.rows; q.cusips.push(p.cusip); q.classes!.push(p.title); if (p.ticker) q.tickers!.push(p.ticker);
  }
  for (const q of out) q.pct = total ? pyRoundN(100 * q.value / total, 2) : 0;
  return out.sort(byValue);
}
const SUFFIX = /\s*\/\s*[A-Z]{2,5}\s*\/?\s*$/;
const ABBREV: Record<string, string> = { AMER: 'AMERICA', AMERN: 'AMERICAN', FINL: 'FINANCIAL', FIN: 'FINANCIAL', PETE: 'PETROLEUM', HLDGS: 'HOLDINGS', HLDG: 'HOLDING', HOLDG: 'HOLDING', INTL: 'INTERNATIONAL', GRP: 'GROUP', SVCS: 'SERVICES', SVC: 'SERVICE', SYS: 'SYSTEMS', MGMT: 'MANAGEMENT', INDS: 'INDUSTRIES', NATL: 'NATIONAL', ENTMT: 'ENTERTAINMENT', PAC: 'PACIFIC', LABS: 'LABORATORIES', PPTYS: 'PROPERTIES', RLTY: 'REALTY', TECHS: 'TECHNOLOGIES', TECH: 'TECHNOLOGY', COMMNS: 'COMMUNICATIONS', COMMUNICATN: 'COMMUNICATIONS', MFG: 'MANUFACTURING', ELEC: 'ELECTRIC', PHARMACEUTICALS: 'PHARMACEUTICALS', PHARMS: 'PHARMACEUTICALS', BANCORPORATION: 'BANCORP', RES: 'RESOURCES', SOLUTIONS: 'SOLUTIONS', WTR: 'WATER', MTRS: 'MOTORS', AIRLS: 'AIRLINES', CHEM: 'CHEMICAL' };
const DROP = new Set(['INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'SA', 'NV', 'AG', 'SE', 'THE', 'AND', 'OF']);
const NONCOMMON = /-P[A-Z]*$|-WT[A-Z]*$|-WS$|-U$|-UN$|-R$|-RT$/;
export function normName(n: string) {
  let s = (n ?? '').toUpperCase().replace(/&/g, ' AND ');
  for (let i = 0; i < 2; i++) s = s.replace(SUFFIX, '');
  s = s.replace(/['’]/g, '').replace(/[^A-Z0-9 ]+/g, ' ');
  return s.split(/\s+/).filter(Boolean).map(w => ABBREV[w] ?? w).filter(w => !DROP.has(w));
}
const keys = (n: string) => { const w = normName(n); return [w.join(''), [...w].sort().join(' ')] as const };
export const normTicker = (t: string) => { const x = (t ?? '').trim().toUpperCase(); return NONCOMMON.test(x) ? x : x.replace(/[-/ ]([A-Z]{1,2})$/, '.$1') };
const classLetter = (t: string) => /\b(?:CL|CLASS|SER|SERIES)\s*([A-Z])\b/.exec((t ?? '').toUpperCase())?.[1] ?? null;
export class TickerIndex {
  byCik = new Map<string, string[]>(); titles = new Map<string, string>(); spaceless = new Map<string, Set<string>>(); sorted = new Map<string, Set<string>>();
  constructor(rows: [string, string, string][]) {
    for (const [cik, t, title] of rows) {
      this.byCik.set(cik, [...(this.byCik.get(cik) ?? []), t]);
      if (this.titles.has(cik)) continue;
      this.titles.set(cik, title);
      const [a, b] = keys(title); if (a) { if (!this.spaceless.has(a)) this.spaceless.set(a, new Set()); this.spaceless.get(a)!.add(cik); if (!this.sorted.has(b)) this.sorted.set(b, new Set()); this.sorted.get(b)!.add(cik) }
    }
  }
  matchCik(issuer: string): [string | null, string | null] {
    const [a, b] = keys(issuer); if (!a) return [null, null];
    for (const h of [this.spaceless.get(a), this.sorted.get(b)]) if (h && h.size === 1) return [[...h][0], 'name'];
    const best: [number, string][] = [];
    for (const [k, c] of this.spaceless) if (k.length >= 8 && c.size === 1 && (a.startsWith(k) || k.startsWith(a))) best.push([k.length, [...c][0]]);
    if (best.length) { best.sort((x, y) => y[0] - x[0] || (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0)); if (best.length === 1 || best[0][0] > best[1][0]) return [best[0][1], 'name-prefix'] }
    return [null, null];
  }
  tickerFor(cik: string, title: string): [string | null, boolean] {
    const ts = this.byCik.get(cik) ?? [], c = ts.filter(t => !NONCOMMON.test(t)).length ? ts.filter(t => !NONCOMMON.test(t)) : ts;
    if (!c.length) return [null, true];
    if (c.length === 1 || c.slice(1).every(t => t.startsWith(c[0]))) return [normTicker(c[0]), false];
    const l = classLetter(title);
    if (l) { for (const t of c) if (['-', '.', '/'].some(s => t.toUpperCase().endsWith(s + l))) return [normTicker(t), false]; for (const t of c) if (t.length >= 4 && t.toUpperCase().endsWith(l)) return [normTicker(t), true] }
    return [normTicker(c[0]), true];
  }
}
export function prettyName(issuer: string, sec?: string | null) {
  let n = sec && /[a-z]/.test(sec) ? sec : sec || issuer;
  n = (n ?? '').replace(SUFFIX, '');
  n = n.trim().replace(/,?\s+(Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|plc|PLC|LLC|L\.P\.|N\.V\.|S\.A\.)$/i, '');
  n = n.trim().replace(/,?\s+(INC|CORP|CO|LTD|PLC)$/, '');
  if (n === n.toUpperCase() && /[A-Z]/.test(n)) { const small = new Set(['OF', 'AND', 'THE', 'FOR', 'IN']); n = n.toLowerCase().split(/\s+/).filter(Boolean).map((w, i) => (small.has(w.toUpperCase()) && i ? w : w[0].toUpperCase() + w.slice(1))).join(' ') }
  return n.trim();
}
export function resolveTickers(ps: Pos[], idx: TickerIndex | null, overrides: Record<string, string> = SHARE_CLASSES) {
  for (const p of ps) {
    let sec: string | null = null, cik: string | null = null, how: string | null = null;
    if (idx) { [cik, how] = idx.matchCik(p.issuer); if (cik) sec = idx.titles.get(cik) ?? null }
    if (p.cusip in overrides) { p.ticker = normTicker(overrides[p.cusip]); p.ticker_source = 'override'; p.check = false }
    else if (cik && idx) { const [t, c] = idx.tickerFor(cik, p.title); p.ticker = t; p.ticker_source = how!; p.check = c || how === 'name-prefix' }
    else { p.ticker = null; p.ticker_source = 'none'; p.check = true }
    p.name = prettyName(p.issuer, sec);
  }
  return ps;
}
export interface Change { status: string; issuer: string; cusip: string; ticker: string | null | undefined; put_call: string; before: number; after: number; change: number; pct: number | null; valueAfter: number; valueBefore: number }
export function diff(cur: Pos[], prior: Pos[]): Change[] {
  const k = (p: Pos) => `${p.cusip}|${p.put_call}`, before = new Map(prior.map(p => [k(p), p])), now = new Map(cur.map(p => [k(p), p])), out: Change[] = [];
  for (const [key, p] of now) { const q = before.get(key), [st, ch] = !q ? ['NEW', p.shares] : p.shares > q.shares ? ['ADDED', p.shares - q.shares] : p.shares < q.shares ? ['TRIMMED', p.shares - q.shares] : ['UNCHANGED', 0]; out.push({ status: st as string, issuer: p.issuer, cusip: p.cusip, ticker: p.ticker, put_call: p.put_call, before: q?.shares ?? 0, after: p.shares, change: ch as number, pct: q && q.shares ? pyRoundN(100 * (ch as number) / q.shares, 1) : null, valueAfter: p.value, valueBefore: q?.value ?? 0 }) }
  for (const [key, q] of before) if (!now.has(key)) out.push({ status: 'SOLD OUT', issuer: q.issuer, cusip: q.cusip, ticker: q.ticker, put_call: q.put_call, before: q.shares, after: 0, change: -q.shares, pct: -100, valueAfter: 0, valueBefore: q.value });
  const rank: Record<string, number> = { NEW: 0, 'SOLD OUT': 1, ADDED: 2, TRIMMED: 3, UNCHANGED: 4 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || Math.max(b.valueAfter, b.valueBefore) - Math.max(a.valueAfter, a.valueBefore));
}
export function copyWeights(ps: Pos[], { top = null as number | null, minPct = 0, exclude = [] as string[], needTicker = true } = {}) {
  const ex = new Set(exclude.map(e => e.toUpperCase())), chosen: Pos[] = [], skipped: { issuer: string; ticker?: string | null; why: string }[] = [];
  for (const p of ps) {
    const why = !isStock(p) ? `${p.put_call || p.share_type} row, not a stock you can copy` : needTicker && !p.ticker ? 'no ticker found' : p.ticker && ex.has(p.ticker.toUpperCase()) ? 'excluded by you' : p.pct < minPct ? `below --min-pct ${minPct.toFixed(2)}` : null;
    if (why) skipped.push({ issuer: p.issuer, ticker: p.ticker, why }); else chosen.push(p);
  }
  let c = chosen; if (top) { for (const p of chosen.slice(top)) skipped.push({ issuer: p.issuer, ticker: p.ticker, why: `outside the top ${top}` }); c = chosen.slice(0, top) }
  const base = c.reduce((a, p) => a + p.pct, 0); if (!c.length || base <= 0) throw new Error('nothing left to copy');
  return { weights: c.map(p => ({ ticker: p.ticker!, name: p.name || p.issuer, weight: pyRoundN(100 * p.pct / base, 2), pct: p.pct, value: p.value, shares: p.shares, check: !!p.check })), skipped };
}
export async function loadQuarter(ctx: Ctx, cik: string, before: string | null = null) {
  const sub = await ctx.json<{ name?: string; filings?: { recent?: Record<string, string[]> } }>(`/api/sec/submissions?q=${cik10(cik)}`), fs = listFilings(sub);
  if (!fs.length) throw new Error(`${sub.name ?? cik} has no 13F-HR filings in its recent list`);
  const { chosen, amendments } = pickFiling(fs, { before }), q = (name: string) => `/api/sec/file?cik=${Number(cik10(cik))}&acc=${chosen.accession}&name=${encodeURIComponent(name)}`;
  const table = infoTableName(await ctx.json(q('index.json'))), rows = parseInfoTable(await ctx.json<string>(q(table)), valueMultiplier(chosen.filed));
  return { filer: sub.name ?? '', chosen, amendments, rows };
}

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`);
export const copycatSkill: Skill = {
  id: 'trader-copycat', name: 'Copy an investor (13F)', group: 'Fundamentals', from: 'trader-copycat',
  desc: 'A famous investor\'s portfolio from the fund\'s latest 13F-HR on SEC EDGAR: every position and its weight, what was bought, added, trimmed and sold since the previous quarter, and copy weights for the top N stocks. A 13F is a 45-day-old snapshot of US long positions only.',
  inputs: [{ key: 'who', label: 'Investor, fund or CIK', type: 'text', default: 'buffett' }, { key: 'top', label: 'Copy the top N', type: 'number', default: 10 }, { key: 'combine', label: 'Combine share classes', type: 'bool', default: true }],
  async run(v, ctx: Ctx) {
    const q = String(v.who ?? '').trim(); if (!q) throw new Error('Give an investor, fund or CIK');
    const hits = findBundled(q), cik = hits[0]?.cik ?? (/^\d{1,10}$/.test(q) ? cik10(q) : null);
    if (!cik) throw new Error(`"${q}" is not in the bundled list: ${FILERS.map(f => f.aliases?.[0] ?? f.name).slice(0, 12).join(', ')}… or give the fund's CIK`);
    const idx = new TickerIndex(await ctx.json<[string, string, string][]>('/api/sec/tickers')), cur = await loadQuarter(ctx, cik);
    const flat = (rows: Row[]) => { const a = aggregate(rows); resolveTickers(a.positions, idx); return a }, cur0 = flat(cur.rows);
    const now = v.combine !== false ? { ...cur0, positions: combineClasses(cur0.positions, cur0.total) } : cur0;
    const prev = await loadQuarter(ctx, cik, cur.chosen.period).catch(() => null), ch = prev ? diff(cur0.positions, flat(prev.rows).positions).filter(c => c.status !== 'UNCHANGED') : [];
    const cw = copyWeights(now.positions, { top: Math.max(1, Number(v.top) || 10) });
    return {
      verdict: { label: `${cur.filer}: ${now.positions.length} positions, ${money(now.total)}`, tone: 'muted', detail: `13F-HR for the quarter ending ${cur.chosen.period}, filed ${cur.chosen.filed}${hits[0]?.person ? ` · ${hits[0].person}` : ''}.` },
      tables: [
        { title: 'Copy weights', cols: ['Ticker', 'Name', 'Weight', '% of 13F', 'Value', 'Shares', ''], rows: cw.weights.map(w => [w.ticker, w.name, `${w.weight}%`, `${w.pct}%`, money(w.value), Math.round(w.shares).toLocaleString(), w.check ? 'check ticker' : '']) },
        { title: `Changes since ${prev?.chosen.period ?? 'the previous quarter'}`, cols: ['Status', 'Issuer', 'Ticker', 'Shares before', 'Shares after', 'Change', 'Value now'], rows: ch.slice(0, 60).map(c => [c.status, c.issuer, c.ticker ?? '–', Math.round(c.before).toLocaleString(), Math.round(c.after).toLocaleString(), c.pct == null ? (c.status === 'NEW' ? 'new' : '–') : `${c.pct}%`, money(c.valueAfter)]) },
        { title: 'All positions', cols: ['Name', 'Ticker', 'Class', 'Type', '% of 13F', 'Value'], rows: now.positions.map(p => [p.name ?? p.issuer, p.ticker ?? '–', p.title, p.put_call || p.share_type, `${p.pct}%`, money(p.value)]) },
      ],
      notes: ['A 13F is the last day of the quarter, filed up to 45 days later: long US-listed positions only, no shorts, cash, bonds or trades inside the quarter, and filed by the firm, not the person.', ...(cur.amendments.length ? [`Amendments for this quarter: ${cur.amendments.map(a => `${a.accession} (${a.filed})`).join(', ')}.`] : []), 'Tickers are matched by company name to SEC\'s list; rows marked "check ticker" are best guesses. Not an order.'],
      links: [{ label: 'The 13F filing on EDGAR', url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${cur.chosen.accession.replace(/-/g, '')}/` }],
    };
  },
};
