// Order flow on a chart: footprint cells, big-print bubbles and a liquidity heatmap drawn as series primitives,
// plus CVD / delta panes. One instance per chart pane; it survives chart rebuilds and is reset on symbol/tf change.
import { CandlestickSeries, HistogramSeries, type IChartApi, type IPrimitivePaneRenderer, type IPrimitivePaneView, type ISeriesApi, type ISeriesPrimitive, type SeriesType, type Time, type UTCTimestamp } from 'lightweight-charts';
import { BookHistory, Footprint, absorption, autoRow, barStats, bigPrints, binOf, clusterSearch, imbalances, type Absorption, type BookSnap, type ClusterHit, type ClusterMetric, type FBar, type Print } from './model.ts';
import { fetchPrints, hasOrderFlow, streamBook, streamPrints } from './feed.ts';
import { ofFeed, replayOn, replayStatus } from './source.ts';
import { parseOfTf } from './tfbars.ts';
import { TPO_LETTERS, sessions, tpo, volumeProfile } from './profile.ts';
import { toast } from '../store.ts';
import type { Bar } from '../data.ts';

export interface OFCfg {
  footprint: 'off' | 'bidask' | 'delta' | 'volume';
  row: number;            // price per footprint row; 0 = automatic
  ratio: number;          // diagonal imbalance ratio
  heatmap: boolean;
  bubbles: boolean;
  bigMin: number;         // big-print notional threshold; 0 = automatic
  cvd: boolean;
  delta: boolean;         // per-bar delta histogram pane
  tpo?: boolean;          // TPO (market profile) per session
  vprofile?: boolean;     // volume profile per session
  cluster?: 'off' | ClusterMetric;   // Cluster Search
  clusterMin?: number;    // 0 = automatic (top 1% of the window)
  clusterMax?: number;    // 0 = no upper bound
  clusterWindow?: number; // bars searched, counted back from the last
  clusterAlert?: boolean; // toast (and an `orderflow:cluster` window event) when the forming bar gets a new hit
  absorption?: boolean;
}
export const defaultOF = (): OFCfg => ({ footprint: 'off', row: 0, ratio: 3, heatmap: false, bubbles: false, bigMin: 0, cvd: false, delta: false, tpo: false, vprofile: false, cluster: 'off', clusterMin: 0, clusterMax: 0, clusterWindow: 50, clusterAlert: false, absorption: false });
/** `type`: the chart types 'footprint' and 'tpo' switch the matching layer on by themselves. */
export const ofActive = (c?: OFCfg, type?: string) => type === 'footprint' || type === 'tpo' || (!!c && (c.footprint !== 'off' || c.heatmap || c.bubbles || c.cvd || c.delta || !!c.tpo || !!c.vprofile || (c.cluster ?? 'off') !== 'off' || !!c.absorption));
/** Effective settings: defaults for fields older layouts lack, plus what the chart type implies. */
export function ofEffective(c: OFCfg | undefined, type?: string): OFCfg {
  const e = { ...defaultOF(), ...c };
  if (type === 'footprint' && e.footprint === 'off') e.footprint = 'bidask';
  if (type === 'tpo') e.tpo = true;
  return e;
}
const needsPrints = (c: OFCfg) => c.footprint !== 'off' || c.heatmap || c.bubbles || c.cvd || c.delta || !!c.vprofile || c.cluster !== 'off' || !!c.absorption;

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
type Ctx = CanvasRenderingContext2D;
const HEAT_EVERY = 2, HEAT_KEEP = 3 * 3600, HEAT_ROWS = 600;

const fmtQ = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'K' : v >= 1000 ? (v / 1e3).toFixed(1) + 'K' : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : v.toPrecision(2));
/** Bookmap-like ramp: deep blue → cyan → yellow → white. */
function heatColor(t: number): [number, number, number] {
  const s: [number, number, number, number][] = [[0, 10, 20, 60], [0.25, 20, 80, 200], [0.5, 30, 200, 220], [0.75, 250, 220, 40], [1, 255, 255, 255]];
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const a = s[i - 1], b = s[i], k = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k] }
  return [255, 255, 255];
}

export interface OFHost { symbol: () => string; tfSec: () => number; tf?: () => string; type?: () => string; bars: () => Bar[]; prec: () => number; cfg: () => OFCfg; colors: () => { up: string; down: string; text: string; bg: string }; status: (s: string) => void }

