// Derivatives on a chart: open interest, funding, long/short ratio and CVD spot vs perp as lower panes; liquidation
// bubbles and the estimated liquidation heatmap drawn on the price pane. Data comes from the data server
// (/api/derivs/*, see server/derivs.ts); CVD reuses the order-flow trade feed. One instance per chart pane, kept across
// rebuilds (the chart calls derivsAttach from its setupLayer hook) and stopped once the pane leaves the page.
import { HistogramSeries, LineSeries, LineStyle, type IPrimitivePaneRenderer, type IPrimitivePaneView, type ISeriesApi, type ISeriesPrimitive, type SeriesType, type Time } from 'lightweight-charts';
import type { ChartPane } from '../chart.ts';
import { isPriceBased } from '../charttypes.ts';
import { serverJson, tfSeconds } from '../data.ts';
import { fetchPrints, streamPrints } from '../orderflow/feed.ts';
import type { Print } from '../orderflow/model.ts';
import type { MenuItem } from '../menu.ts';
import { store } from '../store.ts';
import { addDeltas, align, barIndex, cvdLine, derivSym, liqLevels, niceBin, periodFor, type DSym, type Funding, type Level, type Liq, type OIPt, type Pt } from './model.ts';

export interface DerivCfg { oi?: boolean; oiv?: boolean; funding?: boolean; ratio?: boolean; cvd?: boolean; liqs?: boolean; heat?: boolean; ex?: string }
const cfgOf = (p: ChartPane) => ((p.cfg as { derivs?: DerivCfg }).derivs ?? {});
const anyOn = (c: DerivCfg) => !!(c.oi || c.oiv || c.funding || c.ratio || c.cvd || c.liqs || c.heat);
export const liqMin = () => store.get('liqMin', 0);

export const getDerivs = <T>(kind: string, ds: DSym, extra: Record<string, string> = {}) =>
  serverJson<T>(`/api/derivs/${kind}?${new URLSearchParams({ ex: ds.ex, sym: ds.ccxt, ...extra })}`);
export const fmtN = (v: number) => { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : a >= 1 ? v.toFixed(2) : v.toPrecision(3) };
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, (s / 60) % 60, s % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':') };
const SLOW_MS = 60_000, LIQ_MS = 3000, CVD_KEEP = 100_000;
type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];
type Ctx = CanvasRenderingContext2D;

const inst = new WeakMap<ChartPane, Derivs>();
/** Hook for ChartPane.build (via main.ts setupLayer): (re)attach this pane's derivatives panes and overlays. */
export function derivsAttach(p: ChartPane) {
  let d = inst.get(p);
  if (!d && !anyOn(cfgOf(p))) return;
  if (!d) inst.set(p, (d = new Derivs(p)));
  d.attach();
}

/** "Derivatives" section of the Indicators menu for a pane's config. */
export function derivsMenu(cfg: object, apply: (c: DerivCfg) => void): MenuItem[] {
  const c: DerivCfg = (cfg as { derivs?: DerivCfg }).derivs ?? {}, t = (k: keyof DerivCfg, label: string) => ({ label, checked: !!c[k], action: () => apply({ ...c, [k]: !c[k] }) });
  const ds = derivSym((cfg as { symbol: string }).symbol);
  return [
    { sep: true }, { label: `Derivatives${ds ? ` · ${ds.ccxt}` : ' (crypto symbols only)'}`, disabled: true },
    t('oi', 'Open interest (contracts)'), t('oiv', 'Open interest (value)'), t('funding', 'Funding rate'), t('ratio', 'Long/short ratio'),
    t('cvd', 'CVD spot vs perp'), t('liqs', 'Liquidation bubbles'), t('heat', 'Liquidation heatmap (estimated)'),
    { label: 'Derivatives exchange', hint: c.ex || 'auto', sub: ['', 'binanceusdm', 'bybit', 'okx'].map(x => ({ label: x || 'Auto (from the chart symbol)', checked: (c.ex ?? '') === x, action: () => apply({ ...c, ex: x || undefined }) })) },
  ];
}

