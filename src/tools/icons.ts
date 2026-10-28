// Line icons (28×28, currentColor) for the drawing tools, cursors and the left toolbar's actions. Own drawings, made to
// read at a glance like the shapes they draw; an unknown id falls back to the tool's text glyph.

const P = (d: string, extra = '') => `<path d="${d}"${extra}/>`;
const dash = (d: string) => P(d, ' stroke-dasharray="2 2"');
const o = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.8"/>`;            // anchor point
const f = (x: number, y: number, r = 1.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const T = (x: number, y: number, s: string, size = 7) => `<text x="${x}" y="${y}" font-size="${size}" font-family="system-ui" fill="currentColor" stroke="none" text-anchor="middle">${s}</text>`;
const poly = (pts: [number, number][], dots = true) => P('M' + pts.map(p => p.join(' ')).join(' L')) + (dots ? pts.map(([x, y]) => o(x, y)).join('') : '');
const candle = (x: number, hi: number, top: number, bot: number, lo: number) => P(`M${x} ${hi}V${top}M${x} ${bot}V${lo}M${x - 2} ${top}h4v${bot - top}h-4z`);

const I: Record<string, string> = {
  // ---------- cursors ----------
  cross: P('M14 4V24M4 14H24'),
  magic: P('M14 6V22M6 14H22') + P('M21 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z'),
  dot: f(14, 14, 3),
  arrow: P('M9 5v16l4-4 3 7 2-1-3-7h6z'),
  demo: `<circle cx="14" cy="14" r="8"/>` + f(14, 14, 2.5),
  eraser: P('M5 19l9-11 9 7-6 7H10z M11 12l8 7 M10 22h14'),

  // ---------- lines ----------
  trend: P('M6 22L22 6') + o(6, 22) + o(22, 6),
  ray: P('M6 22L25 3') + o(6, 22) + o(14, 14),
  extended: P('M3 25L25 3') + o(10, 18) + o(18, 10),
  hline: P('M3 14H25') + o(14, 14),
  hray: P('M11 14H25') + o(11, 14),
  vline: P('M14 3V25') + o(14, 14),
  infoline: P('M5 21L17 9') + o(5, 21) + o(17, 9) + P('M15 17h9v7h-9z M17 20h5'),
  trendangle: P('M5 21L22 7M5 21H24') + P('M13 21a8 8 0 0 0-1.5-5') + o(22, 7),
  crossline: P('M14 3V25M3 14H25') + o(14, 14),
  parallel: P('M4 18L17 6M11 24L24 12') + o(4, 18) + o(17, 6) + o(24, 12),
  regression: P('M4 18L24 10') + dash('M4 12L24 4M4 24L24 16') + o(4, 18) + o(24, 10),
  flattop: P('M4 7H24M4 22L24 13') + o(4, 22) + o(24, 13) + o(14, 7),
  disjoint: P('M4 7L24 12M4 23L24 16') + o(4, 7) + o(24, 12) + o(4, 23),
  pitchfork: P('M3 22L13 15L25 7M8 10L24 0M18 20L25 15M8 10L18 20') + o(3, 22) + o(8, 10) + o(18, 20),
  schiff: P('M3 18L14 15L25 8M8 10L25 1M18 20L25 15M8 10L18 20') + o(3, 18) + o(8, 10) + o(18, 20),
  modschiff: P('M5 16L13 15L25 9M8 10L25 2M18 20L25 16M8 10L18 20') + o(5, 16) + o(8, 10) + o(18, 20),
  insidepitchfork: P('M3 22L13 15L25 7M8 10L24 0M18 20L25 15') + dash('M8 10L18 20') + o(3, 22) + o(8, 10) + o(18, 20),

  // ---------- gann & fibonacci ----------
  fib: P('M4 5H24M4 10H24M4 15H24M4 20H24M4 24H24') + dash('M6 24L22 5'),
  fibext: P('M3 22L9 10L15 18M11 5H25M11 10H25M11 15H25') + o(3, 22) + o(9, 10) + o(15, 18),
  fibchannel: P('M3 14L14 4M3 19L19 5M3 24L24 6M8 24L24 10') + o(3, 14) + o(14, 4),
  fibtimezone: P('M4 4V24M6 4V24M9 4V24M14 4V24M22 4V24'),
  fibspeedfan: P('M4 24L24 4M4 24L24 10M4 24L24 16M4 24L18 4M4 24L10 4') + P('M4 4V24H24'),
  trendfibtime: P('M4 22L12 8') + o(4, 22) + o(12, 8) + P('M15 4V24M18 4V24M23 4V24'),
  fibcircles: '<circle cx="14" cy="14" r="3"/><circle cx="14" cy="14" r="6.5"/><circle cx="14" cy="14" r="10"/>' + f(14, 14),
  fibspiral: P('M14 14c0-2 3-2 3 0s-3 4-6 2-2-7 3-8 9 3 8 8-6 9-11 7'),
  fibarcs: P('M4 22L24 22') + P('M10 22a6 6 0 0 1 12 0M6 22a10 10 0 0 1 20 0') + o(16, 22) + o(4, 10) + dash('M4 10L16 22'),
  fibwedge: P('M5 22L24 6M5 22L24 18') + P('M14 14a10 10 0 0 1 2 6M19 10a15 15 0 0 1 2.5 10') + o(5, 22),
  pitchfan: P('M4 20L24 4M4 20L24 10M4 20L24 16M4 20L24 22') + o(4, 20),
  gannbox: P('M4 4h20v20H4zM4 11h20M4 17h20M11 4v20M17 4v20') + dash('M4 24L24 4'),
  gannsquarefixed: P('M4 4h20v20H4zM4 24L24 4M4 4l20 20') + P('M14 4v20M4 14h20'),
  gannsquare: P('M4 4h20v20H4zM4 24L24 4M4 24L24 14M4 24L14 4'),
  gannfan: P('M4 24L24 4M4 24L24 9M4 24L24 15M4 24L19 4M4 24L13 4M4 24L24 20M4 24L8 4') + o(4, 24),

  // ---------- patterns ----------
  xabcd: poly([[3, 21], [8, 8], [13, 16], [19, 6], [25, 18]]) + dash('M3 21L13 16L25 18M8 8L19 6'),
  cypher: poly([[3, 20], [9, 9], [13, 15], [20, 5], [25, 19]]) + dash('M3 20L13 15M9 9L20 5'),
  headshoulders: P('M3 20L7 12L10 18L14 5L18 18L21 12L25 20') + dash('M10 18L18 18'),
  abcd: poly([[4, 21], [10, 8], [16, 15], [24, 4]]),
  trianglepattern: P('M3 6L25 13L3 22') + poly([[5, 9], [9, 19], [13, 11], [17, 16], [21, 13]], false),
  threedrives: P('M3 22L7 14L10 18L14 10L17 14L21 5L24 9') + o(7, 14) + o(14, 10) + o(21, 5),
  elliott12345: P('M3 22L7 14L10 18L17 6L20 11L25 4') + T(7, 11, '1', 6) + T(17, 4, '3', 6) + T(25, 3, '5', 6),
  elliottabc: P('M4 6L11 19L16 12L24 23') + T(11, 26, 'a', 6) + T(16, 10, 'b', 6) + T(24, 26, 'c', 6),
  elliottabcde: P('M3 4L7 22L11 8L15 19L19 11L24 16'),
  elliottwxy: P('M3 6L8 16L11 12L16 21L19 16L25 24') + o(8, 16) + o(16, 21),
  elliottwxyxz: P('M3 4L6 11L8 8L11 15L13 12L17 19L19 16L22 22L25 20'),
  cycliclines: P('M5 4V24M11 4V24M17 4V24M23 4V24'),
  timecycles: P('M2 20a5 5 0 0 1 10 0a5 5 0 0 1 10 0') + P('M2 20H26') + o(2, 20) + o(12, 20),
  sineline: P('M2 14c3-9 6-9 8 0s5 9 8 0 5-9 8 0'),

  // ---------- forecasting & measurement ----------
  long: P('M5 6h18v8H5z') + dash('M5 14h18v8H5z') + P('M14 13V8M11 10l3-3 3 3'),
  short: dash('M5 6h18v8H5z') + P('M5 14h18v8H5z') + P('M14 15v5M11 18l3 3 3-3'),
  forecast: P('M4 21L12 14') + dash('M12 14L23 7M12 14L23 18') + o(4, 21) + o(12, 14) + `<circle cx="23" cy="7" r="2.5"/>`,
  barspattern: candle(7, 8, 11, 18, 21) + candle(14, 5, 8, 15, 19) + candle(21, 10, 13, 20, 24),
  ghostfeed: candle(8, 9, 12, 19, 22) + `<g stroke-dasharray="1.5 1.5">${candle(15, 6, 9, 16, 19) + candle(22, 4, 7, 13, 16)}</g>`,
  projection: P('M5 22L14 10') + P('M14 10a12 12 0 0 1 9 6') + dash('M14 10L23 16') + o(5, 22) + o(14, 10),
  sector: P('M5 22L23 22M5 22L18 8') + P('M23 22a18 18 0 0 0-5-14') + o(5, 22),
  avwap: P('M4 18c4-8 7 0 10-5s6-6 10-7') + f(4, 18, 2) + dash('M4 22H24'),
  frvp: P('M4 4V24M24 4V24') + P('M5 7h6M5 10h10M5 13h16M5 16h11M5 19h7M5 22h4'),
  avp: P('M5 4V24') + f(5, 24, 2) + P('M6 8h7M6 11h11M6 14h16M6 17h10M6 20h6'),
  pricerange: P('M5 5H23M5 23H23M14 7V21M11 10l3-3 3 3M11 18l3 3 3-3'),
  daterange: P('M5 5V23M23 5V23M7 14H21M10 11l-3 3 3 3M18 11l3 3-3 3'),
  datepricerange: P('M5 5h18v18H5z') + P('M14 8V20M8 14H20M11 10l3-2 3 2M10 11l-2 3 2 3'),

  // ---------- geometric shapes ----------
  brush: P('M4 19c4-6 6 2 9-3s5-8 8-6 2 7 3 7'),
  highlighter: P('M4 19c4-6 6 2 9-3s5-8 8-6', ' stroke-width="4" stroke-opacity=".45"'),
  arrowline: P('M5 22L22 6M15 6h7v7'),
  arrowmarker: P('M5 21l9-9-3-3h11v11l-3-3-9 9z'),
  arrowmarkup: P('M14 5l7 8h-4v9h-6v-9H7z'),
  arrowmarkdown: P('M14 23l7-8h-4V6h-6v9H7z'),
  arrowmarkleft: P('M5 14l8-7v4h9v6h-9v4z'),
  arrowmarkright: P('M23 14l-8-7v4H6v6h9v4z'),
  rect: P('M5 7h18v14H5z') + o(5, 7) + o(23, 21),
  rotrect: P('M4 15L13 5l11 8-9 10z') + o(4, 15) + o(13, 5),
  path: P('M4 21L10 11L17 17L23 6') + P('M19 6h4v4') + o(4, 21) + o(10, 11) + o(17, 17),
  circle: '<circle cx="14" cy="14" r="9"/>' + o(14, 14) + o(23, 14),
  ellipse: '<ellipse cx="14" cy="14" rx="10" ry="6"/>' + o(4, 14) + o(24, 14),
  polyline: P('M4 20L9 8L16 15L24 6L22 22z') + o(4, 20) + o(9, 8) + o(16, 15),
  triangle: P('M14 5L24 22H4z') + o(14, 5) + o(24, 22) + o(4, 22),
  arc: P('M4 20a11 11 0 0 1 20 0') + o(4, 20) + o(24, 20) + o(14, 9),
  curve: P('M4 21C8 4 18 4 24 18') + o(4, 21) + o(24, 18),
  doublecurve: P('M3 16C6 4 11 4 14 14S22 24 25 12') + o(3, 16) + o(25, 12),

  // ---------- annotations ----------
  text: P('M7 7H21M14 7V22M11 22h6'),
  anchoredtext: P('M8 5H20M14 5V16') + f(14, 22, 2),
  note: P('M5 6h18v12h-9l-5 4v-4H5z M9 10h10M9 14h7'),
  anchorednote: P('M5 4h18v11h-9l-3 3v-3H5zM9 8h10M9 11h7') + f(11, 23, 2),
  pricenote: P('M4 20L12 12') + o(4, 20) + P('M12 8h12v8H12z M15 12h6'),
  pin: P('M14 24s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z') + '<circle cx="14" cy="12" r="2.5"/>',
  table: P('M4 6h20v16H4zM4 11h20M4 16h20M11 6v16M18 6v16'),
  callout: P('M8 5h15v10H13l-8 8 4-8H8z M11 9h9'),
  comment: P('M4 8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-9l-5 4v-4a3 3 0 0 1-3-3z'),
  pricelabel: P('M4 14l6-6h14v12H10z') + f(9, 14, 1.2),
  signpost: P('M13 24V4M13 6h9l3 3-3 3h-9M13 14H5l-2 3 2 3h8'),
  flagmark: P('M7 25V4M7 5h14l-3 5 3 5H7'),
  image: P('M4 6h20v16H4z') + P('M4 19l6-6 4 4 3-3 7 6') + '<circle cx="18" cy="10" r="1.8"/>',
  emoji: '<circle cx="14" cy="14" r="10"/>' + f(10.5, 11.5, 1.3) + f(17.5, 11.5, 1.3) + P('M9.5 16.5a5 5 0 0 0 9 0'),
  icon: P('M14 4l3 6.5 7 .8-5.2 4.8 1.4 7L14 19.6 7.8 23.1l1.4-7L4 11.3l7-.8z'),

  // ---------- toolbar actions ----------
  measure: P('M3 18L18 3l7 7-15 15z M7 14l2 2M10 11l3 3M13 8l2 2M16 5l3 3'),
  zoom: '<circle cx="12" cy="12" r="7"/>' + P('M17 17l7 7M9 12h6M12 9v6'),
  zoomout: '<circle cx="12" cy="12" r="7"/>' + P('M17 17l7 7M9 12h6'),
  magnet: P('M7 5v9a7 7 0 0 0 14 0V5h-4v9a3 3 0 0 1-6 0V5z M7 9h4M17 9h4'),
  keep: P('M5 23l1-5L18 6l4 4-12 12z M16 8l4 4') + P('M5 23h5'),
  lock: P('M7 13h14v11H7z M10 13V9a4 4 0 0 1 8 0v4') + f(14, 18, 1.4),
  hide: P('M3 14s4-7 11-7 11 7 11 7-4 7-11 7S3 14 3 14z') + '<circle cx="14" cy="14" r="3"/>',
  remove: P('M6 8h16M11 8V5h6v3M8 8l1 16h10l1-16M12 12v8M16 12v8'),
  favbar: P('M14 4l3 6.5 7 .8-5.2 4.8 1.4 7L14 19.6 7.8 23.1l1.4-7L4 11.3l7-.8z'),
};

const svg = (inner: string) => `<svg class="ti" viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const escText = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
/** The icon for a tool, cursor or toolbar action; `fallback` (the tool's text glyph) when there is none. */
export const iconSvg = (id: string, fallback = '') => svg(I[id] ?? T(14, 19, escText(fallback), 14));
export const hasIcon = (id: string) => id in I;
