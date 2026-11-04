// Journal analytics, no DOM: balances, dashboard metrics, sessions, risk buckets, discipline points and streaks,
// prop-challenge rules, and statement import (MT4/MT5 HTML reports, generic CSV).
import { rMultiple, uid, type JAccount, type JTrade, type Journal, type Prop } from '../journal.ts';

export const closed = (ts: JTrade[]) => ts.filter(t => t.kind !== 'notrade' && t.status === 'closed');
export const tradeTime = (t: JTrade) => t.closeTime ?? t.openTime;
/**
 * R of a trade: the manual value if given; captured trades (real units) use money ÷ money at risk; manual entries
 * (lots, contracts: unknown contract size) use price distances, (exit − entry) ÷ (entry − stop).
 */
export const rOf = (t: JTrade): number | null => {
  if (t.rrActual != null) return t.rrActual;
  if (t.fills.length) return rMultiple(t);
  if (t.stop == null || t.avgExit == null || !t.avgEntry || t.stop === t.avgEntry) return null;
  return ((t.avgExit - t.avgEntry) * (t.dir === 'long' ? 1 : -1)) / Math.abs(t.avgEntry - t.stop);
};
export const rrExpected = (t: JTrade): number | null => {
  if (t.rrExpected != null) return t.rrExpected;
  if (t.stop == null || t.target == null || t.stop === t.avgEntry) return null;
  return Math.abs(t.target - t.avgEntry) / Math.abs(t.avgEntry - t.stop);
};

// ---------- periods and accounts ----------
export type Period = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';
export function periodRange(p: Period, now = Date.now() / 1000, custom?: { from?: number; to?: number }): { from?: number; to?: number } {
  const d = new Date(now * 1000); d.setHours(0, 0, 0, 0);
  const day = d.getTime() / 1000;
  switch (p) {
    case 'day': return { from: day };
    case 'week': return { from: day - ((d.getDay() + 6) % 7) * 86400 };   // weeks start Monday
    case 'month': return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000 };
    case 'year': return { from: new Date(d.getFullYear(), 0, 1).getTime() / 1000 };
    case 'custom': return custom ?? {};
    default: return {};
  }
}
export function scope(j: Journal, r: { from?: number; to?: number } = {}, account = j.account ?? '') {
  return j.trades.filter(t => (!account || (t.accountId ?? 'paper') === account) && (r.from == null || tradeTime(t) >= r.from) && (r.to == null || tradeTime(t) < r.to));
}
/** Initial balance + deposits/withdrawals + closed P&L (of one account, or all). */
export function balance(j: Journal, account = j.account ?? '', until = Infinity) {
  const accs = (j.accounts ?? []).filter(a => !account || a.id === account);
  const base = accs.reduce((s, a) => s + a.initial + a.transfers.filter(x => x.t <= until).reduce((q, x) => q + x.amount, 0), 0);
  return base + closed(scope(j, {}, account)).filter(t => tradeTime(t) <= until).reduce((s, t) => s + t.net, 0);
}
export const transfersOf = (accs: JAccount[], account: string) => accs.filter(a => !account || a.id === account).flatMap(a => a.transfers);

// ---------- sessions (UTC hours, the way FX session tables are usually given) ----------
const SESSIONS = [{ name: 'Tokyo', from: 0, to: 8 }, { name: 'London', from: 8, to: 16 }, { name: 'New York', from: 13, to: 22 }, { name: 'Sydney', from: 22, to: 24 }];
export const sessionOf = (t: number) => { const h = new Date(t * 1000).getUTCHours(); return SESSIONS.filter(s => h >= s.from && h < s.to).map(s => s.name) };

