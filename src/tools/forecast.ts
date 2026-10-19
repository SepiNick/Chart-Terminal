// Forecasting, measurement and volume-based tools beyond Long/Short position.
import type { Bar } from '../data.ts';
import type { Drawing, Geo, Renderer, ToolDef, XY } from './types.ts';
import { rgba } from './render.ts';
import { anchoredVwap, volumeProfile } from './volume.ts';

const UP = '#089981', DN = '#f23645', BLUE = '#2962ff';
const pct = (from: number, to: number) => (from ? ((to - from) / from) * 100 : 0);
const signed = (v: number, s: string) => (v >= 0 ? '+' : '') + s;
const kmb = (v: number) => { const a = Math.abs(v); return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : v.toFixed(2) };
const dur = (s: number) => {
  s = Math.abs(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.round((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m';
};
const num = (v: unknown, dflt: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : dflt);

/** Bars whose index lies in the (unordered) time range; [] when the range is entirely outside data. */
function barsIn(g: Geo, t0: number, t1: number): Bar[] {
  const a = Math.round(g.logical(Math.min(t0, t1))), b = Math.round(g.logical(Math.max(t0, t1)));
  return g.bars.slice(Math.max(0, a), Math.max(0, Math.min(g.bars.length - 1, b) + 1));
}
function candle(r: Renderer, g: Geo, x: number, o: number, h: number, l: number, c: number) {
  const col = c >= o ? UP : DN, w = Math.max(1, g.barWidth * 0.35), yo = g.y(o), yc = g.y(c);
  r.line([x, g.y(h)], [x, g.y(l)], { color: col, width: 1, dash: 'solid' });
  r.rect([x - w, yo], [x + w, Math.abs(yc - yo) < 1 ? yo + 1 : yc], { fill: rgba(col, 0.85), stroke: false });
}
/** Signed short-way sweep from angle a0 to a1, in (-π, π]. */
const sweep = (a0: number, a1: number) => { let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da <= -Math.PI) da += 2 * Math.PI; return da };
/** Points along the short way from angle a0 to a1 at radius rad around c. */
function arcPts(c: XY, rad: number, a0: number, a1: number, n = 32): XY[] {
  const da = sweep(a0, a1);
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (da * i) / n; return [c[0] + rad * Math.cos(a), c[1] + rad * Math.sin(a)] as XY });
}
const ang = (c: XY, p: XY) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = (r: Renderer, p: XY, color: string) => r.ellipse(p, 3, 3, 0, { fill: color, stroke: false });

/** Horizontal volume histogram anchored at xl, ~widthPct of the xl..xr range, with POC and value area. */
function drawProfile(r: Renderer, d: Drawing, g: Geo, bars: Bar[], xl: number, xr: number) {
  const s = d.style, pr = volumeProfile(bars, num(s.rows, 24), num(s.vaPct, 70) / 100);
  if (!pr) return;
  const maxV = Math.max(...pr.total) || 1, wMax = Math.max(40, ((xr - xl) * num(s.widthPct, 30)) / 100);
  const yAt = (i: number) => g.y(pr.lo + i * pr.step);
  r.rect([xl, yAt(pr.rows)], [Math.max(xr, xl + wMax), yAt(0)], { fill: r.fill(s.color, 0.05), stroke: false });
  for (let i = 0; i < pr.rows; i++) {
    let y0 = yAt(i) - 0.5, y1 = yAt(i + 1) + 0.5;
    if (y0 - y1 < 1) { const m = (y0 + y1) / 2; y0 = m + 1; y1 = m - 1 }
    const a = i >= pr.vaLo && i <= pr.vaHi && s.showVA ? 0.7 : 0.3, wu = (pr.up[i] / maxV) * wMax, wd = (pr.down[i] / maxV) * wMax;
    if (wu) r.rect([xl, y1], [xl + wu, y0], { fill: rgba(String(s.upColor), a), stroke: false, noHit: true });
    if (wd) r.rect([xl + wu, y1], [xl + wu + wd, y0], { fill: rgba(String(s.downColor), a), stroke: false, noHit: true });
  }
  const pocY = g.y(pr.lo + (pr.poc + 0.5) * pr.step), pc = String(s.pocColor);
  r.hline(pocY, xl, Math.max(xr, xl + wMax), { color: pc, width: 2, dash: 'solid' });
  r.text(`POC ${g.fmt(pr.lo + (pr.poc + 0.5) * pr.step)}`, [Math.max(xr, xl + wMax) + 4, pocY], { size: 10, color: pc, baseline: 'middle', noHit: true });
  if (s.showVA) for (const y of [yAt(pr.vaHi + 1), yAt(pr.vaLo)]) r.hline(y, xl, Math.max(xr, xl + wMax), { color: pc, width: 1, dash: 'dashed', noHit: true });
}
const PROFILE_PROPS: ToolDef['props'] = [
  { key: 'rows', label: 'Row size (rows)', type: 'number', default: 24, min: 2, max: 500 },
  { key: 'vaPct', label: 'Value area volume %', type: 'number', default: 70, min: 1, max: 100 },
  { key: 'widthPct', label: 'Width (% of range)', type: 'number', default: 30, min: 5, max: 100 },
  { key: 'showVA', label: 'Value area', type: 'bool', default: true },
  { key: 'upColor', label: 'Up volume', type: 'color', default: '#26a69a' },
  { key: 'downColor', label: 'Down volume', type: 'color', default: '#ef5350' },
  { key: 'pocColor', label: 'POC', type: 'color', default: '#ff9800' },
];

