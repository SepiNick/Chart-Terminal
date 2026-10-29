// Journal & review skills on the app's own journal (closed trades): drawdown-circuit-breaker, pre-trade-discipline-gate,
// weekly-performance-digest, trade-performance-coach. Recommendations only; the broker guard (phase 6) stays the hard
// limit, these never loosen it.
import { money, num, pct, type Ctx, type Result, type Skill } from './types.ts';

export type JTradeLike = ReturnType<Ctx['trades']>[number];
const HOUR = 3600, DAY = 86400;

/** Calendar parts of a unix time in a time zone ('UTC' or e.g. 'America/New_York'). */
function parts(t: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(t * 1000));
  const g = (k: string) => f.find(x => x.type === k)!.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, month: `${g('year')}-${g('month')}`, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(g('weekday')) };
}
/** Monday (as a day key) of t's week in tz. */
const weekOf = (t: number, tz: string) => parts(t - parts(t, tz).wd * DAY, tz).day;

export interface CbRules { maxDailyLossPct: number; streakN: number; cooldownHours: number; weeklyPct: number; monthlyPct: number; tz: string }
export const CB_DEFAULTS: CbRules = { maxDailyLossPct: 2, streakN: 2, cooldownHours: 24, weeklyPct: 5, monthlyPct: 8, tz: 'UTC' };
export interface CbOut { recommendation: 'TRADING_ALLOWED' | 'COOLDOWN' | 'HALTED'; rules: { rule: string; value: string; limit: string; active: boolean; until?: string }[]; day: number; week: number; month: number; streak: number }

/** drawdown-circuit-breaker: realized P&L today / this week / this month and the latest losing streak, vs. limits. */
export function circuitBreaker(trades: JTradeLike[], account: number, now: number, r: CbRules = CB_DEFAULTS): CbOut {
  if (!(account > 0)) throw new Error('Account size must be positive');
  const closed = trades.filter(t => t.status === 'closed' && t.closeTime != null && t.closeTime <= now).sort((a, b) => a.closeTime! - b.closeTime!);
  const p = parts(now, r.tz), wk = weekOf(now, r.tz);
  const sum = (f: (t: JTradeLike) => boolean) => closed.filter(f).reduce((s, t) => s + t.net, 0);
  const day = sum(t => parts(t.closeTime!, r.tz).day === p.day), week = sum(t => weekOf(t.closeTime!, r.tz) === wk), month = sum(t => parts(t.closeTime!, r.tz).month === p.month);
  let streak = 0;
  for (let i = closed.length - 1; i >= 0 && closed[i].net < 0; i--) streak++;
  const lastLoss = closed.at(-1)?.net! < 0 ? closed.at(-1)!.closeTime! : 0, coolUntil = lastLoss + r.cooldownHours * HOUR;
  const fmtT = (t: number) => new Date(t * 1000).toISOString().replace('.000', '');
  const nextDay = () => { let t = now; while (parts(t, r.tz).day === p.day) t += HOUR; return t };
  const rules: CbOut['rules'] = [
    { rule: 'Max daily loss', value: pct((-day / account) * 100), limit: `${r.maxDailyLossPct}%`, active: -day >= (account * r.maxDailyLossPct) / 100, until: fmtT(nextDay()) },
    { rule: `Losing streak (${r.streakN} in a row)`, value: String(streak), limit: `${r.streakN}`, active: streak >= r.streakN && now < coolUntil, until: fmtT(coolUntil) },
    { rule: 'Weekly drawdown', value: pct((-week / account) * 100), limit: `${r.weeklyPct}%`, active: -week >= (account * r.weeklyPct) / 100 },
    { rule: 'Monthly drawdown', value: pct((-month / account) * 100), limit: `${r.monthlyPct}%`, active: -month >= (account * r.monthlyPct) / 100 },
  ];
  const halted = rules.some((x, i) => x.active && i !== 1), cool = rules[1].active;
  return { recommendation: halted ? 'HALTED' : cool ? 'COOLDOWN' : 'TRADING_ALLOWED', rules, day, week, month, streak };
}