// ---------- dashboard ----------
export interface Group { key: string; n: number; net: number; wins: number; winRate: number }
function groupBy(ts: JTrade[], keys: (t: JTrade) => (string | undefined)[]): Group[] {
  const m = new Map<string, JTrade[]>();
  for (const t of ts) for (const k of keys(t)) if (k) m.set(k, [...(m.get(k) ?? []), t]);
  return [...m].map(([key, xs]) => { const w = xs.filter(x => x.net > 0).length; return { key, n: xs.length, net: xs.reduce((s, x) => s + x.net, 0), wins: w, winRate: (w / xs.length) * 100 } }).sort((a, b) => b.net - a.net);
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dashboard(j: Journal, all: JTrade[], startBalance: number) {
  const t = closed(all).sort((a, b) => tradeTime(a) - tradeTime(b));
  const wins = t.filter(x => x.net > 0), losses = t.filter(x => x.net < 0), even = t.length - wins.length - losses.length;
  const gp = wins.reduce((s, x) => s + x.net, 0), gl = -losses.reduce((s, x) => s + x.net, 0), net = gp - gl;
  // equity per trade with a 5-trade moving average
  let bal = startBalance, peak = startBalance, absDD = 0, relDD = 0;
  const curve = t.map(x => { bal += x.net; peak = Math.max(peak, bal); absDD = Math.max(absDD, startBalance - bal); relDD = Math.max(relDD, peak > 0 ? ((peak - bal) / peak) * 100 : 0); return { t: tradeTime(x), bal } });
  const ma = curve.map((_, i) => { const w = curve.slice(Math.max(0, i - 4), i + 1); return w.reduce((s, c) => s + c.bal, 0) / w.length });
  // streaks (count and money)
  let cw = 0, cl = 0, bw = 0, bl = 0, mw = 0, ml = 0, sw = 0, sl = 0;
  for (const x of t) {
    if (x.net > 0) { cw++; sw += x.net; cl = 0; sl = 0 } else if (x.net < 0) { cl++; sl += -x.net; cw = 0; sw = 0 } else { cw = cl = 0; sw = sl = 0 }
    bw = Math.max(bw, cw); bl = Math.max(bl, cl); mw = Math.max(mw, sw); ml = Math.max(ml, sl);
  }
  const rets = t.map(x => x.net / Math.max(1e-9, startBalance)), mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length || 1));
  const rs = t.map(rOf).filter((r): r is number => r != null);
  const pct = (v: number) => (startBalance ? (v / startBalance) * 100 : 0);
  // risk per trade: stored %, else stop distance × size, else the realised loss
  const riskPct = (x: JTrade) => {
    if (x.riskPct != null) return x.riskPct;
    if (x.fills.length && x.stop != null && x.maxQty) return pct(Math.abs(x.avgEntry - x.stop) * x.maxQty);
    const r = rOf(x);
    if (r) return pct(Math.abs(x.net / r));   // money at risk = result ÷ R
    return x.net < 0 ? pct(-x.net) : null;
  };
  const risks = t.map(riskPct).filter((r): r is number => r != null);
  const bucket = (lo: number, hi: number) => risks.filter(r => r >= lo && r < hi).length;
  const best = t.reduce<JTrade | null>((b, x) => (!b || x.net > b.net ? x : b), null), worst = t.reduce<JTrade | null>((b, x) => (!b || x.net < b.net ? x : b), null);
  const checklistDone = t.filter(x => x.checklist?.done.length).length;
  const days = new Map<string, { net: number; n: number; wins: number }>();
  for (const x of t) { const k = dayKeyOf(tradeTime(x)), d = days.get(k) ?? { net: 0, n: 0, wins: 0 }; d.net += x.net; d.n++; if (x.net > 0) d.wins++; days.set(k, d) }
  return {
    trades: t.length, journals: all.length, wins: wins.length, losses: losses.length, even, winRate: t.length ? (wins.length / t.length) * 100 : 0,
    gp, gl, net, pf: gl ? gp / gl : gp ? Infinity : 0, avgWin: wins.length ? gp / wins.length : 0, avgLoss: losses.length ? gl / losses.length : 0,
    avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 0, rCount: rs.length,
    balance: startBalance + net, curve, ma, absDD, relDD, recovery: absDD || relDD ? net / Math.max(absDD, (relDD / 100) * peak) : 0,
    sharpe: sd ? mean / sd : 0, commission: t.reduce((s, x) => s + x.fees, 0), swap: t.reduce((s, x) => s + (x.swap ?? 0), 0),
    best, worst, pct, consecWins: bw, consecLosses: bl, consecWinAmt: mw, consecLossAmt: ml,
    risk: { avg: risks.length ? risks.reduce((s, r) => s + r, 0) / risks.length : 0, n: risks.length, buckets: [bucket(0, 1), bucket(1, 2), bucket(2, 3), bucket(3, Infinity)] },
    checklist: { done: checklistDone, of: t.length }, stopSet: t.filter(x => x.stop != null).length,
    noPlan: t.filter(x => x.stop == null && !x.entryReason && !x.entryReasons?.length).length,
    long: side(t, 'long'), short: side(t, 'short'),
    bySymbol: groupBy(t, x => [x.sym]), byWeekday: groupBy(t, x => [WEEKDAYS[new Date(x.openTime * 1000).getDay()]]),
    bySession: SESSIONS.map(s => { const g = groupBy(t.filter(x => sessionOf(x.openTime).includes(s.name)), () => [s.name])[0]; return g ?? { key: s.name, n: 0, net: 0, wins: 0, winRate: 0 } }),
    byTf: groupBy(t, x => [x.tf]), byEntryReason: groupBy(t, x => x.entryReasons ?? []), byExitReason: groupBy(t, x => x.exitReasons ?? []),
    bySetup: groupBy(t, x => [x.setup]), byEmotion: groupBy(t, x => x.emotionsBefore?.length ? x.emotionsBefore : [x.emotionIn]), byEmotionAfter: groupBy(t, x => x.emotionsAfter ?? [x.emotionOut]),
    byMotive: groupBy(t, x => x.motives ?? []), byMistake: groupBy(t, x => x.mistakes ?? []), byTag: groupBy(t, x => x.tags ?? []),
    byHour: groupBy(t, x => [`${String(new Date(x.openTime * 1000).getHours()).padStart(2, '0')}`]),
    byEnergy: groupBy(t, x => [x.energy ? `Energy ${x.energy}` : undefined]), byConfidence: groupBy(t, x => [x.confidence ? `Confidence ${x.confidence}` : undefined]),
    byPlan: groupBy(t, x => [x.followedPlan == null ? undefined : x.followedPlan ? 'Followed plan' : 'Broke plan']),
    byHold: groupBy(t, x => [holdBucket(tradeTime(x) - x.openTime)]),
    days,
  };
}
function side(t: JTrade[], d: 'long' | 'short') {
  const xs = t.filter(x => x.dir === d), w = xs.filter(x => x.net > 0);
  return { n: xs.length, share: t.length ? (xs.length / t.length) * 100 : 0, net: xs.reduce((s, x) => s + x.net, 0), profit: w.reduce((s, x) => s + x.net, 0), loss: -xs.filter(x => x.net < 0).reduce((s, x) => s + x.net, 0), winRate: xs.length ? (w.length / xs.length) * 100 : 0 };
}
const holdBucket = (s: number) => (s < 300 ? '< 5 min' : s < 3600 ? '5–60 min' : s < 4 * 3600 ? '1–4 h' : s < 86400 ? '4–24 h' : s < 7 * 86400 ? '1–7 days' : '> 1 week');
export const dayKeyOf = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };

