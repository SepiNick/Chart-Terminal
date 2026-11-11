// Strategy Tester tab: overview, 53-metric performance report (All/Long/Short), trades, properties, CSV export,
// date range, analysis (monthly returns, return distribution, streaks), optimisation with heatmap, walk-forward, Monte Carlo, portfolio backtest and forward testing into the paper account.
import { createChart, AreaSeries, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import type { ChartPane, ScriptRun } from './chart.ts';
import { METRIC_DEFS, fmtMetric, metrics } from './tester/metrics.ts';
import { monteCarlo, values } from './tester/optimize.ts';
import { forSymbol, makeEvaluate, paramSpecs, type Job } from './tester/runner.ts';
import { combine, type Leg, type Portfolio } from './tester/portfolio.ts';
import { monthlyReturns, rangeBounds, returnDistribution, sliceReport, streaks, type RangeSel } from './tester/analysis.ts';
import { fetchBars, type Bar } from './data.ts';
import type { WorkerMsg } from './tester/worker.ts';
import type { Metrics, OptResult, ParamSpec, TesterData, Trade, WalkForwardResult } from './tester/types.ts';
import type { PineValue } from './pine/types.ts';
import { $, calcPrec, esc, store, toast } from './store.ts';
import { api, apiTrade, onServer, serverMode, wsSend } from './sync.ts';
import { gate } from './servers.ts';
import { sourceFor } from './pineui.ts';
import { scriptSig } from './scriptsig.ts';

export interface TesterHost {
  /** Market order into the paper account at the chart's last price. */
  paper(p: ChartPane, side: 'buy' | 'sell', qty: number): void;
  watchlist(): string[];
}
let host: TesterHost;
let cur: { p: ChartPane; run: ScriptRun; data: TesterData } | null = null;
let tab = store.get<string>('tsTab', 'overview');
let eqChart: IChartApi | null = null;

const css = () => { const c = getComputedStyle(document.documentElement); return (n: string) => c.getPropertyValue(n).trim() };
const cls = (v: number) => (v >= 0 ? 'up' : 'dn');
const money = (v: number) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(2)}`;
const date = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16);
const DEF = Object.fromEntries(METRIC_DEFS.map(d => [d.key, d]));
const fm = (key: string, v: number) => fmtMetric(DEF[key], v);

// ---------- report date range (per strategy name) ----------
const PRESETS = { all: 'All data', '30d': 'Last 30 days', '90d': 'Last 90 days', ytd: 'Year to date', '1y': 'Last 365 days', custom: 'Custom dates' };
const ranges = store.get<Record<string, RangeSel>>('tsRange', {});
const rangeSel = (): RangeSel => (cur && ranges[cur.run.name]) || { preset: 'all' };
/** The report the tabs show: the strategy's results restricted to the chosen range. */
function view() {
  const { p, data } = cur!, bars = p.vb();
  return sliceReport(data, bars, rangeBounds(rangeSel(), bars.at(-1)?.time ?? 0));
}
/** Bar indexes of the chosen date range, for the optimiser, walk-forward and portfolio (bars before it are not run). */
function barRange(bars: Bar[]) {
  const b = rangeBounds(rangeSel(), cur?.p.vb().at(-1)?.time ?? bars.at(-1)?.time ?? 0);
  const at = (ok: (t: number) => boolean) => { const i = bars.findIndex(x => ok(x.time)); return i < 0 ? bars.length : i };
  return { from: b.from == null ? 0 : at(t => t >= b.from!), to: b.to == null ? bars.length : at(t => t > b.to!) };
}
function syncRange() {
  const box = document.getElementById('tsRange');
  if (!box) return;
  box.style.display = cur ? '' : 'none';
  if (box.contains(document.activeElement)) return;
  const sel = rangeSel(), custom = sel.preset === 'custom';
  $<HTMLSelectElement>('#tsRangeP').value = sel.preset;
  for (const [id, v] of [['#tsRangeF', sel.from], ['#tsRangeT', sel.to]] as const) { const i = $<HTMLInputElement>(id); i.value = v ?? ''; i.style.display = custom ? '' : 'none' }
}

export function initTesterUI(h: TesterHost) {
  host = h;
  $('#tsTabs').onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ts]'); if (b) { tab = b.dataset.ts!; store.set('tsTab', tab); show() } };
  $('#tsExport').onclick = exportCsv;
  // Analysis tabs and the report's date range live here, not in index.html.
  const props = $('#tsTabs [data-ts="props"]');
  props.insertAdjacentHTML('beforebegin', '<button data-ts="monthly">Monthly returns</button><button data-ts="dist">Distribution</button><button data-ts="streaks">Streaks</button>');
  $('#ts-props').insertAdjacentHTML('beforebegin', '<div class="tspane" id="ts-monthly"></div><div class="tspane" id="ts-dist"></div><div class="tspane" id="ts-streaks"></div>');
  $('#tsNoCode').insertAdjacentHTML('beforebegin', `<span id="tsRange" class="row" style="gap:4px" title="Date range: trades opened in it (report, analysis, CSV, Monte Carlo); optimise, walk-forward and portfolio run on its bars only">
    <select id="tsRangeP">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <input type="date" id="tsRangeF"><input type="date" id="tsRangeT"></span>`);
  $('#tsTitle').parentElement!.style.flexWrap = 'wrap';   // the custom dates need room in a narrow panel
  $('#tsRange').onchange = () => {
    if (!cur) return;
    const sel: RangeSel = { preset: $<HTMLSelectElement>('#tsRangeP').value as RangeSel['preset'], from: $<HTMLInputElement>('#tsRangeF').value || undefined, to: $<HTMLInputElement>('#tsRangeT').value || undefined };
    ranges[cur.run.name] = sel; store.set('tsRange', ranges);
    syncRange(); show();
  };
}

/** Called after every script run on the active chart. */
export function renderTester(p: ChartPane, run: ScriptRun | undefined, data: TesterData | undefined) {
  $('#tsTitle').textContent = data ? `${run!.name} · ${p.cfg.symbol} ${p.cfg.tf}` : 'No strategy or expert on the chart';
  cur = data && run ? { p, run, data } : null;
  syncRange();
  forward();
  show();
}

function show() {
  document.querySelectorAll<HTMLElement>('#tsTabs [data-ts]').forEach(b => b.classList.toggle('on', b.dataset.ts === tab));
  document.querySelectorAll<HTMLElement>('.tspane').forEach(el => el.classList.toggle('on', el.id === `ts-${tab}`));
  if (tab !== 'overview') { eqChart?.remove(); eqChart = null }
  if (!cur) {
    for (const id of ['#tsPortForm', '#tsPortOut', '#tsMetrics', '#tsPerf', '#tsTrades', '#tsProps', '#ts-monthly', '#ts-dist', '#ts-streaks', '#tsOptForm', '#tsOptOut', '#tsWfaForm', '#tsWfaOut', '#tsMcForm', '#tsMcOut']) $(id).innerHTML = '';
    document.querySelectorAll<HTMLElement>('.tspane').forEach(el => delete el.dataset.key);
    eqChart?.remove(); eqChart = null;
  }
  // Scripts re-run on every live tick: rebuild a form tab only when the strategy/chart changed, and never under the user's cursor.
  const pane = $(`#ts-${tab}`), key = cur ? `${cur.run.id}|${cur.p.cfg.symbol}|${cur.p.cfg.tf}` : '';
  if (pane.contains(document.activeElement) && document.activeElement !== document.body) return;
  if (['opt', 'wfa', 'mc', 'port'].includes(tab)) { if (pane.dataset.key === key) return; pane.dataset.key = key }
  if (!cur && tab !== 'fwd') return;
  ({ overview, perf, trades, props, monthly, dist, streaks: streakView, opt: optForm, wfa: wfaForm, mc: mcForm, port: portForm, fwd: forwardView } as Record<string, () => void>)[tab]?.();
}

