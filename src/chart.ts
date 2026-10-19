import {
  createChart, createSeriesMarkers, createTextWatermark, LineSeries, HistogramSeries, ColorType,
  CrosshairMode, PriceScaleMode, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesType, type IPriceLine, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp, type SeriesMarker, type MouseEventParams,
} from 'lightweight-charts';
import { fetchBars, streamBars, tfSeconds, type Bar } from './data.ts';
import { INDICATORS, type Series } from './indicators.ts';
import { DrawingLayer, type Drawing } from './drawings.ts';
import { createMainSeries, toSeriesData, transformBars, isPriceBased, typeDefaults, CHART_TYPES, type ChartType, type TypeOpts } from './charttypes.ts';
import { isExpr, parse, symbols, combine } from './symmath.ts';
import type { Settings } from './settings.ts';
import type { Account, Side } from './trading.ts';
import { $, esc, calcPrec, fmtVol, toast } from './store.ts';
import { runScript, type ScriptError } from './pine/engine.ts';
import { runMql } from './mql/engine.ts';
import { mqlTester, type Job } from './tester/runner.ts';
import { OrderFlow, defaultOF, ofActive, type OFCfg } from './orderflow/layer.ts';
import { runNinjaScript } from './ninja/engine.ts';
import type { NtCompileResult } from './ninja/contract.ts';
import type { CompileResult } from './mql/contract.ts';
import type { TesterData } from './pine/report.ts';
import { renderScript, type ScriptView } from './pine/render.ts';
import type { Outputs } from './pine/interp.ts';
import type { PineValue } from './pine/types.ts';

export type { ChartType } from './charttypes.ts';
export interface ScriptRef { id: string; inputs: Record<string, PineValue>; hidden?: boolean }
export interface PaneCfg { symbol: string; tf: string; type: ChartType; ind: string[]; compare?: string[]; scripts?: ScriptRef[]; of?: OFCfg }
export interface ScriptRun { id: string; name: string; out?: Outputs; error?: ScriptError; ms: number; view?: ScriptView; tester?: TesterData }
export interface Alert { id: number; sym: string; price: number; dir: 'up' | 'down'; on: boolean; drawingId?: number; note?: string }
export interface Hooks {
  settings: () => Settings;
  drawings: (sym: string) => Drawing[];
  alerts: () => Alert[];
  account: () => Account;
  hidden: () => { indicators: boolean; positions: boolean };
  onPrice: (sym: string, px: number, ts: number) => void;
  onCrosshair: (pane: ChartPane, time: number | null, p: MouseEventParams) => void;
  onRange: (pane: ChartPane) => void;
  onActivate: (pane: ChartPane) => void;
  onCfgChange: () => void;
  setupLayer: (pane: ChartPane) => void;
  quickOrder: (pane: ChartPane, side: Side) => void;
  chartMenu: (pane: ChartPane, e: MouseEvent, price: number | null) => void;
  script: (id: string) => { name: string; src: string; lang?: string } | undefined;
  compileMql: (id: string) => CompileResult;
  compileNinja: () => NtCompileResult;
  onScripts: (pane: ChartPane) => void;
  scriptSettings: (pane: ChartPane, id: string) => void;
}
const PAL = ['#2962ff', '#ff9800', '#e91e63', '#00bcd4', '#9c27b0', '#4caf50', '#795548', '#607d8b'];
const SCALE = { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage, indexed: PriceScaleMode.IndexedTo100 };
const DASH = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CANDLE_LIKE: ChartType[] = ['candles', 'hollow', 'ha', 'renko', 'linebreak', 'range'];