class Derivs implements ISeriesPrimitive<Time> {
  private p: ChartPane;
  private key = '';
  private ds: DSym | null = null;
  private oi: { hist: OIPt[]; now: OIPt | null } | null = null;
  private funding: { hist: Pt[]; now: Funding | null } | null = null;
  private ratio: { accounts: Pt[]; top?: Pt[]; topPos?: Pt[] } | null = null;
  private liqs: Liq[] = [];
  private levels: Level[] = [];
  private bin = 0;
  private prints: { spot: Print[]; perp: Print[] } = { spot: [], perp: [] };
  private stopCvd = () => {};
  private cvdOn = false;
  private errs: Record<string, string> = {};
  private s: Record<string, ISeriesApi<SeriesType>> = {};
  private el: HTMLElement;
  private timer = 0;
  private lastSlow = 0;
  private lastLiq = 0;
  private dirty = false;
  private requestUpdate = () => {};
  private views: IPrimitivePaneView[];

  constructor(p: ChartPane) {
    this.p = p;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:8px;bottom:52px;z-index:4;font-size:11px;color:var(--muted);background:color-mix(in srgb,var(--bg) 80%,transparent);padding:1px 6px;border-radius:4px;pointer-events:none;max-width:calc(100% - 90px)';
    const under: IPrimitivePaneRenderer = { draw: t => this.drawHeat(t) }, over: IPrimitivePaneRenderer = { draw: t => this.drawLiqs(t) };
    this.views = [{ renderer: () => under, zOrder: () => 'bottom' }, { renderer: () => over, zOrder: () => 'top' }];
  }
  attached(x: { requestUpdate: () => void }) { this.requestUpdate = x.requestUpdate }
  detached() { this.requestUpdate = () => {} }
  paneViews() { return this.views }
  updateAllViews() {}