// ---------- overview / performance / trades / properties ----------
function overview() {
  const { data, bars } = view(), m = metrics(data, bars);
  const tiles: [string, string, string?][] = [
    ['Net P&L', `${money(m.netProfit)} (${m.netProfitPct.toFixed(2)}%)`, cls(m.netProfit)], ['Total closed trades', String(m.totalTrades)],
    ['Percent profitable', `${m.winRate.toFixed(2)}%`], ['Profit factor', fm('profitFactor', m.profitFactor)],
    ['Max drawdown', `${m.maxDrawdown.toFixed(2)} (${m.maxDrawdownPct.toFixed(2)}%)`, 'dn'], ['Avg trade', money(m.avgTrade), cls(m.avgTrade)],
    ['Avg win / loss', `${m.avgWin.toFixed(2)} / ${m.avgLoss.toFixed(2)}`], ['CAGR', `${m.cagr.toFixed(2)}%`, cls(m.cagr)],
    ['Buy & hold', `${money(m.buyHold)} (${m.buyHoldPct.toFixed(2)}%)`, cls(m.buyHold)], ['Sharpe / Sortino', `${m.sharpe.toFixed(3)} / ${m.sortino.toFixed(3)}`],
    ['Commission paid', m.commission.toFixed(2)], ['Open P&L', money(m.openPL), cls(m.openPL)],
  ];
  $('#tsMetrics').innerHTML = tiles.map(([k, v, c]) => `<div><span>${k}</span><b class="${c ?? ''}">${v}</b></div>`).join('');
  const v = css();
  eqChart?.remove();
  eqChart = createChart($('#tsEquity'), { autoSize: true, layout: { background: { color: v('--bg') }, textColor: v('--muted'), attributionLogo: false }, grid: { vertLines: { visible: false }, horzLines: { color: v('--grid') } }, timeScale: { borderColor: v('--line') }, rightPriceScale: { borderColor: v('--line') } });
  let prev = data.initialCapital;
  eqChart.addSeries(AreaSeries, { lineColor: v('--accent'), topColor: v('--accent') + '44', bottomColor: v('--accent') + '05', lineWidth: 2, title: 'Equity' })
    .setData(bars.map((b, i) => ({ time: b.time as UTCTimestamp, value: (prev = data.equity[i] ?? prev) })));
  const first = bars[0]?.open;
  if (first) eqChart.addSeries(LineSeries, { color: v('--muted'), lineWidth: 1, title: 'Buy & hold', lastValueVisible: false, priceLineVisible: false }).setData(bars.map(b => ({ time: b.time as UTCTimestamp, value: data.initialCapital * b.close / first })));
  eqChart.timeScale().fitContent();
}

const sides = () => { const { data, bars: b } = view(); return [metrics(data, b), metrics(data, b, { side: 'long' }), metrics(data, b, { side: 'short' })] };
function perf() {
  const [a, l, s] = sides();
  let group = '';
  $('#tsPerf').innerHTML = '<tr><th>Metric</th><th>All</th><th>Long</th><th>Short</th></tr>' + METRIC_DEFS.map(d => {
    const head = d.group !== group ? `<tr><th colspan="4" class="grp">${esc((group = d.group))}</th></tr>` : '';
    const td = (m: Metrics) => `<td class="${d.format === 'money' && d.higherIsBetter ? cls(m[d.key]) : ''}">${fm(d.key, m[d.key])}</td>`;
    return `${head}<tr><td>${esc(d.label)}</td>${td(a)}${td(l)}${td(s)}</tr>`;
  }).join('');
}

function trades() {
  const { p } = cur!, { data } = view(), t = data.trades, f = (x: number) => x.toFixed(p.prec);
  let cum = 0;
  const cums = t.map(x => (cum += x.profit));
  $('#tsTrades').innerHTML = '<tr><th>#</th><th>Type</th><th>Entry</th><th>Entry time</th><th>Entry price</th><th>Exit</th><th>Exit time</th><th>Exit price</th><th>Qty</th><th>Net P&L</th><th>Run-up</th><th>Drawdown</th><th>Cum. P&L</th></tr>' +
    t.map((x, i) => [x, i] as const).reverse().slice(0, 1000).map(([x, i]) => `<tr><td>${i + 1}</td><td class="${x.dir === 'long' ? 'up' : 'dn'}">${x.dir}</td><td>${esc(x.entryId)}</td><td>${date(x.entryTime)}</td><td>${f(x.entryPrice)}</td><td>${esc(x.exitId)}</td><td>${date(x.exitTime)}</td><td>${f(x.exitPrice)}</td><td>${+x.qty.toFixed(6)}</td><td class="${cls(x.profit)}">${x.profit.toFixed(2)} (${x.profitPct.toFixed(2)}%)</td><td>${x.runup.toFixed(2)}</td><td>${x.drawdown.toFixed(2)}</td><td class="${cls(cums[i])}">${cums[i].toFixed(2)}</td></tr>`).join('') +
    (data.openCount ? `<tr class="muted"><td colspan="13">${data.openCount} open position(s) · open P&L ${data.openPL.toFixed(2)}</td></tr>` : '');
}

function props() {
  const { p, run, data } = cur!, b = p.vb(), sp = run.out?.meta.strategy;
  const rows: [string, unknown][] = [
    ['Symbol', p.cfg.symbol], ['Timeframe', p.cfg.tf], ['Bars', b.length], ['Range', b.length ? `${date(b[0].time)} — ${date(b.at(-1)!.time)}` : '—'], ['Initial capital', data.initialCapital],
    ...(sp ? [['Order size', `${sp.qtyValue} ${sp.qtyType}`], ['Pyramiding', sp.pyramiding], ['Commission', `${sp.commissionValue} ${sp.commissionType}`], ['Slippage (ticks)', sp.slippageTicks], ['Fill on bar close', sp.processOnClose]] as [string, unknown][] : []),
    ...(run.out?.inputs ?? []).map(i => [`Input · ${i.title}`, i.value] as [string, unknown]),
  ];
  const job = p.testerJob(run.id), swap = job && 'kind' in job && job.kind === 'mql' ? swaps()[run.id] ?? {} : null;
  $('#tsProps').innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')
    + (swap ? `<tr><td>Swap long / short (points per lot per day)</td><td><input type="number" step="any" data-sw="swapLong" value="${esc(+(swap.swapLong ?? 0))}" style="width:70px"> / <input type="number" step="any" data-sw="swapShort" value="${esc(+(swap.swapShort ?? 0))}" style="width:70px"></td></tr>
      <tr><td>Triple swap day</td><td><select data-sw="swap3Day">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${(swap.swap3Day ?? 3) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></td></tr>` : '');
  $('#tsProps').onchange = e => {
    const el = e.target as HTMLInputElement, k = el.dataset.sw as keyof Swap | undefined;
    if (!k || !cur) return;
    const all = swaps(), s = all[cur.run.id] ??= {};
    s[k] = +el.value || 0;
    store.set('mqlSwap', all); cur.p.refresh();
  };
}
type Swap = { swapLong?: number; swapShort?: number; swap3Day?: number };
const swaps = () => store.get<Record<string, Swap>>('mqlSwap', {});