/** Overtrading days (trade count far above the usual) and revenge trades (opened soon after a loss, bigger). */
export function behaviour(all: JTrade[]) {
  const t = closed(all).sort((a, b) => a.openTime - b.openTime);
  const perDay = new Map<string, number>();
  t.forEach(x => perDay.set(dayKeyOf(x.openTime), (perDay.get(dayKeyOf(x.openTime)) ?? 0) + 1));
  const counts = [...perDay.values()], mean = counts.reduce((s, c) => s + c, 0) / (counts.length || 1), sd = Math.sqrt(counts.reduce((s, c) => s + (c - mean) ** 2, 0) / (counts.length || 1));
  const overDays = [...perDay].filter(([, c]) => c > mean + 2 * sd && c >= 4).map(([d]) => d);
  const revenge = t.filter((x, i) => { const p = t[i - 1]; return p && p.net < 0 && x.openTime - tradeTime(p) < 15 * 60 && x.maxQty > p.maxQty * 1.2 });
  return { overDays, revenge, revengeNet: revenge.reduce((s, x) => s + x.net, 0), afterLoss: winRateAfter(t, false), afterWin: winRateAfter(t, true) };
}
function winRateAfter(t: JTrade[], win: boolean) {
  const xs = t.filter((_, i) => i > 0 && (t[i - 1].net > 0) === win);
  return { n: xs.length, winRate: xs.length ? (xs.filter(x => x.net > 0).length / xs.length) * 100 : 0, net: xs.reduce((s, x) => s + x.net, 0) };
}
/** System quality number and Kelly fraction from R (or money when no R). */
export function edge(all: JTrade[]) {
  const t = closed(all), r = t.map(x => rOf(x) ?? null), useR = r.filter(x => x != null).length >= t.length / 2 && t.length > 0;
  const xs = useR ? r.filter((x): x is number => x != null) : t.map(x => x.net);
  const mean = xs.reduce((s, x) => s + x, 0) / (xs.length || 1), sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length || 1));
  const w = t.filter(x => x.net > 0), l = t.filter(x => x.net < 0), p = t.length ? w.length / t.length : 0;
  const b = l.length && w.length ? (w.reduce((s, x) => s + x.net, 0) / w.length) / (-l.reduce((s, x) => s + x.net, 0) / l.length) : 0;
  return { unit: useR ? 'R' : '$', expectancy: mean, sqn: sd ? (mean / sd) * Math.sqrt(Math.min(xs.length, 100)) : 0, kelly: b ? (p - (1 - p) / b) * 100 : 0 };
}

