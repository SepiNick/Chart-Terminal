// Incremental, lookahead-free technical indicator engine shared by the MQL4 (value-at-shift) and MQL5 (handle +
// CopyBuffer) APIs. Each indicator is a stepper that computes index i from bars[0..i] and earlier outputs only.
// Indices < cur are final and cached; index cur (the forming bar) is recomputed on every request.
import type { Bar } from '../../data.ts';
import type { Src } from './util.ts';

type F = (i: number) => number;
export interface Ctx { bar(i: number): Bar; o: number[][]; x: F }
export interface Spec { outs: number; step(c: Ctx, i: number): void; begin?: number[]; shift?: number[] }

/** Applied price, MQL4 numbering (PRICE_CLOSE=0 … PRICE_WEIGHTED=6). */
function price(b: Bar, ap: number): number {
  switch (ap) {
    case 1: return b.open; case 2: return b.high; case 3: return b.low;
    case 4: return (b.high + b.low) / 2; case 5: return (b.high + b.low + b.close) / 3; case 6: return (b.high + b.low + 2 * b.close) / 4;
    default: return b.close;
  }
}

export class Calc {
  spec: Spec; src: Src; o: number[][]; done = 0; c: Ctx;
  constructor(spec: Spec, src: Src, ap: number) {
    this.spec = spec; this.src = src;
    this.o = Array.from({ length: spec.outs }, () => []);
    this.c = { bar: i => src.bar(i), o: this.o, x: i => { const b = src.bar(i); return b ? price(b, ap) : NaN } };
  }
  /** Bring outputs up to the current bar; returns the current index. */
  update(): number {
    const n = this.src.cur();
    for (let i = Math.min(this.done, n); i <= n; i++) if (i >= 0) this.spec.step(this.c, i);
    this.done = Math.max(0, n);
    return n;
  }
  /** Output k at chronological index idx (after display shift); NaN if unavailable. */
  at(k: number, idx: number, n: number): number {
    const j = idx - (this.spec.shift?.[k] ?? 0);
    if (j < 0 || j > n || j < (this.spec.begin?.[k] ?? 0)) return NaN;
    const v = this.o[k][j];
    return v ?? NaN;
  }
}

const g = (a: number[], i: number) => (i >= 0 ? a[i] ?? NaN : NaN);
const sum = (x: F, n: number, i: number) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += x(j); return s };
const smaAt = (x: F, n: number, i: number) => (i < n - 1 || n < 1 ? NaN : sum(x, n, i) / n);
const lwmaAt = (x: F, n: number, i: number) => { if (i < n - 1 || n < 1) return NaN; let s = 0, w = 0; for (let k = 0; k < n; k++) { s += x(i - k) * (n - k); w += n - k } return s / w };
/** One MA step for method m (0 SMA, 1 EMA, 2 SMMA, 3 LWMA); `o` is the MA's own output (for recursive methods). */
function maAt(m: number, n: number, x: F, o: number[], i: number): number {
  if (m === 1) { const v = x(i), p = g(o, i - 1), k = 2 / (n + 1); return Number.isNaN(v) ? NaN : Number.isNaN(p) ? v : v * k + p * (1 - k) }
  if (m === 2) { const p = g(o, i - 1); return Number.isNaN(p) ? smaAt(x, n, i) : (p * (n - 1) + x(i)) / n }
  if (m === 3) return lwmaAt(x, n, i);
  return smaAt(x, n, i);
}
const maxOf = (x: F, n: number, i: number) => { let r = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) r = Math.max(r, x(j)); return r };
const minOf = (x: F, n: number, i: number) => { let r = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) r = Math.min(r, x(j)); return r };
const arr = (o: number[]): F => i => g(o, i);
const tr = (c: Ctx, i: number) => { const b = c.bar(i); if (!i) return b.high - b.low; const pc = c.bar(i - 1).close; return Math.max(b.high, pc) - Math.min(b.low, pc) };

const hi: (c: Ctx) => F = c => i => c.bar(i).high, lo: (c: Ctx) => F = c => i => c.bar(i).low;
const med = (c: Ctx, i: number) => (c.bar(i).high + c.bar(i).low) / 2;
/** Close location value × volume (one A/D step). */
const clv = (b: Bar) => (b.high > b.low ? ((b.close - b.low) - (b.high - b.close)) / (b.high - b.low) * b.volume : 0);