/** Price range / Date range / Date and price range measurement boxes. */
function range(id: string, name: string, icon: string, price: boolean, time: boolean): ToolDef {
  return {
    id, name, icon, group: 'forecast', points: 2, defaults: { fillAlpha: 0.15, width: 1 },
    draw(r, d, P, g) {
      const [a, b] = d.pts, c = (price ? b.p >= a.p : b.t >= a.t) ? BLUE : DN;
      const [x0, x1, y0, y1] = [P[0][0], P[1][0], P[0][1], P[1][1]], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      r.rect(P[0], P[1], { fill: r.fill(c, d.style.fillAlpha), stroke: false });
      const lines: string[] = [];
      if (price) {
        const dp = b.p - a.p, dec = g.fmt(1).split('.')[1]?.length ?? 0, ticks = Math.round(dp * 10 ** dec);
        r.hline(y0, Math.min(x0, x1), Math.max(x0, x1), { color: c, width: 1 }); r.hline(y1, Math.min(x0, x1), Math.max(x0, x1), { color: c, width: 1 });
        r.line([mx, y0], [mx, y1], { color: c, width: 1, arrowEnd: y0 !== y1 });
        lines.push(`${signed(dp, g.fmt(dp))} (${signed(dp, pct(a.p, b.p).toFixed(2))}%) ${signed(ticks, String(ticks))} ticks`);
      }
      if (time) {
        const bars = Math.round(g.logical(b.t) - g.logical(a.t)), vol = barsIn(g, a.t, b.t).reduce((s, x) => s + x.volume, 0);
        r.line([x0, Math.min(y0, y1)], [x0, Math.max(y0, y1)], { color: c, width: 1 }); r.line([x1, Math.min(y0, y1)], [x1, Math.max(y0, y1)], { color: c, width: 1 });
        r.line([x0, my], [x1, my], { color: c, width: 1, arrowEnd: x0 !== x1 });
        lines.push(`${bars} bars, ${dur(b.t - a.t)}`, `Vol ${kmb(vol)}`);
      }
      const h = lines.length * 13.75 + 8, below = y1 >= y0;
      r.label(lines.join('\n'), [mx, below ? Math.max(y0, y1) + 6 + h / 2 : Math.min(y0, y1) - 6 - h / 2], c);
    },
  };
}