// ---------- analysis: monthly returns, return distribution, streaks ----------
/** Green/red background whose strength follows |v| / max. */
const tint = (v: number, max: number) => v ? `background:color-mix(in srgb, var(${v > 0 ? '--up' : '--down'}) ${Math.round(15 + 60 * Math.min(1, Math.abs(v) / (max || 1)))}%, transparent)` : '';
function monthly() {
  const { data, bars } = view(), rows = monthlyReturns(data, bars);
  const max = Math.max(0, ...rows.flatMap(r => r.months.map(c => Math.abs(c?.pct ?? 0))));
  const cell = (c: { pct: number; pl: number } | null, m = max) => c ? `<td style="${tint(c.pct, m)}" title="${money(c.pl)}">${c.pct.toFixed(2)}%<br><small>${money(c.pl)}</small></td>` : '<td></td>';
  const maxY = Math.max(0, ...rows.map(r => Math.abs(r.total.pct)));
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  $('#ts-monthly').innerHTML = rows.length ? `<table class="monthly"><tr><th>Year</th>${names.map(n => `<th>${n}</th>`).join('')}<th>Total</th></tr>${rows.map(r => `<tr><th>${r.year}</th>${r.months.map(c => cell(c)).join('')}${cell(r.total, maxY)}</tr>`).join('')}</table>
    <div class="muted">Equity change per calendar month (UTC), % of the previous month's closing equity; P&L below.</div>` : '<span class="muted">No bars in the selected range.</span>';
}
function dist() {
  const { data } = view(), d = returnDistribution(data.trades), el = $('#ts-dist');
  if (!d.buckets.length) { el.innerHTML = '<span class="muted">No closed trades in the selected range.</span>'; return }
  const W = 600, H = 150, lo = d.buckets[0].from, span = d.buckets.at(-1)!.to - lo, top = Math.max(...d.buckets.map(b => b.count));
  const x = (v: number) => ((v - lo) / span) * W, bw = (d.width / span) * W;
  const line = (v: number, color: string, label: string) => `<line x1="${x(v)}" x2="${x(v)}" y1="0" y2="${H}" stroke="${color}" stroke-dasharray="4 3"><title>${label} ${v.toFixed(2)}%</title></line>`;
  const step = Math.ceil(d.buckets.length / 10);
  el.innerHTML = `<div class="row wrap kpis"><div><span>Trades</span><b>${data.trades.length}</b></div><div><span>Profitable</span><b class="up">${d.wins}</b></div><div><span>Losing</span><b class="dn">${d.losses}</b></div>
      <div><span>Average return</span><b class="${cls(d.mean)}">${d.mean.toFixed(2)}%</b></div><div><span>Median return</span><b class="${cls(d.median)}">${d.median.toFixed(2)}%</b></div><div><span>Bucket width</span><b>${+d.width.toFixed(6)}%</b></div></div>
    <svg class="spark" viewBox="0 0 ${W} ${H + 14}" preserveAspectRatio="none" role="img" aria-label="Distribution of trade returns" style="height:180px">
      ${d.buckets.map(b => `<rect x="${x(b.from) + 1}" width="${Math.max(1, bw - 2)}" y="${H - (b.count / top) * H}" height="${(b.count / top) * H}" fill="var(${b.from >= 0 ? '--up' : '--down'})" fill-opacity=".75"><title>${+b.from.toFixed(6)}% … ${+b.to.toFixed(6)}%: ${b.count} trade(s)</title></rect>`).join('')}
      ${line(d.mean, 'var(--accent)', 'Mean')}${line(d.median, 'var(--warn)', 'Median')}
      ${d.buckets.filter((_, i) => i % step === 0).map(b => `<text x="${x(b.from) + 2}" y="${H + 12}" font-size="10" fill="var(--muted)">${+b.from.toFixed(4)}%</text>`).join('')}
    </svg>
    <div class="muted">Trade % returns in equal buckets (green: profit, red: loss) · <span style="color:var(--accent)">- - mean</span> · <span class="warn">- - median</span></div>`;
}
function streakView() {
  const { data } = view(), s = streaks(data.trades), el = $('#ts-streaks');
  if (!data.trades.length) { el.innerHTML = '<span class="muted">No closed trades in the selected range.</span>'; return }
  const top = Math.max(1, ...s.dist.flatMap(r => [r.wins, r.losses]));
  const bar = (n: number, v: string) => `<span style="display:inline-block;height:9px;width:${(n / top) * 120}px;background:var(${v});margin-right:6px"></span>${n}`;
  el.innerHTML = `<div class="row wrap kpis"><div><span>Longest winning streak</span><b class="up">${s.maxWin}</b></div><div><span>Longest losing streak</span><b class="dn">${s.maxLoss}</b></div>
      <div><span>Current streak</span><b class="${s.current.kind === 'win' ? 'up' : s.current.kind === 'loss' ? 'dn' : ''}">${s.current.kind ? `${s.current.len} ${s.current.kind === 'win' ? 'win' : 'loss'}${s.current.len > 1 ? (s.current.kind === 'win' ? 's' : 'es') : ''}` : '—'}</b></div></div>
    <table style="width:auto"><tr><th>Streak length</th><th>Winning streaks</th><th>Losing streaks</th></tr>${s.dist.map(r => `<tr><td>${r.len}</td><td>${bar(r.wins, '--up')}</td><td>${bar(r.losses, '--down')}</td></tr>`).join('')}</table>
    <div class="muted">Consecutive winning / losing closed trades in exit order; an even trade ends a streak.</div>`;
}

