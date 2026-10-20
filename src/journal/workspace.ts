// Full-screen journal workspace: navigation, filters, dashboard and the journals table.
// Other pages live in form.ts (the entry form) and pages.ts (checklists, discipline, analyses, tools, notes, settings).
import { journal, commitJournal } from '../journalui.ts';
import type { JTrade } from '../journal.ts';
import { balance, closed, dashboard, dayScores, dayKeyOf, periodRange, scope, tradeTime, rOf, rrExpected, addImported, parseCsv, parseMtHtml, transfersOf, type Group, type Period } from './analytics.ts';
import { renderForm } from './form.ts';
import { renderPage } from './pages.ts';
import { replayTrade } from './replay.ts';
import { riskPage } from '../risk/page.ts';
import { toCsv } from '../journal.ts';
import { $, $$, esc, store, toast } from '../store.ts';

export const ws = store.get('jwCfg', { period: 'all' as Period, from: '', to: '', cols: ['title', 'sym', 'dir', 'vol', 'tf', 'date', 'comm', 'r', 'rexp', 'result', 'media', 'points'], sort: 'date', desc: true, group: '', q: '', page: 0, dashTab: 'bySymbol', heat: 'pnl' });
export const saveWs = () => store.set('jwCfg', ws);
let page = 'dashboard', arg = '';

// ---------- shared helpers ----------
export const money = (v: number, sign = true) => `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
export const pct = (v: number) => `${v.toFixed(2)}%`;
export function fmtDate(t: number | undefined, withTime = true) {
  if (!t) return '';
  const cal = journal().calendar === 'jalali' ? 'fa-IR-u-ca-persian-nu-latn' : undefined;
  return new Intl.DateTimeFormat(cal, { year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(t * 1000);
}
export const range = () => periodRange(ws.period, Date.now() / 1000, { from: ws.from ? Date.parse(ws.from) / 1000 : undefined, to: ws.to ? Date.parse(ws.to) / 1000 + 86400 : undefined });
export const trades = () => scope(journal(), range());
/** Balance at the start of the selected period (so the equity curve starts at the right level). */
export const startBalance = () => { const r = range(); return balance(journal(), journal().account ?? '', (r.from ?? -Infinity) - 1e-6) };
export function bars(groups: Group[], max = 12) {
  const g = groups.slice(0, max), m = Math.max(1e-9, ...g.map(x => Math.abs(x.net)));
  if (!g.length) return '<div class="muted">No data yet.</div>';
  return `<div class="jw-bars">${g.map(x => `<div class="jw-bar"><span title="${esc(x.key)}">${esc(x.key)}</span><div><i class="${cls(x.net)}" style="width:${(Math.abs(x.net) / m) * 100}%"></i></div><b class="${cls(x.net)}">${money(x.net)}</b><em>${x.n} · ${x.winRate.toFixed(0)}%</em></div>`).join('')}</div>`;
}
export function lineChart(series: { values: number[]; color: string; label: string; dash?: boolean }[], h = 180) {
  const all = series.flatMap(s => s.values);
  if (all.length < 2) return '<div class="muted jw-empty">Not enough closed trades for a chart yet.</div>';
  const W = 800, lo = Math.min(...all), hi = Math.max(...all), sp = hi - lo || 1, n = Math.max(...series.map(s => s.values.length)) - 1 || 1;
  const y = (v: number) => (h - 8 - ((v - lo) / sp) * (h - 16)).toFixed(1);
  return `<svg class="jw-line" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map(s => s.label).join(', '))}">
    ${[0.25, 0.5, 0.75].map(f => `<path d="M0,${(h * f).toFixed(1)}H${W}" stroke="var(--grid)"/>`).join('')}
    ${series.map(s => `<path d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${((i / n) * W).toFixed(1)},${y(v)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''} vector-effect="non-scaling-stroke"/>`).join('')}
  </svg><div class="jw-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}<span class="muted">${money(lo, false)} – ${money(hi, false)}</span></div>`;
}
export const card = (title: string, body: string, sub = '', extra = '') => `<section class="jw-card ${extra}"><header><h3>${esc(title)}</h3>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</header>${body}</section>`;
export const kpi = (label: string, value: string, c = '', title = '') => `<div class="jw-kpi" title="${esc(title)}"><span>${esc(label)}</span><b class="${c}">${value}</b></div>`;