export const FORECAST_TOOLS: ToolDef[] = [
  {
    // After the target time has passed: Success if any bar after the source touched the target price.
    id: 'forecast', name: 'Forecast', icon: '⇗', group: 'forecast', points: 2,
    draw(r, d, P, g) {
      const [a, b] = d.pts, upMove = b.p >= a.p, dy = upMove ? -1 : 1, last = g.bars.at(-1);
      r.line(P[0], P[1], { arrowEnd: true });
      dot(r, P[0], d.style.color); dot(r, P[1], d.style.color);
      r.label(`Source ${g.fmt(a.p)}`, [P[0][0], P[0][1] - dy * 14], '#5d606b');
      r.label(`Target ${g.fmt(b.p)} (${signed(b.p - a.p, pct(a.p, b.p).toFixed(2))}%)`, [P[1][0], P[1][1] + dy * 14], d.style.color);
      if (!last || last.time < b.t || b.t <= a.t) return;
      const after = barsIn(g, a.t, b.t).slice(1), end = after.at(-1);
      if (!end) return;
      const ok = after.some(x => (upMove ? x.high >= b.p : x.low <= b.p)), act = end.close - a.p;
      r.label(`${ok ? '✔ Success' : '✘ Failure'} · actual ${signed(act, g.fmt(act))} (${signed(act, pct(a.p, end.close).toFixed(2))}%)`, [P[1][0], P[1][1] + dy * 36], ok ? UP : DN);
    },
  },
  {
    // 3 clicks: source range start, source range end, paste location. Pasted bars are re-anchored so the
    // first pasted bar's open sits at the 3rd point's price, one bar per barWidth to the right.
    id: 'barspattern', name: 'Bars pattern', icon: '⫼', group: 'forecast', points: 3,
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['HL bars', 'Line - close', 'Line - open', 'Line - high', 'Line - low'], default: 'HL bars' },
      { key: 'mirror', label: 'Mirrored (flip vertical)', type: 'bool', default: false },
      { key: 'flip', label: 'Flipped (horizontal)', type: 'bool', default: false },
    ],
    draw(r, d, P, g) {
      const src = barsIn(g, d.pts[0].t, d.pts[1].t);
      if (r.selected || P.length < 3) {
        const hi = src.length ? g.y(Math.max(...src.map(b => b.high))) : P[0][1], lo = src.length ? g.y(Math.min(...src.map(b => b.low))) : P[1][1];
        r.rect([P[0][0], hi], [P[1][0], lo], { fill: r.fill(d.style.color, 0.06), stroke: d.style.color, dash: 'dashed', width: 1 });
      }
      if (P.length < 3 || !src.length) return;
      const seq = d.style.flip ? src.slice().reverse().map(b => ({ ...b, open: b.close, close: b.open })) : src;
      const s = d.style.mirror ? -1 : 1, base = seq[0].open, tf = (v: number) => d.pts[2].p + s * (v - base);
      const x = (k: number) => P[2][0] + k * g.barWidth, mode = String(d.style.mode);
      if (mode === 'HL bars') seq.forEach((b, k) => candle(r, g, x(k), tf(b.open), tf(b.high), tf(b.low), tf(b.close)));
      else {
        const key = mode.split(' - ')[1] as 'close' | 'open' | 'high' | 'low';
        const pts = seq.map((b, k) => [x(k), g.y(tf(b[key]))] as XY);
        if (pts.length > 1) r.poly(pts, false); else dot(r, pts[0], d.style.color);
      }
    },
  },
  {
    // Freehand: the dragged path is bucketed per bar; each bucket becomes a candle (open = previous close,
    // close = last path price in the bar, high/low = extremes of the bucket).
    id: 'ghostfeed', name: 'Ghost feed', icon: '👻', group: 'forecast', points: 0,
    draw(r, d, P, g) {
      if (r.selected) r.poly(P, false, { width: 1, dash: 'dotted', noHit: true });
      const buckets = new Map<number, number[]>();
      for (const p of d.pts) { const k = Math.round(g.logical(p.t)); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k)!.push(p.p) }
      let prev: number | undefined;
      for (const [k, ps] of [...buckets].sort((a, b) => a[0] - b[0])) {
        const o = prev ?? ps[0], c = ps[ps.length - 1];
        candle(r, g, g.x(g.timeAt(k)), o, Math.max(o, ...ps), Math.min(o, ...ps), c);
        prev = c;
      }
    },
    handles: () => [],
  },
  {
    // Leg 1→2 swung around point 2 toward point 3: wedge at radius |12|, label = |3−2| / |2−1| in price.
    id: 'projection', name: 'Projection', icon: '◔', group: 'forecast', points: 3, defaults: { fillAlpha: 0.15, width: 1 },
    draw(r, d, P) {
      if (P.length < 3) { r.line(P[0], P[1]); return }
      const [A, B, C] = P, rad = dist(A, B), [a, b, c] = d.pts, leg = b.p - a.p;
      if (rad > 0) {
        const arc = arcPts(B, rad, ang(B, A), ang(B, C));
        r.poly([B, ...arc], true, { stroke: false });
        r.poly(arc, false, { dash: 'dashed' });
      }
      r.line(A, B); r.line(B, C);
      r.label(`${(leg ? Math.abs((c.p - b.p) / leg) * 100 : 0).toFixed(1)}%`, [C[0], C[1] - 14], d.style.color);
    },
  },
  {
    // Center + two rays; filled wedge at the first ray's length, angle measured on screen.
    id: 'sector', name: 'Sector', icon: '◠', group: 'forecast', points: 3, defaults: { fillAlpha: 0.15, width: 1 },
    draw(r, d, P) {
      const [O, A] = P, B = P[2] ?? A, rad = dist(O, A), a0 = ang(O, A), arc = arcPts(O, rad, a0, ang(O, B));
      r.line(O, A); r.line(O, B);
      if (rad <= 0) return;
      r.poly([O, ...arc], true, { stroke: false });
      r.poly(arc, false);
      const mid = arc[16], deg = (Math.abs(sweep(a0, ang(O, B))) * 180) / Math.PI;
      r.label(`${deg.toFixed(1)}°`, [O[0] + (mid[0] - O[0]) * 0.6, O[1] + (mid[1] - O[1]) * 0.6], d.style.color);
    },
  },
  {
    id: 'avwap', name: 'Anchored VWAP', icon: '⚓', group: 'forecast', points: 1, defaults: { color: '#2962ff' },
    props: [
      { key: 'band1', label: 'Bands #1', type: 'bool', default: false },
      { key: 'mult1', label: 'Bands #1 multiplier', type: 'number', default: 1, min: 0, step: 0.5 },
      { key: 'band2', label: 'Bands #2', type: 'bool', default: false },
      { key: 'mult2', label: 'Bands #2 multiplier', type: 'number', default: 2, min: 0, step: 0.5 },
    ],
    // Snap the handle onto the line: the anchor price becomes the anchor bar's typical price.
    build(pts, g) {
      const b = g.bars[Math.round(g.logical(pts[0].t))];
      return b ? [{ t: pts[0].t, p: (b.high + b.low + b.close) / 3 }] : pts;
    },
    draw(r, d, P, g) {
      dot(r, P[0], d.style.color);
      const i0 = Math.max(0, Math.round(g.logical(d.pts[0].t))), vw = anchoredVwap(g.bars.slice(i0));
      const xs = vw.map((_, k) => g.x(g.bars[i0 + k].time)), m = g.barWidth;
      const line = (k: number): XY[] => vw.flatMap((v, j) => (xs[j] >= -m && xs[j] <= g.W + m ? [[xs[j], g.y(v.v + k * v.sd)] as XY] : []));
      r.poly(line(0), false);
      for (const [on, k] of [[d.style.band1, d.style.mult1], [d.style.band2, d.style.mult2]]) {
        if (on) for (const sg of [1, -1]) r.poly(line(sg * Number(k)), false, { width: 1, dash: 'dashed' });
      }
      const last = vw.at(-1);
      if (last) r.text(`VWAP ${g.fmt(last.v)}`, [xs[xs.length - 1] + 6, g.y(last.v)], { size: 11, color: d.style.color, baseline: 'middle', noHit: true });
    },
  },
  {
    id: 'frvp', name: 'Fixed range volume profile', icon: '▤', group: 'forecast', points: 2, props: PROFILE_PROPS,
    draw(r, d, P, g) { drawProfile(r, d, g, barsIn(g, d.pts[0].t, d.pts[1].t), Math.min(P[0][0], P[1][0]), Math.max(P[0][0], P[1][0])) },
  },
  {
    // Grows with new bars: range is always anchor → last bar.
    id: 'avp', name: 'Anchored volume profile', icon: '▥', group: 'forecast', points: 1, props: PROFILE_PROPS,
    draw(r, d, P, g) {
      dot(r, P[0], d.style.color);
      const last = g.bars.at(-1);
      if (last && d.pts[0].t <= last.time) drawProfile(r, d, g, barsIn(g, d.pts[0].t, last.time), P[0][0], g.x(last.time));
    },
  },
  range('pricerange', 'Price range', '⇕', true, false),
  range('daterange', 'Date range', '⇔', false, true),
  range('datepricerange', 'Date and price range', '⤡', true, true),
];