function exportCsv() {
  if (!cur) return toast('No strategy on the chart');
  const q = (v: unknown) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s };
  const [a, l, s] = sides(), t = view().data.trades;
  const lines = [['Metric', 'All', 'Long', 'Short'], ...METRIC_DEFS.map(d => [d.label, a[d.key], l[d.key], s[d.key]]), [],
    ['#', 'Type', 'Entry signal', 'Entry time', 'Entry price', 'Exit signal', 'Exit time', 'Exit price', 'Qty', 'Net P&L', 'P&L %', 'Commission', 'Run-up', 'Drawdown'],
    ...t.map((x, i) => [i + 1, x.dir, x.entryId, date(x.entryTime), x.entryPrice, x.exitId, date(x.exitTime), x.exitPrice, x.qty, x.profit, x.profitPct, x.commission, x.runup, x.drawdown])];
  const a2 = document.createElement('a');
  a2.href = URL.createObjectURL(new Blob([lines.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
  a2.download = `${cur.run.name.replace(/[^\w.-]+/g, '_')}_${cur.p.cfg.symbol.replace(/[^\w.-]+/g, '_')}_${cur.p.cfg.tf}.csv`;
  a2.click();
}

// ---------- worker plumbing ----------
let worker: Worker | null = null;
function jobOf(): Job | null {
  const j = cur && cur.p.testerJob(cur.run.id);
  if (!j || 'msg' in j) { toast(j ? `Script error: ${j.msg}` : 'No strategy on the chart'); return null }
  return j;
}
function startWorker<T>(msg: WorkerMsg, out: HTMLElement, done: (r: T) => void) {
  worker?.terminate();
  const w = (worker = new Worker(new URL('./tester/worker.ts', import.meta.url), { type: 'module' }));
  const t0 = Date.now();
  out.innerHTML = '<span class="muted">Starting…</span>';
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') out.innerHTML = `<span class="muted">${m.done} / ${m.total} · ${((Date.now() - t0) / 1000).toFixed(1)} s</span>`;
    else { w.terminate(); if (worker === w) worker = null; if (m.type === 'error') out.innerHTML = `<span class="dn">${esc(m.msg)}</span>`; else done(m.result as T) }
  };
  w.onerror = e => { out.innerHTML = `<span class="dn">${esc(e.message)}</span>`; w.terminate() };
  w.postMessage(msg);
}
const stop = (out: HTMLElement) => { if (worker) { worker.terminate(); worker = null; out.innerHTML = '<span class="muted">Stopped.</span>' } };
const baseInputs = () => Object.fromEntries((cur!.run.out?.inputs ?? []).map(i => [i.id, i.value]));
const titleOf = (id: string) => cur?.run.out?.inputs.find(i => i.id === id)?.title ?? id;
const applyInputs = (inputs: Record<string, unknown>) => {
  const { p, run } = cur!;
  p.set({ scripts: p.cfg.scripts!.map(x => x.id === run.id ? { ...x, inputs: { ...x.inputs, ...(inputs as Record<string, PineValue>) } } : x) });
  toast('Inputs applied to the chart');
};

// ---------- optimisation ----------
let optSpecs: (ParamSpec & { on: boolean })[] = [];
let optFor = '';
let lastOpt: { results: OptResult[]; params: ParamSpec[]; objective: string } | null = null;
function optForm() {
  const key = `${cur!.run.id}|${cur!.p.cfg.symbol}|${cur!.p.cfg.tf}|${cur!.run.out?.inputs.map(i => i.id).join() ?? ''}`;
  if (key !== optFor) { optFor = key; optSpecs = paramSpecs(cur!.run.out?.inputs ?? []).map((s, i) => ({ ...s, on: i < 2 && s.type !== 'enum' })); lastOpt = null }
  const num = (k: number, f: 'min' | 'max' | 'step', v?: number) => `<input type="number" step="any" data-k="${k}" data-f="${f}" value="${v ?? ''}">`;
  const objectives = METRIC_DEFS.filter(d => d.key !== 'initialCapital').map(d => `<option value="${d.key}" ${d.key === optCfg.objective ? 'selected' : ''}>${esc(d.label)}</option>`).join('');
  $('#tsOptForm').innerHTML = `<table class="params"><tr><th></th><th>Input</th><th>From</th><th>To</th><th>Step</th><th>Values</th></tr>${optSpecs.map((s, k) => `<tr><td><input type="checkbox" data-k="${k}" data-f="on" ${s.on ? 'checked' : ''}></td><td>${esc(titleOf(s.name))}</td>${s.type === 'int' || s.type === 'float' ? `<td>${num(k, 'min', s.min)}</td><td>${num(k, 'max', s.max)}</td><td>${num(k, 'step', s.step)}</td>` : '<td colspan="3" class="muted">all values</td>'}<td>${values(s).length}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">This strategy has no numeric, bool or option inputs to optimise.</td></tr>'}</table>
    <div class="row wrap">
      <label>Method <select id="optMethod">${['grid', 'random', 'genetic'].map(m => `<option ${m === optCfg.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Objective <select id="optObj">${objectives}</select></label>
      <label><input type="checkbox" id="optMax" ${optCfg.maximize ? 'checked' : ''}> maximise</label>
      <label>Max runs <input type="number" id="optRuns" value="${optCfg.maxRuns}" min="1" style="width:70px"></label>
      <label>Min trades <input type="number" id="optMin" value="${optCfg.minTrades}" min="0" style="width:55px"></label>
      <span class="muted" id="optCount"></span><span class="grow"></span>
      <button id="optRun" class="on">Run</button><button id="optStop">Stop</button>
    </div>`;
  const count = () => { const n = optSpecs.filter(s => s.on).reduce((a, s) => a * values(s).length, 1); $('#optCount').textContent = `${n.toLocaleString()} combinations` };
  count();
  $('#tsOptForm').oninput = e => {
    const i = e.target as HTMLInputElement, k = i.dataset.k;
    if (k != null) { const s = optSpecs[+k]; if (i.dataset.f === 'on') s.on = i.checked; else (s as unknown as Record<string, number>)[i.dataset.f!] = +i.value; count() }
    else readOptCfg();
  };
  $<HTMLSelectElement>('#optObj').onchange = () => { $<HTMLInputElement>('#optMax').checked = DEF[$<HTMLSelectElement>('#optObj').value].higherIsBetter; readOptCfg() };
  $('#optRun').onclick = runOpt;
  $('#optStop').onclick = () => stop($('#tsOptOut'));
  if (lastOpt) showOpt(); else if (!worker) $('#tsOptOut').innerHTML = '';
}
const optCfg = store.get('tsOpt', { method: 'grid' as 'grid' | 'random' | 'genetic', objective: 'netProfit', maximize: true, maxRuns: 500, minTrades: 1 });
function readOptCfg() {
  Object.assign(optCfg, { method: $<HTMLSelectElement>('#optMethod').value, objective: $<HTMLSelectElement>('#optObj').value, maximize: $<HTMLInputElement>('#optMax').checked,
    maxRuns: Math.max(1, +$<HTMLInputElement>('#optRuns').value || 1), minTrades: Math.max(0, +$<HTMLInputElement>('#optMin').value || 0) });
  store.set('tsOpt', optCfg);
}
const chosen = (): ParamSpec[] => optSpecs.filter(s => s.on).map(({ on: _, ...s }) => s);
function runOpt() {
  readOptCfg();
  const params = chosen(), job = jobOf();
  if (!job) return;
  if (!params.length) return toast('Tick at least one input to optimise');
  const bars = cur!.p.vb(), objective = optCfg.objective;
  startWorker<OptResult[]>({ type: 'optimize', job, bars, params, base: baseInputs(), opts: { ...optCfg, range: barRange(bars), seed: 1 } }, $('#tsOptOut'), results => {
    lastOpt = { results, params, objective }; showOpt();
  });
}
function showOpt() {
  const { results, params, objective } = lastOpt!, out = $('#tsOptOut');
  if (!results.length) { out.innerHTML = '<span class="muted">No parameter set produced enough trades.</span>'; return }
  const nums = params.filter(p => p.type === 'int' || p.type === 'float');
  let heat = '';
  if (nums.length >= 2) {
    // Heatmap of the best objective value for each (x, y) pair, over every value of the other inputs.
    const [px, py] = nums, xs = values(px), ys = values(py), cell = new Map<string, number>();
    for (const r of results) { const k = `${r.inputs[px.name]}|${r.inputs[py.name]}`, v = r.metrics[objective]; if (!cell.has(k) || (optCfg.maximize ? v > cell.get(k)! : v < cell.get(k)!)) cell.set(k, v) }
    const vs = [...cell.values()].filter(Number.isFinite), lo = Math.min(...vs), hi = Math.max(...vs);
    const color = (v: number) => { let t = hi > lo ? (v - lo) / (hi - lo) : 0.5; if (!optCfg.maximize) t = 1 - t; return `color-mix(in srgb, var(--up) ${Math.round(t * 100)}%, var(--down))` };
    heat = `<div class="heat"><div class="muted">${esc(DEF[objective].label)} · ${esc(titleOf(py.name))} ↓ × ${esc(titleOf(px.name))} →</div><table><tr><th></th>${xs.map(x => `<th>${esc(String(x))}</th>`).join('')}</tr>${[...ys].reverse().map(y => `<tr><th>${esc(String(y))}</th>${xs.map(x => { const v = cell.get(`${esc(String(x))}|${esc(String(y))}`); return v == null ? '<td></td>' : `<td style="background:${color(v)}" title="${esc(titleOf(px.name))} ${esc(String(x))}, ${esc(titleOf(py.name))} ${esc(String(y))}: ${fm(objective, v)}" data-x="${esc(String(x))}" data-y="${esc(String(y))}">${fm(objective, v)}</td>` }).join('')}</tr>`).join('')}</table></div>`;
  }
  const cols = ['netProfit', 'profitFactor', 'maxDrawdownPct', 'winRate', 'totalTrades', 'sharpe'].filter(k => k !== objective);
  out.innerHTML = `${heat}<table class="opt-res"><tr><th>#</th>${params.map(p => `<th>${esc(titleOf(p.name))}</th>`).join('')}<th>${esc(DEF[objective].label)}</th>${cols.map(k => `<th>${esc(DEF[k].label)}</th>`).join('')}<th></th></tr>${results.slice(0, 100).map((r, i) => `<tr><td>${i + 1}</td>${params.map(p => `<td>${esc(String(r.inputs[p.name]))}</td>`).join('')}<td><b>${fm(objective, r.metrics[objective])}</b></td>${cols.map(k => `<td>${fm(k, r.metrics[k])}</td>`).join('')}<td><button data-apply="${i}">Apply</button></td></tr>`).join('')}</table><div class="muted">${results.length} valid runs</div>`;
  out.onclick = e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-apply]');
    if (b) applyInputs(Object.fromEntries(params.map(p => [p.name, results[+b.dataset.apply!].inputs[p.name]])));
    const c = (e.target as HTMLElement).closest<HTMLElement>('td[data-x]');
    if (c && nums.length >= 2) applyInputs({ [nums[0].name]: +c.dataset.x!, [nums[1].name]: +c.dataset.y! });
  };
}

// ---------- walk-forward ----------
const wfaCfg = store.get('tsWfa', { windows: 5, isPct: 70, anchored: false });
let lastWfa: { r: WalkForwardResult; params: ParamSpec[] } | null = null;
function wfaForm() {
  if (!optFor.startsWith(`${cur!.run.id}|${cur!.p.cfg.symbol}|${cur!.p.cfg.tf}|`)) optForm();   // shares the Optimize tab's inputs and settings
  $('#tsWfaForm').innerHTML = `<div class="row wrap">
    <label>Windows <input type="number" id="wfaN" min="1" max="50" value="${wfaCfg.windows}" style="width:55px"></label>
    <label>In-sample % <input type="number" id="wfaIs" min="10" max="95" value="${wfaCfg.isPct}" style="width:55px"></label>
    <label><input type="checkbox" id="wfaAnch" ${wfaCfg.anchored ? 'checked' : ''}> anchored</label>
    <span class="muted">Optimises the ticked inputs on each in-sample window (settings from the Optimize tab), then trades the next out-of-sample window with the winner.</span>
    <span class="grow"></span><button id="wfaRun" class="on">Run</button><button id="wfaStop">Stop</button></div>`;
  $('#wfaRun').onclick = () => {
    Object.assign(wfaCfg, { windows: Math.max(1, +$<HTMLInputElement>('#wfaN').value || 1), isPct: Math.min(95, Math.max(10, +$<HTMLInputElement>('#wfaIs').value || 70)), anchored: $<HTMLInputElement>('#wfaAnch').checked });
    store.set('tsWfa', wfaCfg);
    const params = chosen(), job = jobOf();
    if (!job) return;
    if (!params.length) return toast('Tick inputs to optimise in the Optimize tab');
    const bars = cur!.p.vb();
    startWorker<WalkForwardResult>({ type: 'wfa', job, bars, params, base: baseInputs(), opts: { windows: wfaCfg.windows, isPct: wfaCfg.isPct / 100, anchored: wfaCfg.anchored, range: barRange(bars), optimize: { method: optCfg.method, objective: optCfg.objective, maximize: optCfg.maximize, maxRuns: optCfg.maxRuns, minTrades: optCfg.minTrades, seed: 1 } } },
      $('#tsWfaOut'), r => { lastWfa = { r, params }; showWfa() });
  };
  $('#wfaStop').onclick = () => stop($('#tsWfaOut'));
  if (lastWfa) showWfa(); else if (!worker) $('#tsWfaOut').innerHTML = '';
}
function showWfa() {
  const { r, params } = lastWfa!, b = cur!.p.vb(), m = r.oosMetrics, obj = optCfg.objective;
  const d = (i: number) => b[Math.min(i, b.length - 1)] ? date(b[Math.min(i, b.length - 1)].time).slice(0, 10) : String(i);
  $('#tsWfaOut').innerHTML = `<div class="row wrap kpis">
      <div><span>WF efficiency</span><b class="${r.efficiency >= 0.5 ? 'up' : 'dn'}">${(r.efficiency * 100).toFixed(0)}%</b></div>
      <div><span>OOS net P&L</span><b class="${cls(m.netProfit)}">${money(m.netProfit)}</b></div>
      <div><span>OOS trades</span><b>${m.totalTrades}</b></div><div><span>OOS profit factor</span><b>${fm('profitFactor', m.profitFactor)}</b></div>
      <div><span>OOS max drawdown</span><b class="dn">${m.maxDrawdownPct.toFixed(2)}%</b></div></div>
    ${spark([r.oosEquity.map(e => e.value)], [])}
    <table><tr><th>#</th><th>In-sample</th><th>Out-of-sample</th>${params.map(p => `<th>${esc(titleOf(p.name))}</th>`).join('')}<th>IS ${esc(DEF[obj].label)}</th><th>OOS ${esc(DEF[obj].label)}</th><th>OOS trades</th><th></th></tr>
    ${r.segments.map((s, i) => `<tr><td>${i + 1}</td><td>${d(s.is.from)} → ${d(s.is.to - 1)}</td><td>${d(s.oos.from)} → ${d(s.oos.to - 1)}</td>${params.map(p => `<td>${esc(String(s.best[p.name]))}</td>`).join('')}<td>${fm(obj, s.isMetrics[obj])}</td><td class="${cls(s.oosMetrics.netProfit)}">${fm(obj, s.oosMetrics[obj])}</td><td>${s.oosMetrics.totalTrades}</td><td><button data-wfa="${i}">Apply</button></td></tr>`).join('')}</table>
    <div class="muted">Efficiency = out-of-sample return per bar ÷ in-sample return per bar. Above ~50% suggests the parameters are not just curve-fitted.</div>`;
  $('#tsWfaOut').onclick = e => { const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wfa]'); if (btn) applyInputs(r.segments[+btn.dataset.wfa!].best) };
}

// ---------- Monte Carlo ----------
const mcCfg = store.get('tsMc', { runs: 1000, method: 'shuffle' as 'shuffle' | 'bootstrap', ruinPct: 50, skipPct: 0 });
function mcForm() {
  $('#tsMcForm').innerHTML = `<div class="row wrap">
    <label>Simulations <input type="number" id="mcRuns" min="10" max="20000" value="${mcCfg.runs}" style="width:70px"></label>
    <label>Method <select id="mcMethod"><option value="shuffle" ${mcCfg.method === 'shuffle' ? 'selected' : ''}>shuffle trade order</option><option value="bootstrap" ${mcCfg.method === 'bootstrap' ? 'selected' : ''}>resample trades (bootstrap)</option></select></label>
    <label>Skip trades % <input type="number" id="mcSkip" min="0" max="90" value="${mcCfg.skipPct}" style="width:55px"></label>
    <label>Ruin = loss of % <input type="number" id="mcRuin" min="1" max="100" value="${mcCfg.ruinPct}" style="width:55px"></label>
    <span class="grow"></span><button id="mcRun" class="on">Run</button></div>`;
  $('#mcRun').onclick = () => {
    Object.assign(mcCfg, { runs: Math.min(20000, Math.max(10, +$<HTMLInputElement>('#mcRuns').value || 1000)), method: $<HTMLSelectElement>('#mcMethod').value, skipPct: +$<HTMLInputElement>('#mcSkip').value || 0, ruinPct: +$<HTMLInputElement>('#mcRuin').value || 50 });
    store.set('tsMc', mcCfg);
    showMc();
  };
  showMc();
}
function showMc() {
  const { data } = view(), out = $('#tsMcOut');
  if (data.trades.length < 2) { out.innerHTML = '<span class="muted">Needs at least 2 closed trades.</span>'; return }
  const r = monteCarlo(data.trades, data.initialCapital, { ...mcCfg, seed: 1 }), q = ['p5', 'p25', 'p50', 'p75', 'p95'] as const;
  out.innerHTML = `<div class="row wrap kpis"><div><span>Risk of ruin</span><b class="${r.riskOfRuin > 0.05 ? 'dn' : 'up'}">${(r.riskOfRuin * 100).toFixed(1)}%</b></div>
      <div><span>Median final equity</span><b>${r.finalEquity.p50.toFixed(2)}</b></div><div><span>95th pct. max drawdown</span><b class="dn">${r.maxDrawdownPct.p95.toFixed(2)}%</b></div>
      <div><span>Backtest</span><b>${r.original.finalEquity.toFixed(2)} · DD ${r.original.maxDrawdownPct.toFixed(2)}%</b></div></div>
    ${spark(r.paths, [r.paths.length ? pathOf(data.trades, data.initialCapital) : []])}
    <table><tr><th>Percentile</th>${q.map(k => `<th>${k.slice(1)}%</th>`).join('')}</tr>
      <tr><td>Final equity</td>${q.map(k => `<td>${r.finalEquity[k].toFixed(2)}</td>`).join('')}</tr>
      <tr><td>Max drawdown</td>${q.map(k => `<td>${r.maxDrawdownPct[k].toFixed(2)}%</td>`).join('')}</tr></table>
    <div class="muted">${r.runs} simulations of ${data.trades.length} trades. Shuffling keeps the final result and shows how deep the drawdown could have been in another order; bootstrap also varies the result.</div>`;
}
const pathOf = (t: Trade[], cap: number) => { let v = cap; return [cap, ...t.map(x => (v += x.profit))] };

/** Inline SVG of several equity paths (muted) with highlighted ones on top. */
function spark(paths: number[][], hi: number[][]) {
  const all = [...paths, ...hi].filter(p => p.length > 1);
  if (!all.length) return '';
  const W = 600, H = 140, n = Math.max(...all.map(p => p.length)) - 1, flat = all.flat(), lo = Math.min(...flat), top = Math.max(...flat), span = top - lo || 1;
  const d = (p: number[]) => p.map((v, i) => `${i ? 'L' : 'M'}${((i / n) * W).toFixed(1)},${(H - ((v - lo) / span) * H).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Equity paths">${paths.map(p => `<path d="${d(p)}" stroke="var(--muted)" stroke-opacity=".35"/>`).join('')}${hi.map(p => `<path d="${d(p)}" stroke="var(--accent)" stroke-width="2"/>`).join('')}</svg>`;
}

// ---------- forward test ----------
interface Fwd { scriptId: string; sym: string; tf: string; start: number; qty: number; done: string[]; log: { t: number; side: 'buy' | 'sell'; qty: number }[] }
let fwd = store.get<Fwd | null>('tsFwd', null);
const saveFwd = () => store.set('tsFwd', fwd);
/** Fills of any engine: Pine broker fills, MQL deals, NinjaScript executions. */
function fillsOf(run: ScriptRun): { time: number; side: 'buy' | 'sell'; qty: number }[] {
  const out = run.out as (ScriptRun['out'] & { mqlDeals?: { time: number; type: string; volume: number }[] }) | undefined;
  if (out?.broker) return out.broker.fills.map(f => ({ time: f.time, side: f.side, qty: f.qty }));
  return (out?.mqlDeals ?? []).filter(d => d.type === 'buy' || d.type === 'sell').map(d => ({ time: d.time, side: d.type as 'buy' | 'sell', qty: d.volume }));
}
const fillKey = (f: { time: number; side: string; qty: number }) => `${f.time}|${f.side}|${+f.qty.toFixed(8)}`;
/** Mirror every strategy fill that happens after the forward test started into the paper account (scaled by qty). */
function forward() {
  if (serverMode) return serverForward();
  if (!fwd || !cur || cur.run.id !== fwd.scriptId || cur.p.cfg.symbol !== fwd.sym || cur.p.cfg.tf !== fwd.tf) return;
  // shortcut: fills are keyed by time/side/size; a live-bar fill that a re-run later moves would be mirrored twice.
  const fresh = fillsOf(cur.run).map(f => ({ ...f, key: fillKey(f) })).filter(f => f.time >= fwd!.start && !fwd!.done.includes(f.key));
  for (const f of fresh) {
    const q = +(f.qty * fwd.qty).toFixed(8);
    fwd.done.push(f.key); fwd.log.unshift({ t: f.time, side: f.side, qty: q });
    if (q > 0) host.paper(cur.p, f.side, q);
  }
  if (fresh.length) { fwd.done = fwd.done.slice(-500); fwd.log = fwd.log.slice(0, 200); saveFwd(); toast(`Forward test: ${fresh.length} order(s) sent to the paper account`) }
}
// Server mode: forward tests run on the server (no open tab needed) — list/start/stop them through /api/forward.
interface SrvFwd { id: string; name: string; sym: string; tf: string; qtyMult: number; channels: string[]; start: number | null; status: string; fills: number; lastError: string | null; sig: string; runsIn: 'browser' | 'server' }
interface SrvLog { at: number; t: number; side: 'buy' | 'sell'; qty: number; px: number; error: string | null }
let srvList: SrvFwd[] | null = null, srvLog: { id: string; rows: SrvLog[] } | null = null;
onServer('forward', m => { srvList = m.list as SrvFwd[]; if (tab === 'fwd') forwardView() });
/**
 * Hybrid: while this chart shows the strategy a server forward test runs (same sources, inputs, symbol and interval),
 * run it here — the chart does anyway — and hand the server the fills, so it doesn't run it too. Called after every run.
 */
const sent = new Map<string, { key: string; at: number }>();
let listing = false;
function serverForward() {
  if (!srvList && !listing && gate('forward').on) { listing = true; apiTrade<SrvFwd[]>('/api/forward').then(l => { srvList ??= l }).catch(() => {}).finally(() => { listing = false }) }
  if (!cur || !srvList?.length) return;
  const src = sourceFor(cur.run.id, cur.p.prec), last = cur.p.vb().at(-1);
  if (!src || !last) return;
  const sig = scriptSig(src, baseInputs()), fills = fillsOf(cur.run);
  for (const f of srvList) {
    if (f.sym !== cur.p.cfg.symbol || f.tf !== cur.p.cfg.tf || f.sig !== sig) continue;
    const mine = fills.filter(x => f.start == null || x.time >= f.start).slice(-2000);
    const key = `${mine.length}|${last.time}|${last.close}`, prev = sent.get(f.id);
    if (prev?.key === key && Date.now() - prev.at < 5000) continue;   // nothing new; still renew the server's 15 s lease
    if (wsSend({ op: 'forward.fills', id: f.id, sig, fills: mine, last: { time: last.time, close: last.close } })) sent.set(f.id, { key, at: Date.now() });
  }
}
const CHANNELS = ['push', 'telegram', 'email', 'webhook'];
const fwdOpts = { qty: 1, channels: ['push'] };   // kept across the re-renders live ticks cause
function serverForwardView(el: HTMLElement) {
  if (!gate('forward').on) { el.innerHTML = `<span class="muted">${esc(gate('forward').why)}</span>`; return }
  if (!srvList) { apiTrade<SrvFwd[]>('/api/forward').then(l => { srvList = l; forwardView() }).catch(e => { el.innerHTML = `<span class="dn">${esc((e as Error).message)}</span>` }); el.innerHTML = '<span class="muted">Loading…</span>'; return }
  el.innerHTML = `${cur ? `<div class="row wrap">
      <label>Size multiplier <input type="number" id="fwdQty" value="${esc(fwdOpts.qty)}" min="0" step="any" style="width:70px"></label>
      <span class="muted">Notify:</span> ${CHANNELS.map(c => `<label><input type="checkbox" data-fch="${c}"${fwdOpts.channels.includes(c) ? " checked" : ""}> ${c}</label>`).join(" ")}
      <span class="muted">Runs ${esc(cur.run.name)} on ${esc(cur.p.cfg.symbol)} ${esc(cur.p.cfg.tf)} and sends each new fill as a market order to the paper account, even when this app is closed: while this chart is open the browser runs it, otherwise the server.</span>
      <span class="grow"></span><button id="fwdStart" class="on">Start forward test</button></div>` : '<div class="muted">Add a strategy to the chart to start a forward test.</div>'}
    ${fwd ? `<div class="row"><span class="warn">A browser-only forward test is still running (${esc(fwd.sym)} ${esc(fwd.tf)}).</span><button id="fwdStop">Stop it</button></div>` : ''}
    ${srvList.length ? `<table><tr><th>Name</th><th>Symbol</th><th>Since</th><th>Size ×</th><th>Fills</th><th>Status</th><th></th></tr>${srvList.map(f => `<tr>
      <td>${esc(f.name)}</td><td>${esc(f.sym)} ${esc(f.tf)}</td><td>${f.start ? date(f.start) : '—'}</td><td>${esc(f.qtyMult)}</td><td>${esc(f.fills)}</td>
      <td class="${f.lastError ? 'dn' : 'up'}" title="${esc(f.lastError ?? '')}">${f.lastError ? `Error: ${esc(f.lastError.slice(0, 80))}` : `${esc(f.status)} · ${f.runsIn === 'browser' ? 'in a browser' : 'on the server'}`}</td>
      <td><button data-flog="${esc(f.id)}">Log</button> <button data-fdel="${esc(f.id)}">Stop</button></td></tr>`).join('')}</table>` : '<div class="muted">No forward tests running on the server.</div>'}
    ${srvLog ? `<table><tr><th>Time</th><th>Side</th><th>Qty sent</th><th>Price</th><th></th></tr>${srvLog.rows.map(l => `<tr><td>${date(l.at / 1000)}</td><td class="${l.side === 'buy' ? 'up' : 'dn'}">${esc(l.side)}</td><td>${esc(l.qty)}</td><td>${esc(l.px)}</td><td class="dn">${esc(l.error ?? '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No fills yet.</td></tr>'}</table>` : ''}`;
  el.querySelector<HTMLElement>('#fwdStart')?.addEventListener('click', async () => {
    if (!jobOf() || !cur) return;   // jobOf: same compile check (and error toast) as the optimizer
    // The server compiles sources itself: send the script plus every installed file of its language (#include / other classes).
    const src = sourceFor(cur.run.id, cur.p.prec);
    if (!src) { toast('Save the script first'); return }
    try {
      await apiTrade('/api/forward', { body: { name: cur.run.name, sym: cur.p.cfg.symbol, tf: cur.p.cfg.tf, ...src, inputs: baseInputs(), qtyMult: fwdOpts.qty, channels: fwdOpts.channels } });
      toast('Forward test started on the server (paper account)');
    } catch (e) { toast(`Could not start: ${(e as Error).message}`) }
  });
  el.querySelector('.row')?.addEventListener('change', () => {
    fwdOpts.qty = Math.max(0, +$<HTMLInputElement>('#fwdQty').value || 1);
    fwdOpts.channels = [...el.querySelectorAll<HTMLInputElement>('[data-fch]:checked')].map(c => c.dataset.fch!);
  });
  el.querySelector<HTMLElement>('#fwdStop')?.addEventListener('click', () => { fwd = null; saveFwd(); forwardView() });
  el.querySelectorAll<HTMLElement>('[data-fdel]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Stop this forward test? Its log is deleted; paper fills stay in the account.')) return;
    apiTrade(`/api/forward/${encodeURIComponent(b.dataset.fdel!)}`, { method: 'DELETE' }).then(() => { if (srvLog?.id === b.dataset.fdel) srvLog = null; toast('Forward test stopped') }).catch(e => toast((e as Error).message));
  }));
  el.querySelectorAll<HTMLElement>('[data-flog]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.flog!;
    api<SrvLog[]>(`/api/forward/${encodeURIComponent(id)}/log`).then(rows => { srvLog = { id, rows }; forwardView() }).catch(e => toast((e as Error).message));
  }));
}
function forwardView() {
  const el = $('#ts-fwd');
  if (serverMode) return serverForwardView(el);
  const active = fwd && cur && fwd.scriptId === cur.run.id;
  const live = active ? cur!.data.trades.filter(t => t.entryTime >= fwd!.start) : [];
  const fm2 = live.length ? metrics({ ...cur!.data, trades: live, equity: [], openPL: 0, openCount: 0 }, cur!.p.vb()) : null;
  el.innerHTML = !cur ? '<span class="muted">Add a strategy to the chart first.</span>' : `<div class="row wrap">
      ${active ? `<b class="up">● Forward testing since ${date(fwd!.start)}</b> <span class="muted">${esc(fwd!.sym)} ${esc(fwd!.tf)} · size × ${fwd!.qty}</span><span class="grow"></span><button id="fwdStop">Stop</button>`
      : `${fwd ? `<span class="warn">A forward test is running on another strategy/chart (${esc(fwd.sym)} ${esc(fwd.tf)}).</span>` : ''}<label>Size multiplier <input type="number" id="fwdQty" value="1" min="0" step="any" style="width:70px"></label>
         <span class="muted">Runs this strategy on live candles and sends each new fill as a market order to the paper account. The chart and this tab must stay open.</span><span class="grow"></span><button id="fwdStart" class="on">Start forward test</button>`}
    </div>
    ${fm2 ? `<div class="row wrap kpis"><div><span>Forward trades</span><b>${fm2.totalTrades}</b></div><div><span>Net P&L</span><b class="${cls(fm2.netProfit)}">${money(fm2.netProfit)}</b></div><div><span>Percent profitable</span><b>${fm2.winRate.toFixed(1)}%</b></div><div><span>Profit factor</span><b>${fm('profitFactor', fm2.profitFactor)}</b></div></div>` : ''}
    ${active && fwd!.log.length ? `<table><tr><th>Time</th><th>Side</th><th>Qty sent</th></tr>${fwd!.log.map(l => `<tr><td>${date(l.t)}</td><td class="${l.side === 'buy' ? 'up' : 'dn'}">${l.side}</td><td>${l.qty}</td></tr>`).join('')}</table>` : active ? '<div class="muted">Waiting for the strategy to trade on a new candle…</div>' : ''}`;
  el.querySelector<HTMLElement>('#fwdStart')?.addEventListener('click', () => {
    if (fwd && !confirm('Stop the other forward test and start this one?')) return;
    const p = cur!.p, last = p.vb().at(-1);
    // Start at the current (forming) bar: everything the backtest filled before it is history, not mirrored.
    fwd = { scriptId: cur!.run.id, sym: p.cfg.symbol, tf: p.cfg.tf, start: last?.time ?? Math.floor(Date.now() / 1000), qty: Math.max(0, +$<HTMLInputElement>('#fwdQty').value || 1), done: fillsOf(cur!.run).map(fillKey), log: [] };
    saveFwd(); forwardView(); toast('Forward test started (paper account)');
  });
  el.querySelector<HTMLElement>('#fwdStop')?.addEventListener('click', () => { fwd = null; saveFwd(); forwardView(); toast('Forward test stopped') });
}

// ---------- portfolio ----------
const portCfg = store.get('tsPort', { symbols: '', capital: 10000 });
let lastPort: { r: Portfolio; errors: string[] } | null = null;
function portForm() {
  const syms = portCfg.symbols || [cur!.p.cfg.symbol, ...host.watchlist()].filter((x, i, a) => a.indexOf(x) === i).slice(0, 6).join(', ');
  $('#tsPortForm').innerHTML = `<div class="row wrap">
    <label class="grow">Symbols <input id="portSyms" value="${esc(syms)}" style="flex:1;min-width:240px"></label>
    <label>Capital <input type="number" id="portCap" min="1" value="${portCfg.capital}" style="width:90px"></label>
    <span class="muted">Same strategy, inputs and timeframe (${esc(cur!.p.cfg.tf)}) on every symbol; capital split equally.</span>
    <button id="portRun" class="on">Run</button></div>`;
  $('#portRun').onclick = runPortfolio;
  if (lastPort) showPort(); else $('#tsPortOut').innerHTML = '';
}
async function runPortfolio() {
  const job = jobOf(); if (!job) return;
  const symbols = [...new Set($<HTMLInputElement>('#portSyms').value.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean))];
  Object.assign(portCfg, { symbols: symbols.join(', '), capital: Math.max(1, +$<HTMLInputElement>('#portCap').value || 10000) });
  store.set('tsPort', portCfg);
  if (symbols.length < 2) return toast('Enter at least two symbols');
  const out = $('#tsPortOut'), tf = cur!.p.cfg.tf, inputs = Object.fromEntries((cur!.run.out?.inputs ?? []).map(i => [i.id, i.value]));
  out.innerHTML = `<span class="muted">Loading ${symbols.length} symbols…</span>`;
  const legs: Leg[] = [], errors: string[] = [];
  await Promise.all(symbols.map(async sym => {
    try {
      const bars = await fetchBars(sym, tf);
      if (bars.length < 2) throw new Error('no data');
      await new Promise(r => setTimeout(r));   // let the page breathe between runs
      const data = makeEvaluate(forSymbol(job, sym, calcPrec(bars.at(-1)!.close)), bars)(inputs, barRange(bars));
      legs.push({ symbol: sym, bars, data });
    } catch (e) { errors.push(`${sym}: ${(e as Error).message}`) }
  }));
  legs.sort((a, b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));
  if (!legs.length) { out.innerHTML = `<span class="dn">${esc(errors.join(' · '))}</span>`; return }
  lastPort = { r: combine(legs, portCfg.capital), errors };
  showPort();
}
function showPort() {
  const { r, errors } = lastPort!, m = r.metrics;
  const norm = (eq: (number | undefined)[], cap: number) => { let v = cap; return eq.map(x => (v = x ?? v) / cap * 100) };
  $('#tsPortOut').innerHTML = `${errors.length ? `<div class="warn">Skipped: ${esc(errors.join(' · '))}</div>` : ''}
    <div class="row wrap kpis"><div><span>Portfolio net P&L</span><b class="${cls(m.netProfit)}">${money(m.netProfit)} (${m.netProfitPct.toFixed(2)}%)</b></div>
      <div><span>Equal-weight buy & hold</span><b class="${cls(m.buyHoldPct)}">${m.buyHoldPct.toFixed(2)}%</b></div><div><span>Max drawdown</span><b class="dn">${m.maxDrawdownPct.toFixed(2)}%</b></div>
      <div><span>Trades</span><b>${m.totalTrades}</b></div><div><span>Profit factor</span><b>${fm('profitFactor', m.profitFactor)}</b></div><div><span>Sharpe</span><b>${m.sharpe.toFixed(3)}</b></div></div>
    ${spark([r.bars.map(b => b.close)], [norm(r.data.equity, r.data.initialCapital)])}
    <div class="muted">Blue: portfolio equity · grey: equal-weight buy & hold (both rebased to 100).</div>
    <table><tr><th>Symbol</th><th>Net P&L %</th><th>Share of profit</th><th>Profit factor</th><th>Max DD %</th><th>Trades</th><th>Win %</th><th>Sharpe</th><th>Buy & hold %</th></tr>
    ${r.legs.map(l => `<tr><td>${esc(l.symbol)}</td><td class="${cls(l.metrics.netProfit)}">${l.metrics.netProfitPct.toFixed(2)}%</td><td>${l.share.toFixed(1)}%</td><td>${fm('profitFactor', l.metrics.profitFactor)}</td><td>${l.metrics.maxDrawdownPct.toFixed(2)}%</td><td>${l.metrics.totalTrades}</td><td>${l.metrics.winRate.toFixed(1)}%</td><td>${l.metrics.sharpe.toFixed(3)}</td><td>${l.metrics.buyHoldPct.toFixed(2)}%</td></tr>`).join('')}</table>`;
}
