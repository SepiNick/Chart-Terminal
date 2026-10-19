// Reference tools. New tool files follow the same shape: export a ToolDef[] and register it in tools/index.ts.
import type { Drawing, Geo, Level, Pt, ToolDef, XY } from './types.ts';

/** Price on the infinite line through a drawing's first two points, at time t (linear in bar index). */
export function linePriceAt(d: Drawing, t: number, g: Geo): number | null {
  const [a, b] = d.pts, la = g.logical(a.t), lb = g.logical(b.t);
  if (la === lb) return null;
  return a.p + ((b.p - a.p) * (g.logical(t) - la)) / (lb - la);
}
const pct = (from: number, to: number) => ((to - from) / from) * 100;
const signed = (v: number, s: string) => (v >= 0 ? '+' : '') + s;

/** Stats box shown by trend/info lines: Δprice, %, bars, duration. */
export function moveStats(a: Pt, b: Pt, g: Geo): string {
  const bars = Math.round(g.logical(b.t) - g.logical(a.t)), secs = Math.abs(b.t - a.t);
  const dur = secs >= 86400 ? `${(secs / 86400).toFixed(1)}d` : secs >= 3600 ? `${(secs / 3600).toFixed(1)}h` : `${Math.round(secs / 60)}m`;
  const d = b.p - a.p;
  return `${signed(d, g.fmt(d))} (${signed(d, pct(a.p, b.p).toFixed(2))}%) · ${bars} bars, ${dur}`;
}

export const FIB_LEVELS: Level[] = [
  { v: 0, color: '#787b86', on: true }, { v: 0.236, color: '#f23645', on: true }, { v: 0.382, color: '#ff9800', on: true },
  { v: 0.5, color: '#4caf50', on: true }, { v: 0.618, color: '#089981', on: true }, { v: 0.786, color: '#00bcd4', on: true },
  { v: 1, color: '#787b86', on: true }, { v: 1.618, color: '#2962ff', on: true }, { v: 2.618, color: '#f23645', on: false },
  { v: 3.618, color: '#9c27b0', on: false }, { v: 4.236, color: '#e91e63', on: false },
];

const trendLike = (id: string, name: string, icon: string, extS: boolean, extE: boolean, key?: string): ToolDef => ({
  id, name, icon, key, group: 'lines', points: 2,
  defaults: { extendLeft: extS, extendRight: extE },
  props: [{ key: 'showStats', label: 'Show price range & bars', type: 'bool', default: false }, { key: 'arrowEnd', label: 'Arrow at end', type: 'bool', default: false }],
  draw(r, d, P, g) {
    r.ray(P[0], P[1], d.style.extendLeft, d.style.extendRight, { arrowEnd: !!d.style.arrowEnd });
    if (d.style.text) r.text(d.style.text, [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2 - 4], { align: 'center' });
    if (d.style.showStats) r.label(moveStats(d.pts[0], d.pts[1], g), [P[1][0], P[1][1] - 16], d.style.color);
  },
  priceAt: linePriceAt,
});