// ---------- discipline (mirrors the documented rules of the reference app; our own levels) ----------
export const DISCIPLINE_ITEMS: { key: string; label: string; done: (t: JTrade) => boolean }[] = [
  { key: 'stop', label: 'Valid initial stop', done: t => t.stop != null && t.stop > 0 && t.stop !== t.avgEntry },
  { key: 'entry', label: 'Entry reason', done: t => !!(t.entryReasons?.length || t.entryReason?.trim()) },
  { key: 'exit', label: 'Exit reason', done: t => !!(t.exitReasons?.length || t.exitReason?.trim() || t.exitKind) },
  { key: 'notes', label: 'Trade notes', done: t => !!t.notes?.trim() },
  { key: 'checklist', label: 'At least one checklist tick', done: t => !!t.checklist?.done.length },
  { key: 'image', label: 'At least one picture', done: t => !!(t.shot || t.media?.some(m => m.kind === 'image')) },
  { key: 'emotion', label: 'At least one emotion', done: t => !!(t.emotionsBefore?.length || t.emotionsAfter?.length || t.emotionIn || t.emotionOut) },
];
const endOfDay = (t: number) => { const d = new Date(t * 1000); d.setHours(23, 59, 59, 999); return d.getTime() / 1000 };
/** Update a trade's earned points after a save: items count only if completed by the end of the day it was created. */
export function award(t: JTrade, now = Date.now() / 1000) {
  if (t.kind === 'notrade') return t.points = { notrade: 80 };
  const p = { ...(t.points ?? {}) }, inTime = now <= endOfDay(t.createdAt ?? t.openTime);
  for (const it of DISCIPLINE_ITEMS) { if (!it.done(t)) delete p[it.key]; else if (p[it.key] == null && inTime) p[it.key] = 10 }
  if (DISCIPLINE_ITEMS.every(it => p[it.key])) { if (p.bonus == null && inTime) p.bonus = 10 } else delete p.bonus;
  return (t.points = p);
}
export const pointsOf = (t: JTrade) => Object.values(t.points ?? {}).reduce((s, v) => s + v, 0);
/** Day score: average of that day's journal entries (a no-trade day is 80), + up to 20 for 5 closed backtest trades; max 100. */
export function dayScores(j: Journal) {
  const days = new Map<string, { entries: JTrade[]; backtests: number }>();
  const bt = new Set((j.accounts ?? []).filter(a => a.kind === 'backtest').map(a => a.id));
  for (const t of j.trades) {
    const k = dayKeyOf(t.createdAt ?? t.openTime), d = days.get(k) ?? { entries: [], backtests: 0 };
    if (bt.has(t.accountId ?? '')) { if (t.status === 'closed') d.backtests++ } else d.entries.push(t);
    days.set(k, d);
  }
  const out = new Map<string, number>();
  for (const [k, d] of days) {
    const nt = d.entries.find(t => t.kind === 'notrade'), trades = d.entries.filter(t => t.kind !== 'notrade');
    const base = nt && !trades.length ? 80 : trades.length ? trades.reduce((s, t) => s + pointsOf(t), 0) / trades.length : 0;
    out.set(k, Math.min(100, base + (d.backtests >= 5 ? 20 : 0)));
  }
  return out;
}
export const LEVELS = [{ name: 'Bronze', min: 0 }, { name: 'Silver', min: 1000 }, { name: 'Gold', min: 3000 }, { name: 'Platinum', min: 7000 }, { name: 'Diamond', min: 15000 }];
export function discipline(j: Journal, now = Date.now() / 1000) {
  const scores = dayScores(j), active = new Set(j.activeDays ?? [1, 2, 3, 4, 5]), total = [...scores.values()].reduce((s, v) => s + v, 0);
  // Streak: walk back from today; inactive (rest) days neither break nor extend it; today may still be open.
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const d = new Date((now - i * 86400) * 1000), k = dayKeyOf(d.getTime() / 1000);
    if (!active.has(d.getDay())) continue;
    if (scores.has(k)) streak++; else if (i > 0) break;
  }
  const level = [...LEVELS].reverse().find(l => total >= l.min)!, next = LEVELS[LEVELS.indexOf(level) + 1];
  return { scores, total, streak, level: level.name, next: next ? { name: next.name, need: next.min - total } : null, today: scores.get(dayKeyOf(now)) ?? 0, restDay: !active.has(new Date(now * 1000).getDay()) };
}

