// Technical indicator APIs: MQL4 (value at shift) and MQL5 (handles + CopyBuffer) over the shared Calc engine.
import { MqlArray, type Env, type Rt } from '../contract.ts';
import { Calc, IND, runOn } from './calc.ts';
import { num, val, str, isTime, idxAt, setErr, DBL_MAX, type Sources } from './util.ts';
import type { MqlParam } from './structs.ts';

export function installIndicators(rt: Rt, env: Env, srcs: Sources) {
  const m4 = env.dialect === 'mql4';
  const cache = new Map<string, Calc>();
  const warned = new Set<string>();
  const warn = (k: string, msg: string) => { if (!warned.has(k)) { warned.add(k); env.log('print', `warning: ${msg}`) } };
  const calc = (name: string, p: unknown[], sym: unknown, tf: unknown, ap = 0): Calc => {
    const ps = p.map(num), key = `${name}|${ps.join(',')}|${str(sym)}|${num(tf)}|${ap}`;
    let c = cache.get(key);
    if (!c) { c = new Calc(IND[name](...ps), srcs(sym, tf), ap); cache.set(key, c) }
    return c;
  };

  if (m4) {
    const v = (c: Calc, k: number, shift: unknown) => { const n = c.update(), x = c.at(k, n - num(shift), n); return Number.isNaN(x) ? 0 : x };
    type A = unknown;
    Object.assign(rt, {
      iMA: (s: A, tf: A, p: A, msh: A, m: A, ap: A, sh: A) => v(calc('ma', [p, msh, m], s, tf, num(ap)), 0, sh),
      iRSI: (s: A, tf: A, p: A, ap: A, sh: A) => v(calc('rsi', [p], s, tf, num(ap)), 0, sh),
      iMACD: (s: A, tf: A, f: A, sl: A, sg: A, ap: A, mode: A, sh: A) => v(calc('macd', [f, sl, sg], s, tf, num(ap)), num(mode) ? 1 : 0, sh),
      iOsMA: (s: A, tf: A, f: A, sl: A, sg: A, ap: A, sh: A) => v(calc('osma', [f, sl, sg], s, tf, num(ap)), 0, sh),
      iStochastic: (s: A, tf: A, K: A, D: A, sl: A, m: A, field: A, mode: A, sh: A) => v(calc('stoch', [K, D, sl, m, field], s, tf), num(mode) ? 1 : 0, sh),
      iBands: (s: A, tf: A, p: A, dev: A, bsh: A, ap: A, mode: A, sh: A) => v(calc('bands', [p, dev, bsh], s, tf, num(ap)), num(mode), sh),
      iATR: (s: A, tf: A, p: A, sh: A) => v(calc('atr', [p], s, tf), 0, sh),
      iCCI: (s: A, tf: A, p: A, ap: A, sh: A) => v(calc('cci', [p], s, tf, num(ap)), 0, sh),
      iMomentum: (s: A, tf: A, p: A, ap: A, sh: A) => v(calc('mom', [p], s, tf, num(ap)), 0, sh),
      iADX: (s: A, tf: A, p: A, _ap: A, mode: A, sh: A) => v(calc('adx', [p], s, tf), num(mode), sh),
      iEnvelopes: (s: A, tf: A, p: A, m: A, msh: A, ap: A, dev: A, mode: A, sh: A) => v(calc('env', [p, m, msh, dev], s, tf, num(ap)), num(mode) === 1 ? 0 : num(mode) === 2 ? 1 : 2, sh),
      iSAR: (s: A, tf: A, st: A, mx: A, sh: A) => v(calc('sar', [st, mx], s, tf), 0, sh),
      iStdDev: (s: A, tf: A, p: A, msh: A, m: A, ap: A, sh: A) => v(calc('stddev', [p, msh, m], s, tf, num(ap)), 0, sh),
      iWPR: (s: A, tf: A, p: A, sh: A) => v(calc('wpr', [p], s, tf), 0, sh),
      iDeMarker: (s: A, tf: A, p: A, sh: A) => v(calc('dem', [p], s, tf), 0, sh),
      iForce: (s: A, tf: A, p: A, m: A, ap: A, sh: A) => v(calc('force', [p, m], s, tf, num(ap)), 0, sh),
      iOBV: (s: A, tf: A, ap: A, sh: A) => v(calc('obv', [], s, tf, num(ap)), 0, sh),
      iMFI: (s: A, tf: A, p: A, sh: A) => v(calc('mfi', [p], s, tf), 0, sh),
      iBullsPower: (s: A, tf: A, p: A, ap: A, sh: A) => v(calc('bulls', [p], s, tf, num(ap)), 0, sh),
      iBearsPower: (s: A, tf: A, p: A, ap: A, sh: A) => v(calc('bears', [p], s, tf, num(ap)), 0, sh),
      iAO: (s: A, tf: A, sh: A) => v(calc('ao', [], s, tf), 0, sh),
      iAC: (s: A, tf: A, sh: A) => v(calc('ac', [], s, tf), 0, sh),
      iAlligator: (s: A, tf: A, jp: A, js: A, tp: A, ts: A, lp: A, ls: A, m: A, ap: A, mode: A, sh: A) => v(calc('gator', [jp, js, tp, ts, lp, ls, m], s, tf, num(ap)), Math.max(0, num(mode) - 1), sh),
      iFractals: (s: A, tf: A, mode: A, sh: A) => v(calc('fractals', [], s, tf), num(mode) === 2 ? 1 : 0, sh),
      iIchimoku: (s: A, tf: A, t: A, k: A, sn: A, mode: A, sh: A) => v(calc('ichi', [t, k, sn], s, tf), Math.max(0, num(mode) - 1), sh),
      iRVI: (s: A, tf: A, p: A, mode: A, sh: A) => v(calc('rvi', [p], s, tf), num(mode) ? 1 : 0, sh),
      iCustom: (_s: A, _tf: A, name: A) => { warn('ic' + str(name), `iCustom("${str(name)}"): custom indicators from other files are not supported yet; returning 0`); return 0 },
    });
    // *OnArray: the array is read with its logical indexing; shift i = logical element i (newest first for series).
    const onArr = (spec: string, p: unknown[], a: MqlArray<number>, total: unknown, k: number, shift: unknown) => {
      const T = num(total) > 0 ? Math.min(num(total), a.size) : a.size;
      const data = Array.from({ length: T }, (_, j) => a.get(T - 1 - j));
      const c = runOn(IND[spec](...p.map(num)), data), x = c.at(k, T - 1 - num(shift), T - 1);
      return Number.isNaN(x) ? 0 : x;
    };
    type N = MqlArray<number>;
    Object.assign(rt, {
      iMAOnArray: (a: N, t: A, p: A, msh: A, m: A, sh: A) => onArr('ma', [p, msh, m], a, t, 0, sh),
      iRSIOnArray: (a: N, t: A, p: A, sh: A) => onArr('rsi', [p], a, t, 0, sh),
      iBandsOnArray: (a: N, t: A, p: A, dev: A, bsh: A, mode: A, sh: A) => onArr('bands', [p, dev, bsh], a, t, num(mode), sh),
      iStdDevOnArray: (a: N, t: A, p: A, msh: A, m: A, sh: A) => onArr('stddev', [p, msh, m], a, t, 0, sh),
      iMomentumOnArray: (a: N, t: A, p: A, sh: A) => onArr('mom', [p], a, t, 0, sh),
      iCCIOnArray: (a: N, t: A, p: A, sh: A) => onArr('cci', [p], a, t, 0, sh),
      iEnvelopesOnArray: (a: N, t: A, p: A, m: A, msh: A, dev: A, mode: A, sh: A) => onArr('env', [p, m, msh, dev], a, t, num(mode) === 1 ? 0 : num(mode) === 2 ? 1 : 2, sh),
    });
    return;
  }

  // ---- MQL5: handles ----
  const handles = new Map<number, { c: Calc; map: number[] }>(), byKey = new Map<string, number>();
  let nextH = 10;
  const ap5 = (x: unknown) => { const v = num(x); return v >= 1 && v <= 7 ? v - 1 : 0 };
  const mk = (name: string, p: unknown[], sym: unknown, tf: unknown, ap: number, map: number[]) => {
    const c = calc(name, p, sym, tf, ap), key = `${name}|${p.map(num).join(',')}|${str(sym)}|${num(tf)}|${ap}`;
    const old = byKey.get(key); if (old != null && handles.has(old)) return old;
    const h = nextH++; handles.set(h, { c, map }); byKey.set(key, h); return h;
  };
  type A = unknown;
  const L1 = [0], L2 = [0, 1], L3 = [0, 1, 2];
  const fns: Record<string, (...a: A[]) => number> = {
    iMA: (s, tf, p, msh, m, ap) => mk('ma', [p, msh, m], s, tf, ap5(ap), L1),
    iRSI: (s, tf, p, ap) => mk('rsi', [p], s, tf, ap5(ap), L1),
    iMACD: (s, tf, f, sl, sg, ap) => mk('macd', [f, sl, sg], s, tf, ap5(ap), L2),
    iOsMA: (s, tf, f, sl, sg, ap) => mk('osma', [f, sl, sg], s, tf, ap5(ap), L1),
    iStochastic: (s, tf, K, D, sl, m, field) => mk('stoch', [K, D, sl, m, field], s, tf, 0, L2),
    iBands: (s, tf, p, bsh, dev, ap) => mk('bands', [p, dev, bsh], s, tf, ap5(ap), L3),
    iATR: (s, tf, p) => mk('atr', [p], s, tf, 0, L1),
    iCCI: (s, tf, p, ap) => mk('cci', [p], s, tf, ap5(ap), L1),
    iMomentum: (s, tf, p, ap) => mk('mom', [p], s, tf, ap5(ap), L1),
    iADX: (s, tf, p) => mk('adx', [p], s, tf, 0, L3),
    iADXWilder: (s, tf, p) => mk('adxw', [p], s, tf, 0, L3),
    iEnvelopes: (s, tf, p, msh, m, ap, dev) => mk('env', [p, m, msh, dev], s, tf, ap5(ap), L2),
    iSAR: (s, tf, st, mx) => mk('sar', [st, mx], s, tf, 0, L1),
    iStdDev: (s, tf, p, msh, m, ap) => mk('stddev', [p, msh, m], s, tf, ap5(ap), L1),
    iWPR: (s, tf, p) => mk('wpr', [p], s, tf, 0, L1),
    iDeMarker: (s, tf, p) => mk('dem', [p], s, tf, 0, L1),
    iForce: (s, tf, p, m) => mk('force', [p, m], s, tf, 0, L1),
    iOBV: (s, tf) => mk('obv', [], s, tf, 0, L1),
    iMFI: (s, tf, p) => mk('mfi', [p], s, tf, 0, L1),
    iBullsPower: (s, tf, p) => mk('bulls', [p], s, tf, 0, L1),
    iBearsPower: (s, tf, p) => mk('bears', [p], s, tf, 0, L1),
    iAO: (s, tf) => mk('ao', [], s, tf, 0, L2),
    iAC: (s, tf) => mk('ac', [], s, tf, 0, L2),
    iAlligator: (s, tf, jp, js, tp, ts, lp, ls, m, ap) => mk('gator', [jp, js, tp, ts, lp, ls, m], s, tf, ap5(ap), L3),
    iFractals: (s, tf) => mk('fractals', [], s, tf, 0, L2),
    iIchimoku: (s, tf, t, k, sn) => mk('ichi', [t, k, sn], s, tf, 0, [0, 1, 2, 3, 4]),
    iRVI: (s, tf, p) => mk('rvi', [p], s, tf, 0, L2),
    iVolumes: (s, tf) => mk('vol', [], s, tf, 0, L2),
    iAMA: (s, tf, p, f, sl, sh, ap) => mk('ama', [p, f, sl, sh], s, tf, ap5(ap), L1),
    iDEMA: (s, tf, p, sh, ap) => mk('dema', [p, sh], s, tf, ap5(ap), L1),
    iTEMA: (s, tf, p, sh, ap) => mk('tema', [p, sh], s, tf, ap5(ap), L1),
    iFrAMA: (s, tf, p, sh, ap) => mk('frama', [p, sh], s, tf, ap5(ap), L1),
    iVIDyA: (s, tf, cmo, ema, sh, ap) => mk('vidya', [cmo, ema, sh], s, tf, ap5(ap), L1),
    iTriX: (s, tf, p, ap) => mk('trix', [p], s, tf, ap5(ap), L1),
    iCustom: (_s, _tf, name) => { warn('ic' + str(name), `iCustom("${str(name)}"): custom indicators from other files are not supported yet; INVALID_HANDLE`); setErr(rt, 4802); return -1 },
  };
  Object.assign(rt, fns);
  const IND_FN: Record<string, string> = { AC: 'iAC', ADX: 'iADX', ADXW: 'iADXWilder', ALLIGATOR: 'iAlligator', AMA: 'iAMA', AO: 'iAO', ATR: 'iATR', BANDS: 'iBands', BEARS: 'iBearsPower', BULLS: 'iBullsPower', CCI: 'iCCI', DEMA: 'iDEMA', DEMARKER: 'iDeMarker', ENVELOPES: 'iEnvelopes', FORCE: 'iForce', FRACTALS: 'iFractals', FRAMA: 'iFrAMA', ICHIMOKU: 'iIchimoku', MA: 'iMA', MACD: 'iMACD', MFI: 'iMFI', MOMENTUM: 'iMomentum', OBV: 'iOBV', OSMA: 'iOsMA', RSI: 'iRSI', RVI: 'iRVI', SAR: 'iSAR', STDDEV: 'iStdDev', STOCHASTIC: 'iStochastic', TEMA: 'iTEMA', TRIX: 'iTriX', VIDYA: 'iVIDyA', VOLUMES: 'iVolumes', WPR: 'iWPR' };

  Object.assign(rt, {
    IndicatorCreate: (s: A, tf: A, type: A, cnt: A, params?: MqlArray<MqlParam>) => {
      const name = Object.keys(rt).find(k => k.startsWith('IND_') && rt[k] === num(type))?.slice(4) ?? '';
      const f = fns[IND_FN[name]];
      if (!f || name === 'CUSTOM') { warn('ind' + name, `IndicatorCreate(IND_${name}) is not supported`); return -1 }
      const ps: unknown[] = [];
      for (let i = 0; i < Math.min(num(cnt), params?.size ?? 0); i++) {
        const p = params!.get(i);
        ps.push(p.type === rt.TYPE_DOUBLE || p.type === rt.TYPE_FLOAT ? p.double_value : p.type === rt.TYPE_STRING ? p.string_value : p.integer_value);
      }
      return f(s, tf, ...ps);
    },
    IndicatorRelease: (h: A) => handles.delete(num(h)),
    BarsCalculated: (h: A) => { const H = handles.get(num(h)); return H ? H.c.update() + 1 : -1 },
    CopyBuffer: (h: A, buf: A, start: A, count: A, out: MqlArray<number>) => {
      const H = handles.get(num(h)), b = num(buf);
      if (!H) { setErr(rt, 4807); return -1 }
      if (b < 0 || b >= H.map.length) { setErr(rt, 4602); return -1 }
      const k = H.map[b], c = H.c, n = c.update(), s = c.src, st = val(start), ct = val(count);
      let lo: number, hi: number;
      if (isTime(st)) {
        if (isTime(ct)) { const a = Math.min(num(st), num(ct)), z = Math.max(num(st), num(ct)); hi = idxAt(s, z); lo = idxAt(s, a - 1) + 1 }
        else { hi = idxAt(s, num(st)); lo = hi - num(ct) + 1 }
      } else { hi = n - num(st); lo = hi - num(ct) + 1 }
      hi = Math.min(hi, n + Math.max(0, c.spec.shift?.[k] ?? 0)); lo = Math.max(0, lo);
      if (hi < lo || n < 0) { setErr(rt, 4806); return -1 }
      const vals: number[] = [];
      for (let i = lo; i <= hi; i++) { const x = c.at(k, i, n); vals.push(Number.isNaN(x) ? DBL_MAX : x) }
      return fillOut(out, vals);
    },
  });
}

/** Store chronological values into a Copy* destination (dynamic arrays are resized; series flag maps index 0 to newest). */
export function fillOut<T>(out: MqlArray<T>, vals: T[]): number {
  if (!out.fixed) { out.data = vals; return vals.length }
  const m = Math.min(out.data.length, vals.length);
  for (let i = 0; i < m; i++) out.data[i] = vals[vals.length - m + i];
  return m;
}
