// Renders a Pine script's Outputs onto a lightweight-charts chart: plots → series, shapes → markers,
// hlines → price lines, fill/bgcolor/label/line/box → one canvas primitive per pane.
import {
  LineSeries, HistogramSeries, AreaSeries, CandlestickSeries, BarSeries, LineType, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type SeriesType, type ISeriesPrimitive, type IPrimitivePaneRenderer, type IPrimitivePaneView,
  type Logical, type Time, type UTCTimestamp, type SeriesMarker,
} from 'lightweight-charts';
import type { Bar } from '../data.ts';
import type { Outputs, PineTable } from './interp.ts';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
const PAL = ['#2962ff', '#ff9800', '#e91e63', '#00bcd4', '#9c27b0', '#4caf50'];
const DASH: Record<string, LineStyle> = { style_solid: LineStyle.Solid, style_dashed: LineStyle.Dashed, style_dotted: LineStyle.Dotted };
const fin = (v: number) => Number.isFinite(v);

/** Draws fills, background colors and Pine drawings for one pane. Bar index == logical index. */
class PanePrimitive implements ISeriesPrimitive<Time> {
  private req = () => {};
  private host!: { chart: IChartApi; series: ISeriesApi<SeriesType> };
  out: Outputs; bars: Bar[]; plotSeries: Map<string, number[]>; hlinePrices: Map<string, number>;
  bg: boolean; drawings: boolean;
  constructor(out: Outputs, bars: Bar[], plotSeries: Map<string, number[]>, hlinePrices: Map<string, number>, bg: boolean, drawings: boolean) {
    this.out = out; this.bars = bars; this.plotSeries = plotSeries; this.hlinePrices = hlinePrices; this.bg = bg; this.drawings = drawings;
  }
  attached(p: { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void }) { this.host = p; this.req = p.requestUpdate }
  update() { this.req() }
  paneViews(): IPrimitivePaneView[] {
    return [
      { zOrder: () => 'bottom', renderer: () => ({ draw: (t: Target) => this.drawBack(t) }) },
      { zOrder: () => 'top', renderer: () => ({ draw: (t: Target) => this.drawFront(t) }) },
    ];
  }
  private x = (i: number): number | null => this.host.chart.timeScale().logicalToCoordinate(i as Logical);
  private y = (p: number): number | null => this.host.series.priceToCoordinate(p);
  private range() { const r = this.host.chart.timeScale().getVisibleLogicalRange(); return r ? [Math.max(0, Math.floor(r.from) - 1), Math.min(this.bars.length - 1, Math.ceil(r.to) + 1)] : [0, -1] }
  private drawBack(t: Target) {
    t.useMediaCoordinateSpace(({ context: c, mediaSize }) => {
      const [i0, i1] = this.range(), w = Math.max(1, (this.x(1) ?? 1) - (this.x(0) ?? 0));
      if (this.bg) for (let i = i0; i <= i1; i++) {
        const col = this.out.bgcolors[i]; if (!col) continue;
        const x = this.x(i); if (x == null) continue;
        c.fillStyle = col; c.fillRect(x - w / 2, 0, w, mediaSize.height);
      }
      for (const f of this.out.fills) {
        const A = this.plotSeries.get(f.a), B = this.plotSeries.get(f.b), ha = this.hlinePrices.get(f.a), hb = this.hlinePrices.get(f.b);
        if (ha != null && hb != null) {   // band between two hlines, one color (the latest non-null)
          const col = f.colors.findLast(Boolean); const y1 = this.y(ha), y2 = this.y(hb);
          if (col && y1 != null && y2 != null) { c.fillStyle = col; c.fillRect(0, Math.min(y1, y2), mediaSize.width, Math.abs(y2 - y1)) }
          continue;
        }
        for (let i = Math.max(i0, 1); i <= i1; i++) {
          const col = f.colors[i]; if (!col) continue;
          const va = (k: number) => A ? A[k] : ha!, vb = (k: number) => B ? B[k] : hb!;
          if (![va(i - 1), va(i), vb(i - 1), vb(i)].every(v => v != null && fin(v))) continue;
          const xa = this.x(i - 1), xb = this.x(i);
          const p = [this.y(va(i - 1)), this.y(va(i)), this.y(vb(i)), this.y(vb(i - 1))];
          if (xa == null || xb == null || p.some(v => v == null)) continue;
          c.fillStyle = col; c.beginPath(); c.moveTo(xa, p[0]!); c.lineTo(xb, p[1]!); c.lineTo(xb, p[2]!); c.lineTo(xa, p[3]!); c.closePath(); c.fill();
        }
      }
    });
  }
  private drawFront(t: Target) {
    if (!this.drawings) return;
    t.useMediaCoordinateSpace(({ context: c, mediaSize }) => {
      const tx = (x: unknown, xloc: unknown): number | null => xloc === 'bar_time' ? this.x(this.bars.findIndex(b => b.time * 1000 >= Number(x))) : this.x(Number(x));
      for (const d of this.out.drawings) {
        if (d.deleted) continue;
        if (d.type === 'line') {
          let x1 = tx(d.x1, d.xloc), x2 = tx(d.x2, d.xloc); const y1 = this.y(Number(d.y1)), y2 = this.y(Number(d.y2));
          if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
          let Y1 = y1, Y2 = y2;
          const k = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0;
          if (d.extend === 'right' || d.extend === 'both') { Y2 = y2 + k * (mediaSize.width - x2); x2 = mediaSize.width }
          if (d.extend === 'left' || d.extend === 'both') { Y1 = y1 - k * x1; x1 = 0 }
          c.strokeStyle = String(d.color); c.lineWidth = Number(d.width) || 1;
          c.setLineDash(d.style === 'style_dashed' ? [6, 4] : d.style === 'style_dotted' ? [2, 3] : []);
          c.beginPath(); c.moveTo(x1, Y1); c.lineTo(x2, Y2); c.stroke(); c.setLineDash([]);
        } else if (d.type === 'box') {
          const x1 = tx(d.left, d.xloc), x2 = d.extend === 'right' ? mediaSize.width : tx(d.right, d.xloc), y1 = this.y(Number(d.top)), y2 = this.y(Number(d.bottom));
          if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
          c.fillStyle = String(d.bgcolor); c.fillRect(x1, y1, x2 - x1, y2 - y1);
          c.strokeStyle = String(d.border_color); c.lineWidth = Number(d.border_width) || 1; c.strokeRect(x1, y1, x2 - x1, y2 - y1);
          if (d.text) { c.fillStyle = String(d.text_color); c.font = '11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(d.text), (x1 + x2) / 2, (y1 + y2) / 2) }
        } else if (d.type === 'label') {
          const x = tx(d.x, d.xloc), bar = this.bars[Math.round(Number(d.x))];
          const price = d.yloc === 'abovebar' ? bar?.high : d.yloc === 'belowbar' ? bar?.low : Number(d.y);
          const y = price != null ? this.y(price) : null;
          if (x == null || y == null) continue;
          const text = String(d.text ?? ''), lines = text.split('\n'), size = d.size === 'large' ? 14 : d.size === 'small' || d.size === 'tiny' ? 10 : 12;
          c.font = `${size}px system-ui`;
          const w = Math.max(16, ...lines.map(l => c.measureText(l).width)) + 10, h = lines.length * size * 1.3 + 6;
          const up = String(d.style).includes('up'), none = String(d.style).includes('none');
          const by = up ? y + 6 : y - 6 - h;
          if (!none) { c.fillStyle = String(d.color); c.beginPath(); c.moveTo(x, y); c.lineTo(x - 5, up ? by : by + h); c.lineTo(x + 5, up ? by : by + h); c.fill(); c.fillRect(x - w / 2, by, w, h) }
          c.fillStyle = String(none ? d.color : d.textcolor); c.textAlign = 'center'; c.textBaseline = 'top';
          lines.forEach((l, k) => c.fillText(l, x, by + 3 + k * size * 1.3));
        }
      }
    });
  }
}

const UP = '#26a69a', DOWN = '#ef5350';
const TEXT_PX: Record<string, number> = { tiny: 8, small: 10, normal: 12, large: 16, huge: 22, auto: 12 };
// top_right sits below the chart's quick Buy/Sell buttons, which share that corner.
const POS: Record<string, string> = {
  top_left: 'top:4px;left:4px', top_center: 'top:4px;left:50%;transform:translateX(-50%)', top_right: 'top:40px;right:4px',
  middle_left: 'top:50%;left:4px;transform:translateY(-50%)', middle_center: 'top:50%;left:50%;transform:translate(-50%,-50%)', middle_right: 'top:50%;right:4px;transform:translateY(-50%)',
  bottom_left: 'bottom:4px;left:4px', bottom_center: 'bottom:4px;left:50%;transform:translateX(-50%)', bottom_right: 'bottom:4px;right:4px',
};
/** Pine tables as real HTML tables (text via textContent, so script data is never parsed as markup). */
function tableEl(t: PineTable): HTMLTableElement {
  const el = document.createElement('table'), covered = new Set<string>();
  el.style.cssText = `position:absolute;${POS[t.position] ?? POS.top_right};width:auto;border-collapse:collapse;font-family:system-ui;pointer-events:auto;`
    + `background:${t.bgcolor ?? 'transparent'};${t.frame_width && t.frame_color ? `outline:${t.frame_width}px solid ${t.frame_color};` : ''}`;
  for (let r = 0; r < t.rows; r++) {
    const tr = el.insertRow();
    for (let c = 0; c < t.columns; c++) {
      if (covered.has(`${c},${r}`)) continue;
      const m = t.merges.find(x => x.c0 === c && x.r0 === r), cell = t.cells[`${c},${r}`], td = tr.insertCell();
      if (m) {
        td.colSpan = m.c1 - m.c0 + 1; td.rowSpan = m.r1 - m.r0 + 1;
        for (let cc = m.c0; cc <= m.c1; cc++) for (let rr = m.r0; rr <= m.r1; rr++) covered.add(`${cc},${rr}`);
      }
      td.style.cssText = `padding:2px 6px;white-space:pre;${t.border_width && t.border_color ? `border:${t.border_width}px solid ${t.border_color};` : ''}`;
      if (!cell) continue;
      const px = TEXT_PX[cell.text_size] ?? (Number(cell.text_size) || 12);
      td.textContent = cell.text; td.title = cell.tooltip;
      Object.assign(td.style, {
        color: cell.text_color, fontSize: `${px}px`, textAlign: cell.text_halign.replace('align_', ''), verticalAlign: { align_top: 'top', align_bottom: 'bottom' }[cell.text_valign] ?? 'middle',
        background: cell.bgcolor ?? '', fontFamily: cell.font === 'monospace' || cell.font === 'font_family_monospace' ? 'monospace' : '',
        width: cell.width ? `${cell.width}vw` : '', height: cell.height ? `${cell.height}vh` : '',   // ponytail: Pine sizes are % of the pane; viewport units are close enough
      });
    }
  }
  return el;
}

const MARK: Record<string, SeriesMarker<Time>['shape']> = {
  triangleup: 'arrowUp', arrowup: 'arrowUp', labelup: 'arrowUp', triangledown: 'arrowDown', arrowdown: 'arrowDown', labeldown: 'arrowDown', circle: 'circle',
};

export interface ScriptView { series: ISeriesApi<SeriesType>[]; markers: SeriesMarker<Time>[]; barColors: (string | null)[]; panesUsed: number; dispose(): void }

/**
 * Add a script's visual outputs to the chart. `pane` is the pane index for non-overlay scripts.
 * Returns markers (to merge with the main series' markers) and per-bar candle colors (barcolor).
 */
export function renderScript(chart: IChartApi, main: ISeriesApi<SeriesType>, out: Outputs, bars: Bar[], pane: number, color0: number): ScriptView {
  const overlay = out.meta.overlay, idx = overlay ? 0 : pane;
  const series: ISeriesApi<SeriesType>[] = [], markers: SeriesMarker<Time>[] = [];
  const plotSeries = new Map<string, number[]>(), hlinePrices = new Map<string, number>();
  const prec = out.meta.precision;
  const pf = prec != null ? { priceFormat: { type: 'price' as const, precision: prec, minMove: 10 ** -prec } } : {};
  let host: ISeriesApi<SeriesType> | null = overlay ? main : null, c = color0;
  const t = (i: number) => bars[i]?.time as UTCTimestamp;
  for (const p of out.plots) {
    plotSeries.set(p.id, p.values);
    if (!p.display) continue;
    if (p.kind === 'line') {
      const style = p.style.replace('plot.', '');
      const color = p.colors.findLast(Boolean) ?? PAL[c++ % PAL.length];
      const common = { title: p.title, priceLineVisible: p.trackprice, lastValueVisible: true, ...pf };
      const s = style.includes('histogram') || style.includes('columns')
        ? chart.addSeries(HistogramSeries, { ...common, color, base: p.histbase }, idx)
        : style.includes('area')
          ? chart.addSeries(AreaSeries, { ...common, lineColor: color, topColor: color + '55', bottomColor: color + '05', lineWidth: Math.min(4, p.linewidth) as 1 }, idx)
          : chart.addSeries(LineSeries, {
            ...common, color, lineWidth: Math.min(4, p.linewidth) as 1, crosshairMarkerVisible: false,
            lineType: style.includes('step') ? LineType.WithSteps : LineType.Simple,
            lineVisible: !(style.includes('circles') || style.includes('cross')), pointMarkersVisible: style.includes('circles') || style.includes('cross'),
          }, idx);
      s.setData(p.values.map((v, i) => {
        const j = i + p.offset;
        if (!bars[j]) return null;
        return fin(v) ? { time: t(j), value: v, ...(p.colors[i] ? { color: p.colors[i]! } : {}) } : { time: t(j) };
      }).filter(Boolean) as never);
      series.push(s);
      host ??= s;
    } else if ((p.kind === 'candle' || p.kind === 'bar') && p.ohlc) {
      const { o, h, l, c: cl } = p.ohlc, opts = { title: p.title, priceLineVisible: false, lastValueVisible: true, upColor: UP, downColor: DOWN, ...pf };
      const s = p.kind === 'candle' ? chart.addSeries(CandlestickSeries, { ...opts, wickUpColor: UP, wickDownColor: DOWN, borderUpColor: UP, borderDownColor: DOWN }, idx) : chart.addSeries(BarSeries, opts, idx);
      s.setData(bars.map((_, i) => {
        if (![o[i], h[i], l[i], cl[i]].every(fin)) return { time: t(i) };
        const color = p.colors[i] ?? (cl[i] >= o[i] ? UP : DOWN);
        return p.kind === 'bar' ? { time: t(i), open: o[i], high: h[i], low: l[i], close: cl[i], color }
          : { time: t(i), open: o[i], high: h[i], low: l[i], close: cl[i], color, wickColor: p.wickcolors?.[i] ?? color, borderColor: p.bordercolors?.[i] ?? color };
      }) as never);
      series.push(s);
      host ??= s;
    } else {
      // shapes / chars / arrows → markers
      p.values.forEach((v, i) => {
        if (!fin(v) || !bars[i]) return;
        const pos = p.location === 'belowbar' || p.location === 'bottom' ? 'belowBar' : p.location === 'absolute' ? 'inBar' : 'aboveBar';
        const shape = p.kind === 'arrow' ? (v > 0 ? 'arrowUp' : 'arrowDown') : p.kind === 'char' ? 'circle' : MARK[p.shape ?? ''] ?? 'square';
        const text = p.kind === 'char' ? `${p.char ?? ''}${p.texts?.[i] ? ' ' + p.texts[i] : ''}` : p.texts?.[i] ?? undefined;
        markers.push({ time: t(i + (p.offset || 0)) ?? t(i), position: p.kind === 'arrow' ? (v > 0 ? 'belowBar' : 'aboveBar') : pos, shape, color: p.colors[i] ?? '#2962ff', text, size: p.size === 'large' || p.size === 'huge' ? 2 : p.size === 'tiny' ? 0.5 : 1 });
      });
    }
  }
  if (!host) {   // a pane needs at least one series to host lines/primitives
    host = chart.addSeries(LineSeries, { visible: false, lastValueVisible: false, priceLineVisible: false }, idx);
    host.setData(bars.map(b => ({ time: b.time as UTCTimestamp })) as never);
    series.push(host);
  }
  const lines: IPriceLine[] = [];
  for (const h of out.hlines) {
    hlinePrices.set(h.id, h.price);
    if (h.display && fin(h.price)) lines.push(host.createPriceLine({ price: h.price, color: h.color, lineStyle: DASH[h.linestyle.replace('hline.', '')] ?? LineStyle.Dashed, lineWidth: Math.min(4, h.linewidth) as 1, title: h.title === 'Level' ? '' : h.title, axisLabelVisible: false }));
  }
  const hasBg = out.bgcolors.some(Boolean), hasDraw = out.drawings.some(d => !d.deleted);
  const prim = out.fills.length || hasBg || hasDraw ? new PanePrimitive(out, bars, plotSeries, hlinePrices, hasBg, hasDraw) : null;
  if (prim) host.attachPrimitive(prim);
  const h = host;
  // Tables → one HTML overlay in the pane's plot cell (the pane's <tr> holds left axis, plot, right axis cells).
  let tablesEl: HTMLElement | null = null, disposed = false;
  const live = (out.tables ?? []).filter(x => !x.deleted);
  const mountTables = () => {
    const cell = chart.panes()[idx]?.getHTMLElement()?.children[1] as HTMLElement | undefined;
    if (!cell || disposed) return !!disposed;
    tablesEl = document.createElement('div');
    tablesEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden';
    live.forEach(x => tablesEl!.appendChild(tableEl(x)));
    cell.appendChild(tablesEl);
    return true;
  };
  if (live.length && typeof document !== 'undefined' && !mountTables()) requestAnimationFrame(() => mountTables());   // new panes get their element on the next layout
  // Strategy fills → entry/exit arrows on the main chart.
  if (out.broker) for (const f of out.broker.fills) {
    const buy = f.side === 'buy';
    markers.push({ time: f.time as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? '#2962ff' : '#e91e63', text: `${f.id} ${+f.qty.toFixed(4)}` });
  }
  const dispose = () => {
    disposed = true; tablesEl?.remove();
    if (prim) h.detachPrimitive(prim);
    if (h === main) lines.forEach(l => main.removePriceLine(l));
    series.forEach(x => { try { chart.removeSeries(x) } catch {} });
  };
  // MQL expert deals → arrows on the main chart.
  for (const d of (out as Outputs & { mqlDeals?: { time: number; type: string; volume: number; entry: string; comment: string }[] }).mqlDeals ?? []) {
    const buy = d.type === 'buy';
    markers.push({ time: d.time as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? '#2962ff' : '#e91e63', text: `${d.entry === 'in' ? '' : '✕ '}${+d.volume.toFixed(4)}${d.comment ? ' ' + d.comment : ''}` });
  }
  return { series, markers, barColors: out.barcolors, panesUsed: overlay ? 0 : 1, dispose };
}
