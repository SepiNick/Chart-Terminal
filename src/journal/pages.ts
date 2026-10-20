// Journal workspace pages: checklists, discipline path, analyses, tools (props, calendar, sessions clock, resume, compare), notes, settings.
import { journal, commitJournal, replaceJournal } from '../journalui.ts';
import { newJournal, uid, type Checklist, type JAccount, type Journal, type Note, type Prop } from '../journal.ts';
import { DISCIPLINE_ITEMS, LEVELS, balance, behaviour, closed, dashboard, dayKeyOf, discipline, edge, evalProp, rOf, rrExpected, scope, tradeTime } from './analytics.ts';
import { monteCarlo } from '../tester/optimize.ts';
import { bars, card, cls, fmtDate, go, kpi, lineChart, money, pct, startBalance, trades } from './workspace.ts';
import { serverJson } from '../data.ts';
import { esc, toast } from '../store.ts';

export function renderPage(main: HTMLElement, page: string, arg: string) {
  const fn = PAGES[page];
  main.innerHTML = fn ? fn(arg) : '<p class="muted">Unknown page.</p>';
  main.onclick = e => onClick(e, page, arg);
  main.onchange = e => onChange(e, page);
  main.oninput = e => onInput(e, page);
  if (page === 'calendar') loadCalendar();
  if (page === 'clock') tickClock();
}
const rerender = (page: string, arg = '') => go(page, arg);
const PAGES: Record<string, (arg: string) => string> = {
  checklists, discipline: disciplinePage, 'an-daily': anDaily, 'an-psych': anPsych, 'an-time': anTime, 'an-quality': anQuality, 'an-pro': anPro,
  props, calendar: () => `<div id="jwCal">${card('Economic calendar', '<p class="muted">Loading this week’s events…</p>')}</div>`, clock: () => `<div id="jwClock"></div>`, resume, compare, notes, settings,
};

// ---------- checklists ----------
let editCl: Checklist | null = null;
function checklists() {
  const j = journal(), lists = j.checklists ?? [];
  const used = (id: string) => j.trades.filter(t => t.checklist?.id === id);
  const edit = editCl ? card(editCl.id && lists.some(c => c.id === editCl!.id) ? 'Edit checklist' : 'New checklist', `
    <label class="jw-field"><span>Title</span><input data-cl="title" value="${esc(editCl.title)}"></label>
    <label class="jw-switch"><input type="checkbox" data-cl="advanced" ${editCl.advanced ? 'checked' : ''}> Advanced mode — custom priority weight per item</label>
    <div class="jw-cl-items">${editCl.items.map((it, i) => `<div class="row"><input data-cli="${i}" value="${esc(it.text)}" placeholder="Item ${i + 1}" class="grow">${editCl!.advanced ? `<input type="number" min="1" max="10" data-clw="${i}" value="${it.weight}" title="Weight" style="width:60px">` : ''}<button class="x" data-cldel="${i}">✕</button></div>`).join('')}</div>
    <div class="row"><button data-act="clAddItem">＋ Add item</button><span class="grow"></span><button data-act="clCancel">Cancel</button><button data-act="clSave" class="on">Save</button></div>`) : '';
  return `<div class="jw-toolbar"><h2>Checklists</h2><span class="grow"></span><button data-act="clNew" class="on">＋ New checklist</button></div>${edit}
    <div class="jw-grid">${lists.map(c => { const u = used(c.id), cl = closed(u), w = cl.filter(t => t.net > 0).length; return card(c.title, `<ol>${c.items.map(i => `<li>${esc(i.text)}${c.advanced ? ` <small class="muted">×${i.weight}</small>` : ''}</li>`).join('')}</ol>
      <div class="jw-row">${kpi('Used on', `${u.length} entries`)}${kpi('Win rate when used', cl.length ? pct((w / cl.length) * 100) : '—')}</div>
      <div class="row"><button data-cledit="${esc(c.id)}">Edit</button><button data-cldrop="${esc(c.id)}" class="dn">Delete</button></div>`) }).join('') || '<p class="muted">Write the conditions you check before entering — trend, level, confirmation, risk — and tick them on each journal entry.</p>'}</div>`;
}