// ---------- shell ----------
const NAV: [string, string, string?][] = [
  ['dashboard', '▦ Dashboard'], ['journals', '☰ Journals'], ['checklists', '☑ Checklists'], ['discipline', '🔥 Discipline path'],
  ['an-daily', 'Daily', 'Analyses'], ['an-psych', 'Psychology & behaviour', 'Analyses'], ['an-time', 'Time & efficiency', 'Analyses'], ['an-quality', 'Execution quality', 'Analyses'], ['an-pro', 'Professional', 'Analyses'],
  ['props', 'Prop challenges', 'Tools'], ['calendar', 'Economic calendar', 'Tools'], ['clock', 'Forex sessions clock', 'Tools'], ['resume', 'Trading resume', 'Tools'], ['compare', 'Compare accounts', 'Tools'], ['risk', 'Portfolio risk', 'Tools'],
  ['notes', '✎ Notes'], ['settings', '⚙ Accounts & settings'],
];
export function openWorkspace(p = 'dashboard', a = '') {
  const el = $('#jw');
  if (el.hidden) { el.hidden = false; buildShell() }
  go(p, a);
}
export function go(p: string, a = '') { page = p; arg = a; renderNow() }
let pending = 0;
/** Data changed somewhere (capture, panel edit): re-render unless the user is typing in the form. */
export function workspaceChanged() {
  if ($('#jw')?.hidden !== false || page === 'form') return;
  const a = document.activeElement;
  if (a && $('#jwMain').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // never under the user's cursor
  clearTimeout(pending); pending = window.setTimeout(renderNow, 200);
}
function buildShell() {
  const el = $('#jw'), j = journal();
  let group = '';
  $('#jwNav').innerHTML = NAV.map(([id, label, g]) => { const head = g && g !== group ? `<h4>${(group = g)}</h4>` : g ? '' : ((group = ''), ''); return `${head}<button data-go="${id}" class="${g ? 'sub' : ''}">${esc(label)}</button>` }).join('');
  $('#jwNav').onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]'); if (b) go(b.dataset.go!) };
  $('#jwClose').onclick = () => { el.hidden = true };
  $('#jwNew').onclick = () => go('form', '');
  $('#jwFilters').onchange = e => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'jwAccount') { j.account = t.value; commitJournal() }
    else { (ws as Record<string, unknown>)[t.dataset.k!] = t.value; ws.page = 0; saveWs() }
    renderNow();
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden && !document.querySelector('dialog[open]') && page !== 'form') el.hidden = true });
}
function renderNow() {
  const j = journal();
  $$('#jwNav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === page || (page === 'form' && b.dataset.go === 'journals')));
  $('#jwFilters').innerHTML = `<select id="jwAccount" title="Account"><option value="">All accounts</option>${(j.accounts ?? []).map(a => `<option value="${esc(a.id)}" ${a.id === j.account ? 'selected' : ''}>${esc(a.name)}${a.kind === 'backtest' ? ' (backtest)' : ''}</option>`).join('')}</select>
    <select data-k="period" title="Period">${([['all', 'All time'], ['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom range']] as const).map(([v, l]) => `<option value="${v}" ${ws.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${ws.period === 'custom' ? `<input type="date" data-k="from" value="${esc(ws.from)}"><input type="date" data-k="to" value="${esc(ws.to)}">` : ''}
    <span class="muted">Balance <b>${money(balance(j), false)}</b></span>`;
  const main = $('#jwMain');
  main.scrollTop = 0;
  if (page === 'dashboard') main.innerHTML = dashboardPage();
  else if (page === 'journals') main.innerHTML = journalsPage();
  else if (page === 'form') renderForm(main, arg);
  else if (page === 'risk') riskPage(main);
  else renderPage(main, page, arg);
  main.onclick = page === 'dashboard' || page === 'journals' ? onMainClick : main.onclick;
  main.onchange = page === 'dashboard' || page === 'journals' ? onMainChange : main.onchange;
}

// ---------- dashboard ----------
function dashboardPage() {
  const j = journal(), all = trades(), sb = startBalance(), d = dashboard(j, all, sb), tr = transfersOf(j.accounts ?? [], j.account ?? '');
  const groups: [string, string][] = [['bySymbol', 'Symbols'], ['byWeekday', 'Weekdays'], ['bySession', 'Sessions'], ['byTf', 'Timeframe'], ['byEntryReason', 'Entry reasons'], ['byExitReason', 'Exit reasons'], ['bySetup', 'Setups']];
  const g = (d as unknown as Record<string, Group[]>)[ws.dashTab] ?? d.bySymbol;
  const ma = d.ma;
  return `<div class="jw-grid">
    <div class="jw-kpis">
      ${kpi('Account balance', money(d.balance, false), '', tr.length ? 'Deposits and withdrawals are included' : '')}${kpi('Win rate', pct(d.winRate))}${kpi('Average R', `${d.avgR.toFixed(2)}R`, cls(d.avgR), `${d.rCount} trades with a stop or a manual R`)}
      ${kpi('Profit factor', Number.isFinite(d.pf) ? d.pf.toFixed(2) : '∞')}${kpi('Journal entries', String(d.journals))}${kpi('Net P&L', money(d.net), cls(d.net))}
    </div>
    ${card('Equity curve and moving average', lineChart([{ values: [sb, ...d.curve.map(c => c.bal)], color: 'var(--accent)', label: 'Balance' }, { values: [sb, ...ma], color: 'var(--warn)', label: 'MA of last 5 trades', dash: true }]) +
      `<div class="jw-row">${kpi('Cumulative P&L', money(d.net), cls(d.net))}${kpi('MA (5 trades)', money(ma.at(-1) ?? sb, false))}${kpi('Distance from MA', money((d.curve.at(-1)?.bal ?? sb) - (ma.at(-1) ?? sb)), cls((d.curve.at(-1)?.bal ?? sb) - (ma.at(-1) ?? sb)))}</div>`, 'Balance after each closed trade', 'wide')}
    ${card('Profit and loss distribution', `<div class="jw-donut" style="--w:${d.trades ? (d.wins / d.trades) * 100 : 0}%;--l:${d.trades ? (d.losses / d.trades) * 100 : 0}%"><b>${pct(d.winRate)}</b><span>win rate</span></div>
      <div class="jw-row">${kpi('Winning trades', `${d.wins}`, 'up')}${kpi('Losing trades', `${d.losses}`, 'dn')}${kpi('Break-even', `${d.even}`)}${kpi('Average win', money(d.avgWin, false), 'up')}${kpi('Average loss', money(d.avgLoss, false), 'dn')}</div>`, `${d.trades} closed trades`)}
    ${card('Performance analysis', `<div class="jw-tabs">${groups.map(([k, l]) => `<button data-dash="${k}" class="${ws.dashTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>${bars(g)}`, 'Net result by factor')}
    ${card('Trading activity', heatmap(all), 'Last 12 months — click a day to see its entries', 'wide')}
    ${card('Long vs short', ['long', 'short'].map(s => { const x = d[s as 'long']; return `<div class="jw-side"><b class="${s === 'long' ? 'up' : 'dn'}">${s === 'long' ? 'Long' : 'Short'} positions</b><span class="muted">${pct(x.share)} of trades</span><b class="${cls(x.net)}">${money(x.net)}</b>
      <div class="jw-row">${kpi('Trades', String(x.n))}${kpi('Win rate', pct(x.winRate))}${kpi('Profit', money(x.profit, false), 'up')}${kpi('Loss', money(x.loss, false), 'dn')}</div></div>` }).join(''))}
    ${card('Performance summary', `<div class="jw-row wrap">
      ${kpi('Best trade', d.best ? `${money(d.best.net)} <small>${pct(d.pct(d.best.net))} · ${esc(d.best.sym)}</small>` : '—', 'up')}${kpi('Worst trade', d.worst ? `${money(d.worst.net)} <small>${pct(d.pct(d.worst.net))} · ${esc(d.worst.sym)}</small>` : '—', 'dn')}
      ${kpi('Gross profit', `${money(d.gp, false)} <small>${pct(d.pct(d.gp))}</small>`)}${kpi('Gross loss', `${money(d.gl, false)} <small>${pct(d.pct(d.gl))}</small>`)}${kpi('Net profit', `${money(d.net)} <small>${pct(d.pct(d.net))}</small>`, cls(d.net))}
      ${kpi('Recovery factor', d.recovery.toFixed(2))}${kpi('Sharpe (per trade)', d.sharpe.toFixed(2))}${kpi('Absolute drawdown', money(d.absDD, false))}${kpi('Relative drawdown', pct(d.relDD))}
      ${kpi('Commission', money(d.commission, false))}${kpi('Swap', money(d.swap, false))}${kpi('Max consecutive wins', `${d.consecWins} · ${money(d.consecWinAmt, false)}`)}${kpi('Max consecutive losses', `${d.consecLosses} · ${money(d.consecLossAmt, false)}`)}</div>`, 'Risk, costs and records', 'wide')}
    ${card('Risk and discipline', `<div class="jw-row">${kpi('Average risk per trade', pct(d.risk.avg))}${kpi('Trades with known risk', String(d.risk.n))}</div>
      ${['Under 1% — conservative', '1–2% — standard', '2–3% — aggressive', 'Over 3% — high'].map((l, i) => `<div class="jw-meter"><span>${l}</span><div><i style="width:${d.risk.n ? (d.risk.buckets[i] / d.risk.n) * 100 : 0}%"></i></div><b>${d.risk.buckets[i]}</b></div>`).join('')}
      <div class="jw-row">${kpi('Checklist used', `${d.checklist.of ? pct((d.checklist.done / d.checklist.of) * 100) : '—'} <small>${d.checklist.done} of ${d.checklist.of}</small>`)}${kpi('Stop loss set', `${d.trades ? pct((d.stopSet / d.trades) * 100) : '—'} <small>${d.stopSet} of ${d.trades}</small>`)}${kpi('Trades without a plan', `${d.trades ? pct((d.noPlan / d.trades) * 100) : '—'} <small>no stop and no reason</small>`, d.noPlan ? 'dn' : '')}</div>`, 'Estimated from the stored risk %, the stop distance, or the realised loss')}
    ${card('Sessions', `<div class="jw-row wrap">${d.bySession.map(s => kpi(s.key, `${money(s.net)} <small>${s.n} trades</small>`, cls(s.net))).join('')}</div>`, 'UTC: Tokyo 00–08, London 08–16, New York 13–22, Sydney 22–24')}
    ${card('Top symbols', bars(d.bySymbol, 8), 'By contribution to profit')}
  </div>`;
}
function heatmap(all: JTrade[]) {
  const t = closed(all), by = new Map<string, { net: number; n: number }>(), q = dayScores(journal());
  for (const x of t) { const k = dayKeyOf(tradeTime(x)), v = by.get(k) ?? { net: 0, n: 0 }; v.net += x.net; v.n++; by.set(k, v) }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 364 - ((start.getDay() + 6) % 7));
  const maxN = Math.max(1, ...[...by.values()].map(v => v.n)), maxAbs = Math.max(1e-9, ...[...by.values()].map(v => Math.abs(v.net)));
  const cells: string[] = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const k = dayKeyOf(d.getTime() / 1000), v = by.get(k), s = q.get(k);
    let bg = '';
    if (ws.heat === 'pnl' && v) bg = `color-mix(in srgb, var(--${v.net >= 0 ? 'up' : 'down'}) ${20 + (Math.abs(v.net) / maxAbs) * 80}%, transparent)`;
    if (ws.heat === 'activity' && v) bg = `color-mix(in srgb, var(--accent) ${20 + (v.n / maxN) * 80}%, transparent)`;
    if (ws.heat === 'quality' && s) bg = `color-mix(in srgb, var(--warn) ${20 + (s / 100) * 80}%, transparent)`;
    cells.push(`<i data-day="${k}" style="${bg ? `background:${bg}` : ''}" title="${fmtDate(d.getTime() / 1000, false)}${v ? ` · ${v.n} trades · ${money(v.net)}` : ''}${s ? ` · discipline ${s.toFixed(0)}` : ''}"></i>`);
  }
  const best = [...by].sort((a, b) => b[1].net - a[1].net)[0];
  return `<div class="jw-tabs">${[['pnl', 'Profit / loss'], ['activity', 'Activity'], ['quality', 'Day quality']].map(([k, l]) => `<button data-heat="${k}" class="${ws.heat === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="jw-heat">${cells.join('')}</div>
    <div class="jw-row">${kpi('Trades', String(t.length))}${kpi('Active days', String(by.size))}${kpi('Wins', String(t.filter(x => x.net > 0).length), 'up')}${kpi('Losses', String(t.filter(x => x.net < 0).length), 'dn')}${best ? kpi('Best day', `${fmtDate(Date.parse(best[0]) / 1000, false)} ${money(best[1].net)}`, 'up') : ''}</div>`;
}

// ---------- journals table ----------
const COLS: Record<string, { label: string; cell: (t: JTrade) => string; sort?: (t: JTrade) => number | string }> = {
  title: { label: 'Title', cell: t => esc(t.title || (t.kind === 'notrade' ? 'No-trade day' : t.setup || '—')), sort: t => t.title ?? '' },
  sym: { label: 'Symbol', cell: t => esc(t.sym), sort: t => t.sym },
  dir: { label: 'Dir', cell: t => (t.kind === 'notrade' ? '—' : `<span class="${t.dir === 'long' ? 'up' : 'dn'}">${t.dir}</span>`), sort: t => t.dir },
  vol: { label: 'Volume', cell: t => (t.kind === 'notrade' ? '' : String(+t.maxQty.toFixed(8))), sort: t => t.maxQty },
  tf: { label: 'TF', cell: t => esc(t.tf ?? '—'), sort: t => t.tf ?? '' },
  date: { label: 'Date', cell: t => fmtDate(t.openTime), sort: t => t.openTime },
  comm: { label: 'Comm.', cell: t => (t.fees ? t.fees.toFixed(2) : '—'), sort: t => t.fees },
  r: { label: 'Act. R', cell: t => { const r = rOf(t); return r == null ? '—' : `<span class="${cls(r)}">${r.toFixed(2)}R</span>` }, sort: t => rOf(t) ?? -1e9 },
  rexp: { label: 'Exp. R', cell: t => { const r = rrExpected(t); return r == null ? '—' : `${r.toFixed(2)}R` }, sort: t => rrExpected(t) ?? -1e9 },
  result: { label: 'Result', cell: t => (t.kind === 'notrade' ? '—' : t.status === 'open' ? '<span class="tag">OPEN</span>' : `<b class="${cls(t.net)}">${money(t.net)}</b>`), sort: t => t.net },
  media: { label: 'Media', cell: t => { const n = (t.media?.length ?? 0) + (t.shot ? 1 : 0); return n ? `📎 ${n}` : '—' }, sort: t => t.media?.length ?? 0 },
  points: { label: 'Points', cell: t => { const p = Object.values(t.points ?? {}).reduce((s, v) => s + v, 0); return `<span title="Discipline points">${p}/80</span>` }, sort: t => Object.values(t.points ?? {}).reduce((s, v) => s + v, 0) },
  account: { label: 'Account', cell: t => esc(journal().accounts?.find(a => a.id === t.accountId)?.name ?? ''), sort: t => t.accountId ?? '' },
  setup: { label: 'Setup', cell: t => esc(t.setup ?? ''), sort: t => t.setup ?? '' },
  emotions: { label: 'Emotions', cell: t => esc((t.emotionsBefore ?? (t.emotionIn ? [t.emotionIn] : [])).join(', ')) },
};
function journalsPage() {
  const q = ws.q.trim().toLowerCase();
  let list = trades().filter(t => !q || [t.sym, t.title, t.setup, t.notes, t.entryReason, t.exitReason, ...(t.tags ?? []), ...(t.entryReasons ?? [])].some(x => x?.toLowerCase().includes(q)));
  const sorter = COLS[ws.sort]?.sort ?? (t => t.openTime);
  list = list.sort((a, b) => { const x = sorter(a), y = sorter(b); return (x < y ? -1 : x > y ? 1 : 0) * (ws.desc ? -1 : 1) });
  const cols = ws.cols.filter(c => COLS[c]), per = 25, pages = Math.max(1, Math.ceil(list.length / per));
  ws.page = Math.min(ws.page, pages - 1);
  const head = `<tr>${cols.map(c => `<th data-sort="${c}">${COLS[c].label}${ws.sort === c ? (ws.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}<th></th></tr>`;
  const row = (t: JTrade) => `<tr class="click ${t.kind !== 'notrade' && !t.entryReasons?.length && !t.entryReason ? 'warn-row' : ''}" data-open="${esc(t.id)}">${cols.map(c => `<td>${COLS[c].cell(t)}</td>`).join('')}<td>${t.kind !== 'notrade' ? `<button class="x" data-replay="${esc(t.id)}" title="Replay this trade on the chart with Bar Replay">▶</button>` : ''}</td></tr>`;
  let body = '';
  if (ws.group) {
    const key = (t: JTrade) => ws.group === 'day' ? fmtDate(t.openTime, false) : ws.group === 'sym' ? t.sym : ws.group === 'setup' ? t.setup ?? '(no setup)' : journal().accounts?.find(a => a.id === t.accountId)?.name ?? '';
    const groups = new Map<string, JTrade[]>(); list.forEach(t => groups.set(key(t), [...(groups.get(key(t)) ?? []), t]));
    body = [...groups].map(([k, xs]) => { const net = xs.reduce((s, x) => s + (x.status === 'closed' ? x.net : 0), 0); return `<tr class="grp"><th colspan="${cols.length + 1}">${esc(k)} <span class="muted">${xs.length} entries</span> <b class="${cls(net)}">${money(net)}</b></th></tr>${xs.map(row).join('')}` }).join('');
  } else body = list.slice(ws.page * per, ws.page * per + per).map(row).join('');
  const pg = (i: number) => `<button data-page="${i}" class="${i === ws.page ? 'on' : ''}">${i + 1}</button>`;
  return `<div class="jw-toolbar">
      <input type="search" data-ws="q" value="${esc(ws.q)}" placeholder="Search symbol, notes, tags…">
      <label>Group <select data-ws="group">${[['', 'None'], ['day', 'Day'], ['sym', 'Symbol'], ['setup', 'Setup'], ['account', 'Account']].map(([v, l]) => `<option value="${v}" ${ws.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="grow"></span>
      <button data-act="cols">Columns</button>
      <label class="btn" title="MetaTrader 4/5 HTML statement or a CSV export from an exchange">⤓ Import statement<input type="file" id="jwImport" accept=".htm,.html,.csv,.txt" hidden></label>
      <button data-act="csv">⤒ Export CSV</button>
      <button data-act="new" class="on">＋ New entry</button>
    </div>
    <div class="jw-colpick" hidden>${Object.entries(COLS).map(([k, c]) => `<label><input type="checkbox" data-col="${k}" ${ws.cols.includes(k) ? 'checked' : ''}> ${c.label}</label>`).join('')}</div>
    <div class="jw-tablewrap"><table class="jw-table">${head}${body || `<tr><td colspan="${cols.length + 1}" class="muted">No entries for this account and period. Trades on the paper account are recorded automatically; add others with “New entry” or import a statement.</td></tr>`}</table></div>
    ${!ws.group && pages > 1 ? `<div class="jw-pager">${Array.from({ length: pages }, (_, i) => pg(i)).join('')}</div>` : ''}
    <div class="muted">${list.length} entries · rows marked yellow are missing an entry reason.</div>`;
}

// ---------- events for dashboard and journals ----------
function onMainClick(e: MouseEvent) {
  const el = e.target as HTMLElement, b = el.closest<HTMLElement>('[data-dash],[data-heat],[data-sort],[data-page],[data-replay],[data-open],[data-act],[data-day]');
  if (!b) return;
  if (b.dataset.dash) { ws.dashTab = b.dataset.dash; saveWs(); renderNow() }
  else if (b.dataset.heat) { ws.heat = b.dataset.heat; saveWs(); renderNow() }
  else if (b.dataset.day) { ws.q = ''; ws.period = 'custom'; ws.from = ws.to = b.dataset.day; saveWs(); go('journals') }
  else if (b.dataset.sort) { ws.desc = ws.sort === b.dataset.sort ? !ws.desc : true; ws.sort = b.dataset.sort; saveWs(); renderNow() }
  else if (b.dataset.page) { ws.page = +b.dataset.page; saveWs(); renderNow() }
  else if (b.dataset.replay) void replayTrade(b.dataset.replay);
  else if (b.dataset.open) go('form', b.dataset.open);
  else if (b.dataset.act === 'new') go('form', '');
  else if (b.dataset.act === 'cols') { const p = $('.jw-colpick'); p.hidden = !p.hidden }
  else if (b.dataset.act === 'csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(trades())], { type: 'text/csv' })); a.download = `journal_${new Date().toISOString().slice(0, 10)}.csv`; a.click() }
}
async function onMainChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.ws) { (ws as Record<string, unknown>)[el.dataset.ws] = el.value; ws.page = 0; saveWs(); renderNow(); return }
  if (el.dataset.col) { ws.cols = el.checked ? [...ws.cols, el.dataset.col] : ws.cols.filter(c => c !== el.dataset.col); saveWs(); renderNow(); return }
  if (el.id === 'jwImport') {
    const f = el.files?.[0]; el.value = ''; if (!f) return;
    const j = journal(), acc = j.account || (j.accounts ?? []).find(a => a.kind === 'manual')?.id;
    if (!acc) return toast('Choose or create a (non-paper) account first — Accounts & settings', 6000);
    try {
      const text = await f.text(), rows = /<tr/i.test(text) ? parseMtHtml(text) : parseCsv(text);
      if (!rows.length) return toast('No closed trades found in that file', 6000);
      const n = addImported(j, rows, acc);
      j.trades.filter(t => t.source === 'Import').forEach(t => { t.points ??= {} });
      commitJournal(); toast(`Imported ${n} trades${rows.length - n ? ` (${rows.length - n} already in the journal)` : ''}`);
    } catch (err) { toast(`Import failed: ${(err as Error).message}`, 6000) }
  }
}