const cbInputs = [
  { key: 'account', label: 'Account size', type: 'number' as const, optional: true, hint: 'empty = paper account equity' },
  { key: 'maxDailyLossPct', label: 'Max daily loss %', type: 'number' as const, default: 2 },
  { key: 'streakN', label: 'Losing streak N', type: 'number' as const, default: 2 },
  { key: 'cooldownHours', label: 'Cooldown hours', type: 'number' as const, default: 24 },
  { key: 'weeklyPct', label: 'Weekly drawdown %', type: 'number' as const, default: 5 },
  { key: 'monthlyPct', label: 'Monthly drawdown %', type: 'number' as const, default: 8 },
  { key: 'tz', label: 'Day boundaries', type: 'select' as const, options: ['UTC', 'America/New_York', 'Asia/Tehran'], default: 'UTC' },
];
const readCb = (v: Record<string, unknown>, ctx: Ctx) => {
  const acct = num(v.account, 'Account size', { optional: true });
  return { account: Number.isFinite(acct) && acct > 0 ? acct : ctx.account().equity, rules: { maxDailyLossPct: num(v.maxDailyLossPct, 'Max daily loss %', { min: 0 }), streakN: num(v.streakN, 'Streak', { min: 1 }), cooldownHours: num(v.cooldownHours, 'Cooldown', { min: 0 }), weeklyPct: num(v.weeklyPct, 'Weekly %', { min: 0 }), monthlyPct: num(v.monthlyPct, 'Monthly %', { min: 0 }), tz: String(v.tz || 'UTC') } };
};
const cbView = (o: CbOut): Result => ({
  verdict: { label: o.recommendation.replace('_', ' '), tone: o.recommendation === 'TRADING_ALLOWED' ? 'up' : o.recommendation === 'COOLDOWN' ? 'warn' : 'dn', detail: o.recommendation === 'TRADING_ALLOWED' ? 'No limit is active' : 'No new positions; manage the open ones' },
  kpis: [{ label: 'Today', value: money(o.day), tone: o.day < 0 ? 'dn' : 'up' }, { label: 'This week', value: money(o.week), tone: o.week < 0 ? 'dn' : 'up' }, { label: 'This month', value: money(o.month), tone: o.month < 0 ? 'dn' : 'up' }, { label: 'Losing streak', value: o.streak }],
  tables: [{ title: 'Rules', cols: ['Rule', 'Now', 'Limit', 'Active'], rows: o.rules.map(x => [x.rule, x.value, x.limit, x.active ? `yes${x.until ? ` until ${x.until}` : ''}` : 'no']) }],
});
export const circuitBreakerSkill: Skill = {
  id: 'drawdown-circuit-breaker', name: 'Drawdown circuit breaker', group: 'Journal & review', from: 'drawdown-circuit-breaker',
  desc: 'May you take new risk today? Realized P&L of journal trades vs. daily / weekly / monthly loss limits, plus a cooldown after a losing streak.',
  inputs: cbInputs,
  run(v, ctx) { const { account, rules } = readCb(v, ctx); return cbView(circuitBreaker(ctx.trades(), account, Date.now() / 1000, rules)) },
};

