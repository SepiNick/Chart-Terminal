// Trading journal model: no DOM. Paper-account fills are folded into round-trip trades (open → scale in/out →
// flat), price ticks track MAE/MFE, and the user's reasons/emotions/mistakes live on each trade.
import type { Account, Fill } from './trading.ts';

export interface JFill { t: number; side: 'buy' | 'sell'; qty: number; px: number; fee: number; realized: number }
export interface JTrade {
  id: string; sym: string; dir: 'long' | 'short'; status: 'open' | 'closed';
  openTime: number; closeTime?: number;
  qty: number; maxQty: number;              // current open size and largest size held
  avgEntry: number; avgExit?: number;       // volume-weighted
  exitQty: number; gross: number; fees: number; net: number;
  fills: JFill[];
  mfe: number; mae: number;                 // best / worst unrealised P&L seen while open (money)
  tf?: string; source?: string;             // chart timeframe at entry; 'forward test' etc.
  // filled in by the trader
  setup?: string; entryReason?: string; exitReason?: string; exitKind?: string;
  emotionIn?: string; emotionOut?: string; confidence?: number; followedPlan?: boolean;
  mistakes?: string[]; tags?: string[]; lesson?: string; rating?: number; notes?: string;
  stop?: number; target?: number;           // planned levels → R-multiple
  shot?: string;                            // small JPEG data URL of the chart
  askedIn?: boolean; askedOut?: boolean;    // reason prompts already shown
  // ---- full journal form (manual entries and enrichment of captured trades) ----
  accountId?: string;                       // 'paper' for trades captured from the paper account
  kind?: 'trade' | 'notrade';               // a "no-trade day" entry keeps symbol, tf, date and why
  createdAt?: number;                       // when the entry was first saved (discipline deadline)
  title?: string;
  riskFree?: boolean;                       // stop moved to break-even
  stopFinal?: number; targetFinal?: number; rrExpected?: number; rrActual?: number;   // manual R:R overrides
  swap?: number; riskPct?: number;
  entryReasons?: string[]; exitReasons?: string[];   // picked from the editable lists
  checklist?: { id: string; done: string[] };
  media?: { id: string; kind: 'image' | 'audio'; name?: string }[];   // blobs live in IndexedDB
  emotionsBefore?: string[]; emotionsAfter?: string[]; energy?: number; motives?: string[];
  answers?: Record<string, boolean>;        // custom yes/no questions
  crypto?: { notional?: number; market?: 'futures' | 'spot'; exchange?: string; contract?: string; leverage?: number; margin?: 'cross' | 'isolated'; liq?: number; funding?: number; networkFee?: number };
  custom?: Record<string, string | number | boolean>;
  noTradeReason?: string;
  points?: Record<string, number>;          // discipline points earned per item (kept once earned in time)
}
export interface JAccount { id: string; name: string; initial: number; kind: 'paper' | 'manual' | 'backtest'; transfers: { id: string; t: number; amount: number; note?: string }[] }
export interface Checklist { id: string; title: string; items: { id: string; text: string; weight: number }[]; advanced?: boolean }
export interface Note { id: string; title: string; body: string; tags: string[]; pinned?: boolean; created: number; updated: number }
export interface CustomField { id: string; label: string; type: 'text' | 'number' | 'select' | 'checkbox' | 'date'; options?: string[] }
export interface Prop { id: string; name: string; accountId: string; phase: string; target: number; maxDD: number; dailyDD: number; ddType: 'static' | 'trailing'; minDays: number; start: number }
export interface Journal {
  trades: JTrade[]; seen: number; synced?: boolean; notes: Record<string, string>; setups: string[];
  accounts?: JAccount[]; account?: string;  // selected account ('' = all)
  entryReasons?: string[]; exitReasons?: string[]; motives?: string[]; questions?: string[]; tagList?: string[];
  checklists?: Checklist[]; docs?: Note[]; fields?: CustomField[]; props?: Prop[];
  activeDays?: number[];                    // weekdays (0 = Sunday) that count for the discipline streak
  calendar?: 'gregorian' | 'jalali';
}