// ---------- discipline ----------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function disciplinePage() {
  const j = journal(), d = discipline(j), now = Date.now() / 1000, todayKey = dayKeyOf(now);
  const todays = j.trades.filter(t => dayKeyOf(t.createdAt ?? t.openTime) === todayKey && t.kind !== 'notrade');
  const last30 = Array.from({ length: 30 }, (_, i) => { const t = now - (29 - i) * 86400; return { k: dayKeyOf(t), s: d.scores.get(dayKeyOf(t)) ?? 0, rest: !(j.activeDays ?? []).includes(new Date(t * 1000).getDay()) } });
  const lvl = LEVELS.find(l => l.name === d.level)!;
  return `<div class="jw-toolbar"><h2>Discipline path</h2><span class="muted">Build the habit: log every trading day, complete each entry, review.</span></div>
  <div class="jw-grid">
    ${card('Your level', `<div class="jw-row">${kpi('Level', `🏅 ${d.level}`)}${kpi('Streak', `🔥 ${d.streak} days`)}${kpi('Today', `${d.today.toFixed(0)} / 100`)}${kpi('Total points', d.total.toFixed(0))}</div>
      ${d.next ? `<div class="jw-meter"><span>To ${d.next.name}</span><div><i style="width:${Math.min(100, ((d.total - lvl.min) / (d.total - lvl.min + d.next.need)) * 100)}%"></i></div><b>${d.next.need.toFixed(0)} left</b></div>` : '<p>Top level reached.</p>'}`)}
    ${card(d.restDay ? 'Today is a rest day' : 'Today’s path', `
      <ol class="jw-path">
        <li class="${todays.length || j.trades.some(t => t.kind === 'notrade' && dayKeyOf(t.createdAt ?? t.openTime) === todayKey) ? 'done' : ''}">Log a valid entry — a trade or a no-trade day <button data-act="newEntry">＋ Entry</button> <button data-act="noTrade">Didn’t trade today</button></li>
        <li class="${todays.length && todays.every(t => Object.keys(t.points ?? {}).length >= 7) ? 'done' : ''}">Complete today’s entries (${todays.length ? (todays.reduce((s, t) => s + Object.values(t.points ?? {}).reduce((a, b) => a + b, 0), 0) / todays.length).toFixed(0) : 0} / 80 average)</li>
        <li>Optional: close 5 backtest trades (+20) in a backtest account</li>
      </ol>${d.restDay ? '<p class="muted">Rest days don’t break the streak.</p>' : ''}`)}
    ${card('Last 30 days', `<div class="jw-days">${last30.map(x => `<i title="${x.k}: ${x.s.toFixed(0)}${x.rest ? ' (rest day)' : ''}" class="${x.rest ? 'rest' : ''}" style="height:${Math.max(4, x.s)}%"></i>`).join('')}</div>`, 'Daily score out of 100', 'wide')}
    ${card('Active days', `<div class="chips">${DAYS.map((n, i) => `<button data-day="${i}" class="${(j.activeDays ?? []).includes(i) ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted">Only active days count for the streak.</p>`)}
    ${card('How points work', `<ul class="jw-rules">
      <li>Each trade entry earns up to <b>80</b>: ${DISCIPLINE_ITEMS.map(i => `${esc(i.label.toLowerCase())} (10)`).join(', ')}, plus a <b>10</b> bonus when all seven are done.</li>
      <li>Items only count if completed by the end of the day the entry was created; later edits are kept but earn nothing. Removing an item removes its points.</li>
      <li>A day’s score is the average of its trade entries. A no-trade day scores <b>80</b>. Closing 5 backtest trades adds <b>20</b>. The daily maximum is 100.</li>
      <li>Profit or loss never affects points — the path rewards process, not results.</li>
      <li>Levels: ${LEVELS.map(l => `${l.name} ${l.min}+`).join(' · ')}.</li></ul>`, '', 'wide')}
  </div>`;
}

// ---------- analyses ----------
const table = (rows: { key: string; n: number; net: number; winRate: number }[], title = '') => `<table class="jw-table small">${title ? `<tr><th colspan="4">${esc(title)}</th></tr>` : ''}<tr><th></th><th>Trades</th><th>Win</th><th>Net</th></tr>${rows.map(r => `<tr><td>${esc(r.key)}</td><td>${r.n}</td><td>${r.winRate.toFixed(0)}%</td><td class="${cls(r.net)}">${money(r.net)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No data yet.</td></tr>'}</table>`;
const head = (t: string, s: string) => `<div class="jw-toolbar"><h2>${t}</h2><span class="muted">${s}</span></div>`;
function anDaily() {
  const d = dashboard(journal(), trades(), startBalance()), days = [...d.days].sort((a, b) => b[0].localeCompare(a[0]));
  const green = days.filter(x => x[1].net > 0).length;
  return head('Daily analysis', 'How your days go') + `<div class="jw-grid">
    ${card('Days', `<div class="jw-row">${kpi('Trading days', String(days.length))}${kpi('Green days', `${green} · ${days.length ? pct((green / days.length) * 100) : '—'}`, 'up')}${kpi('Avg per day', money(days.length ? d.net / days.length : 0), cls(d.net))}
      ${kpi('Best day', days.length ? money(Math.max(...days.map(x => x[1].net))) : '—', 'up')}${kpi('Worst day', days.length ? money(Math.min(...days.map(x => x[1].net))) : '—', 'dn')}${kpi('Avg trades per day', days.length ? (d.trades / days.length).toFixed(1) : '—')}</div>`)}
    ${card('By weekday', bars(d.byWeekday))}
    ${card('Day by day', `<table class="jw-table small"><tr><th>Day</th><th>Trades</th><th>Win</th><th>Net</th><th>Note</th></tr>${days.slice(0, 60).map(([k, v]) => `<tr class="click" data-dayopen="${k}"><td>${fmtDate(Date.parse(k) / 1000, false)}</td><td>${v.n}</td><td>${((v.wins / v.n) * 100).toFixed(0)}%</td><td class="${cls(v.net)}">${money(v.net)}</td><td>${esc((journal().notes[k] ?? '').slice(0, 60))}</td></tr>`).join('')}</table>`, '', 'wide')}
  </div>`;
}
function anPsych() {
  const ts = trades(), d = dashboard(journal(), ts, startBalance()), b = behaviour(ts);
  return head('Psychology & behaviour', 'What your state of mind costs or earns') + `<div class="jw-grid">
    ${card('Emotion before entering', bars(d.byEmotion))}${card('Emotion after the trade', bars(d.byEmotionAfter))}
    ${card('Why you entered', bars(d.byMotive))}${card('Mistakes and their cost', bars(d.byMistake))}
    ${card('Energy level', table(d.byEnergy))}${card('Confidence in the setup', table(d.byConfidence))}
    ${card('Plan discipline', table(d.byPlan))}
    ${card('Tilt check', `<div class="jw-row">${kpi('After a loss: win rate', `${pct(b.afterLoss.winRate)} <small>${b.afterLoss.n} trades</small>`, b.afterLoss.winRate < d.winRate ? 'dn' : 'up')}${kpi('After a win: win rate', `${pct(b.afterWin.winRate)} <small>${b.afterWin.n} trades</small>`)}
      ${kpi('Revenge-like trades', `${b.revenge.length} · ${money(b.revengeNet)}`, b.revenge.length ? 'dn' : '', 'Opened within 15 min of a loss with a bigger size')}${kpi('Overtrading days', String(b.overDays.length), b.overDays.length ? 'dn' : '', 'Days with far more trades than usual')}</div>
      ${b.overDays.length ? `<p class="muted">Overtrading: ${b.overDays.slice(0, 8).map(x => fmtDate(Date.parse(x) / 1000, false)).join(', ')}</p>` : ''}`, '', 'wide')}
  </div>`;
}
function anTime() {
  const ts = trades(), d = dashboard(journal(), ts, startBalance()), t = closed(ts);
  const eff = t.filter(x => x.mfe > 0).map(x => x.net / x.mfe);
  return head('Time & efficiency', 'When you trade best, and how much of each move you keep') + `<div class="jw-grid">
    ${card('By hour of entry (local time)', bars([...d.byHour].sort((a, b) => a.key.localeCompare(b.key)), 24))}
    ${card('By session (UTC)', table(d.bySession))}${card('By weekday', bars(d.byWeekday))}${card('By holding time', table(d.byHold))}
    ${card('Exit efficiency', `<div class="jw-row">${kpi('Profit kept of the best open profit', eff.length ? pct((eff.reduce((s, x) => s + x, 0) / eff.length) * 100) : '—', '', 'Net ÷ MFE, trades that were ever in profit')}
      ${kpi('Avg hold — winners', dur(avg(t.filter(x => x.net > 0).map(x => tradeTime(x) - x.openTime))))}${kpi('Avg hold — losers', dur(avg(t.filter(x => x.net < 0).map(x => tradeTime(x) - x.openTime))))}</div>`)}
  </div>`;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const dur = (s: number) => (!s ? '—' : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);
function anQuality() {
  const t = closed(trades()), d = dashboard(journal(), trades(), startBalance());
  const rs = t.map(rOf).filter((r): r is number => r != null), buckets = [-3, -2, -1, 0, 1, 2, 3, 5];
  const hist = buckets.map((lo, i) => ({ key: i === buckets.length - 1 ? `≥ ${lo}R` : `${lo}…${buckets[i + 1]}R`, n: rs.filter(r => r >= lo && (i === buckets.length - 1 || r < buckets[i + 1])).length }));
  const below = rs.filter(r => r < -3).length, maxN = Math.max(1, below, ...hist.map(h => h.n));
  const planned = t.map(x => ({ e: rrExpected(x), a: rOf(x) })).filter(x => x.e != null && x.a != null) as { e: number; a: number }[];
  const withCl = t.filter(x => x.checklist?.done.length), noCl = t.filter(x => !x.checklist?.done.length);
  const wr = (xs: typeof t) => (xs.length ? pct((xs.filter(x => x.net > 0).length / xs.length) * 100) : '—');
  return head('Execution quality', 'How well you execute the plan') + `<div class="jw-grid">
    ${card('R-multiple distribution', `<div class="jw-hist">${[{ key: '< −3R', n: below }, ...hist].map(h => `<div><i style="height:${(h.n / maxN) * 100}%"></i><span>${h.key}</span><b>${h.n}</b></div>`).join('')}</div>`, `${rs.length} trades with R`, 'wide')}
    ${card('Planned vs actual R', `<div class="jw-row">${kpi('Avg planned', planned.length ? `${avg(planned.map(p => p.e)).toFixed(2)}R` : '—')}${kpi('Avg actual', planned.length ? `${avg(planned.map(p => p.a)).toFixed(2)}R` : '—')}${kpi('Reached target', planned.length ? pct((planned.filter(p => p.a >= p.e * 0.95).length / planned.length) * 100) : '—')}</div>`)}
    ${card('Checklist and results', `<div class="jw-row">${kpi('Win rate with checklist', wr(withCl))}${kpi('Win rate without', wr(noCl))}${kpi('Net with', money(withCl.reduce((s, x) => s + x.net, 0)))}${kpi('Net without', money(noCl.reduce((s, x) => s + x.net, 0)))}</div>`)}
    ${card('Risk per trade', `<div class="jw-row">${kpi('Average', pct(d.risk.avg))}${['<1%', '1–2%', '2–3%', '>3%'].map((l, i) => kpi(l, String(d.risk.buckets[i]))).join('')}</div>`)}
    ${card('By setup', table(d.bySetup))}${card('By entry reason', table(d.byEntryReason))}${card('By exit reason', table(d.byExitReason))}${card('By tag', table(d.byTag))}
  </div>`;
}
function anPro() {
  const t = closed(trades()), sb = startBalance(), d = dashboard(journal(), trades(), sb), e = edge(trades());
  const mc = t.length >= 5 ? monteCarlo(t.map(x => ({ profit: x.net }) as never), sb || 1, { runs: 1000, method: 'shuffle', ruinPct: 30, seed: 1 }) : null;
  return head('Professional analysis', 'Edge, sizing and luck') + `<div class="jw-grid">
    ${card('Edge', `<div class="jw-row">${kpi('Expectancy', `${e.expectancy.toFixed(2)}${e.unit}`, cls(e.expectancy))}${kpi('SQN', e.sqn.toFixed(2), '', 'System Quality Number: <1.6 poor, 2–3 good, >3 excellent')}${kpi('Kelly %', pct(e.kelly), '', 'Share of capital the Kelly criterion would risk; most traders use a fraction')}${kpi('Payoff ratio', d.avgLoss ? (d.avgWin / d.avgLoss).toFixed(2) : '—')}${kpi('Profit factor', Number.isFinite(d.pf) ? d.pf.toFixed(2) : '∞')}${kpi('Recovery factor', d.recovery.toFixed(2))}</div>`, '', 'wide')}
    ${mc ? card('Monte Carlo (1,000 shuffles of your trades)', `${lineChart(mc.paths.slice(0, 12).map((p, i) => ({ values: p, color: i ? 'var(--muted)' : 'var(--accent)', label: i ? '' : 'Simulated equity paths' })).filter((_, i) => i < 12), 200)}
      <div class="jw-row">${kpi('Max drawdown — median', pct(mc.maxDrawdownPct.p50))}${kpi('Max drawdown — 95th pct.', pct(mc.maxDrawdownPct.p95), 'dn')}${kpi('Risk of losing 30%', pct(mc.riskOfRuin * 100), mc.riskOfRuin > 0.05 ? 'dn' : 'up')}${kpi('Your drawdown', pct(mc.original.maxDrawdownPct))}</div>`, 'Same trades, different order: how deep could the drawdown have been?', 'wide') : card('Monte Carlo', '<p class="muted">Needs at least 5 closed trades.</p>')}
    ${card('Long vs short', `<div class="jw-row">${kpi('Long net', money(d.long.net), cls(d.long.net))}${kpi('Long win rate', pct(d.long.winRate))}${kpi('Short net', money(d.short.net), cls(d.short.net))}${kpi('Short win rate', pct(d.short.winRate))}</div>`)}
    ${card('By symbol', table(d.bySymbol))}
  </div>`;
}

// ---------- props ----------
let propDraft: Prop | null = null;
function props() {
  const j = journal(), list = j.props ?? [];
  const form = propDraft ? card('New prop challenge', `<div class="jw-fields">
    <label class="jw-field"><span>Name</span><input data-pp="name" value="${esc(propDraft.name)}" placeholder="e.g. FTMO 100k"></label>
    <label class="jw-field"><span>Account</span><select data-pp="accountId">${(j.accounts ?? []).map(a => `<option value="${esc(a.id)}" ${a.id === propDraft!.accountId ? 'selected' : ''}>${esc(a.name)} (${money(a.initial, false)})</option>`).join('')}</select></label>
    <label class="jw-field"><span>Phase</span><select data-pp="phase">${['Phase 1', 'Phase 2', 'Funded'].map(p => `<option ${p === propDraft!.phase ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    <label class="jw-field"><span>Profit target %</span><input type="number" step="any" data-pp="target" value="${propDraft.target}"></label>
    <label class="jw-field"><span>Max total drawdown %</span><input type="number" step="any" data-pp="maxDD" value="${propDraft.maxDD}"></label>
    <label class="jw-field"><span>Max daily drawdown %</span><input type="number" step="any" data-pp="dailyDD" value="${propDraft.dailyDD}"></label>
    <label class="jw-field"><span>Drawdown type</span><select data-pp="ddType"><option value="static" ${propDraft.ddType === 'static' ? 'selected' : ''}>Static (from the initial balance)</option><option value="trailing" ${propDraft.ddType === 'trailing' ? 'selected' : ''}>Trailing (from the peak)</option></select></label>
    <label class="jw-field"><span>Minimum trading days</span><input type="number" min="0" data-pp="minDays" value="${propDraft.minDays}"></label>
    <label class="jw-field"><span>Start date</span><input type="date" data-pp="start" value="${new Date(propDraft.start * 1000).toISOString().slice(0, 10)}"></label>
    </div><div class="row"><span class="grow"></span><button data-act="ppCancel">Cancel</button><button data-act="ppSave" class="on">Create</button></div>`) : '';
  return `<div class="jw-toolbar"><h2>Prop challenges</h2><span class="muted">Define the rules once; the journal tracks them.</span><span class="grow"></span><button data-act="ppNew" class="on">＋ New challenge</button></div>${form}
  <div class="jw-grid">${list.map(p => {
    const e = evalProp(p, j), acc = j.accounts?.find(a => a.id === p.accountId);
    const meter = (label: string, v: number, max: number, bad: boolean) => `<div class="jw-meter ${bad ? 'bad' : ''}"><span>${label}</span><div><i style="width:${Math.min(100, Math.max(0, (v / (max || 1)) * 100))}%"></i></div><b>${pct(v)} / ${pct(max)}</b></div>`;
    return card(`${p.name} · ${p.phase}`, `<div class="jw-row">${kpi('Status', e.status === 'passed' ? '✅ Passed' : e.status === 'failed' ? '❌ Failed' : '⏳ In progress', e.status === 'passed' ? 'up' : e.status === 'failed' ? 'dn' : '')}${kpi('Balance', money(e.balance, false))}${kpi('Trades', String(e.trades))}${kpi('Trading days', `${e.days} / ${p.minDays}`)}</div>
      ${meter('Profit target', Math.max(0, e.profitPct), p.target, false)}${meter(`Max drawdown (${p.ddType})`, e.worstTotal, p.maxDD, e.worstTotal >= p.maxDD)}${p.dailyDD ? meter('Worst daily drawdown', e.worstDaily, p.dailyDD, e.worstDaily >= p.dailyDD) : ''}
      <div class="row"><span class="muted">${esc(acc?.name ?? '')} · since ${fmtDate(p.start, false)}</span><span class="grow"></span><button data-ppdrop="${esc(p.id)}" class="dn">Delete</button></div>`);
  }).join('') || '<p class="muted">No challenges yet.</p>'}</div>`;
}

// ---------- economic calendar ----------
let calFilter = { impact: 'High,Medium', ccy: '' };
async function loadCalendar() {
  const el = document.getElementById('jwCal'); if (!el) return;
  try {
    type Ev = { title: string; country: string; date: string; impact: string; forecast: string; previous: string; actual?: string };
    const evs = await serverJson<Ev[]>('/api/calendar'), ccys = [...new Set(evs.map(e => e.country))].sort();
    const imp = calFilter.impact.split(',');
    const list = evs.filter(e => imp.includes(e.impact) && (!calFilter.ccy || e.country === calFilter.ccy));
    let day = '';
    el.innerHTML = card('Economic calendar — this week', `<div class="jw-toolbar">${['High', 'Medium', 'Low', 'Holiday'].map(i => `<label><input type="checkbox" data-imp="${i}" ${imp.includes(i) ? 'checked' : ''}> ${i}</label>`).join('')}
      <select data-ccy><option value="">All currencies</option>${ccys.map(c => `<option ${c === calFilter.ccy ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <table class="jw-table small"><tr><th>Time</th><th>Cur.</th><th>Impact</th><th>Event</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr>${list.map(e => {
        const t = Date.parse(e.date) / 1000, dk = fmtDate(t, false), h = dk !== day ? `<tr class="grp"><th colspan="7">${(day = dk)}</th></tr>` : '';
        return `${h}<tr class="${t < Date.now() / 1000 ? 'muted' : ''}"><td>${new Date(t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</td><td>${esc(e.country)}</td><td><span class="imp imp-${esc(e.impact.toLowerCase())}">${esc(e.impact)}</span></td><td>${esc(e.title)}</td><td>${esc(e.actual ?? '')}</td><td>${esc(e.forecast)}</td><td>${esc(e.previous)}</td></tr>`;
      }).join('')}</table>`, 'Times in your time zone · source: ForexFactory weekly feed via the local data server', 'wide');
  } catch (err) { el.innerHTML = card('Economic calendar', `<p class="dn">${esc((err as Error).message)}</p><p class="muted">The calendar is fetched by the local data server (npm run server).</p>`, '', 'wide') }
}

// ---------- sessions clock ----------
const CITIES = [{ name: 'Sydney', tz: 'Australia/Sydney', open: 7, close: 16 }, { name: 'Tokyo', tz: 'Asia/Tokyo', open: 9, close: 18 }, { name: 'London', tz: 'Europe/London', open: 8, close: 17 }, { name: 'New York', tz: 'America/New_York', open: 8, close: 17 }];
let clockTimer = 0;
function tickClock() {
  clearInterval(clockTimer);
  const draw = () => {
    const el = document.getElementById('jwClock'); if (!el) return clearInterval(clockTimer);
    const now = new Date(), hourIn = (tz: string) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now); return +p.find(x => x.type === 'hour')!.value % 24 + +p.find(x => x.type === 'minute')!.value / 60 };
    const wd = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    const local = now.getHours() + now.getMinutes() / 60;
    const rows = CITIES.map(c => {
      const h = hourIn(c.tz), open = h >= c.open && h < c.close && !['Sat', 'Sun'].includes(wd(c.tz));
      // the session in local hours: shift by the city/local offset
      const off = local - h, from = (c.open + off + 24) % 24, to = (c.close + off + 24) % 24;
      const seg = (a: number, b: number) => `<i style="left:${(a / 24) * 100}%;width:${((b - a) / 24) * 100}%"></i>`;
      return `<div class="jw-sess ${open ? 'open' : ''}"><b>${c.name}</b><span>${new Intl.DateTimeFormat(undefined, { timeZone: c.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)} · ${open ? 'open' : 'closed'}</span>
        <div class="jw-track">${from < to ? seg(from, to) : seg(from, 24) + seg(0, to)}<em style="left:${(local / 24) * 100}%"></em></div><small class="muted">${fmtH(from)}–${fmtH(to)} your time</small></div>`;
    });
    const openNames = CITIES.filter(c => { const h = hourIn(c.tz); return h >= c.open && h < c.close && !['Sat', 'Sun'].includes(wd(c.tz)) }).map(c => c.name);
    el.innerHTML = card('Forex sessions', `<div class="jw-row">${kpi('Your time', now.toLocaleTimeString(undefined, { hour12: false }))}${kpi('Open now', openNames.join(' + ') || 'None (weekend or between sessions)')}${kpi('Overlap', openNames.length > 1 ? 'Yes — usually the most liquid hours' : 'No')}</div>${rows.join('')}`, 'Local business hours of each centre, with daylight-saving time', 'wide');
  };
  draw(); clockTimer = window.setInterval(draw, 1000);
}
const fmtH = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// ---------- resume ----------
let resumeName = '';
function resume() {
  const j = journal(), all = trades(), d = dashboard(j, all, startBalance()), disc = discipline(j), e = edge(all);
  const months = new Map<string, number>(); closed(all).forEach(t => { const k = dayKeyOf(tradeTime(t)).slice(0, 7); months.set(k, (months.get(k) ?? 0) + t.net) });
  const green = [...months.values()].filter(v => v > 0).length;
  return `<div class="jw-toolbar"><h2>Trading resume</h2><span class="muted">A one-page summary of the selected account and period to share or print.</span><span class="grow"></span>
    <input data-resume="name" placeholder="Your name" value="${esc(resumeName)}"><button data-act="resumePng" class="on">Download PNG</button><button data-act="print">Print / PDF</button></div>
  <div class="jw-resume" id="jwResume">
    <header><h1>${esc(resumeName || 'Trader')}</h1><p>${esc(j.accounts?.find(a => a.id === j.account)?.name ?? 'All accounts')} · ${closed(all).length ? `${fmtDate(Math.min(...closed(all).map(x => x.openTime)), false)} – ${fmtDate(Math.max(...closed(all).map(tradeTime)), false)}` : 'no closed trades yet'}</p></header>
    <div class="jw-row wrap">${kpi('Net result', `${money(d.net)} <small>${pct(d.pct(d.net))}</small>`, cls(d.net))}${kpi('Trades', String(d.trades))}${kpi('Win rate', pct(d.winRate))}${kpi('Profit factor', Number.isFinite(d.pf) ? d.pf.toFixed(2) : '∞')}
      ${kpi('Average R', `${d.avgR.toFixed(2)}R`)}${kpi('Max drawdown', pct(d.relDD))}${kpi('Expectancy', `${e.expectancy.toFixed(2)}${e.unit}`)}${kpi('Green months', `${green} / ${months.size}`)}${kpi('Discipline', `${disc.level} · ${disc.streak}-day streak`)}</div>
    ${lineChart([{ values: [startBalance(), ...d.curve.map(c => c.bal)], color: '#2962ff', label: 'Equity' }], 160)}
    <div class="jw-row">${bars(d.bySymbol, 5)}${bars(d.bySetup, 5)}</div>
    <footer class="muted">Generated by Chart Terminal · ${new Date().toISOString().slice(0, 10)}</footer>
  </div>`;
}
async function resumePng() {
  const el = document.getElementById('jwResume'); if (!el) return;
  // Render the card through an SVG foreignObject with the page's computed colours inlined.
  const clone = el.cloneNode(true) as HTMLElement, cs = getComputedStyle(document.documentElement), w = el.offsetWidth, h = el.offsetHeight;
  const vars = ['--bg', '--panel', '--line', '--text', '--muted', '--accent', '--up', '--down', '--grid', '--warn'].map(v => `${v}:${cs.getPropertyValue(v)}`).join(';');
  const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText) } catch { return [] } }).filter(r => /jw-|\.up|\.dn|\.muted/.test(r)).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="${vars};font:12px system-ui,sans-serif;color:var(--text);background:var(--bg)"><style>${css}</style>${clone.outerHTML}</div></foreignObject></svg>`;
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode().catch(() => {});
  const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
  const ctx = c.getContext('2d')!; ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `trading_resume_${new Date().toISOString().slice(0, 10)}.png`; a.click();
}

// ---------- compare accounts ----------
function compare() {
  const j = journal(), rows = (j.accounts ?? []).map(a => { const ts = scope(j, {}, a.id), d = dashboard(j, ts, a.initial + a.transfers.reduce((s, x) => s + x.amount, 0)); return { a, d, e: edge(ts) } });
  const keys: [string, (x: (typeof rows)[number]) => string][] = [['Balance', x => money(balance(j, x.a.id), false)], ['Net P&L', x => money(x.d.net)], ['Return', x => pct(x.d.pct(x.d.net))], ['Trades', x => String(x.d.trades)], ['Win rate', x => pct(x.d.winRate)],
    ['Profit factor', x => (Number.isFinite(x.d.pf) ? x.d.pf.toFixed(2) : '∞')], ['Average R', x => `${x.d.avgR.toFixed(2)}R`], ['Expectancy', x => `${x.e.expectancy.toFixed(2)}${x.e.unit}`], ['Max drawdown', x => pct(x.d.relDD)], ['Sharpe (per trade)', x => x.d.sharpe.toFixed(2)], ['Commission', x => money(x.d.commission, false)]];
  return head('Compare accounts', 'All time, side by side') + card('Accounts', `<table class="jw-table"><tr><th></th>${rows.map(r => `<th>${esc(r.a.name)}</th>`).join('')}</tr>${keys.map(([k, f]) => `<tr><td>${k}</td>${rows.map(r => `<td>${f(r)}</td>`).join('')}</tr>`).join('')}</table>`, '', 'wide') +
    card('Equity', lineChart(rows.map((r, i) => ({ values: [r.d.balance - r.d.net, ...r.d.curve.map(c => c.bal)], color: ['var(--accent)', 'var(--up)', 'var(--warn)', 'var(--down)', 'var(--muted)'][i % 5], label: r.a.name }))), '', 'wide');
}

// ---------- notes ----------
let noteId = '', noteQ = '';
function notes() {
  const j = journal(), list = (j.docs ?? []).filter(n => !noteQ || (n.title + n.body + n.tags.join(' ')).toLowerCase().includes(noteQ.toLowerCase())).sort((a, b) => +!!b.pinned - +!!a.pinned || b.updated - a.updated);
  const cur = (j.docs ?? []).find(n => n.id === noteId);
  return `<div class="jw-notes"><aside><div class="row"><input type="search" data-noteq value="${esc(noteQ)}" placeholder="Search notes" class="grow"><button data-act="noteNew" class="on">＋</button></div>
      ${list.map(n => `<button data-note="${esc(n.id)}" class="${n.id === noteId ? 'on' : ''}">${n.pinned ? '📌 ' : ''}<b>${esc(n.title || 'Untitled')}</b><small class="muted">${fmtDate(n.updated, false)} ${esc(n.tags.join(', '))}</small></button>`).join('') || '<p class="muted">No notes yet.</p>'}</aside>
    <section>${cur ? `<div class="row"><input data-nf="title" value="${esc(cur.title)}" placeholder="Title" class="grow jw-note-title"><button data-act="notePin">${cur.pinned ? 'Unpin' : 'Pin'}</button><button data-act="noteDel" class="dn">Delete</button></div>
      <input data-nf="tags" value="${esc(cur.tags.join(', '))}" placeholder="Tags, comma separated">
      <textarea data-nf="body" placeholder="Market review, trading plan, rules, lessons… (saved as you type)">${esc(cur.body)}</textarea><small class="muted">Saved automatically · created ${fmtDate(cur.created)}</small>`
      : '<p class="muted">Pick a note or create one — weekly reviews, trading plan, rules, lessons.</p>'}</section></div>`;
}

// ---------- settings ----------
function settings() {
  const j = journal();
  const list = (key: 'entryReasons' | 'exitReasons' | 'motives' | 'tagList' | 'setups', title: string) => card(title, `<div class="chips">${(j[key] ?? []).map((x, i) => `<span class="chip">${esc(x)}<button class="x" data-ren="${key}:${i}" title="Rename">✎</button><button class="x" data-rm="${key}:${i}" title="Remove">✕</button></span>`).join('')}<button data-add="${key}">＋ Add</button></div>`);
  return head('Accounts & settings', '') + `<div class="jw-grid">
    ${card('Accounts', `<table class="jw-table small"><tr><th>Name</th><th>Type</th><th>Initial balance</th><th>Deposits / withdrawals</th><th>Balance</th><th></th></tr>${(j.accounts ?? []).map(a => `<tr><td>${esc(a.name)}</td><td>${a.kind}</td><td>${money(a.initial, false)}</td>
      <td>${a.transfers.map(t => `<span class="${cls(t.amount)}" title="${esc(t.note ?? '')}">${money(t.amount)} <small>${fmtDate(t.t, false)}</small> <button class="x" data-trdel="${esc(a.id)}:${esc(t.id)}">✕</button></span>`).join('<br>') || '—'}</td>
      <td>${money(balance(j, a.id), false)}</td><td><button data-tr="${esc(a.id)}">± Deposit / withdraw</button><button data-acren="${esc(a.id)}">Rename</button><button data-acbal="${esc(a.id)}">Initial…</button>${a.kind === 'paper' ? '' : `<button data-acdel="${esc(a.id)}" class="dn">Delete</button>`}</td></tr>`).join('')}</table>
      <div class="row"><button data-act="acNew">＋ New account</button><button data-act="acNewBt">＋ New backtest account</button></div>`, 'The paper account is filled automatically; others take manual entries and statement imports.', 'wide')}
    ${card('Bar Replay', `<label class="jw-field"><span>Log Replay trades to</span><select data-set="replayAccount">${(j.accounts ?? []).filter(a => a.kind === 'backtest').map(a => `<option value="${esc(a.id)}" ${a.id === j.replayAccount ? 'selected' : ''}>${esc(a.name)}</option>`).join('') || '<option value="">A new backtest account (created on the first Replay order)</option>'}</select></label>
      <label class="jw-field"><span>Bars before the entry when replaying a trade</span><input type="number" min="1" max="2000" data-set="replayBars" value="${j.replayBars ?? 50}"></label>`, 'Orders placed on a chart in Bar Replay fill on a separate simulated account at replay prices, never the live paper account. They are journaled with the replay time.')}
    ${card('Display', `<label class="jw-field"><span>Calendar</span><select data-set="calendar"><option value="gregorian" ${j.calendar !== 'jalali' ? 'selected' : ''}>Gregorian</option><option value="jalali" ${j.calendar === 'jalali' ? 'selected' : ''}>Jalali (Solar Hijri)</option></select></label>`)}
    ${list('entryReasons', 'Entry reasons')}${list('exitReasons', 'Exit reasons')}${list('motives', 'Entry motives')}${list('setups', 'Setups / playbooks')}${list('tagList', 'Tags')}
    ${card('Custom fields', `<div class="chips">${(j.fields ?? []).map((f, i) => `<span class="chip">${esc(f.label)} <small class="muted">${f.type}</small><button class="x" data-rm="fields:${i}">✕</button></span>`).join('') || '<span class="muted">None — add them from an entry’s “Custom fields” tab.</span>'}</div>`)}
    ${card('Custom questions', `<div class="chips">${(j.questions ?? []).map((q, i) => `<span class="chip">${esc(q)}<button class="x" data-rm="questions:${i}">✕</button></span>`).join('') || '<span class="muted">None</span>'}</div>`)}
    ${card('Backup', `<div class="row"><button data-act="backup">Download backup (.json)</button><label class="btn">Restore…<input type="file" id="jwRestore" accept=".json" hidden></label><button data-act="clear" class="dn">Clear journal</button></div><p class="muted">Pictures and voice notes stay in this browser (IndexedDB) and are not part of the backup file.</p>`)}
  </div>`;
}

// ---------- events ----------
function onClick(e: MouseEvent, page: string, arg: string) {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button,[data-dayopen]'); if (!b) return;
  const j = journal(), d = b.dataset;
  const ask = (q: string, def = '') => prompt(q, def)?.trim();
  // checklists
  if (d.act === 'clNew') { editCl = { id: uid(), title: '', items: [{ id: uid(), text: '', weight: 1 }] }; return rerender(page) }
  if (d.cledit) { editCl = structuredClone((j.checklists ?? []).find(c => c.id === d.cledit)!); return rerender(page) }
  if (d.cldrop && confirm('Delete this checklist? Entries keep their ticks.')) { j.checklists = (j.checklists ?? []).filter(c => c.id !== d.cldrop); commitJournal(); return rerender(page) }
  if (d.act === 'clAddItem' && editCl) { editCl.items.push({ id: uid(), text: '', weight: 1 }); return rerender(page) }
  if (d.cldel && editCl) { editCl.items.splice(+d.cldel, 1); return rerender(page) }
  if (d.act === 'clCancel') { editCl = null; return rerender(page) }
  if (d.act === 'clSave' && editCl) {
    editCl.items = editCl.items.filter(i => i.text.trim()); if (!editCl.title.trim() || !editCl.items.length) return toast('Give the checklist a title and at least one item');
    const lists = (j.checklists ??= []), i = lists.findIndex(c => c.id === editCl!.id); if (i >= 0) lists[i] = editCl; else lists.push(editCl);
    editCl = null; commitJournal(); return rerender(page);
  }
  // discipline
  if (d.act === 'newEntry') return go('form', '');
  if (d.act === 'noTrade') return go('form', '#notrade');
  if (d.day != null && page === 'discipline') { const s = new Set(j.activeDays ?? []); s.has(+d.day) ? s.delete(+d.day) : s.add(+d.day); j.activeDays = [...s].sort(); commitJournal(); return rerender(page) }
  if (d.dayopen) return go('journals');
  // props
  if (d.act === 'ppNew') { propDraft = { id: uid(), name: '', accountId: j.account || j.accounts?.[0]?.id || 'paper', phase: 'Phase 1', target: 10, maxDD: 10, dailyDD: 5, ddType: 'static', minDays: 4, start: Math.floor(Date.now() / 1000 / 86400) * 86400 }; return rerender(page) }
  if (d.act === 'ppCancel') { propDraft = null; return rerender(page) }
  if (d.act === 'ppSave' && propDraft) { if (!propDraft.name.trim()) return toast('Name the challenge'); (j.props ??= []).push(propDraft); propDraft = null; commitJournal(); return rerender(page) }
  if (d.ppdrop && confirm('Delete this challenge?')) { j.props = (j.props ?? []).filter(p => p.id !== d.ppdrop); commitJournal(); return rerender(page) }
  // resume
  if (d.act === 'resumePng') return void resumePng();
  if (d.act === 'print') return window.print();
  // notes
  if (d.act === 'noteNew') { const n: Note = { id: uid(), title: '', body: '', tags: [], created: Date.now() / 1000, updated: Date.now() / 1000 }; (j.docs ??= []).push(n); noteId = n.id; commitJournal(); return rerender(page) }
  if (d.note) { noteId = d.note; return rerender(page) }
  const cur = (j.docs ?? []).find(n => n.id === noteId);
  if (d.act === 'notePin' && cur) { cur.pinned = !cur.pinned; commitJournal(); return rerender(page) }
  if (d.act === 'noteDel' && cur && confirm('Delete this note?')) { j.docs = (j.docs ?? []).filter(n => n !== cur); noteId = ''; commitJournal(); return rerender(page) }
  // settings
  if (d.act === 'acNew' || d.act === 'acNewBt') {
    const name = ask('Account name', d.act === 'acNewBt' ? 'Backtest' : 'My account'); if (!name) return;
    const initial = +(ask('Initial balance', '10000') ?? NaN); if (!Number.isFinite(initial)) return toast('Enter a number');
    const a: JAccount = { id: uid(), name, initial, kind: d.act === 'acNewBt' ? 'backtest' : 'manual', transfers: [] };
    (j.accounts ??= []).push(a); commitJournal(); return rerender(page);
  }
  const acc = (id?: string) => (j.accounts ?? []).find(a => a.id === id);
  if (d.tr) { const a = acc(d.tr), amt = +(ask('Amount: positive to deposit, negative to withdraw') ?? NaN); if (a && Number.isFinite(amt) && amt) { a.transfers.push({ id: uid(), t: Date.now() / 1000, amount: amt, note: ask('Note (optional)') || undefined }); commitJournal() } return rerender(page) }
  if (d.trdel) { const [aid, tid] = d.trdel.split(':'), a = acc(aid); if (a) { a.transfers = a.transfers.filter(t => t.id !== tid); commitJournal() } return rerender(page) }
  if (d.acren) { const a = acc(d.acren), n = a && ask('New name', a.name); if (a && n) { a.name = n; commitJournal() } return rerender(page) }
  if (d.acbal) { const a = acc(d.acbal), v = a && +(ask('Initial balance', String(a.initial)) ?? NaN); if (a && Number.isFinite(v)) { a.initial = v as number; commitJournal() } return rerender(page) }
  if (d.acdel) { const a = acc(d.acdel); if (a && confirm(`Delete “${a.name}” and its ${j.trades.filter(t => t.accountId === a.id).length} entries?`)) { j.accounts = j.accounts!.filter(x => x !== a); j.trades = j.trades.filter(t => t.accountId !== a.id); if (j.account === a.id) j.account = ''; commitJournal() } return rerender(page) }
  type ListKey = 'entryReasons' | 'exitReasons' | 'motives' | 'tagList' | 'setups' | 'fields' | 'questions';
  if (d.add) { const v = ask('New option'); if (v) { ((j[d.add as ListKey] ??= []) as string[]).push(v); commitJournal() } return rerender(page) }
  if (d.rm) { const [k, i] = d.rm.split(':'); (j[k as ListKey] as unknown[]).splice(+i, 1); commitJournal(); return rerender(page) }
  if (d.ren) {
    const [k, i] = d.ren.split(':'), arr = j[k as ListKey] as string[], old = arr[+i], v = ask('Rename', old); if (!v || v === old) return;
    arr[+i] = v;
    // keep entries consistent with the renamed option
    for (const t of j.trades) { if (k === 'setups' && t.setup === old) t.setup = v; for (const f of ['entryReasons', 'exitReasons', 'motives', 'tags'] as const) { const xs = t[f]; if (xs && (k === f || (k === 'tagList' && f === 'tags'))) t[f] = xs.map(x => (x === old ? v : x)) } }
    commitJournal(); return rerender(page);
  }
  if (d.act === 'backup') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(j)], { type: 'application/json' })); a.download = `journal_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); return }
  if (d.act === 'clear' && confirm('Delete every journal entry, note and setting? (Download a backup first.)')) { replaceJournal({ ...newJournal(), seen: j.seen, synced: true }); return rerender(page) }
  void arg;
}
async function onChange(e: Event, page: string) {
  const el = e.target as HTMLInputElement, j = journal();
  if (el.dataset.cl && editCl) { if (el.dataset.cl === 'advanced') editCl.advanced = el.checked; else editCl.title = el.value; if (el.dataset.cl === 'advanced') rerender(page); return }
  if (el.dataset.pp && propDraft) { const k = el.dataset.pp as keyof Prop; (propDraft as unknown as Record<string, unknown>)[k] = k === 'start' ? Date.parse(el.value) / 1000 : ['target', 'maxDD', 'dailyDD', 'minDays'].includes(k) ? +el.value : el.value; return }
  if (el.dataset.imp != null) { const s = new Set(calFilter.impact.split(',')); el.checked ? s.add(el.dataset.imp) : s.delete(el.dataset.imp); calFilter.impact = [...s].join(','); return loadCalendar() }
  if (el.dataset.ccy != null) { calFilter.ccy = el.value; return loadCalendar() }
  if (el.dataset.set === 'replayAccount') { j.replayAccount = el.value || undefined; commitJournal(); return }
  if (el.dataset.set === 'replayBars') { j.replayBars = Math.max(1, Math.min(2000, Math.round(+el.value) || 50)); commitJournal(); return }
  if (el.dataset.set === 'calendar') { j.calendar = el.value as Journal['calendar']; commitJournal(); return rerender(page) }
  if (el.id === 'jwRestore') {
    const f = el.files?.[0]; el.value = ''; if (!f) return;
    try { const data = JSON.parse(await f.text()) as Journal; if (!Array.isArray(data.trades)) throw Error('not a journal backup'); if (!confirm(`Replace the journal with ${data.trades.length} entries from this backup?`)) return; replaceJournal({ ...data, seen: j.seen, synced: true }); toast('Journal restored'); rerender(page) }
    catch (err) { toast(`Restore failed: ${(err as Error).message}`, 6000) }
  }
}
let noteTimer = 0;
function onInput(e: Event, page: string) {
  const el = e.target as HTMLInputElement, j = journal();
  if (el.dataset.cli != null && editCl) { editCl.items[+el.dataset.cli].text = el.value; return }
  if (el.dataset.clw != null && editCl) { editCl.items[+el.dataset.clw].weight = Math.max(1, +el.value || 1); return }
  if (el.dataset.resume) { resumeName = el.value; return }
  if (el.dataset.noteq != null) { noteQ = el.value; clearTimeout(noteTimer); noteTimer = window.setTimeout(() => { rerender(page); const q = document.querySelector<HTMLInputElement>('[data-noteq]'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length) }, 300); return }
  const cur = (j.docs ?? []).find(n => n.id === noteId);
  if (el.dataset.nf && cur) {
    if (el.dataset.nf === 'tags') cur.tags = el.value.split(',').map(s => s.trim()).filter(Boolean); else (cur as unknown as Record<string, string>)[el.dataset.nf] = el.value;
    cur.updated = Date.now() / 1000; clearTimeout(noteTimer); noteTimer = window.setTimeout(() => commitJournal(), 600);
  }
}
