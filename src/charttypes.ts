// Main-series factory for every chart type. Pure transforms live in charttransforms.ts (re-exported here).
import {
  CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, HistogramSeries, LineType, customSeriesDefaultOptions,
  type IChartApi, type ISeriesApi, type SeriesType, type PriceFormat, type CustomData, type CustomSeriesOptions, type Time,
  type ICustomSeriesPaneView, type ICustomSeriesPaneRenderer, type PaneRendererCustomData, type PriceToCoordinateConverter,
} from 'lightweight-charts';
import type { Bar } from './data.ts';
import { transformBars, type ChartType, type TypeOpts, type XBar } from './charttransforms.ts';

export * from './charttransforms.ts';

type CBar = CustomData<Time> & XBar;
type Target = Parameters<ICustomSeriesPaneRenderer['draw']>[0];
interface Ctx { ctx: CanvasRenderingContext2D; hr: number; vr: number; y: PriceToCoordinateConverter; bars: PaneRendererCustomData<Time, CBar>['bars']; from: number; to: number; spacing: number; o: TypeOpts }
type Paint = (c: Ctx) => void;

/** Generic custom series: data = bar-like objects, autoscale on low/high/close, painting delegated to `paint` in bitmap space. */
class View implements ICustomSeriesPaneView<Time, CBar, CustomSeriesOptions> {
  private d: PaneRendererCustomData<Time, CBar> | null = null;
  constructor(private paint: Paint, private o: TypeOpts) {}
  renderer(): ICustomSeriesPaneRenderer {
    return {
      draw: (t: Target, y: PriceToCoordinateConverter) => {
        const d = this.d;
        if (!d?.visibleRange || !d.bars.length) return;
        t.useBitmapCoordinateSpace(s => this.paint({
          ctx: s.context, hr: s.horizontalPixelRatio, vr: s.verticalPixelRatio, y, bars: d.bars,
          from: Math.max(0, d.visibleRange!.from), to: Math.min(d.bars.length, d.visibleRange!.to), spacing: d.barSpacing, o: this.o,
        }));
      },
    };
  }
  update(d: PaneRendererCustomData<Time, CBar>) { this.d = d }
  priceValueBuilder(b: CBar) { return [b.low, b.high, b.close] }
  isWhitespace(b: CBar | { time: Time }): b is { time: Time } { return (b as CBar).close == null }
  defaultOptions() { return { ...customSeriesDefaultOptions, color: this.o.lineColor } }
}

const Y = (c: Ctx, p: number) => (c.y(p) ?? 0) * c.vr;
const upOf = (c: Ctx, i: number) => { const b = c.bars[i].originalData; return b.close >= b.open };

/** High-low: a bar spanning low..high, colored by close vs open. */
const highLow: Paint = c => {
  const w = Math.max(1, Math.round(c.spacing * 0.6 * c.hr));
  for (let i = c.from; i < c.to; i++) {
    const { x, originalData: b } = c.bars[i], y1 = Y(c, b.high), y2 = Y(c, b.low);
    c.ctx.fillStyle = upOf(c, i) ? c.o.upColor : c.o.downColor;
    c.ctx.fillRect(Math.round(x * c.hr - w / 2), Math.round(y1), w, Math.max(1, Math.round(y2 - y1)));
  }
};

/** HLC area: high..close band in up color, close..low band in down color, close line on top. */
const hlcArea: Paint = c => {
  const { ctx } = c, from = Math.max(0, c.from - 1), to = Math.min(c.bars.length, c.to + 1), pts = c.bars.slice(from, to);
  if (!pts.length) return;
  const X = (i: number) => pts[i].x * c.hr, line = (k: 'high' | 'low' | 'close', rev = false) => {
    const idx = pts.map((_, i) => i); if (rev) idx.reverse();
    idx.forEach(i => ctx.lineTo(X(i), Y(c, pts[i].originalData[k])));
  };
  for (const [k, col] of [['high', c.o.upColor], ['low', c.o.downColor]] as const) {
    ctx.beginPath(); line(k); line('close', true); ctx.closePath();
    ctx.fillStyle = col + '33'; ctx.fill();
  }
  ctx.beginPath(); line('close'); ctx.strokeStyle = c.o.lineColor; ctx.lineWidth = Math.max(1, Math.round(2 * c.hr)); ctx.stroke();
};

/** Volume candles: body width = full width * volume / max visible volume (min 1px). */
const volCandles: Paint = c => {
  let max = 0;
  for (let i = c.from; i < c.to; i++) max = Math.max(max, c.bars[i].originalData.volume);
  const full = Math.max(1, c.spacing * 0.8 * c.hr), ww = Math.max(1, Math.floor(c.hr));
  for (let i = c.from; i < c.to; i++) {
    const { x, originalData: b } = c.bars[i], xs = x * c.hr, col = upOf(c, i) ? c.o.upColor : c.o.downColor;
    const w = Math.max(1, Math.round(max ? full * b.volume / max : full)), yo = Y(c, b.open), yc = Y(c, b.close);
    c.ctx.fillStyle = col;
    c.ctx.fillRect(Math.round(xs - ww / 2), Math.round(Y(c, b.high)), ww, Math.max(1, Math.round(Y(c, b.low) - Y(c, b.high))));
    c.ctx.fillRect(Math.round(xs - w / 2), Math.round(Math.min(yo, yc)), w, Math.max(1, Math.round(Math.abs(yc - yo))));
  }
};