export class OrderFlow implements ISeriesPrimitive<Time> {
  fp: Footprint | null = null;
  book = new BookHistory(HEAT_EVERY, HEAT_KEEP);
  firstId?: number;
  loading = false;
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private cvdSeries: ISeriesApi<'Candlestick'> | null = null;
  private deltaSeries: ISeriesApi<'Histogram'> | null = null;
  private stopPrints = () => {};
  private stopBook = () => {};
  private pending: Print[] = [];
  private requestUpdate = () => {};
  private raf = 0;
  private paneTimer = 0;
  private views: IPrimitivePaneView[];
  private heat: { canvas: OffscreenCanvas | HTMLCanvasElement; row: number; base: number; t0: number; dirty: boolean } | null = null;
  private heatScale = 1;
  private host: OFHost;

  constructor(host: OFHost) {
    this.host = host;
    const under: IPrimitivePaneRenderer = { draw: t => { this.drawHeat(t); this.drawProfiles(t) } };
    const over: IPrimitivePaneRenderer = { draw: t => this.drawTop(t) };
    this.views = [{ renderer: () => under, zOrder: () => 'bottom' }, { renderer: () => over, zOrder: () => 'top' }];
  }
  // ---------- ISeriesPrimitive ----------
  attached(p: { requestUpdate: () => void }) { this.requestUpdate = p.requestUpdate }
  detached() { this.requestUpdate = () => {} }
  paneViews() { return this.views }
  updateAllViews() {}

  /** Called from ChartPane.build(): attach to the new chart and add CVD/delta panes after the existing ones. */
  attach(chart: IChartApi, main: ISeriesApi<SeriesType>) {
    this.chart = chart; this.series = main;
    const c = this.cfg(), colors = this.host.colors();
    main.attachPrimitive(this);
    let pane = chart.panes().length;
    this.cvdSeries = c.cvd ? chart.addSeries(CandlestickSeries, { upColor: colors.up, downColor: colors.down, borderVisible: false, wickUpColor: colors.up, wickDownColor: colors.down, title: 'CVD', priceFormat: { type: 'volume' }, priceLineVisible: false }, pane++) : null;
    this.deltaSeries = c.delta ? chart.addSeries(HistogramSeries, { title: 'Delta', priceFormat: { type: 'volume' }, priceLineVisible: false }, pane++) : null;
    chart.panes().forEach((p, i) => p.setStretchFactor(i ? 1 : 3.5));
    if (c.footprint !== 'off' || this.host.type?.() === 'tpo') main.applyOptions({ upColor: 'transparent', downColor: 'transparent', borderVisible: false, wickVisible: false } as never);
    if (c.footprint !== 'off') {
      // After the chart restores its previous zoom: footprint cells need wide bars.
      setTimeout(() => {
        if (this.chart !== chart) return;
        const ts = chart.timeScale(), n = this.host.bars().length;
        if (ts.options().barSpacing < 60) ts.setVisibleLogicalRange({ from: n - Math.max(6, ts.width() / 90), to: n + 1 });
      });
    }
    this.start();
    this.panes();
  }
  /** Symbol or timeframe changed / chart destroyed. */
  reset() { this.stopPrints(); this.stopBook(); this.stopPrints = this.stopBook = () => {}; this.fp = null; this.book = new BookHistory(HEAT_EVERY, HEAT_KEEP); this.heat = null; this.firstId = undefined; this.started = '' }