  attach() {
    const p = this.p, c = cfgOf(p), ds = derivSym(p.cfg.symbol, c.ex);
    this.s = {};
    if (!anyOn(c) || !ds || isPriceBased(p.cfg.type)) { this.stop(); this.el.remove(); return }
    const key = `${p.cfg.symbol}|${p.cfg.tf}|${ds.ex}`;
    if (key !== this.key) { this.stop(); this.key = key; this.ds = ds; this.oi = this.funding = this.ratio = null; this.liqs = []; this.lastLiq = 0; this.errs = {}; this.prints = { spot: [], perp: [] } }
    if (!p.cell.contains(this.el)) p.cell.append(this.el);
    const ch = p.chart, base = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
    let pane = ch.panes().length;
    const line = (k: string, title: string, color: string, idx: number, fmt: 'volume' | 'price' = 'volume') =>
      (this.s[k] = ch.addSeries(LineSeries, { ...base, title, color, lineWidth: 1, priceFormat: fmt === 'volume' ? { type: 'volume' } : { type: 'price', precision: 3, minMove: 0.001 } }, idx));
    if (c.oi) line('oi', `OI ${ds.base}`, '#f0b90b', pane++);
    if (c.oiv) line('oiv', `OI ${ds.quote}`, '#26a69a', pane++);
    if (c.funding) this.s.funding = ch.addSeries(HistogramSeries, { ...base, title: 'Funding %', priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, pane++);
    if (c.ratio) {
      const i = pane++;
      line('ratio', 'L/S accounts', '#42a5f5', i, 'price').createPriceLine({ price: 1, color: '#888', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      line('top', 'L/S top accounts', '#ab47bc', i, 'price'); line('topPos', 'L/S top positions', '#ff7043', i, 'price');
    }
    if (c.cvd) { const i = pane++; line('cvdSpot', 'CVD spot', '#29b6f6', i); line('cvdPerp', 'CVD perp', '#ffa726', i) }
    if (c.liqs || c.heat) p.main.attachPrimitive(this);
    if (c.cvd && !this.cvdOn) this.startCvd(); else if (!c.cvd && this.cvdOn) { this.stopCvd(); this.cvdOn = false }
    this.lastSlow = 0;   // config changed: fetch what is now needed
    this.render();
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }
  private stop() { this.stopCvd(); this.stopCvd = () => {}; this.cvdOn = false; clearInterval(this.timer); this.timer = 0 }

  private tick() {
    const p = this.p, c = cfgOf(p), ds = this.ds;
    if (!p.cell.isConnected) { this.stop(); inst.delete(p); return }
    if (!ds || !anyOn(c)) return;
    const now = Date.now(), period = periodFor(tfSeconds(p.cfg.tf)), key = this.key;
    const load = <T>(k: string, kind: string, extra: Record<string, string>, set: (v: T) => void) =>
      getDerivs<T>(kind, ds, extra).then(v => { if (key !== this.key) return; set(v); delete this.errs[k]; this.render() })
        .catch(e => { if (key !== this.key) return; this.errs[k] = (e as Error).message; this.status() });
    if (now - this.lastSlow > SLOW_MS) {
      this.lastSlow = now;
      if (c.oi || c.oiv || c.heat) load<typeof this.oi>('oi', 'oi', { period }, v => (this.oi = v));
      if (c.funding) load<typeof this.funding>('funding', 'funding', {}, v => (this.funding = v));
      if (c.ratio) load<typeof this.ratio>('ratio', 'ratio', { period }, v => (this.ratio = v));
    }
    if (c.liqs && now - this.lastLiq > LIQ_MS) {
      this.lastLiq = now;
      const since = this.liqs.at(-1)?.t ?? 0;
      load<{ list: Liq[]; err?: string }>('liqs', 'liqs', { since: String(since) }, v => {
        this.liqs.push(...v.list); if (this.liqs.length > 500) this.liqs.splice(0, this.liqs.length - 500);
        if (v.err) this.errs.liqs = v.err;
      });
    }
    if (this.dirty) { this.dirty = false; this.render() } else this.status();
  }

  private startCvd() {
    const ds = this.ds!, key = this.key;
    this.cvdOn = true;
    const stops: (() => void)[] = [];
    for (const side of ['spot', 'perp'] as const) {
      const sym = side === 'spot' ? ds.spot : ds.perp, buf = this.prints[side];
      const add = (ps: Print[]) => { if (key !== this.key) return; buf.push(...ps); if (buf.length > CVD_KEEP) buf.splice(0, buf.length - CVD_KEEP); this.dirty = true };
      fetchPrints(sym, side === 'spot' ? 5 : 1).then(r => { if (key !== this.key) return; buf.unshift(...r.prints.filter(x => !buf.length || x.t < buf[0].t)); this.dirty = true })
        .catch(e => { this.errs['cvd' + side] = `CVD ${side}: ${(e as Error).message}`; this.status() });
      stops.push(streamPrints(sym, add));
    }
    this.stopCvd = () => stops.forEach(f => f());
  }

  private render() {
    const p = this.p, c = cfgOf(p), bars = p.vb(), times = bars.map(b => b.time), s = this.s;
    const put = (k: string, pts: { time: number; value: number; color?: string }[]) => s[k]?.setData(pts as never);
    if (this.oi && (c.oi || c.oiv || c.heat)) {
      const hist = this.oi.now ? [...this.oi.hist, this.oi.now] : this.oi.hist, a = align(hist, times);
      put('oi', bars.flatMap(b => { const x = a.get(b.time); return x ? [{ time: b.time, value: x.oi }] : [] }));
      put('oiv', bars.flatMap(b => { const x = a.get(b.time); return x ? [{ time: b.time, value: x.oiv ?? x.oi * b.close }] : [] }));
      if (c.heat && bars.length) { this.bin = niceBin(bars.at(-1)!.close); this.levels = liqLevels(bars, a, this.bin) }
    }
    if (this.funding && c.funding) {
      const a = align(this.funding.hist, times);
      put('funding', [...a].map(([time, x]) => ({ time, value: x.v * 100, color: x.v >= 0 ? '#26a69a' : '#ef5350' })));
    }
    if (this.ratio && c.ratio) for (const k of ['ratio', 'top', 'topPos'] as const) {
      const pts = k === 'ratio' ? this.ratio.accounts : this.ratio[k];
      put(k, pts ? [...align(pts, times)].map(([time, x]) => ({ time, value: x.v })) : []);
    }
    if (c.cvd) {
      const { spot, perp } = this.prints, from = Math.max(spot[0]?.t ?? Infinity, perp[0]?.t ?? Infinity);
      if (Number.isFinite(from) && times.length) {
        const start = times[Math.max(0, barIndex(times, from))];
        for (const [k, ps] of [['cvdSpot', spot], ['cvdPerp', perp]] as const) { const d = new Map<number, number>(); addDeltas(d, ps, times); put(k, cvdLine(d, times, start)) }
      }
    }
    this.requestUpdate();
    this.status();
  }

  private status() {
    const c = cfgOf(this.p), ds = this.ds; if (!ds) return;
    const parts = [`${ds.ex} ${ds.ccxt}`];
    const o = this.oi?.now ?? this.oi?.hist.at(-1);
    if (o && (c.oi || c.oiv)) parts.push(`OI ${fmtN(o.oi)} ${ds.base}${o.oiv != null ? ` ($${fmtN(o.oiv)})` : ''}`);
    const f = this.funding;
    if (f && c.funding) {
      const last = f.hist.at(-1);
      parts.push(`Funding ${last ? `last ${(last.v * 100).toFixed(4)}%` : ''}${f.now && Number.isFinite(f.now.rate) ? ` · predicted ${(f.now.rate * 100).toFixed(4)}%` : ''}${f.now?.next ? ` in ${clock(f.now.next - Date.now())}` : ''}`);
    }
    const r = this.ratio;
    if (r && c.ratio) parts.push(`L/S ${r.accounts.at(-1)?.v.toFixed(2) ?? '–'}${r.top?.length ? ` · top ${r.top.at(-1)!.v.toFixed(2)}` : ''}`);
    if (c.heat) parts.push('Liq. heatmap: ESTIMATED from OI × leverage tiers');
    const errs = Object.values(this.errs);
    this.el.innerHTML = '';
    this.el.append(parts.join(' · '));
    if (errs.length) { const e = document.createElement('div'); e.style.color = '#ef5350'; e.textContent = '⚠ ' + errs.join(' | '); this.el.append(e) }
  }

  // ---------- drawing on the price pane ----------
  private x(t: number) { return this.p.chart.timeScale().timeToCoordinate(t as Time) }
  private drawHeat(target: Target) {
    if (!cfgOf(this.p).heat || !this.levels.length) return;
    const series = this.p.main, max = Math.max(...this.levels.map(l => l.size));
    target.useMediaCoordinateSpace(({ context: g, mediaSize }: { context: Ctx; mediaSize: { width: number; height: number } }) => {
      for (const l of this.levels) {
        const k = l.size / max; if (k < 0.03) continue;
        const x0 = this.x(l.t0), x1 = l.t1 == null ? mediaSize.width : this.x(l.t1);
        const y0 = series.priceToCoordinate(l.px + this.bin / 2), y1 = series.priceToCoordinate(l.px - this.bin / 2);
        if (x0 == null || x1 == null || y0 == null || y1 == null) continue;
        const a = 0.12 + 0.6 * Math.sqrt(k);
        g.fillStyle = k > 0.6 ? `rgba(255,235,59,${a})` : k > 0.25 ? `rgba(255,152,0,${a})` : `rgba(156,39,176,${a})`;
        g.fillRect(x0, Math.min(y0, y1), Math.max(1, x1 - x0), Math.max(1.5, Math.abs(y1 - y0)));
      }
      g.font = '11px sans-serif'; g.fillStyle = 'rgba(255,152,0,0.9)';
      g.fillText('Liquidation heatmap — ESTIMATED (OI changes × 5/10/25/50/100× leverage)', 8, mediaSize.height - 8);
    });
  }
  private drawLiqs(target: Target) {
    if (!cfgOf(this.p).liqs || !this.liqs.length) return;
    const times = this.p.vb().map(b => b.time), series = this.p.main, min = liqMin();
    const a = this.liqs.filter(l => l.value >= min), ref = Math.max(1, ...a.map(l => l.value));
    target.useMediaCoordinateSpace(({ context: g }: { context: Ctx }) => {
      for (const l of a) {
        const i = barIndex(times, l.t), x = i < 0 ? null : this.x(times[i]), y = series.priceToCoordinate(l.px);
        if (x == null || y == null) continue;
        const r = 3 + 17 * Math.sqrt(l.value / ref);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = l.long ? 'rgba(239,83,80,0.45)' : 'rgba(38,166,154,0.45)'; g.fill();
        g.strokeStyle = l.long ? '#ef5350' : '#26a69a'; g.stroke();
      }
    });
  }
}