// ---------- pre-trade discipline gate ----------
export interface GateIn { entryInPlan: boolean; stopPredefined: boolean; sizeInPlan: boolean; plannedRisk: number; actualRisk: number; breaker: CbOut['recommendation']; recentLosses: { sym: string; net: number; at: number }[]; revengeHours: number }
export function preTradeGate(g: GateIn): { decision: 'GO' | 'REVIEW_REQUIRED' | 'NO_GO'; reasons: string[] } {
  const reasons: string[] = [];
  let rank = 0;
  const raise = (r: number, why: string) => { rank = Math.max(rank, r); reasons.push(why) };
  if (!g.entryInPlan) raise(2, 'Entry is not confirmed in a written plan');
  if (!g.stopPredefined) raise(2, 'Stop is not predefined');
  if (!g.sizeInPlan) raise(2, 'Size is not confirmed within the plan');
  if (!Number.isFinite(g.plannedRisk) || g.plannedRisk < 0) raise(1, 'Planned risk ($) is required');
  if (!Number.isFinite(g.actualRisk) || g.actualRisk < 0) raise(1, 'Actual risk ($) is required');
  if (g.actualRisk > g.plannedRisk) raise(2, `Actual risk ${money(g.actualRisk)} exceeds planned risk ${money(g.plannedRisk)}`);
  if (g.breaker !== 'TRADING_ALLOWED') raise(2, `Circuit breaker is ${g.breaker}`);
  for (const l of g.recentLosses.slice(0, 5)) raise(2, `Revenge risk: losing exit within ${g.revengeHours}h — ${l.sym} ${money(l.net)} at ${new Date(l.at * 1000).toISOString().slice(0, 16)}`);
  return { decision: (['GO', 'REVIEW_REQUIRED', 'NO_GO'] as const)[rank], reasons };
}
export const preTradeGateSkill: Skill = {
  id: 'pre-trade-discipline-gate', name: 'Pre-trade discipline gate', group: 'Journal & review', from: 'pre-trade-discipline-gate',
  desc: 'Checklist before a manual order: written plan, predefined stop, size within plan, actual risk ≤ planned, circuit breaker clear, no losing exit in the revenge window.',
  inputs: [
    { key: 'entryInPlan', label: 'Entry is in my written plan', type: 'bool', default: false },
    { key: 'stopPredefined', label: 'Stop is predefined', type: 'bool', default: false },
    { key: 'sizeInPlan', label: 'Size is within the plan', type: 'bool', default: false },
    { key: 'plannedRisk', label: 'Planned risk ($)', type: 'number' },
    { key: 'actualRisk', label: 'Actual risk ($)', type: 'number' },
    { key: 'revengeHours', label: 'Revenge window (hours)', type: 'number', default: 24 },
    ...cbInputs,
  ],
  run(v, ctx) {
    const now = Date.now() / 1000, { account, rules } = readCb(v, ctx), hours = num(v.revengeHours, 'Revenge window', { min: 0.1 });
    const cb = circuitBreaker(ctx.trades(), account, now, rules);
    const recentLosses = ctx.trades().filter(t => t.status === 'closed' && t.net < 0 && t.closeTime! >= now - hours * HOUR).sort((a, b) => b.closeTime! - a.closeTime!).map(t => ({ sym: t.sym, net: t.net, at: t.closeTime! }));
    const g = preTradeGate({ entryInPlan: !!v.entryInPlan, stopPredefined: !!v.stopPredefined, sizeInPlan: !!v.sizeInPlan, plannedRisk: num(v.plannedRisk, 'Planned risk', { optional: true }), actualRisk: num(v.actualRisk, 'Actual risk', { optional: true }), breaker: cb.recommendation, recentLosses, revengeHours: hours });
    return { verdict: { label: g.decision.replace('_', ' '), tone: g.decision === 'GO' ? 'up' : g.decision === 'NO_GO' ? 'dn' : 'warn', detail: g.decision === 'GO' ? 'Every check passed' : 'Do not place the order yet' }, tables: [{ title: 'Reasons', cols: ['Check'], rows: g.reasons.map(x => [x]) }] };
  },
};