/** Date/time formatting in the chosen timezone and format, for axis ticks and the crosshair label. */
function timeFormatters(s: Settings) {
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' };
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat('en-GB', { timeZone: s.tz, ...opts }) } catch { f = new Intl.DateTimeFormat('en-GB', opts) }
  const parts = (t: number) => Object.fromEntries(f.formatToParts(t * 1000).map(p => [p.type, p.value])) as Record<string, string>;
  const time = (p: Record<string, string>, sec = false) => {
    let h = +p.hour; const ap = s.hour12 ? (h >= 12 ? ' PM' : ' AM') : '';
    if (s.hour12) h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${p.minute}${sec ? ':' + p.second : ''}${ap}`;
  };
  const date = (p: Record<string, string>) => {
    const mon = MONTHS[+p.month - 1], yy = p.year.slice(2);
    return s.dateFormat === 'yyyy-MM-dd' ? `${p.year}-${p.month}-${p.day}` : s.dateFormat === 'MM/dd/yy' ? `${p.month}/${p.day}/${yy}` : s.dateFormat === 'dd.MM.yyyy' ? `${p.day}.${p.month}.${p.year}` : `${p.day} ${mon} ${yy}`;
  };
  return {
    full: (t: number, tf: string) => { const p = parts(t), sec = tfSeconds(tf); return `${s.dayOfWeek ? p.weekday + ' ' : ''}${date(p)}${sec < 86400 ? '  ' + time(p, sec < 60) : ''}` },
    tick: (t: number, type: number) => { const p = parts(t); return [p.year, MONTHS[+p.month - 1], String(+p.day), time(p), time(p, true)][type] },
  };
}

export class ChartPane {
  cfg: PaneCfg;
  bars: Bar[] = [];            // raw bars from the feed
  disp: Bar[] = [];            // displayed bars (transformed for Heikin Ashi / price-based types)
  chart!: IChartApi;
  main!: ISeriesApi<SeriesType>;
  layer!: DrawingLayer;
  replay: { idx: number; picking?: boolean; timer?: number } | null = null;
  prec = 2;
  crosshairTime: number | null = null;
  private builtType: ChartType | null = null;
  scriptRuns: ScriptRun[] = [];
  private scriptMarkers: SeriesMarker<Time>[] = [];
  private scriptPaneBase = 0;
  private lastScriptRun = 0;
  private scriptTimer = 0;
  ind: { key: string; name: string; calc: (b: Bar[]) => Record<string, Series>; plots: Record<string, ISeriesApi<SeriesType>>; hidden?: boolean }[] = [];
  private vol: ISeriesApi<'Histogram'> | null = null;
  private cmp: { sym: string; unsub: () => void }[] = [];
  private markers!: ISeriesMarkersPluginApi<Time>;
  private lines: IPriceLine[] = [];
  private scaleLines: IPriceLine[] = [];
  private unsub = () => {};
  private loadTok = 0;
  private loadingMore = false;
  private noMore = false;
  private countdownTimer = 0;
  private exprData: Record<string, Bar[]> = {};
  private chartEl: HTMLElement;
  private legendEl: HTMLElement;
  private quickEl: HTMLElement;
  private rtBtn: HTMLElement;
  private ofEl: HTMLElement;
  of: OrderFlow | null = null;
  readonly cell: HTMLElement;
  private hooks: Hooks;

  constructor(cell: HTMLElement, cfg: PaneCfg, hooks: Hooks) {
    this.cell = cell; this.hooks = hooks;
    this.cfg = { compare: [], scripts: [], ...cfg, ind: [...cfg.ind] };
    cell.innerHTML = '<div class="chart"></div><div class="legend"></div><div class="quick"></div><button class="rt" title="Scroll to the most recent bar">»</button><div class="ofstatus"></div>';
    this.chartEl = $('.chart', cell); this.legendEl = $('.legend', cell); this.quickEl = $('.quick', cell); this.rtBtn = $('.rt', cell); this.ofEl = $('.ofstatus', cell);
    cell.addEventListener('mousedown', () => hooks.onActivate(this), true);
    this.rtBtn.onclick = () => this.chart.timeScale().scrollToRealTime();
    this.quickEl.onclick = e => { const s = (e.target as HTMLElement).closest<HTMLElement>('[data-side]')?.dataset.side; if (s) hooks.quickOrder(this, s as Side) };
    this.legendEl.onclick = e => {
      const el = e.target as HTMLElement, k = el.closest<HTMLElement>('[data-ind]')?.dataset.ind; if (!k) return;
      if (el.dataset.act === 'hide') { const x = this.ind.find(i => i.key === k); if (x) { x.hidden = !x.hidden; Object.values(x.plots).forEach(s => s.applyOptions({ visible: !x.hidden })) } this.legend(this.disp.at(-1)) }
      if (el.dataset.act === 'remove') this.set({ ind: this.cfg.ind.filter(x => x !== k) });
    };
    this.legendEl.addEventListener('click', e => {
      const el = e.target as HTMLElement, sid = el.closest<HTMLElement>('[data-script]')?.dataset.script; if (!sid) return;
      e.stopPropagation();
      const ref = this.cfg.scripts?.find(x => x.id === sid); if (!ref) return;
      if (el.dataset.act === 'settings') hooks.scriptSettings(this, sid);
      if (el.dataset.act === 'hide') this.set({ scripts: this.cfg.scripts!.map(x => x.id === sid ? { ...x, hidden: !x.hidden } : x) });
      if (el.dataset.act === 'remove') this.set({ scripts: this.cfg.scripts!.filter(x => x.id !== sid) });
    });
    this.chartEl.addEventListener('contextmenu', e => {
      if (e.defaultPrevented) return; // a drawing's own menu handled it
      e.preventDefault();
      const r = this.chartEl.getBoundingClientRect();
      hooks.chartMenu(this, e, this.main?.coordinateToPrice(e.clientY - r.top) ?? null);
    });
  }

  vb() { return this.replay && !this.replay.picking ? this.bars.slice(0, this.replay.idx) : this.bars }
  lastPrice() { return this.vb().at(-1)?.close }
  fmt = (p: number) => p.toFixed(this.prec);
  typeOpts(): TypeOpts {
    const s = this.hooks.settings();
    return typeDefaults({
      boxSize: s.renkoBox === 'atr' ? 'atr' : +s.renkoBox, atrLength: s.atrLength, reversal: s.reversal, lineBreak: s.lineBreak,
      range: s.rangeSize || undefined, upColor: s.upColor, downColor: s.downColor,
      lineColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2962ff',
      colorByPrevClose: s.colorByPrevClose, baseValue: this.vb()[0]?.close,
    });
  }

  // ---------- data ----------
  async load() {
    const tok = ++this.loadTok;
    this.unsub(); this.exitReplay(false); this.of?.reset();
    this.bars = []; this.noMore = false;
    try {
      const b = await this.fetch();
      if (tok !== this.loadTok) return;
      this.bars = b;
    } catch (e) { if (tok === this.loadTok) toast(`${this.cfg.symbol}: ${(e as Error).message}`, 6000) }
    if (tok !== this.loadTok) return;
    this.build();
    if (this.bars.length) this.subscribe();
  }
  private async fetch(endTime?: number): Promise<Bar[]> {
    if (!isExpr(this.cfg.symbol)) return fetchBars(this.cfg.symbol, this.cfg.tf, endTime);
    const n = parse(this.cfg.symbol), syms = symbols(n);
    const all = await Promise.all(syms.map(s => fetchBars(s, this.cfg.tf, endTime)));
    syms.forEach((s, i) => (this.exprData[s] = endTime ? [...all[i], ...(this.exprData[s] ?? [])] : all[i]));
    return combine(n, Object.fromEntries(syms.map((s, i) => [s, all[i]])));
  }
  private subscribe() {
    const onBar = (b: Bar) => {
      const last = this.bars.at(-1);
      if (!last || b.time < last.time) return;
      if (b.time === last.time) this.bars[this.bars.length - 1] = b; else this.bars.push(b);
      if (!this.replay) this.refresh();
    };
    if (!isExpr(this.cfg.symbol)) {
      this.unsub = streamBars(this.cfg.symbol, this.cfg.tf, b => { this.hooks.onPrice(this.cfg.symbol, b.close, b.time); onBar(b) });
      return;
    }
    const n = parse(this.cfg.symbol), syms = symbols(n);
    const subs = syms.map(s => streamBars(s, this.cfg.tf, b => {
      const arr = this.exprData[s]; if (!arr?.length) return;
      if (arr.at(-1)!.time === b.time) arr[arr.length - 1] = b; else if (b.time > arr.at(-1)!.time) arr.push(b);
      this.hooks.onPrice(s, b.close, b.time);
      const last = combine(n, Object.fromEntries(syms.map(x => [x, this.exprData[x].slice(-2)]))).at(-1);
      if (last) onBar(last);
    }));
    this.unsub = () => subs.forEach(u => u());
  }
  set(cfg: Partial<PaneCfg>) {
    const reload = (cfg.symbol && cfg.symbol !== this.cfg.symbol) || (cfg.tf && cfg.tf !== this.cfg.tf);
    Object.assign(this.cfg, cfg);
    this.hooks.onCfgChange();
    if (reload) this.load(); else this.build();
  }
  destroy() { clearTimeout(this.scriptTimer); this.unsub(); this.of?.reset(); this.cmp.forEach(c => c.unsub()); this.loadTok++; this.exitReplay(false); clearInterval(this.countdownTimer); this.chart?.remove() }

  // ---------- build ----------
  build() {
    // Bar indices only mean the same thing if the bar series is the same kind.
    const keepRange = this.builtType === this.cfg.type ? this.chart?.timeScale().getVisibleLogicalRange() : null;
    this.builtType = this.cfg.type;
    const prevLayer = this.layer;
    this.cmp.forEach(c => c.unsub()); this.cmp = [];
    clearInterval(this.countdownTimer);
    this.chart?.remove();
    const s = this.hooks.settings(), css = getComputedStyle(document.documentElement), c = (n: string) => css.getPropertyValue(n).trim();
    const tf = timeFormatters(s), bg = s.bgColor || c('--bg');
    const scaleMode = this.cfg.compare?.length ? PriceScaleMode.Percentage : SCALE[s.scaleMode];
    const scale = (visible: boolean) => ({ visible, borderColor: c('--line'), mode: scaleMode, invertScale: s.invert, scaleMargins: { top: s.marginTop / 100, bottom: s.marginBottom / 100 } });
    this.chart = createChart(this.chartEl, {
      autoSize: true,
      layout: {
        background: s.bgType === 'gradient' ? { type: ColorType.VerticalGradient, topColor: bg, bottomColor: s.bgColor2 || c('--panel') } : { type: ColorType.Solid, color: bg },
        textColor: s.scaleTextColor || c('--muted'), fontSize: s.scaleFontSize, panes: { separatorColor: s.separatorColor || c('--line') }, attributionLogo: false,
      },
      grid: { vertLines: { visible: s.vertGrid, color: s.gridColor || c('--grid') }, horzLines: { visible: s.horzGrid, color: s.gridColor || c('--grid') } },
      crosshair: {
        mode: s.crosshair === 'magnet' ? CrosshairMode.Magnet : s.crosshair === 'hidden' ? CrosshairMode.Hidden : CrosshairMode.Normal,
        vertLine: { color: s.crosshairColor, width: s.crosshairWidth as 1, style: DASH[s.crosshairStyle] },
        horzLine: { color: s.crosshairColor, width: s.crosshairWidth as 1, style: DASH[s.crosshairStyle] },
      },
      rightPriceScale: scale(s.scaleSide === 'right'),
      leftPriceScale: scale(s.scaleSide === 'left'),
      timeScale: { borderColor: c('--line'), timeVisible: true, secondsVisible: tfSeconds(this.cfg.tf) < 60, rightOffset: s.rightOffset, tickMarkFormatter: (t: Time, type: number) => tf.tick(t as number, type) },
      localization: { timeFormatter: (t: Time) => tf.full(t as number, this.cfg.tf) },
    });
    this.prec = s.precision === 'default' ? calcPrec(this.bars.at(-1)?.close || 1) : +s.precision;
    const pf = { type: 'price' as const, precision: this.prec, minMove: 10 ** -this.prec };
    const scaleId = s.scaleSide;
    this.main = createMainSeries(this.chart, this.cfg.type, this.typeOpts(), pf, 0);
    this.main.applyOptions({ priceScaleId: scaleId, lastValueVisible: s.lastPriceLabel, priceLineVisible: s.lastPriceLine });
    if (CANDLE_LIKE.includes(this.cfg.type))
      this.main.applyOptions({ borderVisible: s.borderVisible, wickVisible: s.wickVisible, ...(s.bodyVisible ? {} : { upColor: 'transparent', downColor: 'transparent' }) } as never);
    this.markers = createSeriesMarkers(this.main, []);
    if (s.watermark) createTextWatermark(this.chart.panes()[0], { horzAlign: 'center', vertAlign: 'center', lines: [{ text: `${this.cfg.symbol}, ${this.cfg.tf}`, color: c('--muted') + '30', fontSize: 40 }] });

    const priceBased = isPriceBased(this.cfg.type);
    this.vol = null;
    if (s.volume && !priceBased) {
      this.vol = this.chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
      this.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    this.ind = []; let pane = 0, color = 0;
    if (!priceBased) for (const k of this.cfg.ind) {
      const d = INDICATORS[k]; if (!d) continue;
      const idx = d.pane ? ++pane : 0, plots: Record<string, ISeriesApi<SeriesType>> = {};
      for (const key of Object.keys(d.calc(this.vb().slice(-5)))) {
        const hist = key === 'Hist';
        plots[key] = this.chart.addSeries(hist ? HistogramSeries : LineSeries, hist
          ? { priceLineVisible: false, lastValueVisible: false }
          : { color: PAL[color++ % PAL.length], lineWidth: idx ? 1 : 2, priceLineVisible: false, lastValueVisible: s.indLabels, crosshairMarkerVisible: false, ...(idx ? {} : { priceFormat: pf, priceScaleId: scaleId }) }, idx);
        if (this.hooks.hidden().indicators) plots[key].applyOptions({ visible: false });
      }
      d.levels?.forEach(l => Object.values(plots)[0]?.createPriceLine({ price: l, color: c('--muted'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
      this.ind.push({ key: k, name: d.name, calc: d.calc, plots });
    }
    this.scriptPaneBase = pane;
    this.renderScripts();
    this.chart.panes().forEach((p, i) => p.setStretchFactor(i ? 1 : 3.5));
    (this.cfg.compare ?? []).forEach((sym, i) => this.addCompare(sym, PAL[(i + 3) % PAL.length], scaleId));

    this.layer = new DrawingLayer({ chart: this.chart, series: this.main, bars: () => this.disp, tfSec: () => tfSeconds(this.cfg.tf), fmt: this.fmt }, this.chartEl);
    this.layer.drawings = this.hooks.drawings(this.cfg.symbol);
    if (prevLayer) Object.assign(this.layer, { cursor: prevLayer.cursor, color: prevLayer.color, hideAll: prevLayer.hideAll });
    this.main.attachPrimitive(this.layer);
    this.hooks.setupLayer(this);
    if (ofActive(this.cfg.of) && !isPriceBased(this.cfg.type) && !isExpr(this.cfg.symbol)) {
      this.of ??= new OrderFlow({
        symbol: () => this.cfg.symbol, tfSec: () => tfSeconds(this.cfg.tf), bars: () => this.vb(), prec: () => this.prec, cfg: () => this.cfg.of ?? defaultOF(),
        colors: () => { const st = this.hooks.settings(); return { up: st.upColor, down: st.downColor, text: c('--text'), bg } },
        status: msg => { this.ofEl.textContent = msg; this.ofEl.hidden = !msg },
      });
      this.of.attach(this.chart, this.main);
    } else { this.of?.reset(); this.ofEl.hidden = true }

    this.chart.subscribeClick(p => { if (this.replay?.picking && p.time != null) this.startReplayAt(p.time as number) });
    this.chart.subscribeCrosshairMove(p => {
      this.crosshairTime = (p.time as number) ?? null;
      this.legend(p.time != null ? this.disp.find(x => x.time === p.time) : this.disp.at(-1));
      if (p.sourceEvent) this.hooks.onCrosshair(this, this.crosshairTime, p);
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (r && r.from < 20) this.loadMore();
      this.rtBtn.style.display = r && r.to < this.disp.length - 2 ? 'block' : 'none';
      this.scaleOverlay();
      this.hooks.onRange(this);
    });
    this.legendEl.style.display = s.legend ? '' : 'none';
    this.legendEl.classList.toggle('bg', s.legendBg);
    this.setData();
    if (keepRange) this.chart.timeScale().setVisibleLogicalRange(keepRange);
    else if (isPriceBased(this.cfg.type)) this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, this.disp.length - 80), to: this.disp.length + 5 });
    if (s.countdown) this.countdownTimer = window.setInterval(() => this.countdown(), 1000);
  }

  private addCompare(sym: string, color: string, scaleId: string) {
    const series = this.chart.addSeries(LineSeries, { color, lineWidth: 2, priceScaleId: scaleId, title: sym, priceLineVisible: false });
    const entry = { sym, unsub: () => {} };
    this.cmp.push(entry);
    fetchBars(sym, this.cfg.tf).then(b => {
      if (!this.cmp.includes(entry)) return;
      series.setData(b.map(x => ({ time: x.time as UTCTimestamp, value: x.close })));
      entry.unsub = streamBars(sym, this.cfg.tf, x => series.update({ time: x.time as UTCTimestamp, value: x.close }));
    }).catch(e => toast(`${sym}: ${(e as Error).message}`));
  }

  // ---------- data → series ----------
  private volBar = (b: Bar) => { const s = this.hooks.settings(); return { time: b.time as UTCTimestamp, value: b.volume, color: (b.close >= b.open ? s.upColor : s.downColor) + '55' } };
  private toSeries(arr: Series | undefined, hist: boolean) {
    const b = this.vb(), s = this.hooks.settings();
    return (arr ?? []).flatMap((v, i) => (v == null || !isFinite(v) || !b[i] ? [] :
      [hist ? { time: b[i].time as UTCTimestamp, value: v, color: (v >= 0 ? s.upColor : s.downColor) + 'aa' } : { time: b[i].time as UTCTimestamp, value: v }]));
  }
  setData() {
    const to = this.typeOpts();
    this.disp = transformBars(this.cfg.type, this.vb(), to);
    this.main.setData(this.withBarColors(toSeriesData(this.cfg.type, this.vb(), to)) as never);
    this.vol?.setData(this.vb().map(this.volBar));
    this.setInd(); this.tradeOverlay(); this.scaleOverlay(); this.legend(this.disp.at(-1)); this.quick();
  }
  /** Pine barcolor(): recolor candles/bars where a script set a color. */
  private withBarColors(data: unknown[]) {
    const cols = this.scriptRuns.flatMap(r => r.view?.barColors ?? []).length ? this.scriptRuns.map(r => r.view?.barColors ?? []) : null;
    if (!cols || isPriceBased(this.cfg.type)) return data;
    return data.map((d, i) => { const c = cols.map(x => x[i]).findLast(Boolean); return c ? { ...(d as object), color: c, borderColor: c, wickColor: c } : d });
  }
  /** Run every script on the chart and draw its outputs. Panes for non-overlay scripts follow indicator panes. */
  private renderScripts() {
    this.scriptRuns.forEach(r => r.view?.dispose());
    this.scriptRuns = []; this.scriptMarkers = [];
    if (isPriceBased(this.cfg.type)) return;
    let pane = this.scriptPaneBase, color = 3;
    for (const ref of this.cfg.scripts ?? []) {
      const sc = this.hooks.script(ref.id), job = this.testerJob(ref.id);
      if (!sc || !job) continue;
      const run: ScriptRun = 'msg' in job ? { id: ref.id, name: sc.name, ms: 0, error: job }
        : job.kind === 'mql' ? this.runMqlJob(ref.id, sc.name, job, ref.inputs)
        : job.kind === 'ninja' ? this.runNinjaJob(ref.id, job, ref.inputs)
        : (() => { const res = runScript(job.src, this.vb(), { ...job.opts, inputs: ref.inputs }); return { id: ref.id, name: res.out?.meta.shorttitle || res.out?.meta.title || sc.name, ...res } })();
      const res = run;
      if (res.out && !ref.hidden) {
        run.view = renderScript(this.chart, this.main, res.out, this.vb(), res.out.meta.overlay ? 0 : pane + 1, color);
        pane += run.view.panesUsed; color += res.out.plots.length;
        this.scriptMarkers.push(...run.view.markers);
      }
      this.scriptRuns.push(run);
    }
    this.lastScriptRun = Date.now();
    this.hooks.onScripts(this);
  }
  /** Plain-data description of how a script runs on this chart; the Strategy Tester worker re-runs it with other inputs. */
  testerJob(id: string): Job | ScriptError | null {
    const sc = this.hooks.script(id);
    if (!sc) return null;
    const symbol = this.cfg.symbol, tfSec = tfSeconds(this.cfg.tf);
    const fail = (e?: { file: string; line: number; col: number; msg: string }): ScriptError => ({ line: e?.line ?? 1, col: e?.col ?? 1, msg: e ? `${e.file}: ${e.msg}` : 'Compilation failed', kind: 'syntax' });
    if (sc.lang === 'mql4' || sc.lang === 'mql5') {
      const cr = this.hooks.compileMql(id);
      return cr.ok && cr.js ? { kind: 'mql', js: cr.js, opts: { dialect: cr.dialect, symbol: symbol.replace(/^[A-Z0-9]+:/, ''), tfSec, digits: this.prec, spreadPoints: 0 } } : fail(cr.errors[0]);
    }
    if (sc.lang === 'ninja') {
      const cr = this.hooks.compileNinja();
      if (!cr.ok || !cr.js) return fail(cr.errors[0]);
      const cls = sc.src.match(/class\s+(\w+)\s*:\s*(?:[\w.]*\.)?(Indicator|Strategy)\b/)?.[1];
      if (!cls) return { line: 1, col: 1, msg: 'No Indicator or Strategy class in this file', kind: 'syntax' };
      return { kind: 'ninja', cr, cls, opts: { symbol, tfSec, tickSize: 10 ** -this.prec, pointValue: 1, initialCapital: 10000, commissionPerContract: 0 } };
    }
    return { kind: 'pine', src: sc.src, opts: { symbol, tf: this.cfg.tf, tfSec, mintick: 10 ** -this.prec } };
  }
  /** Run a compiled MQL program on this chart's bars. Experts are backtested over the loaded history. */
  private runMqlJob(id: string, name: string, job: Extract<Job, { kind: 'mql' }>, inputs: Record<string, unknown>): ScriptRun {
    const r = runMql(job.js, this.vb(), { ...job.opts, inputs });
    r.out.logs = r.logs.map(l => ({ bar: l.bar, level: l.level === 'error' ? 'error' : l.level === 'alert' ? 'warning' : 'info', msg: l.msg }));
    return { id, name: r.out.meta.shorttitle || name, out: r.out, ms: r.ms, tester: mqlTester(r, this.vb()), error: r.error ? { line: 0, col: 0, msg: r.error, kind: 'runtime' } : undefined };
  }
  /** Run the first Indicator/Strategy class of a .cs file (every installed .cs file is compiled together). */
  private runNinjaJob(id: string, job: Extract<Job, { kind: 'ninja' }>, inputs: Record<string, unknown>): ScriptRun {
    try {
      const r = runNinjaScript(job.cr, job.cls, this.vb(), { ...job.opts, inputs });
      return { id, name: r.result.name || job.cls, out: r.out, ms: r.ms, tester: r.tester, error: r.result.error ? { line: 0, col: 0, msg: r.result.error, kind: 'runtime' } : undefined };
    } catch (e) { return { id, name: job.cls, ms: 0, error: { line: 0, col: 0, msg: (e as Error).message, kind: 'runtime' } } }
  }
  /** Re-run scripts on live ticks, at most every 2s (full recompute is cheap for chart-sized data). */
  private rerunScripts() {
    if (!this.cfg.scripts?.length) return;
    const wait = 2000 - (Date.now() - this.lastScriptRun);
    clearTimeout(this.scriptTimer);
    this.scriptTimer = window.setTimeout(() => { if (!this.chart) return; this.renderScripts(); this.tradeOverlay(); this.main.setData(this.withBarColors(toSeriesData(this.cfg.type, this.vb(), this.typeOpts())) as never) }, Math.max(0, wait));
  }
  refresh() {
    this.rerunScripts();
    if (isPriceBased(this.cfg.type) || ['volcandles', 'columns', 'hollow'].includes(this.cfg.type)) { this.setData(); return }
    const to = this.typeOpts();
    this.disp = transformBars(this.cfg.type, this.vb(), to);
    const last = (toSeriesData(this.cfg.type, this.vb(), to) as never[]).at(-1);
    if (!last) return;
    this.main.update(last);
    this.vol?.update(this.volBar(this.vb().at(-1)!));
    this.setInd();
    this.legend(this.crosshairTime ? this.disp.find(x => x.time === this.crosshairTime) : this.disp.at(-1));
    this.quick();
  }
  private setInd() {
    for (const e of this.ind) {
      const d = e.calc(this.vb());
      for (const [k, s] of Object.entries(e.plots)) s.setData(this.toSeries(d[k], k === 'Hist'));
    }
  }
  setIndicatorsVisible(on: boolean) { this.ind.forEach(e => Object.values(e.plots).forEach(s => s.applyOptions({ visible: on && !e.hidden }))) }

  /** Fills as markers; positions, working orders and alerts as price lines. */
  tradeOverlay() {
    if (!this.main) return;
    for (const l of this.lines) this.main.removePriceLine(l);
    this.lines = [];
    const s = this.hooks.settings(), a = this.hooks.account(), sym = this.cfg.symbol, b = this.vb(), hidePos = this.hooks.hidden().positions;
    const line = (price: number, color: string, title: string, style: LineStyle = LineStyle.Dashed) =>
      this.lines.push(this.main.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true }));
    if (s.alertLines) for (const al of this.hooks.alerts()) if (al.sym === sym && (al.on || !s.onlyActiveAlerts) && al.drawingId == null) line(al.price, s.alertLineColor, '⏰');
    const m: SeriesMarker<Time>[] = [];
    if (s.tradeLines && !hidePos) {
      const p = a.pos[sym];
      if (p) line(p.avg, p.qty > 0 ? s.upColor : s.downColor, `${p.qty > 0 ? 'Long' : 'Short'} ${Math.abs(p.qty)}`, LineStyle.Solid);
      for (const o of a.orders) if (o.sym === sym) line(o.price!, o.side === 'buy' ? s.upColor : s.downColor, `${o.reduceOnly ? (o.type === 'limit' ? 'TP' : 'SL') : o.type.toUpperCase()} ${o.side} ${o.qty}`);
    }
    if (s.executions && !hidePos && b.length && !isPriceBased(this.cfg.type)) for (const f of a.fills) {
      if (f.sym !== sym || f.ts < b[0].time || f.ts > b.at(-1)!.time + tfSeconds(this.cfg.tf)) continue;
      let i = b.length - 1; while (i > 0 && b[i].time > f.ts) i--;
      const buy = f.side === 'buy';
      m.push({ time: b[i].time as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar', color: buy ? s.upColor : s.downColor, shape: buy ? 'arrowUp' : 'arrowDown', text: `${f.side} ${f.qty}` });
    }
    m.push(...this.scriptMarkers);
    this.markers.setMarkers(m.sort((x, y) => (x.time as number) - (y.time as number)));
  }
  /** Previous day close, visible high/low and average close lines (Scales and lines settings). */
  scaleOverlay() {
    if (!this.main) return;
    this.scaleLines.forEach(l => this.main.removePriceLine(l)); this.scaleLines = [];
    const s = this.hooks.settings(), muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const add = (price: number, title: string, color = muted) => this.scaleLines.push(this.main.createPriceLine({ price, title, color, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true }));
    const b = this.vb();
    if (s.prevCloseLine && b.length) {
      const dayStart = Math.floor(b.at(-1)!.time / 86400) * 86400;
      const prev = [...b].reverse().find(x => x.time < dayStart);
      if (prev) add(prev.close, 'Prev close');
    }
    const r = this.chart.timeScale().getVisibleLogicalRange();
    if (r && (s.highLowLines || s.avgCloseLine)) {
      const vis = this.disp.slice(Math.max(0, Math.floor(r.from)), Math.ceil(r.to) + 1);
      if (vis.length) {
        if (s.highLowLines) { add(Math.max(...vis.map(x => x.high)), 'High', s.upColor); add(Math.min(...vis.map(x => x.low)), 'Low', s.downColor) }
        if (s.avgCloseLine) add(vis.reduce((a, x) => a + x.close, 0) / vis.length, 'Avg close');
      }
    }
  }
  private countdown() {
    const last = this.vb().at(-1); if (!last || this.replay || isPriceBased(this.cfg.type)) return;
    const left = Math.max(0, Math.round(last.time + tfSeconds(this.cfg.tf) - Date.now() / 1000));
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
    this.main.applyOptions({ title: left > 172800 ? `${Math.floor(left / 86400)}d ${h % 24}h` : `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` });
  }
  private quick() {
    const s = this.hooks.settings(), px = this.lastPrice();
    this.quickEl.style.display = s.buySellButtons && px && !this.replay && !isExpr(this.cfg.symbol) ? '' : 'none';
    if (px) this.quickEl.innerHTML = `<button data-side="sell" class="qs">SELL<br><b>${this.fmt(px)}</b></button><button data-side="buy" class="qb">BUY<br><b>${this.fmt(px)}</b></button>`;
  }
  legend(b?: Bar) {
    const s = this.hooks.settings(), f = this.fmt, sym = this.cfg.symbol;
    const desc = sym.replace(/^[A-Z0-9]+:/, '').replace(/_?USDT(\.P)?$/, ' / TetherUS$1').replace(/_/g, ' / ');
    const title = s.legendTitle === 'description' ? desc : s.legendTitle === 'both' ? `${sym} · ${desc}` : sym;
    const typeName = CHART_TYPES.find(t => t.id === this.cfg.type)?.name ?? '';
    let html = `<b>${esc(title)}</b> · ${esc(this.cfg.tf)} · ${isExpr(sym) ? 'Spread' : sym.includes(':') ? esc(sym.split(':')[0]) : 'Binance'}${isPriceBased(this.cfg.type) || this.cfg.type === 'ha' ? ` · ${esc(typeName)}` : ''}${this.replay && !this.replay.picking ? ' · <span class="warn">REPLAY</span>' : ''}`;
    if (b) {
      const ch = b.close - b.open, cls = ch >= 0 ? 'up' : 'dn';
      html += `<br><span class="n">O</span><span class="${cls}">${f(b.open)}</span> <span class="n">H</span><span class="${cls}">${f(b.high)}</span> <span class="n">L</span><span class="${cls}">${f(b.low)}</span> <span class="n">C</span><span class="${cls}">${f(b.close)}</span>`;
      if (s.barChange) html += ` <span class="${cls}">${ch >= 0 ? '+' : ''}${f(ch)} (${ch >= 0 ? '+' : ''}${((ch / b.open) * 100).toFixed(2)}%)</span>`;
      if (s.legendVolume && b.volume) html += ` <span class="n">Vol</span>${fmtVol(b.volume)}`;
    }
    if (s.indTitles) {
      const i = b ? this.vb().findIndex(x => x.time === b.time) : -1;
      for (const e of this.ind) {
        const vals = s.indValues && i >= 0 ? Object.entries(e.calc(this.vb().slice(0, i + 1))).map(([k, v]) => `<span title="${esc(k)}">${v.at(-1) == null ? '∅' : (+v.at(-1)!).toFixed(Math.min(this.prec, 4))}</span>`).join(' ') : '';
        const name = s.indArgs ? e.name : e.name.replace(/[\d\s.,]+$/, '');
        html += `<div class="ind${e.hidden ? ' off' : ''}" data-ind="${esc(e.key)}"><span class="n">${esc(name)}</span> ${vals} <span class="ia"><button data-act="hide" title="Hide">👁</button><button data-act="remove" title="Remove">×</button></span></div>`;
      }
      for (const r of this.scriptRuns) {
        const ref = this.cfg.scripts?.find(x => x.id === r.id);
        const i = b ? this.vb().findIndex(x => x.time === b.time) : -1;
        const vals = s.indValues && r.out && i >= 0 ? r.out.plots.filter(p => p.kind === 'line' && p.display).slice(0, 6).map(p => `<span title="${esc(p.title)}" style="color:${esc(p.colors[i] ?? '')}">${Number.isFinite(p.values[i]) ? (+p.values[i]).toFixed(Math.min(this.prec, 4)) : '∅'}</span>`).join(' ') : '';
        html += `<div class="ind${ref?.hidden ? ' off' : ''}" data-script="${esc(r.id)}"><span class="n">${esc(r.name)}${r.error ? ' <span class="dn" title="' + esc(r.error.msg) + '">⚠</span>' : ''}</span> ${vals} <span class="ia"><button data-act="settings" title="Settings">⚙</button><button data-act="hide" title="Hide">👁</button><button data-act="remove" title="Remove">×</button></span></div>`;
      }
      for (const c of this.cfg.compare ?? []) html += `<div><span class="n">${esc(c)}</span></div>`;
    }
    this.legendEl.innerHTML = html;
  }
  /** Values under the crosshair for the Data Window. */
  dataWindow(): { name: string; value: string }[] {
    const t = this.crosshairTime, b = t != null ? this.disp.find(x => x.time === t) : this.disp.at(-1);
    if (!b) return [];
    const f = this.fmt, rows = [
      { name: 'Date', value: new Date(b.time * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' },
      { name: 'Open', value: f(b.open) }, { name: 'High', value: f(b.high) }, { name: 'Low', value: f(b.low) }, { name: 'Close', value: f(b.close) },
      { name: 'Change', value: `${f(b.close - b.open)} (${(((b.close - b.open) / b.open) * 100).toFixed(2)}%)` }, { name: 'Volume', value: fmtVol(b.volume) },
    ];
    const i = this.vb().findIndex(x => x.time === b.time);
    if (i >= 0) for (const e of this.ind) for (const [k, v] of Object.entries(e.calc(this.vb().slice(0, i + 1))))
      rows.push({ name: `${e.name} · ${k}`, value: v.at(-1) == null ? '∅' : (+v.at(-1)!).toFixed(Math.min(this.prec, 4)) });
    return rows;
  }
  private async loadMore() {
    if (this.loadingMore || this.noMore || this.replay || !this.bars.length) return;
    this.loadingMore = true;
    const tok = this.loadTok;
    try {
      const older = await this.fetch(this.bars[0].time * 1000 - 1);
      if (tok !== this.loadTok) return;
      const fresh = older.filter(b => b.time < this.bars[0].time);
      if (!fresh.length) { this.noMore = true; return }
      const before = this.disp.length, r = this.chart.timeScale().getVisibleLogicalRange();
      this.bars = [...fresh, ...this.bars];
      this.setData();
      const added = this.disp.length - before;
      if (r) this.chart.timeScale().setVisibleLogicalRange({ from: r.from + added, to: r.to + added });
    } catch {} finally { this.loadingMore = false }
  }
  /** Load history back to `t` (bounded to 20 pages), then centre the view on it. */
  async goTo(t: number) {
    for (let i = 0; i < 20 && this.bars.length && this.bars[0].time > t && !this.noMore; i++) {
      await this.loadMore();
      while (this.loadingMore) await new Promise(r => setTimeout(r, 50));
    }
    const i = this.disp.findIndex(b => b.time >= t);
    if (i < 0) return toast('Date is outside the available data');
    this.chart.timeScale().setVisibleLogicalRange({ from: i - 60, to: i + 60 });
  }
  /** Show [from, now], loading older history first when needed. */
  async showSince(from: number) {
    await this.goTo(from);
    const i = Math.max(0, this.disp.findIndex(b => b.time >= from));
    this.chart.timeScale().setVisibleLogicalRange({ from: i, to: this.disp.length + this.hooks.settings().rightOffset });
  }
  resetView() { this.chart.timeScale().resetTimeScale(); this.chart.timeScale().scrollToRealTime(); this.main.priceScale().setAutoScale(true) }
  syncCrosshair(time: number | null) {
    const b = time == null ? undefined : this.disp.find(x => x.time === time);
    if (b) this.chart.setCrosshairPosition(b.close, b.time as UTCTimestamp, this.main); else this.chart.clearCrosshairPosition();
  }
  exportCsv() {
    const head = ['time', 'open', 'high', 'low', 'close', 'volume', ...this.ind.flatMap(e => Object.keys(e.plots).map(k => `${e.name} ${k}`))];
    const calc = this.ind.map(e => e.calc(this.vb()));
    const rows = this.vb().map((b, i) => [new Date(b.time * 1000).toISOString(), b.open, b.high, b.low, b.close, b.volume, ...calc.flatMap(d => Object.values(d).map(v => v[i] ?? ''))].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `${this.cfg.symbol.replace(/[^A-Z0-9]/gi, '_')}_${this.cfg.tf}.csv`; a.click();
  }

  // ---------- bar replay ----------
  startReplay() {
    if (!this.bars.length) return;
    if (isPriceBased(this.cfg.type)) return toast('Bar Replay is not available for price-based chart types');
    this.replay = { idx: this.bars.length, picking: true };
    toast('Click a bar to start replay from');
  }
  startReplayAt(t: number) {
    const i = this.bars.findIndex(b => b.time >= t);
    if (i < 1) return toast('Pick a later bar');
    this.pauseReplay();
    this.replay = { idx: i + 1 }; this.setData(); this.hooks.onCfgChange();
    this.chart.timeScale().scrollToRealTime();
  }
  replayRandom() { if (this.bars.length > 100) this.startReplayAt(this.bars[50 + Math.floor(Math.random() * (this.bars.length - 100))].time) }
  replayFirst() { if (this.bars.length > 2) this.startReplayAt(this.bars[1].time) }
  stepReplay() {
    if (!this.replay || this.replay.picking) return;
    if (this.replay.idx >= this.bars.length) { this.pauseReplay(); toast('Replay reached real-time data'); this.hooks.onCfgChange(); return }
    this.replay.idx++; // replay prices never reach live alerts or the paper account
    this.refresh();
  }
  stepBack() { if (this.replay && !this.replay.picking && this.replay.idx > 2) { this.replay.idx--; this.setData() } }
  playReplay(ms: number) { this.pauseReplay(); if (this.replay) this.replay.timer = window.setInterval(() => this.stepReplay(), ms) }
  pauseReplay() { if (this.replay?.timer) { clearInterval(this.replay.timer); this.replay.timer = undefined } }
  exitReplay(redraw = true) { this.pauseReplay(); this.replay = null; if (redraw && this.main) { this.setData(); this.chart.timeScale().scrollToRealTime() } }
}