/** Kagi: horizontal link at the turn price from the previous line, then vertical line; yang thick/up color, yin thin/down color. */
const kagiPaint: Paint = c => {
  const { ctx } = c, seg = (yang: boolean, x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath(); ctx.strokeStyle = yang ? c.o.upColor : c.o.downColor; ctx.lineWidth = Math.max(1, Math.round((yang ? 3 : 1) * c.hr));
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  ctx.lineCap = 'square';
  for (let i = Math.max(0, c.from - 1); i < Math.min(c.bars.length, c.to + 1); i++) {
    const { x, originalData: b } = c.bars[i], xs = x * c.hr, yang = !!b.yang, before = b.flip == null ? yang : !yang;
    if (i) { const p = c.bars[i - 1]; seg(!!p.originalData.yang, p.x * c.hr, Y(c, b.open), xs, Y(c, b.open)) }
    if (b.flip == null) seg(yang, xs, Y(c, b.open), xs, Y(c, b.close));
    else { seg(before, xs, Y(c, b.open), xs, Y(c, b.flip)); seg(yang, xs, Y(c, b.flip), xs, Y(c, b.close)) }
  }
};

/** Point & figure: one glyph per box row, X (up color, two diagonals) or O (down color, ellipse). */
const pnfPaint: Paint = c => {
  const { ctx } = c;
  ctx.lineWidth = Math.max(1, Math.round(1.5 * c.hr));
  for (let i = c.from; i < c.to; i++) {
    const { x, originalData: b } = c.bars[i], box = b.box ?? 0, n = b.boxes ?? 0, xs = x * c.hr;
    if (!box || !n) continue;
    const hh = Math.max(1, Math.abs(Y(c, b.low + box) - Y(c, b.low))) / 2 * 0.85, hw = Math.max(1, Math.min(c.spacing * c.hr * 0.4, hh * 1.6));
    ctx.strokeStyle = b.pnf === 'X' ? c.o.upColor : c.o.downColor;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const yc = Y(c, b.low + k * box);
      if (b.pnf === 'X') { ctx.moveTo(xs - hw, yc - hh); ctx.lineTo(xs + hw, yc + hh); ctx.moveTo(xs + hw, yc - hh); ctx.lineTo(xs - hw, yc + hh) }
      else { ctx.moveTo(xs + hw, yc); ctx.ellipse(xs, yc, hw, hh, 0, 0, Math.PI * 2) }
    }
    ctx.stroke();
  }
};

const CUSTOM: Partial<Record<ChartType, Paint>> = { highlow: highLow, hlcarea: hlcArea, volcandles: volCandles, kagi: kagiPaint, pnf: pnfPaint };

export function createMainSeries(chart: IChartApi, type: ChartType, o: TypeOpts, priceFormat: PriceFormat, paneIndex = 0): ISeriesApi<SeriesType> {
  const up = o.upColor, dn = o.downColor, pf = { priceFormat }, paint = CUSTOM[type];
  if (paint) return chart.addCustomSeries(new View(paint, o), { ...pf, color: o.lineColor }, paneIndex) as unknown as ISeriesApi<SeriesType>;
  switch (type) {
    case 'line': case 'linemarkers': case 'step':
      return chart.addSeries(LineSeries, { color: o.lineColor, lineWidth: 2, lineType: type === 'step' ? LineType.WithSteps : LineType.Simple, pointMarkersVisible: type === 'linemarkers', ...pf }, paneIndex);
    case 'area': return chart.addSeries(AreaSeries, { lineColor: o.lineColor, topColor: o.lineColor + '55', bottomColor: o.lineColor + '05', lineWidth: 2, ...pf }, paneIndex);
    case 'baseline': return chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: o.baseValue ?? 0 }, topLineColor: up, bottomLineColor: dn,
      topFillColor1: up + '44', topFillColor2: up + '05', bottomFillColor1: dn + '05', bottomFillColor2: dn + '44', ...pf,
    }, paneIndex);
    case 'columns': return chart.addSeries(HistogramSeries, { color: up, ...pf }, paneIndex);
    case 'bars': return chart.addSeries(BarSeries, { upColor: up, downColor: dn, ...pf }, paneIndex);
    default: // candles, hollow, ha, renko, linebreak, range
      return chart.addSeries(CandlestickSeries, {
        upColor: type === 'hollow' ? 'transparent' : up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, ...pf,
      }, paneIndex);
  }
}

/**
 * Series data for `type` from raw source bars (runs transformBars). OHLC types get per-point colors when colorByPrevClose
 * (hollow always: color by close vs previous close, body hollow when close > open). Columns color by value vs previous value.
 */
export function toSeriesData(type: ChartType, bars: Bar[], o: TypeOpts): unknown[] {
  const b = transformBars(type, bars, o);
  const t = (x: Bar) => x.time as Time, pc = (i: number) => (i ? b[i - 1].close : b[i].open);
  const col = (x: Bar, i: number) => (x.close >= pc(i) ? o.upColor : o.downColor);
  if (CUSTOM[type]) return b.map(x => ({ ...x, time: t(x) }));
  switch (type) {
    case 'line': case 'linemarkers': case 'step': case 'area': case 'baseline': return b.map(x => ({ time: t(x), value: x.close }));
    case 'columns': return b.map((x, i) => ({ time: t(x), value: x.close, color: col(x, i) }));
    case 'hollow': return b.map((x, i) => {
      const c = col(x, i);
      return { time: t(x), open: x.open, high: x.high, low: x.low, close: x.close, color: x.close > x.open ? 'transparent' : c, borderColor: c, wickColor: c };
    });
    default: return b.map((x, i) => {
      const d = { time: t(x), open: x.open, high: x.high, low: x.low, close: x.close };
      if (!o.colorByPrevClose) return d;
      const c = col(x, i);
      return type === 'bars' ? { ...d, color: c } : { ...d, color: c, borderColor: c, wickColor: c };
    });
  }
}
