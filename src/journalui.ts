// Journal side panel: auto-captured trades, reason prompts on open/close, stats, calendar with daily notes, setups.
import type { Account } from './trading.ts';
import {
  EMOTIONS, EXIT_KINDS, MISTAKES, dayKey, migrate, filterTrades, incomplete, mark, newJournal, rMultiple, stats, syncFills, toCsv,
  type Filter, type JTrade, type Journal,
} from './journal.ts';
import { $, $$, esc, store, toast } from './store.ts';
import { award } from './journal/analytics.ts';
import { openWorkspace, workspaceChanged } from './journal/workspace.ts';
import { replayTrade } from './journal/replay.ts';
import type { ChartPane } from './chart.ts';

export interface JournalHost {
  /** Timeframe of a chart showing this symbol, if any. */
  tfOf(sym: string): string | undefined;
  /** Bracket levels resting in the account for this symbol (set by the order ticket's TP/SL). */
  bracketOf(sym: string): { stop?: number; target?: number };
  /** Chart image of the active pane, or null. */
  shot(): HTMLCanvasElement | null;
  /** Show this symbol on the active chart around a time. */
  show(sym: string, t: number): void;
  /** Show this symbol and timeframe on the active chart; resolves to its pane once bars are loaded. */
  pane(sym: string, tf: string): Promise<ChartPane>;
  /** Paper account, latest prices and the watchlist (portfolio risk). */
  portfolio(): { acct: Account; price: (sym: string) => number | undefined; watch: string[] };
}
let host: JournalHost;
let j: Journal = migrate({ ...newJournal(), ...store.get<Partial<Journal> | null>('journal', null) });
const cfg = store.get('journalCfg', { askOpen: true, askClose: true, tab: 'trades', period: 'all', sym: '', setup: '', result: '', group: 'bySetup' });
let source = '';
let saveTimer = 0;
function save(now = false) {
  clearTimeout(saveTimer);
  const go = () => { if (!store.set('journal', j)) toast('Journal storage is full — remove some chart snapshots or export and clear old trades', 8000) };
  if (now) go(); else saveTimer = window.setTimeout(go, 1000);
}
const money = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const f2 = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
const dt = (t?: number) => (t ? new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const dur = (s: number) => (s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`);

// ---------- capture ----------
/** Next paper orders come from this source (e.g. the forward test) until cleared. */
export function journalSource(s: string) { source = s }
export function journalSync(a: Account) {
  if (!host) return;   // the account is saved once before the journal is wired up
  const first = !j.synced;   // first run imports the existing paper history silently
  const r = syncFills(j, a, Math.floor(Date.now() / 1000), sym => ({ tf: host.tfOf(sym), source: source || undefined, ...host.bracketOf(sym) }));
  // A bracket is attached right after the fill that opens the position: pick it up on the next sync too.
  for (const t of j.trades) if (t.status === 'open' && (t.accountId ?? 'paper') === 'paper' && t.stop == null && t.target == null) Object.assign(t, host.bracketOf(t.sym));
  if (first || (!r.opened.length && !r.closed.length)) { save(first); if (first) render(); return }
  if (cfg.askOpen) r.opened.forEach(t => ask(t.id, 'open'));
  if (cfg.askClose) r.closed.forEach(t => ask(t.id, 'close'));
  [...r.opened, ...r.closed].forEach(t => award(t));
  save(true); render(); workspaceChanged();
}
export function journalMark(sym: string, px: number) { if (mark(j, sym, px)) save() }

// ---------- prompts ----------
type Mode = 'open' | 'close' | 'edit';
const queue: { id: string; mode: Mode }[] = [];
let editing: { id: string; mode: Mode } | null = null;
function ask(id: string, mode: Mode) {
  if (editing?.id === id && editing.mode === 'open' && mode === 'close') { queue.unshift({ id, mode }); return }   // closed while the entry prompt is open
  queue.push({ id, mode });
  if (!editing) next();
}
function next() {
  editing = queue.shift() ?? null;
  if (!editing) return;
  const t = j.trades.find(x => x.id === editing!.id);
  if (!t) return next();
  openDialog(t, editing.mode);
}

const chips = (name: string, all: string[], on: string[] = [], multi = true) =>
  `<div class="chips" data-chips="${name}" data-multi="${multi ? 1 : 0}">${all.map(x => `<button type="button" class="${on.includes(x) ? 'on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
const scale = (name: string, v = 0, label = '') => `<div class="chips" data-chips="${name}" data-multi="0" title="${label}">${[1, 2, 3, 4, 5].map(i => `<button type="button" class="${i === v ? 'on' : ''}" data-v="${i}">${i}</button>`).join('')}</div>`;

function openDialog(t: JTrade, mode: Mode) {
  const d = $<HTMLDialogElement>('#journalDlg'), r = rMultiple(t), closed = t.status === 'closed';
  $('#jdTitle').innerHTML = `${mode === 'open' ? 'New trade — why are you entering?' : mode === 'close' ? 'Trade closed — how did it go?' : 'Trade'} <span class="muted">${esc(t.sym)}</span>`;
  const showIn = mode !== 'close', showOut = mode !== 'open' && closed;
  $('#jdBody').innerHTML = `
    <div class="jd-head"><b class="${t.dir === 'long' ? 'up' : 'dn'}">${t.dir === 'long' ? 'LONG' : 'SHORT'}</b> ${esc(t.sym)} · ${+t.maxQty.toFixed(8)} @ ${+t.avgEntry.toPrecision(8)}
      ${closed ? ` → ${+(t.avgExit ?? 0).toPrecision(8)} · <b class="${cls(t.net)}">${money(t.net)}</b>${r != null ? ` · ${r.toFixed(2)}R` : ''}` : ' · open'}
      <span class="muted"> · ${dt(t.openTime)}${closed ? ` · held ${dur((t.closeTime ?? 0) - t.openTime)}` : ''} · MFE ${f2(t.mfe)} / MAE ${f2(t.mae)}${t.source ? ` · ${esc(t.source)}` : ''}</span></div>
    ${showIn ? `<fieldset><legend>Entry</legend>
      <label>Setup / playbook <input name="setup" list="jdSetups" value="${esc(t.setup ?? '')}" placeholder="Breakout, pullback…"></label>
      <datalist id="jdSetups">${j.setups.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Why did you enter? <textarea name="entryReason" rows="2" placeholder="Signal, level, confluence, higher-timeframe context…">${esc(t.entryReason ?? '')}</textarea></label>
      <div class="row wrap"><label>Planned stop <input name="stop" type="number" step="any" value="${esc(t.stop ?? '')}"></label><label>Target <input name="target" type="number" step="any" value="${esc(t.target ?? '')}"></label></div>
      <div>How do you feel? ${chips('emotionIn', EMOTIONS, t.emotionIn ? [t.emotionIn] : [], false)}</div>
      <div>Confidence ${scale('confidence', t.confidence, 'Confidence 1–5')}</div>
    </fieldset>` : ''}
    ${showOut ? `<fieldset><legend>Exit</legend>
      <div>Exit type ${chips('exitKind', EXIT_KINDS, t.exitKind ? [t.exitKind] : [], false)}</div>
      <label>Why did you exit? <textarea name="exitReason" rows="2">${esc(t.exitReason ?? '')}</textarea></label>
      <div>Followed the plan? ${chips('followedPlan', ['Yes', 'No'], t.followedPlan == null ? [] : [t.followedPlan ? 'Yes' : 'No'], false)}</div>
      <div>Mistakes ${chips('mistakes', MISTAKES, t.mistakes)}</div>
      <div>Feeling after ${chips('emotionOut', EMOTIONS, t.emotionOut ? [t.emotionOut] : [], false)}</div>
      <label>Lesson <textarea name="lesson" rows="2" placeholder="What would you do differently?">${esc(t.lesson ?? '')}</textarea></label>
      <div>Execution rating ${scale('rating', t.rating, 'Rate your execution, not the result')}</div>
    </fieldset>` : ''}
    ${mode === 'edit' ? `<label>Tags <input name="tags" value="${esc((t.tags ?? []).join(', '))}" placeholder="comma separated"></label><label>Notes <textarea name="notes" rows="2">${esc(t.notes ?? '')}</textarea></label>` : ''}
    <div class="row wrap">${t.shot?.startsWith('data:image/') ? `<img src="${esc(t.shot)}" alt="Chart snapshot" class="jd-shot">` : ''}</div>`;
  $('#jdSkipAll').hidden = !queue.length;
  $('#jdDelete').hidden = mode !== 'edit';
  if (!d.open) d.showModal();
}
function readDialog(t: JTrade) {
  const f = $('#jdBody');
  const val = (n: string) => f.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value;
  const chip = (n: string) => $$(`[data-chips="${n}"] button.on`, f).map(b => b.dataset.v!);
  const has = (n: string) => !!f.querySelector(`[name="${n}"],[data-chips="${n}"]`);
  const txt = (n: keyof JTrade) => { if (has(n)) (t as unknown as Record<string, unknown>)[n] = val(n)?.trim() || undefined };
  const one = (n: keyof JTrade, conv: (s: string) => unknown = s => s) => { if (has(n)) { const v = chip(n)[0]; (t as unknown as Record<string, unknown>)[n] = v == null ? undefined : conv(v) } };
  ['setup', 'entryReason', 'exitReason', 'lesson', 'notes'].forEach(n => txt(n as keyof JTrade));
  for (const n of ['stop', 'target'] as const) if (has(n)) { const v = val(n); t[n] = v ? +v : undefined }
  one('emotionIn'); one('emotionOut'); one('exitKind'); one('confidence', Number); one('rating', Number); one('followedPlan', s => s === 'Yes');
  if (has('mistakes')) t.mistakes = chip('mistakes');
  if (has('tags')) t.tags = val('tags')!.split(',').map(s => s.trim()).filter(Boolean);
  if (t.setup && !j.setups.includes(t.setup)) j.setups.push(t.setup);
}

// ---------- panel ----------
function filter(): Filter {
  const now = Date.now() / 1000, day = 86400;
  const from = { today: dayStart(), '7d': now - 7 * day, '30d': now - 30 * day, '90d': now - 90 * day, year: new Date(new Date().getFullYear(), 0, 1).getTime() / 1000 }[cfg.period as string];
  return { from, sym: cfg.sym || undefined, setup: cfg.setup || undefined, result: (cfg.result || undefined) as Filter['result'], dir: undefined };
}
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000 };

export function renderJournal() { render() }
/** Trades the panel shows: everything except backtest accounts (Bar Replay trades must not mix into live stats). */
function live() { const bt = new Set((j.accounts ?? []).filter(a => a.kind === 'backtest').map(a => a.id)); return j.trades.filter(t => !bt.has(t.accountId ?? 'paper')) }
/** Shared with the full journal workspace. */
export const journal = () => j;
export const journalHost = () => host;
export function replaceJournal(next: Journal) { j = migrate(next); save(true); render(); workspaceChanged() }
/** Persist after an edit: recompute discipline points, save, refresh both views. */
export function commitJournal(t?: JTrade) { if (t) award(t); save(true); render(); workspaceChanged() }
function render() {
  if (!$('#s-journal').classList.contains('on')) return;
  $$('#jTabs button').forEach(b => b.classList.toggle('on', b.dataset.jt === cfg.tab));
  const syms = [...new Set(j.trades.map(t => t.sym))].sort();
  const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  $('#jFilters').innerHTML = cfg.tab === 'calendar' || cfg.tab === 'setups' ? '' : `
    <select data-f="period">${[['all', 'All time'], ['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '3 months'], ['year', 'This year']].map(([v, l]) => opt(v, l, cfg.period)).join('')}</select>
    <select data-f="sym">${opt('', 'All symbols', cfg.sym)}${syms.map(s => opt(s, s, cfg.sym)).join('')}</select>
    <select data-f="setup">${opt('', 'All setups', cfg.setup)}${j.setups.map(s => opt(s, s, cfg.setup)).join('')}</select>
    <select data-f="result">${opt('', 'Any result', cfg.result)}${opt('win', 'Winners', cfg.result)}${opt('loss', 'Losers', cfg.result)}</select>`;
  const el = $('#jView');
  if (cfg.tab === 'trades') el.innerHTML = tradesView();
  else if (cfg.tab === 'stats') el.innerHTML = statsView();
  else if (cfg.tab === 'calendar') el.innerHTML = calendarView();
  else el.innerHTML = setupsView();
}

function tradesView() {
  const ts = filterTrades(live(), filter()).sort((a, b) => b.openTime - a.openTime);
  if (!ts.length) return `<div class="muted">${j.trades.length ? 'No trades match the filters.' : 'No trades yet. Every paper trade you open or close is recorded here automatically, and you are asked why.'}</div>`;
  return ts.slice(0, 300).map(t => {
    const r = rMultiple(t), warn = incomplete(t);
    return `<div class="jt ${warn ? 'warn-row' : ''}" data-id="${esc(t.id)}" title="${warn ? 'Missing setup or reasons — click to complete' : 'Click to edit'}">
      <div class="row"><b class="${t.dir === 'long' ? 'up' : 'dn'}">${t.dir === 'long' ? '▲' : '▼'} ${esc(t.sym)}</b><span class="muted">${dt(t.openTime)}</span><span class="grow"></span>
        ${t.kind !== 'notrade' ? '<button class="x" data-replay title="Replay this trade with Bar Replay">▶</button>' : ''}${t.status === 'open' ? '<span class="tag">OPEN</span>' : `<b class="${cls(t.net)}">${money(t.net)}</b>`}${r != null ? `<span class="muted">${r.toFixed(1)}R</span>` : ''}${warn ? '<span class="warn">⚠</span>' : ''}</div>
      <div class="muted jt-sub">${esc(t.setup ?? 'no setup')}${t.emotionIn ? ` · ${esc(t.emotionIn)}` : ''}${t.mistakes?.length ? ` · <span class="dn">${esc(t.mistakes.join(', '))}</span>` : ''}${t.entryReason ? ` · ${esc(t.entryReason.slice(0, 60))}` : ''}</div></div>`;
  }).join('');
}

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)}%`);
function statsView() {
  const s = stats(filterTrades(live(), filter()));
  if (!s.trades) return `<div class="muted">No closed trades${s.open ? ` (${s.open} open)` : ''}.</div>`;
  const k = (label: string, v: string, c = '') => `<div><span>${label}</span><b class="${c}">${v}</b></div>`;
  const groups: Record<string, string> = { bySetup: 'Setup', byEmotion: 'Emotion at entry', byMistake: 'Mistake', bySymbol: 'Symbol', byDir: 'Direction', byWeekday: 'Weekday', byHour: 'Hour' };
  const g = s[cfg.group as 'bySetup'] ?? s.bySetup;
  return `<div class="jkpi">
      ${k('Net P&L', money(s.net), cls(s.net))}${k('Trades', `${s.trades}${s.open ? ` +${s.open} open` : ''}`)}${k('Win rate', pct(s.winRate))}${k('Profit factor', Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞')}
      ${k('Expectancy', money(s.expectancy), cls(s.expectancy))}${k('Avg R', s.avgR == null ? '—' : `${s.avgR.toFixed(2)}R`, cls(s.avgR ?? 0))}${k('Avg win / loss', `${s.avgWin.toFixed(2)} / ${s.avgLoss.toFixed(2)}`)}${k('Payoff', s.payoff.toFixed(2))}
      ${k('Max drawdown', s.maxDD.toFixed(2), 'dn')}${k('Best / worst', `${s.best.toFixed(2)} / ${s.worst.toFixed(2)}`)}${k('Streak W / L', `${s.bestStreak} / ${s.worstStreak}`)}${k('Avg hold', dur(s.avgHoldMin * 60))}
      ${k('Followed plan', pct(s.followedPlan))}${k('Exit efficiency', pct(s.exitEfficiency))}${k('Green days', `${s.greenDays} / ${s.days.size}`)}${k('Fees', s.fees.toFixed(2))}
    </div>
    ${spark(s.curve)}
    <div class="row"><span class="muted">Break down by</span><select data-f="group">${Object.entries(groups).map(([v, l]) => `<option value="${v}" ${v === cfg.group ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <table class="jgroup"><tr><th></th><th>#</th><th>Win</th><th>PF</th><th>Net</th></tr>${g.map(x => `<tr><td>${esc(x.key)}</td><td>${x.n}</td><td>${x.winRate.toFixed(0)}%</td><td>${Number.isFinite(x.pf) ? x.pf.toFixed(2) : '∞'}</td><td class="${cls(x.net)}">${x.net.toFixed(2)}</td></tr>`).join('')}</table>`;
}
function spark(curve: number[]) {
  if (curve.length < 2) return '';
  const W = 260, H = 70, lo = Math.min(0, ...curve), hi = Math.max(0, ...curve), sp = hi - lo || 1, y = (v: number) => (H - ((v - lo) / sp) * H).toFixed(1);
  const d = [0, ...curve].map((v, i) => `${i ? 'L' : 'M'}${((i / curve.length) * W).toFixed(1)},${y(v)}`).join('');
  return `<svg class="jspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Cumulative P&L"><path d="M0,${y(0)}H${W}" stroke="var(--line)"/><path d="${d}" stroke="var(--accent)" stroke-width="1.5" fill="none"/></svg>`;
}

let month = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })();
function calendarView() {
  const s = stats(live()), first = new Date(month.y, month.m, 1), days = new Date(month.y, month.m + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const cells: string[] = Array.from({ length: lead }, () => '<div></div>');
  let total = 0;
  for (let d = 1; d <= days; d++) {
    const key = `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, x = s.days.get(key), note = j.notes[key];
    if (x) total += x.net;
    cells.push(`<div class="jday ${x ? (x.net > 0 ? 'win' : 'loss') : ''}" data-day="${key}" title="${x ? `${x.n} trades · win ${Math.round((x.wins / x.n) * 100)}%` : ''}${note ? `\n📝 ${esc(note)}` : ''}"><span>${d}${note ? '📝' : ''}</span>${x ? `<b>${x.net.toFixed(0)}</b><i>${x.n}</i>` : ''}</div>`);
  }
  const name = first.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  return `<div class="row"><button data-month="-1">‹</button><b class="grow" style="text-align:center">${esc(name)}</b><button data-month="1">›</button></div>
    <div class="jcal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<div class="muted">${x}</div>`).join('')}${cells.join('')}</div>
    <div class="row"><span class="muted">Month</span><b class="${cls(total)}">${money(total)}</b><span class="grow"></span><span class="muted">Click a day for its trades and notes</span></div>
    <div id="jDayView"></div>`;
}
function dayView(key: string) {
  const ts = live().filter(t => dayKey(t.closeTime ?? t.openTime) === key);
  $('#jDayView').innerHTML = `<h4>${esc(key)}</h4><textarea id="jNote" rows="3" placeholder="Daily note: market conditions, mood, plan for tomorrow…">${esc(j.notes[key] ?? '')}</textarea>
    ${ts.map(t => `<div class="jt" data-id="${esc(t.id)}"><b class="${t.dir === 'long' ? 'up' : 'dn'}">${esc(t.sym)}</b> <span class="${cls(t.net)}">${t.status === 'open' ? 'open' : money(t.net)}</span> <span class="muted">${esc(t.setup ?? '')}</span></div>`).join('')}`;
  $<HTMLTextAreaElement>('#jNote').oninput = e => { const v = (e.target as HTMLTextAreaElement).value.trim(); if (v) j.notes[key] = v; else delete j.notes[key]; save() };
}

function setupsView() {
  const s = stats(live()), by = new Map(s.bySetup.map(g => [g.key, g]));
  return `<div class="muted">Playbooks: the setups you trade. Stats are over all closed trades.</div>
    <table class="jgroup"><tr><th>Setup</th><th>#</th><th>Win</th><th>Net</th><th></th></tr>${j.setups.map((x, i) => { const g = by.get(x); return `<tr><td>${esc(x)}</td><td>${g?.n ?? 0}</td><td>${g ? g.winRate.toFixed(0) + '%' : '—'}</td><td class="${cls(g?.net ?? 0)}">${g ? g.net.toFixed(2) : '—'}</td><td><button class="x" data-rename="${i}" title="Rename">✎</button><button class="x" data-del-setup="${i}" title="Remove from list">✕</button></td></tr>` }).join('')}</table>
    <div class="row"><input id="jNewSetup" placeholder="New setup name" class="grow"><button id="jAddSetup">Add</button></div>`;
}

// ---------- wiring ----------
export function initJournal(h: JournalHost) {
  host = h;
  $('#jTabs').onclick = e => { const t = (e.target as HTMLElement).dataset.jt; if (t) { cfg.tab = t; store.set('journalCfg', cfg); render() } };
  $('#s-journal').addEventListener('change', e => {
    const f = (e.target as HTMLElement).dataset.f;
    if (f) { (cfg as Record<string, unknown>)[f] = (e.target as HTMLSelectElement).value; store.set('journalCfg', cfg); render() }
  });
  $('#jView').onclick = e => {
    const el = e.target as HTMLElement;
    const card = el.closest<HTMLElement>('[data-id]');
    if (card) { if (el.closest('[data-replay]')) void replayTrade(card.dataset.id!); else openWorkspace('form', card.dataset.id); return }
    const m = el.closest<HTMLElement>('[data-month]');
    if (m) { const d = new Date(month.y, month.m + +m.dataset.month!, 1); month = { y: d.getFullYear(), m: d.getMonth() }; render(); return }
    const day = el.closest<HTMLElement>('[data-day]');
    if (day) { dayView(day.dataset.day!); return }
    if (el.id === 'jAddSetup') { const v = $<HTMLInputElement>('#jNewSetup').value.trim(); if (v && !j.setups.includes(v)) { j.setups.push(v); save(true); render() } return }
    if (el.dataset.rename != null) {
      const old = j.setups[+el.dataset.rename], v = prompt('Rename setup', old)?.trim();
      if (v && v !== old) { j.setups[+el.dataset.rename] = v; j.trades.forEach(t => { if (t.setup === old) t.setup = v }); save(true); render() }
      return;
    }
    if (el.dataset.delSetup != null) { j.setups.splice(+el.dataset.delSetup, 1); save(true); render() }
  };
  $('#jMenu').onclick = () => {
    const d = $<HTMLDialogElement>('#journalSetDlg');
    $<HTMLInputElement>('#jAskOpen').checked = cfg.askOpen; $<HTMLInputElement>('#jAskClose').checked = cfg.askClose;
    d.showModal();
  };
  $('#jAskOpen').onchange = e => { cfg.askOpen = (e.target as HTMLInputElement).checked; store.set('journalCfg', cfg) };
  $('#jAskClose').onchange = e => { cfg.askClose = (e.target as HTMLInputElement).checked; store.set('journalCfg', cfg) };
  const download = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click() };
  $('#jOpen').onclick = () => openWorkspace('dashboard');
  $('#jCsv').onclick = () => download(`journal_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filterTrades(live(), filter())), 'text/csv');
  $('#jBackup').onclick = () => download(`journal_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(j), 'application/json');
  $<HTMLInputElement>('#jRestore').onchange = async e => {
    const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Journal;
      if (!Array.isArray(data.trades)) throw new Error('not a journal backup');
      if (!confirm(`Replace the journal with ${data.trades.length} trades from this backup?`)) return;
      j = { ...newJournal(), ...data, seen: j.seen, synced: true };   // keep the link to the current paper account
      save(true); render(); toast('Journal restored');
    } catch (err) { toast(`Restore failed: ${(err as Error).message}`, 6000) }
  };
  $('#jClear').onclick = () => { if (confirm('Delete every journal entry and note? (Export a backup first.)')) { j = { ...newJournal(), seen: j.seen, synced: true }; save(true); render() } };

  // dialog
  const dlg = $<HTMLDialogElement>('#journalDlg');
  $('#jdBody').onclick = e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-chips] button');
    if (!b) return;
    const box = b.parentElement!;
    if (box.dataset.multi !== '1') box.querySelectorAll('button').forEach(x => { if (x !== b) x.classList.remove('on') });
    b.classList.toggle('on');
  };
  const cur = () => (editing ? j.trades.find(t => t.id === editing!.id) : undefined);
  const done = (mark?: 'save' | 'skip') => {
    const t = cur();
    if (t && mark) {
      if (mark === 'save') { readDialog(t); award(t) }
      if (editing!.mode === 'open') t.askedIn = true; if (editing!.mode === 'close') t.askedOut = true;
      save(true);
    }
    dlg.close();
  };
  $('#jdSave').onclick = () => done('save');
  $('#jdSkip').onclick = () => done('skip');
  $('#jdSkipAll').onclick = () => { queue.length = 0; done('skip') };
  $('#jdDelete').onclick = () => { const t = cur(); if (t && confirm('Delete this trade from the journal?')) { j.trades = j.trades.filter(x => x !== t); save(true); dlg.close() } };
  $('#jdShot').onclick = () => {
    const t = cur(), c = host.shot(); if (!t || !c) return toast('No chart to capture');
    readDialog(t);
    // ponytail: snapshots live in localStorage (~5 MB); a ~640px JPEG is ~40 KB, so roughly a hundred fit. Move to IndexedDB if that runs out.
    const k = Math.min(1, 640 / c.width), s = document.createElement('canvas');
    s.width = c.width * k; s.height = c.height * k; s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
    t.shot = s.toDataURL('image/jpeg', 0.7); save(true); openDialog(t, editing!.mode);
  };
  $('#jdChart').onclick = () => { const t = cur(); if (t) { done('save'); host.show(t.sym, t.openTime) } };
  dlg.addEventListener('close', () => { editing = null; render(); setTimeout(next, 150) });
}