export const BASIC_TOOLS: ToolDef[] = [
  trendLike('trend', 'Trend line', '╱', false, false, 'Alt+T'),
  trendLike('ray', 'Ray', '↗', false, true),
  trendLike('extended', 'Extended line', '⟋', true, true),
  {
    id: 'hline', name: 'Horizontal line', icon: '─', key: 'Alt+H', group: 'lines', points: 1,
    draw(r, d, P, g) {
      r.hline(P[0][1]);
      r.text(d.style.text || g.fmt(d.pts[0].p), [4, P[0][1] - 3], { size: 11, color: d.style.color, noHit: true });
    },
    handles: (_d, P, g) => [[g.W / 2, P[0][1]]],
    moveHandle(d, _i, pt) { d.pts[0] = { t: d.pts[0].t, p: pt.p } },
    priceAt: d => d.pts[0].p,
  },
  {
    id: 'hray', name: 'Horizontal ray', icon: '⟶', key: 'Alt+J', group: 'lines', points: 1,
    draw(r, d, P, g) {
      r.hline(P[0][1], P[0][0], g.W);
      r.text(d.style.text || g.fmt(d.pts[0].p), [P[0][0] + 4, P[0][1] - 3], { size: 11, color: d.style.color, noHit: true });
    },
    priceAt: (d, t) => (t >= d.pts[0].t ? d.pts[0].p : null),
  },
  {
    id: 'vline', name: 'Vertical line', icon: '│', key: 'Alt+V', group: 'lines', points: 1,
    draw(r, d, P) { r.vline(P[0][0]); if (d.style.text) r.text(d.style.text, [P[0][0] + 4, 16], { baseline: 'top' }) },
    handles: (_d, P) => [[P[0][0], 30]],
    moveHandle(d, _i, pt) { d.pts[0] = { t: pt.t, p: d.pts[0].p } },
  },
  {
    id: 'rect', name: 'Rectangle', icon: '▭', key: 'Alt+Shift+R', group: 'shapes', points: 2,
    defaults: { fillAlpha: 0.15 },
    props: [{ key: 'midline', label: 'Middle line', type: 'bool', default: false }],
    draw(r, d, P, g) {
      const xs = d.style.extendLeft ? 0 : Math.min(P[0][0], P[1][0]), xe = d.style.extendRight ? g.W : Math.max(P[0][0], P[1][0]);
      r.rect([xs, P[0][1]], [xe, P[1][1]]);
      if (d.style.midline) r.hline((P[0][1] + P[1][1]) / 2, xs, xe, { dash: 'dashed', width: 1 });
      if (d.style.text) r.text(d.style.text, [(xs + xe) / 2, (P[0][1] + P[1][1]) / 2], { align: 'center', baseline: 'middle' });
    },
    // 4 corners: dragging any corner keeps the opposite one fixed.
    handles: (_d, P) => [P[0], P[1], [P[0][0], P[1][1]], [P[1][0], P[0][1]]],
    moveHandle(d, i, pt) {
      const [a, b] = d.pts;
      if (i === 0) d.pts[0] = pt; else if (i === 1) d.pts[1] = pt;
      else if (i === 2) { d.pts[0] = { t: pt.t, p: a.p }; d.pts[1] = { t: b.t, p: pt.p } }
      else { d.pts[1] = { t: pt.t, p: b.p }; d.pts[0] = { t: a.t, p: pt.p } }
    },
  },
  {
    id: 'fib', name: 'Fib retracement', icon: '≡', key: 'Alt+F', group: 'fib', points: 2,
    levels: FIB_LEVELS, defaults: { fillAlpha: 0.08 },
    props: [
      { key: 'reverse', label: 'Reverse', type: 'bool', default: false },
      { key: 'showPrices', label: 'Prices', type: 'bool', default: true },
      { key: 'labelsLeft', label: 'Labels on left', type: 'bool', default: true },
    ],
    draw(r, d, P, g) {
      const [a, b] = d.style.reverse ? [d.pts[1], d.pts[0]] : d.pts;
      const x0 = d.style.extendLeft ? 0 : Math.min(P[0][0], P[1][0]), x1 = d.style.extendRight ? g.W : Math.max(P[0][0], P[1][0]);
      const lv = (d.style.levels ?? []).filter(l => l.on).sort((p, q) => p.v - q.v);
      r.line(P[0], P[1], { dash: 'dashed', width: 1, color: '#787b86' });
      lv.forEach((l, i) => {
        const price = b.p + (a.p - b.p) * l.v, y = g.y(price);
        if (i && d.style.fillAlpha > 0) { const yp = g.y(b.p + (a.p - b.p) * lv[i - 1].v); r.rect([x0, yp], [x1, y], { fill: r.fill(l.color), stroke: false, noHit: true }) }
        r.hline(y, x0, x1, { color: l.color, width: 1 });
        r.text(`${l.v}${d.style.showPrices ? ` (${g.fmt(price)})` : ''}`, [d.style.labelsLeft ? x0 + 2 : x1 - 2, y - 2], { size: 11, color: l.color, align: d.style.labelsLeft ? 'left' : 'right', noHit: true });
      });
    },
  },
  {
    id: 'text', name: 'Text', icon: 'T', group: 'annotations', points: 1, needsText: true,
    defaults: { text: 'Text', fontSize: 14 },
    props: [{ key: 'bgOn', label: 'Background', type: 'bool', default: false }, { key: 'border', label: 'Border', type: 'bool', default: false }],
    draw(r, d, P) {
      r.text(d.style.text, P[0], { bg: d.style.bgOn ? r.fill(d.style.fillColor, Math.max(d.style.fillAlpha, 0.2)) : undefined, border: d.style.border ? d.style.color : undefined, pad: d.style.bgOn || d.style.border ? 5 : 0, baseline: 'top' });
    },
  },
  position('long', 'Long position', '⬆', 1),
  position('short', 'Short position', '⬇', -1),
];