  private started = '';
  private cfg() { return ofEffective(this.host.cfg(), this.host.type?.()) }
  /** Activity interval (tick/range/reversal/delta): bars are keyed by `Print.bar`, not by the clock. */
  private activity() { return !!parseOfTf(this.host.tf?.() ?? '') }
  private start() {
    const c = this.cfg(), sym = this.host.symbol(), tf = this.host.tf?.() ?? '';
    if (!needsPrints(c)) { this.stopPrints(); this.stopBook(); this.stopPrints = this.stopBook = () => {}; this.started = ''; this.fp = null; this.statusLine(); this.changed(); return }
    if (!hasOrderFlow(sym)) { this.host.status('Order flow is available for crypto symbols only'); return }
    const feed = ofFeed(sym, tf), heat = c.heatmap && !feed;   // the book heatmap is live-only and clock-based
    const want = `${sym}|${tf}|${this.host.tfSec()}|${heat}|${replayOn(sym, tf)}`;
    if (this.started === want) { this.syncRow(); return }
    this.stopPrints(); this.stopBook();
    this.started = want;
    const row = this.rowSize();
    this.fp = new Footprint(this.host.tfSec(), row);
    this.pending = [];
    let live = false;
    const onPrints = (ps: Print[]) => { if (live) { this.fp!.add(ps); this.changed() } else this.pending.push(...ps) };
    const loaded = ({ prints, firstId }: { prints: Print[]; firstId?: number }) => {
      if (!this.fp || this.started !== want) return;
      this.firstId = firstId;
      const last = prints.at(-1)?.t ?? 0;
      this.fp.add([...prints, ...this.pending.filter(p => p.t > last)]);
      this.pending = []; live = true; this.loading = false;
      this.statusLine(); this.changed();
    };
    const failed = (e: Error) => { live = true; this.loading = false; this.host.status(`Order flow history unavailable: ${e.message}`) };
    this.loading = true; this.host.status('Order flow: loading recent trades…');
    if (feed) {
      feed.onPrints.add(onPrints);
      this.stopPrints = () => { feed.onPrints.delete(onPrints); feed.release() };
      feed.ready.then(() => loaded({ prints: feed.prints }), failed);
      return;
    }
    this.stopPrints = streamPrints(sym, onPrints);
    if (heat) this.stopBook = streamBook(sym, b => this.onBook(b), 500);
    fetchPrints(sym, 20, n => this.host.status(`Order flow: loading recent trades… ${n.toLocaleString()}`)).then(loaded, failed);
  }
  /** Fetch older trades (Binance only), extending the footprint back in time. */
  async loadMore(pages = 20) {
    if (!this.fp || this.loading || this.firstId == null) return;
    this.loading = true;
    try {
      const { prints, firstId } = await fetchPrints(this.host.symbol(), pages, n => this.host.status(`Order flow: loading older trades… ${n.toLocaleString()}`), this.firstId);
      this.firstId = firstId; this.fp.prepend(prints);
    } finally { this.loading = false; this.statusLine(); this.changed() }
  }
  private statusLine() {
    const rs = replayOn(this.host.symbol(), this.host.tf?.()) ? replayStatus() + ' · ' : '';
    if (!this.fp) { this.host.status(rs.slice(0, -3)); return }
    const from = this.fp.from === Infinity ? '' : new Date(this.fp.from * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    this.host.status(`${rs}Order flow since ${from} · ${this.fp.prints.length.toLocaleString()} trades · row ${+this.fp.row.toPrecision(6)}`);
  }
  private rowSize() {
    const c = this.cfg();
    if (c.row > 0) return c.row;
    return autoRow(this.host.bars().slice(-200).map(b => b.high - b.low), 22, 10 ** -this.host.prec());
  }
  private syncRow() { if (!this.cfg().row) { this.autoZoomRow(); this.changed(); return }   // automatic rows follow the zoom instead
    const r = this.rowSize(); if (this.fp && Math.abs(r - this.fp.row) > 1e-12) { this.fp.rebuild(r); this.heat = null; this.statusLine() } this.changed() }

  private changed() {
    if (!this.raf) this.raf = window.setTimeout(() => { this.raf = 0; this.autoZoomRow(); this.requestUpdate() }, 60);   // not rAF: it stalls in background tabs
    if (!this.paneTimer) this.paneTimer = window.setTimeout(() => { this.paneTimer = 0; this.panes() }, 500);
  }
  private panes() {
    if (!this.fp) return;
    if (!this.loading && replayOn(this.host.symbol(), this.host.tf?.())) this.statusLine();
    const bs = [...this.fp.bars.values()].sort((a, b) => a.time - b.time), c = this.host.colors();
    try {
      this.cvdSeries?.setData(bs.map(b => ({ time: b.time as UTCTimestamp, open: b.cvdOpen, high: b.cvdHigh, low: b.cvdLow, close: b.cvdClose })));
      this.deltaSeries?.setData(bs.map(b => ({ time: b.time as UTCTimestamp, value: b.buy - b.sell, color: (b.buy >= b.sell ? c.up : c.down) + 'cc' })));
    } catch { /* series of a chart that was just rebuilt */ }
    this.analyse(bs);
  }

  // ---------- Cluster Search and absorption (recomputed with the panes, at most every 500 ms) ----------
  private hits: ClusterHit[] = [];
  private absorbed: Absorption[] = [];
  private seen: Set<string> | null = null;
  private analyse(bs: FBar[]) {
    const c = this.cfg(), fp = this.fp!;
    const win = bs.slice(-Math.max(1, c.clusterWindow || 50));
    this.hits = c.cluster === 'off' ? [] : clusterSearch(win, c.cluster!, c.clusterMin, c.clusterMax || Infinity);
    this.absorbed = c.absorption ? absorption(bs.slice(-300), fp.row) : [];
    if (!c.clusterAlert || c.cluster === 'off') { this.seen = null; return }
    const last = bs.at(-1)?.time, fresh = this.hits.filter(h => h.time === last && !this.seen?.has(`${h.time}:${h.bin}`));
    const first = !this.seen;
    this.seen ??= new Set();
    for (const h of fresh) this.seen.add(`${h.time}:${h.bin}`);
    if (first || !fresh.length) return;   // the first pass only learns what is already there
    const h = fresh.reduce((a, x) => (Math.abs(x.value) > Math.abs(a.value) ? x : a)), px = (h.bin * fp.row).toFixed(this.host.prec());
    toast(`Cluster ${this.host.symbol()}: ${c.cluster} ${h.value > 0 && c.cluster === 'delta' ? '+' : ''}${+h.value.toPrecision(4)} at ${px}`);
    window.dispatchEvent(new CustomEvent('orderflow:cluster', { detail: { symbol: this.host.symbol(), metric: c.cluster, price: h.bin * fp.row, value: h.value, time: h.time } }));
  }

  // ---------- heatmap ----------
  private onBook(b: BookSnap) {
    this.book.push(b);
    const row = this.fp?.row ?? this.rowSize();
    const mid = b.bids[0] && b.asks[0] ? (b.bids[0][0] + b.asks[0][0]) / 2 : b.bids[0]?.[0] ?? b.asks[0]?.[0];
    if (mid == null) return;
    const midBin = binOf(mid, row);
    // Rebuild on a new row size, when price leaves the band, and every ~2 min so colours follow the current liquidity.
    if (!this.heat || this.heat.row !== row || Math.abs(midBin - this.heat.base) > HEAT_ROWS * 0.4 || ++this.sinceScale > 60) this.rebuildHeat(row, midBin);
    else this.paintSnap(b);
    this.changed();
  }
  private rebuildHeat(row: number, midBin: number) {
    const w = Math.ceil(HEAT_KEEP / HEAT_EVERY);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, HEAT_ROWS) : Object.assign(document.createElement('canvas'), { width: w, height: HEAT_ROWS });
    this.heat = { canvas, row, base: midBin, t0: Math.floor((this.book.snaps[0]?.t ?? Date.now() / 1000) / HEAT_EVERY) * HEAT_EVERY, dirty: false };
    // Colour scale = 98th percentile of per-row totals over recent snapshots near the mid price.
    const totals: number[] = [];
    for (const s of this.book.snaps.slice(-60)) totals.push(...this.binSizes(s, row).values());
    totals.sort((a, b) => a - b);
    this.heatScale = totals[Math.floor(totals.length * 0.98)] || 1;
    this.sinceScale = 0;
    for (const s of this.book.snaps) this.paintSnap(s);
  }
  private sinceScale = 0;
  private binSizes(s: BookSnap, row: number) {
    const sizes = new Map<number, number>();
    for (const [p, q] of s.bids) { const k = binOf(p, row); sizes.set(k, (sizes.get(k) ?? 0) + q) }
    for (const [p, q] of s.asks) { const k = binOf(p, row); sizes.set(k, (sizes.get(k) ?? 0) + q) }
    return sizes;
  }
  /** One snapshot = one pixel column; row = price bin around `base`. */
  private paintSnap(s: BookSnap) {
    const h = this.heat!; const ctx = h.canvas.getContext('2d') as Ctx;
    let col = Math.floor((s.t - h.t0) / HEAT_EVERY);
    if (col >= h.canvas.width) {   // scroll the image left by half
      const shift = Math.floor(h.canvas.width / 2);
      const img = ctx.getImageData(shift, 0, h.canvas.width - shift, HEAT_ROWS);
      ctx.clearRect(0, 0, h.canvas.width, HEAT_ROWS); ctx.putImageData(img, 0, 0);
      h.t0 += shift * HEAT_EVERY; col -= shift;
    }
    const sizes = this.binSizes(s, h.row);
    const img = ctx.createImageData(1, HEAT_ROWS), top = h.base + HEAT_ROWS / 2;
    if (this.heatScale <= 0) this.heatScale = 1;
    for (const [k, q] of sizes) {
      const y = top - k; if (y < 0 || y >= HEAT_ROWS) continue;
      const [r, g, b] = heatColor(Math.sqrt(q / this.heatScale)), i = y * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 235;
    }
    ctx.putImageData(img, col, 0);
  }
  /** x of a moment in time, interpolated inside its bar. */
  // ponytail: linear from the last bar, which assumes no gaps between bars (true for 24/7 crypto); weekend-gapped markets would need per-bar lookup.
  private xOf(t: number): number | null {
    const ts = this.chart!.timeScale(), sec = this.host.tfSec(), last = this.host.bars().at(-1);
    const x = last && ts.timeToCoordinate(last.time as UTCTimestamp);
    if (x == null || !last) return null;
    return x + ((t - last.time) / sec - 0.5) * ts.options().barSpacing;
  }
  private drawHeat(target: Target) {
    const h = this.heat, c = this.cfg();
    if (!c.heatmap || !h || !this.chart || !this.series) return;
    const first = this.book.snaps[0], last = this.book.snaps.at(-1);
    if (!first || !last) return;
    const x0 = this.xOf(h.t0), x1 = this.xOf(h.t0 + h.canvas.width * HEAT_EVERY);
    const yTop = this.series.priceToCoordinate((h.base + HEAT_ROWS / 2 + 1) * h.row), yBot = this.series.priceToCoordinate((h.base - HEAT_ROWS / 2 + 1) * h.row);
    if (x0 == null || x1 == null || yTop == null || yBot == null) return;
    target.useMediaCoordinateSpace(({ context: ctx }: { context: Ctx }) => {
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.85;
      ctx.drawImage(h.canvas as CanvasImageSource, x0, yTop, x1 - x0, yBot - yTop);
      ctx.restore();
    });
  }