// ---------- prop challenge ----------
export function evalProp(p: Prop, j: Journal) {
  const acc = (j.accounts ?? []).find(a => a.id === p.accountId);
  const start = acc ? acc.initial : 0;
  const t = closed(j.trades.filter(x => (x.accountId ?? 'paper') === p.accountId && tradeTime(x) >= p.start)).sort((a, b) => tradeTime(a) - tradeTime(b));
  let bal = start, peak = start, worstTotal = 0, worstDaily = 0;
  const dayStart = new Map<string, number>();
  for (const x of t) {
    const k = dayKeyOf(tradeTime(x));
    if (!dayStart.has(k)) dayStart.set(k, bal);
    bal += x.net; peak = Math.max(peak, bal);
    const floor = p.ddType === 'trailing' ? peak : start;
    worstTotal = Math.max(worstTotal, ((floor - bal) / start) * 100);
    worstDaily = Math.max(worstDaily, ((dayStart.get(k)! - bal) / start) * 100);
  }
  const profitPct = start ? ((bal - start) / start) * 100 : 0, days = dayStart.size;
  const failed = worstTotal >= p.maxDD || (p.dailyDD > 0 && worstDaily >= p.dailyDD);
  const passed = !failed && profitPct >= p.target && days >= p.minDays;
  return { balance: bal, profitPct, worstTotal, worstDaily, days, status: failed ? 'failed' : passed ? 'passed' : 'in progress', trades: t.length };
}