/**
 * Long/short position: pts = [entry, (end time, target), (end time, stop)].
 * Two clicks: entry, then width/risk. Account size & risk % give the position size, as in TradingView.
 */
function position(id: string, name: string, icon: string, dir: 1 | -1): ToolDef {
  return {
    id, name, icon, group: 'forecast', points: 2,
    props: [
      { key: 'account', label: 'Account size', type: 'number', default: 1000, min: 0 },
      { key: 'riskPct', label: 'Risk %', type: 'number', default: 1, min: 0, step: 0.1 },
      { key: 'qtyPrec', label: 'Qty decimals', type: 'number', default: 4, min: 0, max: 8 },
    ],
    build(pts) {
      if (pts.length >= 3) return pts;
      const [e, end] = pts, risk = Math.abs(end.p - e.p) || e.p * 0.01;
      return [e, { t: end.t, p: e.p + dir * risk * 2 }, { t: end.t, p: e.p - dir * risk }];
    },
    draw(r, d, P, g) {
      if (P.length < 3) return;
      const [e, tp, sl] = d.pts, x0 = P[0][0], x1 = P[1][0];
      r.rect([x0, P[0][1]], [x1, P[1][1]], { fill: r.fill('#089981', 0.2), stroke: false });
      r.rect([x0, P[0][1]], [x1, P[2][1]], { fill: r.fill('#f23645', 0.2), stroke: false });
      r.hline(P[0][1], Math.min(x0, x1), Math.max(x0, x1), { color: '#787b86', width: 1 });
      // Outcome: walk bars after entry until TP or SL is touched.
      const i0 = Math.ceil(g.logical(e.t)), i1 = Math.floor(g.logical(tp.t));
      let hit: 'tp' | 'sl' | null = null, hitI = -1;
      for (let i = Math.max(i0, 0); i <= Math.min(i1, g.bars.length - 1) && !hit; i++) {
        const b = g.bars[i];
        const slHit = dir > 0 ? b.low <= sl.p : b.high >= sl.p, tpHit = dir > 0 ? b.high >= tp.p : b.low <= tp.p;
        if (slHit) hit = 'sl'; else if (tpHit) hit = 'tp';
        hitI = i;
      }
      if (hit) {
        const hx = g.x(g.bars[hitI].time), hy = g.y(hit === 'tp' ? tp.p : sl.p);
        r.rect([x0, P[0][1]], [hx, hy], { fill: r.fill(hit === 'tp' ? '#089981' : '#f23645', 0.25), stroke: false, noHit: true });
      }
      const risk = Math.abs(e.p - sl.p), rr = Math.abs(tp.p - e.p) / (risk || 1);
      const qty = risk ? ((Number(d.style.account) * Number(d.style.riskPct)) / 100) / risk : 0;
      const cx = (x0 + x1) / 2, f = g.fmt;
      r.label(`Target: ${f(tp.p)} (${Math.abs(pct(e.p, tp.p)).toFixed(2)}%) ${f(Math.abs(tp.p - e.p) * qty)}`, [cx, P[1][1] + (dir > 0 ? -11 : 11)], '#089981');
      r.label(`Stop: ${f(sl.p)} (${Math.abs(pct(e.p, sl.p)).toFixed(2)}%) ${f(risk * qty)}`, [cx, P[2][1] + (dir > 0 ? 11 : -11)], '#f23645');
      r.label(`${hit === 'tp' ? '✔ ' : hit === 'sl' ? '✘ ' : ''}${dir > 0 ? 'Long' : 'Short'} ${f(e.p)} · Qty ${qty.toFixed(Number(d.style.qtyPrec))} · R:R ${rr.toFixed(2)}`, [cx, P[0][1]], '#5d606b');
    },
    handles: (_d, P) => (P.length < 3 ? P : [P[0], [P[0][0], P[1][1]], [P[0][0], P[2][1]], [P[1][0], P[0][1]]]),
    moveHandle(d, i, pt) {
      if (i === 0) d.pts[0] = pt;
      if (i === 1) d.pts[1] = { ...d.pts[1], p: pt.p };
      if (i === 2) d.pts[2] = { ...d.pts[2], p: pt.p };
      if (i === 3) { d.pts[1] = { ...d.pts[1], t: pt.t }; d.pts[2] = { ...d.pts[2], t: pt.t } }
    },
  };
}

export type { XY };