  // ---------- session profiles: TPO (letters from the left edge) and volume profile (bars from the right edge) ----------
  /** Row size giving about `px` pixels per row at the current vertical zoom. */
  private zoomRow(px: number) {
    const p = this.host.bars().at(-1)?.close, s = this.series!;
    const a = p && s.priceToCoordinate(p), b = p && s.priceToCoordinate(p * 1.001);
    return a == null || b == null || !p || a === b ? 0 : autoRow([(px / Math.abs(a - b)) * p * 0.001], 1, 10 ** -this.host.prec());
  }
  private drawProfiles(target: Target) {
    const c = this.cfg(), bars = this.host.bars();
    if ((!c.tpo && !c.vprofile) || !this.chart || !this.series || !bars.length) return;
    const ts = this.chart.timeScale(), sp = ts.options().barSpacing, s = this.series, colors = this.host.colors(), tfSec = this.host.tfSec();
    // ponytail: UTC-day sessions (week / 30 days on daily+ charts) and 30-min TPO periods (one bar when bars are longer); no custom session templates.
    const len = tfSec < 4 * 3600 ? 86400 : tfSec <= 86400 ? 604800 : 30 * 86400, period = Math.max(1800, tfSec);
    const overlay = this.host.type?.() !== 'tpo', POC = '#f5a623';
    const yRange = (k: number, row: number) => { const a = s.priceToCoordinate((k + 1) * row), b = s.priceToCoordinate(k * row); return a == null || b == null ? null : { top: Math.min(a, b), h: Math.abs(b - a) } };
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: { context: Ctx; mediaSize: { width: number; height: number } }) => {
      for (const ses of sessions(bars, len)) {
        const xa = ts.timeToCoordinate(ses.bars[0].time as UTCTimestamp), xb = ts.timeToCoordinate(ses.bars.at(-1)!.time as UTCTimestamp);
        if (xa == null || xb == null || xb + sp < 0 || xa - sp > mediaSize.width) continue;
        const x0 = xa - sp / 2, x1 = xb + sp / 2;
        ctx.save();
        if (c.tpo) {
          const row = this.zoomRow(12); if (!row) break;
          const t = tpo(ses.bars, ses.start, period, row), singles = new Set(t.singles);
          const maxN = Math.max(1, ...[...t.rows.values()].map(r => r.length)), cw = Math.min(9, (x1 - x0) / maxN);
          ctx.globalAlpha = overlay ? 0.55 : 1;
          for (const [k, ps] of t.rows) {
            const r = yRange(k, row); if (!r) continue;
            const inVA = k >= t.val && k <= t.vah;
            ctx.fillStyle = k === t.poc ? POC : inVA ? colors.text : colors.text + '80';
            if (cw >= 5 && r.h >= 8) {
              ctx.font = `${Math.min(12, r.h - 1)}px monospace`; ctx.textBaseline = 'middle';
              ps.forEach((p, i) => ctx.fillText(TPO_LETTERS[p % TPO_LETTERS.length], x0 + i * cw, r.top + r.h / 2));
            } else ctx.fillRect(x0, r.top, ps.length * cw, Math.max(1, r.h - 1));
            if (singles.has(k)) { ctx.fillStyle = '#e6c200'; ctx.fillRect(x0 - 5, r.top, 3, Math.max(1, r.h)) }
          }
          const ib1 = s.priceToCoordinate((t.ibHi + 1) * row), ib2 = s.priceToCoordinate(t.ibLo * row);
          if (ib1 != null && ib2 != null && Number.isFinite(t.ibHi)) { ctx.fillStyle = '#2962ff'; ctx.fillRect(x0 - 2, Math.min(ib1, ib2), 2, Math.abs(ib2 - ib1)) }
        }
        if (c.vprofile) {
          const row = this.zoomRow(5); if (!row) break;
          const fp = this.fp, vp = volumeProfile(ses.bars, row, fp ? { bars: fp.bars, row: fp.row, from: fp.from } : undefined);
          const maxV = Math.max(1e-12, ...vp.rows.values()), w = (x1 - x0) * 0.45;
          ctx.globalAlpha = 0.6;
          for (const [k, v] of vp.rows) {
            const r = yRange(k, row); if (!r) continue;
            ctx.fillStyle = k === vp.poc ? POC : k >= vp.val && k <= vp.vah ? colors.up + '99' : colors.text + '40';
            const bw = (v / maxV) * w; ctx.fillRect(x1 - bw, r.top, bw, Math.max(1, r.h - (r.h > 3 ? 1 : 0)));
          }
          ctx.globalAlpha = 1; ctx.lineWidth = 1;
          for (const [k, col, dash] of [[vp.poc, POC, []], [vp.vah + 1, colors.text + '99', [4, 3]], [vp.val, colors.text + '99', [4, 3]]] as [number, string, number[]][]) {
            const y = s.priceToCoordinate((k === vp.poc ? k + 0.5 : k) * row); if (y == null) continue;
            ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    });
  }

  // ---------- footprint, bubbles, clusters, absorption ----------
  private drawTop(target: Target) {
    const c = this.cfg(), fp = this.fp;
    if (!fp || !this.chart || !this.series || (c.footprint === 'off' && !c.bubbles && c.cluster === 'off' && !c.absorption)) return;
    const ts = this.chart.timeScale(), sp = ts.options().barSpacing, colors = this.host.colors();
    this.autoZoomRow();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: { context: Ctx; mediaSize: { width: number; height: number } }) => {
      if (c.footprint !== 'off') {
        const bars = this.host.bars(), byTime = new Map(bars.map(b => [b.time, b]));
        for (const fb of fp.bars.values()) {
          const xc = ts.timeToCoordinate(fb.time as UTCTimestamp);
          if (xc == null || xc < -sp || xc > mediaSize.width + sp) continue;
          this.drawBar(ctx, fb, byTime.get(fb.time), xc, sp, colors, c);
        }
        // bars without footprint data keep a plain candle so the chart doesn't look empty before the history starts
        for (const b of bars) {
          if (fp.bars.has(b.time)) continue;
          const x = ts.timeToCoordinate(b.time as UTCTimestamp); if (x == null || x < -sp || x > mediaSize.width + sp) continue;
          this.candle(ctx, b, x, Math.max(2, sp * 0.3), colors);
        }
      }
      if (c.bubbles) this.drawBubbles(ctx, fp.prints.slice(-20000), mediaSize.width, colors, c);
      const cell = (time: number, bin: number) => {
        const x = ts.timeToCoordinate(time as UTCTimestamp), a = this.series!.priceToCoordinate((bin + 1) * fp.row), b = this.series!.priceToCoordinate(bin * fp.row);
        return x == null || a == null || b == null || x < -sp || x > mediaSize.width + sp ? null : { x, top: Math.min(a, b), h: Math.max(2, Math.abs(b - a)) };
      };
      ctx.lineWidth = 2; ctx.strokeStyle = '#f5a623';
      for (const h of this.hits) {
        const r = cell(h.time, h.bin); if (!r) continue;
        if (c.footprint !== 'off') ctx.strokeRect(r.x - sp * 0.45, r.top, sp * 0.9, r.h);
        else { ctx.beginPath(); ctx.arc(r.x, r.top + r.h / 2, Math.max(4, Math.min(12, sp * 0.45)), 0, Math.PI * 2); ctx.stroke() }
      }
      for (const a of this.absorbed) {
        const r = cell(a.time, a.bin); if (!r) continue;
        const x = r.x - sp * 0.5 - 7, y = r.top + r.h / 2, up = a.side === 'buy';
        ctx.fillStyle = up ? colors.up : colors.down;
        ctx.beginPath(); ctx.moveTo(x, y + (up ? -6 : 6)); ctx.lineTo(x - 5, y + (up ? 4 : -4)); ctx.lineTo(x + 5, y + (up ? 4 : -4)); ctx.closePath(); ctx.fill();
        if (sp >= 30) { ctx.font = '9px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`ABS ${fmtQ(a.vol)}`, x - 7, y); ctx.textAlign = 'left' }
      }
    });
  }
  /** Automatic row size follows the vertical zoom (~14 px per row); regrouping waits until it is off by 2×. */
  private zoomTimer = 0;
  private autoZoomRow() {
    if (this.cfg().row > 0 || !this.fp || !this.series || this.zoomTimer) return;
    const p = this.host.bars().at(-1)?.close; if (!p) return;
    const a = this.series.priceToCoordinate(p), b = this.series.priceToCoordinate(p * 1.001);
    if (a == null || b == null || a === b) return;
    const want = autoRow([(14 / Math.abs(a - b)) * p * 0.001], 1, 10 ** -this.host.prec()), r = want / this.fp.row;
    if (r > 1.9 || r < 0.52) this.zoomTimer = window.setTimeout(() => { this.zoomTimer = 0; this.fp?.rebuild(want); this.heat = null; this.statusLine(); this.changed() }, 120);
  }
  private candle(ctx: Ctx, b: Bar, x: number, w: number, colors: { up: string; down: string }) {
    const s = this.series!, yo = s.priceToCoordinate(b.open), yc = s.priceToCoordinate(b.close), yh = s.priceToCoordinate(b.high), yl = s.priceToCoordinate(b.low);
    if (yo == null || yc == null || yh == null || yl == null) return;
    ctx.fillStyle = ctx.strokeStyle = b.close >= b.open ? colors.up : colors.down;
    ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillRect(x - w / 2, Math.min(yo, yc), w, Math.max(1, Math.abs(yc - yo)));
  }
  private drawBar(ctx: Ctx, fb: FBar, bar: Bar | undefined, xc: number, sp: number, colors: { up: string; down: string; text: string; bg: string }, c: OFCfg) {
    const s = this.series!, row = this.fp!.row, st = barStats(fb), im = imbalances(fb, c.ratio);
    const left = xc - sp * 0.45, width = sp * 0.9, strip = Math.max(2, Math.min(5, sp * 0.06));
    const imb = new Map(im.map(x => [`${x.side}${x.bin}`, x]));
    if (bar) { // thin candle on the left edge
      this.candle(ctx, bar, left + strip / 2, strip, colors);
    }
    const cellsX = left + strip + 2, cellsW = width - strip - 2;
    const showText = cellsW >= 44;
    for (const [k, cell] of fb.cells) {
      const y1 = s.priceToCoordinate((k + 1) * row), y2 = s.priceToCoordinate(k * row);
      if (y1 == null || y2 == null) continue;
      const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y2 - y1) - (Math.abs(y2 - y1) > 6 ? 1 : 0));
      const vol = cell.bid + cell.ask, d = cell.ask - cell.bid;
      ctx.globalAlpha = 1;
      if (c.footprint === 'volume') {
        const w = (vol / Math.max(1e-12, ...[...fb.cells.values()].map(x => x.bid + x.ask))) * cellsW;
        ctx.fillStyle = (d >= 0 ? colors.up : colors.down) + '99'; ctx.fillRect(cellsX, top, w, h);
        if (showText && h >= 9) { ctx.fillStyle = colors.text; ctx.font = `${Math.min(11, h - 1)}px sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText(fmtQ(vol), cellsX + 2, top + h / 2) }
      } else if (c.footprint === 'delta') {
        const a = Math.min(1, Math.abs(d) / Math.max(1e-12, st.maxCell)) * 0.85 + 0.1;
        ctx.fillStyle = (d >= 0 ? colors.up : colors.down) + Math.round(a * 255).toString(16).padStart(2, '0'); ctx.fillRect(cellsX, top, cellsW, h);
        if (showText && h >= 9) { ctx.fillStyle = '#fff'; ctx.font = `${Math.min(11, h - 1)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((d > 0 ? '+' : '') + fmtQ(d), cellsX + cellsW / 2, top + h / 2); ctx.textAlign = 'left' }
      } else {
        // bid × ask: two half cells, shade by size
        const half = cellsW / 2, sb = cell.bid / Math.max(1e-12, st.maxCell), sa = cell.ask / Math.max(1e-12, st.maxCell);
        ctx.fillStyle = colors.down + Math.round((0.12 + sb * 0.7) * 255).toString(16).padStart(2, '0'); ctx.fillRect(cellsX, top, half - 0.5, h);
        ctx.fillStyle = colors.up + Math.round((0.12 + sa * 0.7) * 255).toString(16).padStart(2, '0'); ctx.fillRect(cellsX + half + 0.5, top, half - 0.5, h);
        if (showText && h >= 9) {
          const fs = Math.min(11, h - 1);
          ctx.textBaseline = 'middle';
          const bi = imb.get(`sell${k}`), ai = imb.get(`buy${k}`);
          ctx.font = `${bi ? 'bold ' : ''}${fs}px sans-serif`; ctx.fillStyle = bi ? (bi.stacked ? '#ff5b5b' : '#ffb3b3') : colors.text; ctx.textAlign = 'right'; ctx.fillText(fmtQ(cell.bid), cellsX + half - 3, top + h / 2);
          ctx.font = `${ai ? 'bold ' : ''}${fs}px sans-serif`; ctx.fillStyle = ai ? (ai.stacked ? '#3dffb0' : '#b3ffd9') : colors.text; ctx.textAlign = 'left'; ctx.fillText(fmtQ(cell.ask), cellsX + half + 3, top + h / 2);
          ctx.textAlign = 'left';
        } else {
          // too small for text: mark imbalances with a coloured tick
          if (imb.has(`buy${k}`)) { ctx.fillStyle = colors.up; ctx.fillRect(cellsX + cellsW - 2, top, 2, h) }
          if (imb.has(`sell${k}`)) { ctx.fillStyle = colors.down; ctx.fillRect(cellsX, top, 2, h) }
        }
      }
      if (k === st.poc) { ctx.strokeStyle = colors.text; ctx.lineWidth = 1; ctx.strokeRect(cellsX + 0.5, top + 0.5, cellsW - 1, h - 1) }
    }
    // value area bracket and stats under the bar
    const yva1 = s.priceToCoordinate((st.vah + 1) * row), yva2 = s.priceToCoordinate(st.val * row);
    if (yva1 != null && yva2 != null) { ctx.fillStyle = colors.text + '55'; ctx.fillRect(left + width + 1, Math.min(yva1, yva2), 2, Math.abs(yva2 - yva1)) }
    const ylo = s.priceToCoordinate(fb.lo);
    if (ylo != null && cellsW >= 30) {
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = st.delta >= 0 ? colors.up : colors.down; ctx.fillText(`Δ ${st.delta >= 0 ? '+' : ''}${fmtQ(st.delta)}`, xc, ylo + 6);
      ctx.fillStyle = colors.text; ctx.fillText(`V ${fmtQ(st.volume)}`, xc, ylo + 18);
      ctx.textAlign = 'left';
    }
  }
  private drawBubbles(ctx: Ctx, prints: Print[], width: number, colors: { up: string; down: string; text: string }, c: OFCfg) {
    const big = bigPrints(prints, c.bigMin), s = this.series!;
    if (!big.length) return;
    const th = Math.min(...big.map(p => p.px * p.qty));
    for (const p of big) {
      const x = this.activity() && p.bar != null ? this.chart!.timeScale().timeToCoordinate(p.bar as UTCTimestamp) : this.xOf(p.t), y = s.priceToCoordinate(p.px);
      if (x == null || y == null || x < -40 || x > width + 40) continue;
      const r = Math.max(4, Math.min(28, Math.sqrt((p.px * p.qty) / th) * 5));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = (p.buy ? colors.up : colors.down) + '77'; ctx.fill();
      ctx.strokeStyle = p.buy ? colors.up : colors.down; ctx.lineWidth = 1; ctx.stroke();
      if (r >= 12) { ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(fmtQ(p.qty), x, y); ctx.textAlign = 'left' }
    }
  }
}