// ---------- statement import ----------
export interface Imported { sym: string; dir: 'long' | 'short'; openTime: number; closeTime: number; qty: number; entry: number; exit: number; stop?: number; target?: number; commission: number; swap: number; profit: number; ticket?: string }
const cellText = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = (s: string) => +s.replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '');
const mtTime = (s: string) => { const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000 : NaN };
/** MetaTrader 5 "Positions" table or MetaTrader 4 "Closed Transactions" from an HTML statement (times are server time, taken as UTC). */
export function parseMtHtml(html: string): Imported[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cellText(c[1])));
  const out: Imported[] = [];
  for (const c of rows) {
    const v = c.filter(x => x !== '');
    // MT5: Time, Position, Symbol, Type, Volume, Price, S/L, T/P, Time, Price, Commission, Swap, Profit
    if (v.length >= 13 && /^\d{4}\.\d{2}\.\d{2}/.test(v[0]) && /^(buy|sell)$/i.test(v[3]) && /^\d{4}\.\d{2}\.\d{2}/.test(v[8]))
      out.push({ ticket: v[1], sym: v[2], dir: /buy/i.test(v[3]) ? 'long' : 'short', qty: num(v[4]), entry: num(v[5]), stop: num(v[6]) || undefined, target: num(v[7]) || undefined, openTime: mtTime(v[0]), closeTime: mtTime(v[8]), exit: num(v[9]), commission: num(v[10]) || 0, swap: num(v[11]) || 0, profit: num(v[12]) });
    // MT4: Ticket, Open Time, Type, Size, Item, Price, S/L, T/P, Close Time, Price, Commission, Taxes, Swap, Profit
    else if (v.length >= 14 && /^\d+$/.test(v[0]) && /^\d{4}\.\d{2}\.\d{2}/.test(v[1]) && /^(buy|sell)$/i.test(v[2]))
      out.push({ ticket: v[0], openTime: mtTime(v[1]), dir: /buy/i.test(v[2]) ? 'long' : 'short', qty: num(v[3]), sym: v[4].toUpperCase(), entry: num(v[5]), stop: num(v[6]) || undefined, target: num(v[7]) || undefined, closeTime: mtTime(v[8]), exit: num(v[9]), commission: (num(v[10]) || 0) + (num(v[11]) || 0), swap: num(v[12]) || 0, profit: num(v[13]) });
  }
  return out.filter(x => Number.isFinite(x.openTime) && Number.isFinite(x.profit));
}
/** CSV with a header row; columns are matched by common names (symbol, side/type, open/close time, qty, entry/exit price, pnl, fee). */
export function parseCsv(text: string): Imported[] {
  const lines = text.trim().split(/\r?\n/), sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out.map(x => x.trim()) };
  const head = split(lines[0]).map(h => h.toLowerCase());
  const col = (...names: RegExp[]) => head.findIndex(h => names.some(n => n.test(h)));
  const c = { sym: col(/^symbol|^pair|^market|^instrument|^item/), side: col(/^side|^type|^direction/), ot: col(/open.*time|entry.*time|^open$|^opened|^date|^time/), ct: col(/close.*time|exit.*time|^closed/),
    qty: col(/^qty|quantity|^size|^volume|^amount|^lots?/), entry: col(/entry.*price|open.*price|^price|^avg.*entry/), exit: col(/exit.*price|close.*price|^avg.*exit/), pnl: col(/pnl|p&l|profit|realized/), fee: col(/fee|commission/), sl: col(/^s\/?l|stop/), tp: col(/^t\/?p|target|take/) };
  if (c.sym < 0 || c.pnl < 0) throw Error('CSV needs at least a symbol and a profit/PnL column');
  const time = (s: string) => { if (!s) return NaN; const n = +s; if (Number.isFinite(n)) return n > 1e11 ? n / 1000 : n; const m = mtTime(s); return Number.isFinite(m) ? m : Date.parse(s.replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : 'Z')) / 1000 };
  return lines.slice(1).filter(l => l.trim()).map(l => {
    const v = split(l), g = (i: number) => (i >= 0 ? v[i] ?? '' : ''), ot = time(g(c.ot));
    return { sym: g(c.sym).replace(/[^A-Za-z0-9.]/g, '').toUpperCase(), dir: /sell|short/i.test(g(c.side)) ? 'short' : 'long', openTime: ot, closeTime: Number.isFinite(time(g(c.ct))) ? time(g(c.ct)) : ot,
      qty: Math.abs(num(g(c.qty)) || 0), entry: num(g(c.entry)) || 0, exit: num(g(c.exit)) || 0, profit: num(g(c.pnl)), commission: Math.abs(num(g(c.fee)) || 0), swap: 0, stop: num(g(c.sl)) || undefined, target: num(g(c.tp)) || undefined } as Imported;
  }).filter(x => x.sym && Number.isFinite(x.profit) && Number.isFinite(x.openTime));
}
/** Turn imported rows into journal trades of an account, skipping ones already imported (same symbol, open time and size). */
export function addImported(j: Journal, rows: Imported[], accountId: string) {
  const seen = new Set(j.trades.filter(t => t.accountId === accountId).map(t => `${t.sym}|${t.openTime}|${t.maxQty}`));
  let added = 0;
  for (const r of rows) {
    const key = `${r.sym}|${r.openTime}|${r.qty}`; if (seen.has(key)) continue; seen.add(key);
    const fees = Math.abs(r.commission), net = r.profit - fees + r.swap;
    j.trades.push({ id: uid(), accountId, kind: 'trade', source: 'Import', createdAt: Date.now() / 1000, sym: r.sym, dir: r.dir, status: 'closed', openTime: r.openTime, closeTime: r.closeTime,
      qty: 0, maxQty: r.qty, avgEntry: r.entry, avgExit: r.exit, exitQty: r.qty, gross: r.profit, fees, swap: r.swap, net, fills: [], mfe: Math.max(0, net), mae: Math.min(0, net), stop: r.stop, target: r.target, title: r.ticket ? `#${r.ticket}` : undefined });
    added++;
  }
  return added;
}