export const EMOTIONS = ['Calm', 'Confident', 'Focused', 'Uncertain', 'Fearful', 'Greedy', 'FOMO', 'Revenge', 'Bored', 'Tired', 'Euphoric', 'Frustrated'];
export const MISTAKES = ['No stop loss', 'Moved stop', 'Exited too early', 'Held too long', 'Late entry', 'Chased price', 'Oversized', 'Against trend', 'Ignored plan', 'Overtrading', 'Revenge trade', 'Added to loser', 'News ignored'];
export const EXIT_KINDS = ['Target hit', 'Stop hit', 'Trailing stop', 'Exit signal', 'Discretionary', 'Time exit', 'Breakeven', 'News / event', 'Fear', 'Margin / risk limit'];
export const DEFAULT_SETUPS = ['Breakout', 'Pullback', 'Reversal', 'Range', 'Trend follow', 'Scalp', 'News'];

export const MOTIVES = ['Per strategy', 'FOMO', 'Revenge on the market', 'Intuition', "Someone's advice", 'News', 'Technical signal', 'Fundamental signal'];
export const FEELINGS = ['Calm', 'Confident', 'Anxious', 'Fearful', 'Greedy', 'Excited', 'Disappointed', 'Neutral', 'Angry', 'Tired'];
export const DEFAULT_ENTRY_REASONS = ['Price action', 'Support / resistance', 'Trend line', 'Breakout', 'Pullback', 'Classic pattern', 'Candlestick pattern', 'Indicator signal', 'Ichimoku', 'Order flow', 'Liquidity sweep', 'News'];
export const DEFAULT_EXIT_REASONS = ['Target hit', 'Stop hit', 'Trailing stop', 'Opposite signal', 'Time exit', 'Break-even', 'Manual / discretionary', 'News', 'Fear'];