// ---------- weekly digest ----------
export function weeklyDigest(trades: JTradeLike[], weekStart: string, tz = 'UTC') {
  const ts = trades.filter(t => t.status === 'closed' && t.closeTime != null && weekOf(t.closeTime, tz) === weekStart);
  const wins = ts.filter(t => t.net > 0), losses = ts.filter(t => t.net < 0), rs = ts.map(t => t.r).filter((x): x is number => x != null && Number.isFinite(x));
  const by = (key: (t: JTradeLike) => string) => {
    const m = new Map<string, JTradeLike[]>();
    for (const t of ts) { const k = key(t) || '—'; m.set(k, [...(m.get(k) ?? []), t]) }
    return [...m].map(([k, l]) => [k, l.length, `${Math.round((l.filter(t => t.net > 0).length / l.length) * 100)}%`, money(l.reduce((s, t) => s + t.net, 0))] as (string | number)[]).sort((a, b) => +String(b[3]).replace(/,/g, '') - +String(a[3]).replace(/,/g, ''));
  };
  return {
    n: ts.length, wins: wins.length, losses: losses.length, net: ts.reduce((s, t) => s + t.net, 0), winRate: ts.length ? (wins.length / ts.length) * 100 : NaN,
    avgR: rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : NaN, best: [...ts].sort((a, b) => b.net - a.net)[0], worst: [...ts].sort((a, b) => a.net - b.net)[0],
    bySetup: by(t => t.setup ?? ''), bySymbol: by(t => t.sym), byDir: by(t => t.dir),
    mistakes: [...ts.flatMap(t => t.mistakes ?? []).reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
  };
}
export const weeklyDigestSkill: Skill = {
  id: 'weekly-performance-digest', name: 'Weekly performance digest', group: 'Journal & review', from: 'weekly-performance-digest',
  desc: 'One week of closed journal trades: results, R, best/worst, and attribution by setup, symbol, direction and mistakes. Descriptive, not prescriptive.',
  inputs: [{ key: 'weeksAgo', label: 'Week (0 = this week)', type: 'number', default: 0 }, { key: 'tz', label: 'Week boundaries', type: 'select', options: ['UTC', 'America/New_York', 'Asia/Tehran'], default: 'UTC' }],
  run(v, ctx) {
    const tz = String(v.tz || 'UTC'), wk = weekOf(Date.now() / 1000 - num(v.weeksAgo, 'Week', { min: 0 }) * 7 * DAY, tz), d = weeklyDigest(ctx.trades(), wk, tz);
    const cols = ['', 'Trades', 'Win %', 'Net'];
    return {
      verdict: { label: `Week of ${wk}: ${money(d.net)}`, tone: d.net > 0 ? 'up' : d.net < 0 ? 'dn' : 'muted', detail: `${d.n} closed trades` },
      kpis: [{ label: 'Win rate', value: pct(d.winRate, 0) }, { label: 'Wins / losses', value: `${d.wins} / ${d.losses}` }, { label: 'Average R', value: Number.isFinite(d.avgR) ? d.avgR.toFixed(2) : '–' },
        { label: 'Best', value: d.best ? `${d.best.sym} ${money(d.best.net)}` : '–', tone: 'up' }, { label: 'Worst', value: d.worst ? `${d.worst.sym} ${money(d.worst.net)}` : '–', tone: 'dn' }],
      tables: [{ title: 'By setup', cols, rows: d.bySetup }, { title: 'By symbol', cols, rows: d.bySymbol }, { title: 'By direction', cols, rows: d.byDir }, { title: 'Mistakes tagged', cols: ['Mistake', 'Times'], rows: d.mistakes }],
    };
  },
};

// ---------- performance coach ----------
export function coach(trades: JTradeLike[], o: { revengeHours: number; maxLossR: number; streakN: number }) {
  const closed = trades.filter(t => t.status === 'closed' && t.closeTime != null).sort((a, b) => a.closeTime! - b.closeTime!).slice(-50);
  const findings: { level: 'WARN' | 'REVIEW_REQUIRED' | 'RULE_VIOLATION' | 'COOL_DOWN'; text: string }[] = [];
  const noStop = closed.filter(t => t.r == null), bigLoss = closed.filter(t => t.r != null && t.r < -o.maxLossR);
  if (noStop.length) findings.push({ level: 'RULE_VIOLATION', text: `${noStop.length} trade(s) without a recorded stop (no R): ${noStop.slice(-5).map(t => t.sym).join(', ')}` });
  if (bigLoss.length) findings.push({ level: 'RULE_VIOLATION', text: `${bigLoss.length} loss(es) beyond ${o.maxLossR}R: the stop was not respected (${bigLoss.slice(-5).map(t => `${t.sym} ${t.r!.toFixed(1)}R`).join(', ')})` });
  let revenge = 0;
  for (const t of closed) if (closed.some(x => x.net < 0 && x.closeTime! <= t.openTime && t.openTime - x.closeTime! <= o.revengeHours * HOUR)) revenge++;
  const revengeLosses = closed.filter(t => t.net < 0 && closed.some(x => x !== t && x.net < 0 && x.closeTime! <= t.openTime && t.openTime - x.closeTime! <= o.revengeHours * HOUR)).length;
  if (revenge >= 3 && revengeLosses / revenge > 0.5) findings.push({ level: 'REVIEW_REQUIRED', text: `${revenge} trades opened within ${o.revengeHours}h of a loss, ${revengeLosses} of them lost again: revenge pattern` });
  let streak = 0, worst = 0;
  for (const t of closed) { streak = t.net < 0 ? streak + 1 : 0; worst = Math.max(worst, streak) }
  if (streak >= o.streakN) findings.push({ level: 'COOL_DOWN', text: `${streak} losses in a row right now: review-only until a written review is done` });
  else if (worst >= o.streakN + 2) findings.push({ level: 'WARN', text: `Longest losing streak in the last ${closed.length} trades: ${worst}` });
  const missing = closed.filter(t => !t.setup).length;
  if (missing > closed.length / 3) findings.push({ level: 'WARN', text: `${missing} of ${closed.length} trades have no setup recorded: attribution is weak` });
  const mistakes = closed.flatMap(t => t.mistakes ?? []), top = [...mistakes.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) findings.push({ level: 'REVIEW_REQUIRED', text: `Repeated mistake: "${top[0]}" ×${top[1]}` });
  const order = ['OK', 'WARN', 'REVIEW_REQUIRED', 'RULE_VIOLATION', 'COOL_DOWN'] as const;
  const verdict = findings.reduce<typeof order[number]>((v, f) => (order.indexOf(f.level) > order.indexOf(v) ? f.level : v), 'OK');
  return { verdict, findings, n: closed.length };
}
export const coachSkill: Skill = {
  id: 'trade-performance-coach', name: 'Trade performance coach', group: 'Journal & review', from: 'trade-performance-coach',
  desc: 'Process review of the last 50 closed trades: missing stops, losses beyond the planned R, revenge pattern, losing streaks, repeated mistakes. Verdict OK → COOL DOWN.',
  inputs: [{ key: 'revengeHours', label: 'Revenge window (hours)', type: 'number', default: 24 }, { key: 'maxLossR', label: 'Max loss per trade (R)', type: 'number', default: 1.2 }, { key: 'streakN', label: 'Losing streak N', type: 'number', default: 3 }],
  run(v, ctx) {
    const c = coach(ctx.trades(), { revengeHours: num(v.revengeHours, 'Revenge window', { min: 0 }), maxLossR: num(v.maxLossR, 'Max loss R', { min: 0 }), streakN: num(v.streakN, 'Streak', { min: 1 }) });
    return { verdict: { label: c.verdict.replace('_', ' '), tone: c.verdict === 'OK' ? 'up' : c.verdict === 'WARN' ? 'warn' : 'dn', detail: `${c.n} closed trades reviewed` }, tables: [{ title: 'Findings', cols: ['Level', 'Finding'], rows: c.findings.map(f => [f.level, f.text]) }], notes: ['Process feedback only: not buy/sell advice.'] };
  },
};
