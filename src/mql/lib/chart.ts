// Chart objects (both MQL4 and MQL5 signatures) → env.objects, plus harmless chart stubs.
import type { Env, Rt } from '../contract.ts';
import { num, put, str, val, setErr, secToTf } from './util.ts';

export function installChart(rt: Rt, env: Env) {
  const m4 = env.dialect === 'mql4';
  const objs = env.objects;
  // property id → canonical key (OBJPROP_COLOR → 'color')
  let names: Map<number, string> | null = null;
  const key = (id: number) => {
    if (!names) { names = new Map(); for (const k of Object.keys(rt)) if (k.startsWith('OBJPROP_') && !/^OBJPROP_(TIME|PRICE)\d$/.test(k) && !names.has(rt[k] as number)) names.set(rt[k] as number, k.slice(8).toLowerCase()) }
    return names.get(id) ?? `p${id}`;
  };
  const errNF = () => setErr(rt, m4 ? 4202 : 4202);
  /** Normalise (chart_id, name, …) vs MQL4 (name, …) argument lists. */
  const split = (a: unknown[]): [string, unknown[]] => (typeof val(a[0]) === 'string' ? [str(a[0]), a.slice(1)] : [str(a[1]), a.slice(2)]);
  const point = (id: number, mod: number): ['t' | 'p', number] | null => (id >= 0 && id <= 5 ? [id % 2 ? 'p' : 't', (id >> 1) + mod] : null);
  const set = (name: string, id: number, mod: number, v: unknown) => {
    const o = objs.get(name); if (!o) { errNF(); return false }
    const pt = point(id, mod);
    if (pt) { (pt[0] === 't' ? o.time : o.price)[pt[1]] = num(v); return true }
    if (id >= 210 && id < 242) { ((o.props.levelvalue ??= []) as number[])[id - 210] = num(v); return true }
    const k = key(id);
    if (['levelvalue', 'levelcolor', 'levelstyle', 'levelwidth', 'leveltext'].includes(k)) { ((o.props[k] ??= []) as unknown[])[mod] = val(v); return true }
    o.props[k] = val(v); return true;
  };
  const get = (name: string, id: number, mod: number): unknown => {
    const o = objs.get(name); if (!o) { errNF(); return undefined }
    const pt = point(id, mod);
    if (pt) return (pt[0] === 't' ? o.time : o.price)[pt[1]] ?? 0;
    if (id >= 210 && id < 242) return (o.props.levelvalue as number[] | undefined)?.[id - 210] ?? 0;
    const k = key(id), v = o.props[k];
    if (k === 'type') return o.type;
    if (k === 'name') return o.name;
    return Array.isArray(v) ? v[mod] : v;
  };
  const create = (name: string, type: number, win: number, pts: unknown[]) => {
    if (objs.has(name)) { setErr(rt, m4 ? 4200 : 4201); return false }
    const time: number[] = [], price: number[] = [];
    for (let i = 0; i < pts.length; i += 2) { time.push(num(pts[i])); price.push(num(pts[i + 1])) }
    objs.set(name, { name, type: num(type), window: num(win), time, price, props: { color: type === 23 || type === 21 ? 0xffffff : 0xff0000, width: 1, style: 0, createtime: env.now() } });
    return true;
  };
  const filt = (win: unknown, type: unknown, prefix = '') => [...objs.values()].filter(o => (num(win) < 0 || win === undefined || o.window === num(win)) && (num(type) < 0 || type === undefined || o.type === num(type)) && o.name.startsWith(prefix));

  Object.assign(rt, {
    ObjectCreate: (...a: unknown[]) => {
      if (typeof val(a[0]) === 'string') return create(str(a[0]), num(a[1]), num(a[2]), a.slice(3));
      return create(str(a[1]), num(a[2]), num(a[3]), a.slice(4));
    },
    ObjectDelete: (...a: unknown[]) => { const [n] = split(a); const ok = objs.delete(n); if (!ok) errNF(); return ok },
    ObjectsDeleteAll: (...a: unknown[]) => {
      let list;
      if (typeof val(a[1]) === 'string') list = filt(a[2] ?? -1, a[3] ?? -1, str(a[1]));
      else if (a.length >= 3 || !m4) list = filt(a[1] ?? -1, a[2] ?? -1);
      else list = filt(a[0] ?? -1, a[1] ?? -1);
      for (const o of list) objs.delete(o.name);
      return list.length;
    },
    ObjectFind: (...a: unknown[]) => { const [n] = split(a); const o = objs.get(n); return o ? o.window : -1 },
    ObjectsTotal: (...a: unknown[]) => (m4 && a.length <= 1 ? filt(-1, a[0] ?? -1) : filt(a[1] ?? -1, a[2] ?? -1)).length,
    ObjectName: (...a: unknown[]) => { const list = m4 && a.length <= 1 ? filt(-1, -1) : filt(a[2] ?? -1, a[3] ?? -1), i = num(m4 && a.length <= 1 ? a[0] : a[1]); return list[i]?.name ?? '' },
    ObjectType: (n: unknown) => objs.get(str(n))?.type ?? -1,
    ObjectSet: (n: unknown, id: number, v: unknown) => set(str(n), num(id), 0, v),
    ObjectGet: (n: unknown, id: number) => num(get(str(n), num(id), 0) ?? 0),
    ObjectSetText: (n: unknown, text: unknown, size = 0, font = '', clr = -1) => {
      const o = objs.get(str(n)); if (!o) { errNF(); return false }
      o.props.text = str(text); if (size) o.props.fontsize = size; if (font) o.props.font = font; if (clr !== -1) o.props.color = clr; return true;
    },
    ObjectDescription: (n: unknown) => String(objs.get(str(n))?.props.text ?? ''),
    ObjectSetFiboDescription: (n: unknown, i: number, t: unknown) => set(str(n), num(rt.OBJPROP_LEVELTEXT), i, str(t)),
    ObjectGetFiboDescription: (n: unknown, i: number) => str(get(str(n), num(rt.OBJPROP_LEVELTEXT), i)),
    ObjectMove: (...a: unknown[]) => {
      const [n, r] = split(a), o = objs.get(n); if (!o) { errNF(); return false }
      const i = num(r[0]); o.time[i] = num(r[1]); o.price[i] = num(r[2]); return true;
    },
    ObjectSetInteger: (_c: unknown, n: unknown, id: number, ...r: unknown[]) => set(str(n), num(id), r.length > 1 ? num(r[0]) : 0, r.at(-1)),
    ObjectSetDouble: (_c: unknown, n: unknown, id: number, ...r: unknown[]) => set(str(n), num(id), r.length > 1 ? num(r[0]) : 0, r.at(-1)),
    ObjectSetString: (_c: unknown, n: unknown, id: number, ...r: unknown[]) => set(str(n), num(id), r.length > 1 ? num(r[0]) : 0, r.at(-1)),
    ObjectGetInteger: (_c: unknown, n: unknown, id: number, mod = 0, out?: unknown) => { const v = get(str(n), num(id), num(mod)); const x = typeof v === 'boolean' ? +v : num(v ?? 0); if (out !== undefined) { put(out, x); return v !== undefined } return x },
    ObjectGetDouble: (_c: unknown, n: unknown, id: number, mod = 0, out?: unknown) => { const v = get(str(n), num(id), num(mod)); const x = num(v ?? 0); if (out !== undefined) { put(out, x); return v !== undefined } return x },
    ObjectGetString: (_c: unknown, n: unknown, id: number, mod = 0, out?: unknown) => { const v = get(str(n), num(id), num(mod)); const x = v == null ? '' : str(v); if (out !== undefined) { put(out, x); return v !== undefined } return x },
    ObjectGetValueByTime: (_c: unknown, n: unknown, t: number) => {
      const o = objs.get(str(n)); if (!o) { errNF(); return 0 }
      if (o.time.length < 2 || o.time[1] === o.time[0]) return o.price[0] ?? 0;
      return o.price[0] + ((o.price[1] - o.price[0]) * (num(t) - o.time[0])) / (o.time[1] - o.time[0]);
    },
    ObjectGetTimeByValue: (_c: unknown, n: unknown, p: number) => {
      const o = objs.get(str(n)); if (!o || o.price.length < 2 || o.price[1] === o.price[0]) return 0;
      return Math.round(o.time[0] + ((o.time[1] - o.time[0]) * (num(p) - o.price[0])) / (o.price[1] - o.price[0]));
    },
    // chart stubs
    ChartID: () => 0, ChartRedraw: () => {}, ChartSymbol: () => env.symbol, ChartPeriod: () => secToTf(env, env.tfSec), ChartFirst: () => 0, ChartNext: () => -1,
    ChartGetInteger: (_c: unknown, prop: number, _w = 0, out?: unknown) => {
      const p = num(prop), v = p === rt.CHART_VISIBLE_BARS || p === rt.CHART_WIDTH_IN_BARS ? 100 : p === rt.CHART_FIRST_VISIBLE_BAR ? Math.min(env.cur(), 99) : p === rt.CHART_WINDOWS_TOTAL ? 1 : p === rt.CHART_WIDTH_IN_PIXELS ? 1000 : p === rt.CHART_HEIGHT_IN_PIXELS ? 600 : 0;
      if (out !== undefined) { put(out, v); return true } return v;
    },
    ChartGetDouble: (_c: unknown, _p: number, _w = 0, out?: unknown) => { if (out !== undefined) { put(out, 0); return true } return 0 },
    ChartGetString: (_c: unknown, _p: number, out?: unknown) => { if (out !== undefined) { put(out, ''); return true } return '' },
    ChartSetInteger: () => true, ChartSetDouble: () => true, ChartSetString: () => true, ChartSetSymbolPeriod: () => true, ChartNavigate: () => true,
    ChartWindowFind: () => 0, ChartIndicatorAdd: () => true, ChartIndicatorDelete: () => true, ChartIndicatorGet: () => -1, ChartIndicatorName: () => '', ChartIndicatorsTotal: () => 0,
    ChartTimePriceToXY: () => false, ChartXYToTimePrice: () => false, ChartScreenShot: () => false, ChartOpen: () => 0, ChartClose: () => true, ChartApplyTemplate: () => true, ChartSaveTemplate: () => true,
    EventChartCustom: () => true,
  });
}