export const newJournal = (): Journal => ({ trades: [], seen: 0, notes: {}, setups: [...DEFAULT_SETUPS] });
/** Fill in lists and the paper account for journals saved by older versions. */
export function migrate(j: Journal): Journal {
  j.accounts ??= [{ id: 'paper', name: 'Paper account', initial: 10000, kind: 'paper', transfers: [] }];
  j.account ??= '';
  j.entryReasons ??= [...DEFAULT_ENTRY_REASONS]; j.exitReasons ??= [...DEFAULT_EXIT_REASONS];
  j.motives ??= [...MOTIVES]; j.questions ??= []; j.tagList ??= [];
  j.checklists ??= []; j.docs ??= []; j.fields ??= []; j.props ??= [];
  j.activeDays ??= [1, 2, 3, 4, 5];
  j.calendar ??= 'gregorian';
  for (const t of j.trades) { t.accountId ??= 'paper'; t.kind ??= 'trade'; t.createdAt ??= t.openTime }
  return j;
}
const sign = (t: JTrade) => (t.dir === 'long' ? 1 : -1);
export const uid = () => `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Fold one fill into the journal. Returns trades that were opened and closed by it (for prompting). */
export function applyFill(j: Journal, sym: string, f: JFill, ctx: { tf?: string; source?: string; stop?: number; target?: number } = {}) {
  const opened: JTrade[] = [], closed: JTrade[] = [];
  let open = j.trades.find(t => t.sym === sym && t.status === 'open' && (t.accountId ?? 'paper') === 'paper');
  let qty = f.qty, fee = f.fee;
  const dir = f.side === 'buy' ? 'long' : 'short';
  if (open && open.dir !== dir) {
    // Reduce (and maybe flip). The account's realised P&L for this fill belongs to the closing part.
    const q = Math.min(qty, open.qty), part = q / qty;
    open.fills.push({ ...f, qty: q, fee: fee * part });
    open.avgExit = ((open.avgExit ?? 0) * open.exitQty + f.px * q) / (open.exitQty + q);
    open.exitQty += q; open.qty = +(open.qty - q).toFixed(10);
    open.gross += f.realized; open.fees += fee * part; open.net = open.gross - open.fees;
    qty = +(qty - q).toFixed(10); fee -= fee * part;
    if (open.qty <= 1e-12) { open.qty = 0; open.status = 'closed'; open.closeTime = f.t; closed.push(open); open = undefined }
  }
  if (qty > 1e-12) {
    if (!open) {
      open = { id: uid(), accountId: 'paper', kind: 'trade', createdAt: Date.now() / 1000, sym, dir, status: 'open', openTime: f.t, qty: 0, maxQty: 0, avgEntry: f.px, exitQty: 0, gross: 0, fees: 0, net: 0, fills: [], mfe: 0, mae: 0, tf: ctx.tf, source: ctx.source, stop: ctx.stop, target: ctx.target };
      j.trades.push(open); opened.push(open);
    }
    open.avgEntry = (open.avgEntry * open.qty + f.px * qty) / (open.qty + qty);
    open.qty += qty; open.maxQty = Math.max(open.maxQty, open.qty);
    open.fills.push({ ...f, qty, fee, realized: 0 });
    open.fees += fee; open.net = open.gross - open.fees;
  }
  return { opened, closed };
}

/** Import every fill the journal has not seen yet (account fills are newest-first). */
export function syncFills(j: Journal, a: Account, now: number, ctx: (sym: string) => Parameters<typeof applyFill>[3] = () => ({})) {
  const opened: JTrade[] = [], closed: JTrade[] = [];
  if (a.fills.length < j.seen) {   // account was reset: positions are gone
    for (const t of j.trades) if (t.status === 'open') { t.status = 'closed'; t.closeTime = now; t.notes = [t.notes, 'Closed by paper account reset'].filter(Boolean).join('\n') }
    j.seen = 0;
  }
  const fresh: Fill[] = a.fills.slice(0, a.fills.length - j.seen).reverse();
  for (const f of fresh) {
    // Fills from before the journal existed keep their own time; live ones use the wall clock (fill.ts can be a bar time).
    const r = applyFill(j, f.sym, { t: j.synced ? now : f.ts, side: f.side, qty: f.qty, px: f.px, fee: f.fee, realized: f.realized }, ctx(f.sym));
    opened.push(...r.opened); closed.push(...r.closed);
  }
  j.seen = a.fills.length; j.synced = true;
  return { opened, closed };
}

/** Track max favourable / adverse excursion of open trades on a price tick. */
export function mark(j: Journal, sym: string, px: number) {
  let changed = false;
  for (const t of j.trades) {
    if (t.status !== 'open' || t.sym !== sym) continue;
    const u = (px - t.avgEntry) * t.qty * sign(t) + t.gross;
    if (u > t.mfe) { t.mfe = u; changed = true }
    if (u < t.mae) { t.mae = u; changed = true }
  }
  return changed;
}

/** Profit in units of initial risk (needs a planned stop). */
export function rMultiple(t: JTrade): number | null {
  if (t.stop == null || !t.maxQty) return null;
  const risk = Math.abs(t.avgEntry - t.stop) * t.maxQty;
  return risk > 0 ? t.net / risk : null;
}
/** Trades missing the trader's input (highlighted in the list, like ATAS's incomplete rows). */
export const incomplete = (t: JTrade) => !t.setup || !t.entryReason || (t.status === 'closed' && !t.exitReason && !t.exitKind);

export interface Filter { from?: number; to?: number; sym?: string; setup?: string; dir?: string; result?: 'win' | 'loss'; tag?: string }
export function filterTrades(trades: JTrade[], f: Filter) {
  return trades.filter(t => (f.from == null || t.openTime >= f.from) && (f.to == null || t.openTime < f.to) && (!f.sym || t.sym === f.sym) && (!f.setup || t.setup === f.setup)
    && (!f.dir || t.dir === f.dir) && (!f.tag || t.tags?.includes(f.tag) || t.mistakes?.includes(f.tag))
    && (!f.result || (t.status === 'closed' && (f.result === 'win' ? t.net > 0 : t.net <= 0))));
}

export interface Group { key: string; n: number; net: number; winRate: number; pf: number; avg: number }
function group(trades: JTrade[], keys: (t: JTrade) => string[]): Group[] {
  const m = new Map<string, JTrade[]>();
  for (const t of trades) for (const k of keys(t)) m.set(k, [...(m.get(k) ?? []), t]);
  return [...m].map(([key, ts]) => {
    const w = ts.filter(t => t.net > 0), gp = w.reduce((a, t) => a + t.net, 0), gl = -ts.filter(t => t.net < 0).reduce((a, t) => a + t.net, 0);
    return { key, n: ts.length, net: gp - gl, winRate: (w.length / ts.length) * 100, pf: gl ? gp / gl : gp ? Infinity : 0, avg: (gp - gl) / ts.length };
  }).sort((a, b) => b.net - a.net);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayKey = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };

export function stats(all: JTrade[]) {
  const t = all.filter(x => x.status === 'closed').sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0));
  const wins = t.filter(x => x.net > 0), losses = t.filter(x => x.net <= 0);
  const gp = wins.reduce((a, x) => a + x.net, 0), gl = -losses.reduce((a, x) => a + x.net, 0), net = gp - gl;
  let eq = 0, peak = 0, dd = 0, streak = 0, bestStreak = 0, worstStreak = 0;
  const curve = t.map(x => {
    eq += x.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    streak = x.net > 0 ? Math.max(1, streak + 1) : Math.min(-1, streak - 1);
    bestStreak = Math.max(bestStreak, streak); worstStreak = Math.min(worstStreak, streak);
    return eq;
  });
  const rs = t.map(rMultiple).filter((r): r is number => r != null);
  const days = new Map<string, { net: number; n: number; wins: number }>();
  for (const x of t) { const k = dayKey(x.closeTime!), d = days.get(k) ?? { net: 0, n: 0, wins: 0 }; d.net += x.net; d.n++; if (x.net > 0) d.wins++; days.set(k, d) }
  const winRate = t.length ? (wins.length / t.length) * 100 : 0, avgWin = wins.length ? gp / wins.length : 0, avgLoss = losses.length ? gl / losses.length : 0;
  // Exit efficiency: how much of the best open profit was kept (only trades that were ever in profit).
  const eff = t.filter(x => x.mfe > 0).map(x => x.net / x.mfe);
  return {
    trades: t.length, open: all.filter(x => x.status === 'open').length, net, gp, gl, fees: t.reduce((a, x) => a + x.fees, 0),
    winRate, pf: gl ? gp / gl : gp ? Infinity : 0, avgWin, avgLoss, expectancy: t.length ? net / t.length : 0, payoff: avgLoss ? avgWin / avgLoss : 0,
    best: Math.max(0, ...t.map(x => x.net)), worst: Math.min(0, ...t.map(x => x.net)), maxDD: dd, curve,
    avgR: rs.length ? rs.reduce((a, r) => a + r, 0) / rs.length : null, rCount: rs.length,
    avgHoldMin: t.length ? t.reduce((a, x) => a + (x.closeTime! - x.openTime), 0) / t.length / 60 : 0,
    bestStreak, worstStreak: -worstStreak, exitEfficiency: eff.length ? (eff.reduce((a, x) => a + x, 0) / eff.length) * 100 : null,
    followedPlan: (() => { const k = t.filter(x => x.followedPlan != null); return k.length ? (k.filter(x => x.followedPlan).length / k.length) * 100 : null })(),
    days, greenDays: [...days.values()].filter(d => d.net > 0).length,
    bySetup: group(t, x => [x.setup || '(no setup)']), bySymbol: group(t, x => [x.sym]), byDir: group(t, x => [x.dir]),
    byEmotion: group(t, x => [x.emotionIn || '(not set)']), byMistake: group(t, x => x.mistakes?.length ? x.mistakes : ['(no mistakes)']),
    byWeekday: group(t, x => [DAYS[new Date(x.openTime * 1000).getDay()]]), byHour: group(t, x => [`${String(new Date(x.openTime * 1000).getHours()).padStart(2, '0')}:00`]),
  };
}

export function toCsv(trades: JTrade[]) {
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s };
  const iso = (t?: number) => (t ? new Date(t * 1000).toISOString() : '');
  const head = ['Symbol', 'Direction', 'Status', 'Open time', 'Close time', 'Max qty', 'Avg entry', 'Avg exit', 'Gross P&L', 'Fees', 'Net P&L', 'R', 'MFE', 'MAE', 'Setup', 'Entry reason', 'Exit type', 'Exit reason', 'Emotion in', 'Emotion out', 'Confidence', 'Followed plan', 'Mistakes', 'Tags', 'Lesson', 'Rating', 'Stop', 'Target', 'Timeframe', 'Source', 'Notes'];
  return [head, ...trades.map(t => [t.sym, t.dir, t.status, iso(t.openTime), iso(t.closeTime), t.maxQty, t.avgEntry, t.avgExit, t.gross, t.fees, t.net, rMultiple(t), t.mfe, t.mae, t.setup, t.entryReason, t.exitKind, t.exitReason, t.emotionIn, t.emotionOut, t.confidence, t.followedPlan, t.mistakes?.join('; '), t.tags?.join('; '), t.lesson, t.rating, t.stop, t.target, t.tf, t.source, t.notes])]
    .map(r => r.map(q).join(',')).join('\n');
}