export const IND: Record<string, (...p: number[]) => Spec> = {
  ma: (n, sh = 0, m = 0) => ({ outs: 1, begin: [n - 1], shift: [sh], step: (c, i) => { c.o[0][i] = maAt(m, n, c.x, c.o[0], i) } }),
  rsi: n => ({
    outs: 3, begin: [n],
    step: (c, i) => {
      const [r, up, dn] = c.o;
      const d = (j: number) => (j > 0 ? c.x(j) - c.x(j - 1) : NaN);
      up[i] = maAt(2, n, j => Math.max(d(j), 0), up, i); dn[i] = maAt(2, n, j => Math.max(-d(j), 0), dn, i);
      r[i] = Number.isNaN(up[i]) ? NaN : dn[i] !== 0 ? 100 - 100 / (1 + up[i] / dn[i]) : up[i] !== 0 ? 100 : 50;
    },
  }),
  macd: (f, s, sg) => ({
    outs: 4, begin: [s - 1, s + sg - 2],
    step: (c, i) => { const [m, sig, ef, es] = c.o; ef[i] = maAt(1, f, c.x, ef, i); es[i] = maAt(1, s, c.x, es, i); m[i] = ef[i] - es[i]; sig[i] = smaAt(arr(m), sg, i) },
  }),
  osma: (f, s, sg) => {
    const mc = IND.macd(f, s, sg);
    return { outs: 5, begin: [s + sg - 2], step: (c, i) => { const sub: Ctx = { ...c, o: c.o.slice(1) }; mc.step(sub, i); c.o[0][i] = c.o[1][i] - c.o[2][i] } };
  },
  stoch: (K, D, sl, m = 0, field = 0) => ({
    outs: 4, begin: [K + sl - 2, K + sl + D - 3],
    step: (c, i) => {
      const [main, sig, ll, hh] = c.o, cl: F = j => c.bar(j).close;
      ll[i] = i >= K - 1 ? minOf(field ? cl : lo(c), K, i) : NaN; hh[i] = i >= K - 1 ? maxOf(field ? cl : hi(c), K, i) : NaN;
      let num = 0, den = 0;
      for (let j = i - sl + 1; j <= i; j++) { num += cl(j) - g(ll, j); den += g(hh, j) - g(ll, j) }
      main[i] = Number.isNaN(num + den) || i < K + sl - 2 ? NaN : den === 0 ? 100 : (100 * num) / den;
      sig[i] = maAt(m, D, arr(main), sig, i);
    },
  }),
  bands: (n, dev, sh = 0) => ({
    outs: 3, begin: [n - 1, n - 1, n - 1], shift: [sh, sh, sh],
    step: (c, i) => {
      if (i < n - 1) { c.o[0][i] = c.o[1][i] = c.o[2][i] = NaN; return }
      const m = smaAt(c.x, n, i); let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (c.x(j) - m) ** 2;
      const sd = Math.sqrt(s / n);
      c.o[0][i] = m; c.o[1][i] = m + dev * sd; c.o[2][i] = m - dev * sd;
    },
  }),
  atr: n => ({ outs: 2, begin: [n - 1], step: (c, i) => { c.o[1][i] = tr(c, i); c.o[0][i] = smaAt(arr(c.o[1]), n, i) } }),
  cci: n => ({
    outs: 1, begin: [n - 1],
    step: (c, i) => {
      if (i < n - 1) { c.o[0][i] = NaN; return }
      const m = smaAt(c.x, n, i); let d = 0;
      for (let j = i - n + 1; j <= i; j++) d += Math.abs(c.x(j) - m);
      d = (d / n) * 0.015;
      c.o[0][i] = Number.isNaN(m) ? NaN : d === 0 ? 0 : (c.x(i) - m) / d;
    },
  }),
  mom: n => ({ outs: 1, begin: [n], step: (c, i) => { c.o[0][i] = i >= n ? (c.x(i) * 100) / c.x(i - n) : NaN } }),
  adx: n => ({
    outs: 6, begin: [n, n, n],
    step: (c, i) => {
      const [adx, pdi, ndi, pr, nr, dx] = c.o;
      if (i === 0) { pr[i] = nr[i] = NaN } else {
        const b = c.bar(i), p = c.bar(i - 1);
        let up = b.high - p.high, dn = p.low - b.low;
        if (up < 0) up = 0; if (dn < 0) dn = 0;
        if (up > dn) dn = 0; else if (up < dn) up = 0; else up = dn = 0;
        const t = Math.max(b.high, p.close) - Math.min(b.low, p.close);
        pr[i] = t ? (100 * up) / t : 0; nr[i] = t ? (100 * dn) / t : 0;
      }
      pdi[i] = maAt(1, n, arr(pr), pdi, i); ndi[i] = maAt(1, n, arr(nr), ndi, i);
      const s = pdi[i] + ndi[i];
      dx[i] = Number.isNaN(s) ? NaN : s ? (100 * Math.abs(pdi[i] - ndi[i])) / s : 0;
      adx[i] = maAt(1, n, arr(dx), adx, i);
    },
  }),
  adxw: n => ({
    outs: 10, begin: [2 * n, n, n],
    step: (c, i) => {
      const [adx, pdi, ndi, trr, pdm, ndm, ts, ps, ns, dx] = c.o;
      if (i === 0) { trr[i] = pdm[i] = ndm[i] = NaN } else {
        const b = c.bar(i), p = c.bar(i - 1), up = b.high - p.high, dn = p.low - b.low;
        pdm[i] = up > dn && up > 0 ? up : 0; ndm[i] = dn > up && dn > 0 ? dn : 0; trr[i] = tr(c, i);
      }
      ts[i] = maAt(2, n, arr(trr), ts, i); ps[i] = maAt(2, n, arr(pdm), ps, i); ns[i] = maAt(2, n, arr(ndm), ns, i);
      pdi[i] = ts[i] ? (100 * ps[i]) / ts[i] : 0; ndi[i] = ts[i] ? (100 * ns[i]) / ts[i] : 0;
      if (Number.isNaN(ts[i])) pdi[i] = ndi[i] = NaN;
      const s = pdi[i] + ndi[i];
      dx[i] = Number.isNaN(s) ? NaN : s ? (100 * Math.abs(pdi[i] - ndi[i])) / s : 0;
      adx[i] = maAt(2, n, arr(dx), adx, i);
    },
  }),
  env: (n, m, sh, dev) => ({
    outs: 3, begin: [n - 1, n - 1, n - 1], shift: [sh, sh, sh],
    step: (c, i) => { const v = (c.o[2][i] = maAt(m, n, c.x, c.o[2], i)); c.o[0][i] = v * (1 + dev / 100); c.o[1][i] = v * (1 - dev / 100) },
  }),
  sar: (st, mx) => ({
    outs: 4, begin: [1],
    step: (c, i) => {
      const [sar, ep, af, tr_] = c.o, b = c.bar(i);
      if (i === 0) { sar[i] = ep[i] = af[i] = tr_[i] = NaN; return }
      if (i === 1) {
        const p = c.bar(0), up = b.close >= p.close;
        tr_[i] = up ? 1 : -1; sar[i] = up ? Math.min(p.low, b.low) : Math.max(p.high, b.high); ep[i] = up ? Math.max(p.high, b.high) : Math.min(p.low, b.low); af[i] = st; return;
      }
      const up = tr_[i - 1] > 0, p1 = c.bar(i - 1), p2 = c.bar(i - 2);
      let s = sar[i - 1] + af[i - 1] * (ep[i - 1] - sar[i - 1]), e = ep[i - 1], a = af[i - 1], t = tr_[i - 1];
      if (up) {
        s = Math.min(s, p1.low, p2.low);
        if (b.low < s) { t = -1; s = e; e = b.low; a = st }
        else if (b.high > e) { e = b.high; a = Math.min(a + st, mx) }
      } else {
        s = Math.max(s, p1.high, p2.high);
        if (b.high > s) { t = 1; s = e; e = b.high; a = st }
        else if (b.low < e) { e = b.low; a = Math.min(a + st, mx) }
      }
      sar[i] = s; ep[i] = e; af[i] = a; tr_[i] = t;
    },
  }),
  stddev: (n, sh = 0, m = 0) => ({
    outs: 2, begin: [n - 1], shift: [sh],
    step: (c, i) => { const v = (c.o[1][i] = maAt(m, n, c.x, c.o[1], i)); if (i < n - 1) { c.o[0][i] = NaN; return } let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c.x(j) - v) ** 2; c.o[0][i] = Math.sqrt(s / n) },
  }),
  wpr: n => ({
    outs: 1, begin: [n - 1],
    step: (c, i) => { if (i < n - 1) { c.o[0][i] = NaN; return } const h = maxOf(hi(c), n, i), l = minOf(lo(c), n, i); c.o[0][i] = h !== l ? (-100 * (h - c.bar(i).close)) / (h - l) : g(c.o[0], i - 1) || 0 },
  }),
  dem: n => ({
    outs: 3, begin: [n],
    step: (c, i) => {
      const [d, mx, mn] = c.o;
      if (i === 0) { mx[i] = mn[i] = NaN } else { const b = c.bar(i), p = c.bar(i - 1); mx[i] = b.high > p.high ? b.high - p.high : 0; mn[i] = b.low < p.low ? p.low - b.low : 0 }
      const a = smaAt(arr(mx), n, i), z = smaAt(arr(mn), n, i);
      d[i] = Number.isNaN(a + z) ? NaN : a + z ? a / (a + z) : 0;
    },
  }),
  force: (n, m) => ({ outs: 2, begin: [n], step: (c, i) => { const v = (c.o[1][i] = maAt(m, n, c.x, c.o[1], i)); c.o[0][i] = (v - g(c.o[1], i - 1)) * c.bar(i).volume } }),
  obv: () => ({ outs: 1, step: (c, i) => { const v = c.bar(i).volume; c.o[0][i] = i ? c.o[0][i - 1] + (c.x(i) > c.x(i - 1) ? v : c.x(i) < c.x(i - 1) ? -v : 0) : v } }),
  mfi: n => ({
    outs: 1, begin: [n],
    step: (c, i) => {
      if (i < n) { c.o[0][i] = NaN; return }
      const tp = (j: number) => price(c.bar(j), 5); let p = 0, q = 0;
      for (let j = i - n + 1; j <= i; j++) { const t = tp(j), f = t * c.bar(j).volume; if (t > tp(j - 1)) p += f; else if (t < tp(j - 1)) q += f }
      c.o[0][i] = q ? 100 - 100 / (1 + p / q) : 100;
    },
  }),
  bulls: n => ({ outs: 2, begin: [n - 1], step: (c, i) => { c.o[1][i] = maAt(1, n, c.x, c.o[1], i); c.o[0][i] = c.bar(i).high - c.o[1][i] } }),
  bears: n => ({ outs: 2, begin: [n - 1], step: (c, i) => { c.o[1][i] = maAt(1, n, c.x, c.o[1], i); c.o[0][i] = c.bar(i).low - c.o[1][i] } }),
  ao: () => ({ outs: 2, begin: [33, 34], step: (c, i) => { const m: F = j => med(c, j); const v = (c.o[0][i] = smaAt(m, 5, i) - smaAt(m, 34, i)); c.o[1][i] = v >= g(c.o[0], i - 1) ? 0 : 1 } }),
  ac: () => ({
    outs: 3, begin: [37, 38],
    step: (c, i) => { const m: F = j => med(c, j); c.o[2][i] = smaAt(m, 5, i) - smaAt(m, 34, i); const v = (c.o[0][i] = c.o[2][i] - smaAt(arr(c.o[2]), 5, i)); c.o[1][i] = v >= g(c.o[0], i - 1) ? 0 : 1 },
  }),
  gator: (jp, js, tp, ts, lp, ls, m) => ({
    outs: 3, begin: [jp - 1, tp - 1, lp - 1], shift: [js, ts, ls],
    step: (c, i) => { c.o[0][i] = maAt(m, jp, c.x, c.o[0], i); c.o[1][i] = maAt(m, tp, c.x, c.o[1], i); c.o[2][i] = maAt(m, lp, c.x, c.o[2], i) },
  }),
  // Accumulation/Distribution: running sum of the close location value × volume.
  ad: () => ({ outs: 1, step: (c, i) => { c.o[0][i] = (i ? g(c.o[0], i - 1) : 0) + clv(c.bar(i)) } }),
  // Chaikin oscillator: MA(AD, fast) − MA(AD, slow) with method m.
  chaikin: (f, s, m = 1) => ({
    outs: 4, begin: [Math.max(f, s) - 1],
    step: (c, i) => { const [o, ad, a, b] = c.o; ad[i] = (i ? g(ad, i - 1) : 0) + clv(c.bar(i)); a[i] = maAt(m, f, arr(ad), a, i); b[i] = maAt(m, s, arr(ad), b, i); o[i] = a[i] - b[i] },
  }),
  // Bill Williams Market Facilitation Index (high − low) / volume; colour 0 green (MFI↑ vol↑), 1 fade (↓↓), 2 fake (MFI↑ vol↓), 3 squat (MFI↓ vol↑).
  bwmfi: () => ({
    outs: 2,
    step: (c, i) => {
      const b = c.bar(i), v = b.volume, m = (c.o[0][i] = v ? (b.high - b.low) / v : g(c.o[0], i - 1) || 0);
      if (!i) { c.o[1][i] = 0; return }
      const up = m > c.o[0][i - 1], vu = v > c.bar(i - 1).volume;
      c.o[1][i] = up ? (vu ? 0 : 2) : vu ? 3 : 1;
    },
  }),
  // Gator oscillator: |jaw − teeth| above zero, −|teeth − lips| below, using the Alligator lines as displayed (shifted).
  gatorosc: (jp, js, tp, ts, lp, ls, m) => ({
    outs: 7, begin: [Math.max(jp - 1 + js, tp - 1 + ts), 0, Math.max(tp - 1 + ts, lp - 1 + ls)],
    step: (c, i) => {
      const [up, uc, lo, lc, jaw, teeth, lips] = c.o;
      jaw[i] = maAt(m, jp, c.x, jaw, i); teeth[i] = maAt(m, tp, c.x, teeth, i); lips[i] = maAt(m, lp, c.x, lips, i);
      up[i] = Math.abs(g(jaw, i - js) - g(teeth, i - ts)); lo[i] = -Math.abs(g(teeth, i - ts) - g(lips, i - ls));
      uc[i] = up[i] >= g(up, i - 1) || Number.isNaN(g(up, i - 1)) ? 0 : 1;
      lc[i] = -lo[i] >= -g(lo, i - 1) || Number.isNaN(g(lo, i - 1)) ? 0 : 1;
    },
  }),
  fractals: () => ({
    outs: 2,
    step: (c, i) => {
      c.o[0][i] = c.o[1][i] = NaN;
      if (i < 4) return;
      const j = i - 2, h = (k: number) => c.bar(k).high, l = (k: number) => c.bar(k).low;
      c.o[0][j] = h(j) > h(j + 1) && h(j) > h(j + 2) && h(j) >= h(j - 1) && h(j) >= h(j - 2) ? h(j) : NaN;
      c.o[1][j] = l(j) < l(j + 1) && l(j) < l(j + 2) && l(j) <= l(j - 1) && l(j) <= l(j - 2) ? l(j) : NaN;
    },
  }),
  ichi: (t, k, s) => ({
    outs: 5, begin: [t - 1, k - 1, Math.max(t, k) - 1, s - 1, 0], shift: [0, 0, k, k, -k],
    step: (c, i) => {
      const mid = (n: number) => (i >= n - 1 ? (maxOf(hi(c), n, i) + minOf(lo(c), n, i)) / 2 : NaN);
      c.o[0][i] = mid(t); c.o[1][i] = mid(k); c.o[2][i] = (c.o[0][i] + c.o[1][i]) / 2; c.o[3][i] = mid(s); c.o[4][i] = c.bar(i).close;
    },
  }),
  rvi: n => ({
    outs: 4, begin: [n + 2, n + 5],
    step: (c, i) => {
      const [r, sg, nu, de] = c.o;
      if (i < 3) { nu[i] = de[i] = r[i] = sg[i] = NaN; return }
      const co = (j: number) => c.bar(j).close - c.bar(j).open, hl = (j: number) => c.bar(j).high - c.bar(j).low;
      nu[i] = (co(i) + 2 * co(i - 1) + 2 * co(i - 2) + co(i - 3)) / 6; de[i] = (hl(i) + 2 * hl(i - 1) + 2 * hl(i - 2) + hl(i - 3)) / 6;
      const a = sum(arr(nu), n, i), b = sum(arr(de), n, i);
      r[i] = i < n + 2 ? NaN : b ? a / b : a;
      sg[i] = (r[i] + 2 * g(r, i - 1) + 2 * g(r, i - 2) + g(r, i - 3)) / 6;
    },
  }),
  vol: () => ({ outs: 2, step: (c, i) => { const v = (c.o[0][i] = c.bar(i).volume); c.o[1][i] = i && v < c.o[0][i - 1] ? 1 : 0 } }),
  ama: (n, fast, slow, sh = 0) => ({
    outs: 1, begin: [n], shift: [sh],
    step: (c, i) => {
      if (i < n) { c.o[0][i] = i === n - 1 ? c.x(i) : NaN; return }
      let v = 0; for (let j = i - n + 1; j <= i; j++) v += Math.abs(c.x(j) - c.x(j - 1));
      const er = v ? Math.abs(c.x(i) - c.x(i - n)) / v : 0, f = 2 / (fast + 1), s = 2 / (slow + 1), sc = (er * (f - s) + s) ** 2;
      const p = c.o[0][i - 1]; c.o[0][i] = p + sc * (c.x(i) - p);
    },
  }),
  dema: (n, sh = 0) => ({ outs: 3, begin: [2 * n - 2], shift: [sh], step: (c, i) => { const [d, a, b] = c.o; a[i] = maAt(1, n, c.x, a, i); b[i] = maAt(1, n, arr(a), b, i); d[i] = 2 * a[i] - b[i] } }),
  tema: (n, sh = 0) => ({ outs: 4, begin: [3 * n - 3], shift: [sh], step: (c, i) => { const [t, a, b, e] = c.o; a[i] = maAt(1, n, c.x, a, i); b[i] = maAt(1, n, arr(a), b, i); e[i] = maAt(1, n, arr(b), e, i); t[i] = 3 * a[i] - 3 * b[i] + e[i] } }),
  trix: n => ({ outs: 4, begin: [3 * n - 2], step: (c, i) => { const [t, a, b, e] = c.o; a[i] = maAt(1, n, c.x, a, i); b[i] = maAt(1, n, arr(a), b, i); e[i] = maAt(1, n, arr(b), e, i); const p = g(e, i - 1); t[i] = p ? (e[i] - p) / p : NaN } }),
  frama: (n, sh = 0) => ({
    outs: 1, begin: [2 * n - 1], shift: [sh],
    step: (c, i) => {
      if (i < 2 * n - 1) { c.o[0][i] = NaN; return }
      const H = hi(c), L = lo(c);
      const n1 = (maxOf(H, n, i) - minOf(L, n, i)) / n, n2 = (maxOf(H, n, i - n) - minOf(L, n, i - n)) / n, n3 = (maxOf(H, 2 * n, i) - minOf(L, 2 * n, i)) / (2 * n);
      const d = n1 + n2 > 0 && n3 > 0 ? (Math.log(n1 + n2) - Math.log(n3)) / Math.LN2 : 1;
      const a = Math.min(1, Math.max(0.01, Math.exp(-4.6 * (d - 1)))), p = g(c.o[0], i - 1);
      c.o[0][i] = Number.isNaN(p) ? c.x(i) : a * c.x(i) + (1 - a) * p;
    },
  }),
  vidya: (cmo, ema, sh = 0) => ({
    outs: 1, begin: [cmo], shift: [sh],
    step: (c, i) => {
      if (i < cmo) { c.o[0][i] = i === cmo - 1 ? c.x(i) : NaN; return }
      let u = 0, d = 0; for (let j = i - cmo + 1; j <= i; j++) { const x = c.x(j) - c.x(j - 1); if (x > 0) u += x; else d -= x }
      const k = (u + d ? Math.abs(u - d) / (u + d) : 0) * (2 / (ema + 1)), p = c.o[0][i - 1];
      c.o[0][i] = c.x(i) * k + p * (1 - k);
    },
  }),
};

/** Run a spec over a plain chronological series (for the MQL4 *OnArray functions). */
export function runOn(spec: Spec, data: number[]): Calc {
  const bar = (i: number): Bar => { const v = data[i]; return { time: 0, open: v, high: v, low: v, close: v, volume: 0 } };
  const c = new Calc(spec, { bar, cur: () => data.length - 1, time: () => 0 }, 0);
  c.update();
  return c;
}
