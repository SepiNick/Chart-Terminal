// Strategy broker emulator for Pine strategies. Orders are placed on a bar's close and filled from the
// next bar on: market orders at the open; limit/stop orders when the bar's assumed price path touches them.
// Intrabar path (TradingView's documented assumption): if the open is nearer the high, O→H→L→C, else O→L→H→C.
import type { Bar } from '../data.ts';

export type Dir = 'long' | 'short';
export interface StrategyProps {
  initialCapital: number;
  qtyType: 'fixed' | 'cash' | 'percent_of_equity';
  qtyValue: number;
  pyramiding: number;                 // max entries in the same direction (TradingView default 0 = 1 entry)
  commissionType: 'percent' | 'cash_per_contract' | 'cash_per_order';
  commissionValue: number;
  slippageTicks: number;
  mintick: number;
  processOnClose: boolean;            // fill market orders at the signal bar's close instead of next open
}
export const defaultProps = (p: Partial<StrategyProps> = {}): StrategyProps => ({
  initialCapital: 10000, qtyType: 'fixed', qtyValue: 1, pyramiding: 0, commissionType: 'percent', commissionValue: 0,
  slippageTicks: 0, mintick: 0.01, processOnClose: false, ...p,
});

interface Entry { id: string; dir: Dir; qty: number; price: number; bar: number; comment: string; commission: number; maxPrice: number; minPrice: number }
export interface Trade {
  entryId: string; exitId: string; dir: Dir; qty: number;
  entryBar: number; entryTime: number; entryPrice: number;
  exitBar: number; exitTime: number; exitPrice: number;
  profit: number; profitPct: number; commission: number; runup: number; drawdown: number; comment: string;
}
interface Order {
  kind: 'entry' | 'close' | 'exit' | 'order';
  id: string; dir?: Dir; qty?: number; qtyPercent?: number; limit?: number; stop?: number;
  fromEntry?: string; trail?: { points?: number; offset: number; activation?: number; active?: boolean; best?: Map<Entry, number> };
  comment: string; placedBar: number;
}
export interface FillEvent { bar: number; time: number; price: number; qty: number; side: 'buy' | 'sell'; id: string; comment: string }

export class Broker {
  props: StrategyProps;
  cash: number;
  open: Entry[] = [];
  trades: Trade[] = [];
  orders: Order[] = [];
  fills: FillEvent[] = [];
  equity: number[] = [];
  private bars: Bar[];

  constructor(bars: Bar[], props: StrategyProps) { this.bars = bars; this.props = props; this.cash = props.initialCapital }

  get positionSize() { return this.open.reduce((a, e) => a + (e.dir === 'long' ? e.qty : -e.qty), 0) }
  get positionAvgPrice() { const q = this.open.reduce((a, e) => a + e.qty, 0); return q ? this.open.reduce((a, e) => a + e.price * e.qty, 0) / q : NaN }
  openProfit(price: number) { return this.open.reduce((a, e) => a + (price - e.price) * e.qty * (e.dir === 'long' ? 1 : -1), 0) }
  netProfit() { return this.trades.reduce((a, t) => a + t.profit, 0) }
  equityAt(price: number) { return this.props.initialCapital + this.netProfit() + this.openProfit(price) }

  // ---------- order placement (called while the script runs on bar `bar`) ----------
  entry(bar: number, id: string, dir: Dir, o: { qty?: number; limit?: number; stop?: number; comment?: string }) {
    this.orders = this.orders.filter(x => !(x.kind === 'entry' && x.id === id));   // same id replaces the pending order
    this.orders.push({ kind: 'entry', id, dir, qty: o.qty, limit: o.limit, stop: o.stop, comment: o.comment ?? '', placedBar: bar });
  }
  order(bar: number, id: string, dir: Dir, o: { qty?: number; limit?: number; stop?: number; comment?: string }) {
    this.orders = this.orders.filter(x => !(x.kind === 'order' && x.id === id));
    this.orders.push({ kind: 'order', id, dir, qty: o.qty, limit: o.limit, stop: o.stop, comment: o.comment ?? '', placedBar: bar });
  }
  close(bar: number, id: string | null, o: { qty?: number; qtyPercent?: number; comment?: string } = {}) {
    if (!this.open.some(e => id == null || e.id === id)) return;
    this.orders.push({ kind: 'close', id: id ?? '', qty: o.qty, qtyPercent: o.qtyPercent, comment: o.comment ?? '', placedBar: bar });
  }
  exit(bar: number, id: string, o: { fromEntry?: string; qty?: number; qtyPercent?: number; limit?: number; stop?: number; profit?: number; loss?: number; trailPoints?: number; trailOffset?: number; trailPrice?: number; comment?: string }) {
    const prev = this.orders.find(x => x.kind === 'exit' && x.id === id && x.fromEntry === o.fromEntry);
    this.orders = this.orders.filter(x => x !== prev);
    const trail = o.trailOffset != null && (o.trailPoints != null || o.trailPrice != null) ? { points: o.trailPoints, offset: o.trailOffset, activation: o.trailPrice, best: prev?.trail?.best ?? new Map() } : undefined; // keep the trail's high-water mark
    // profit/loss are in ticks from the entry price; resolved per entry at fill time
    this.orders.push({ kind: 'exit', id, fromEntry: o.fromEntry, qty: o.qty, qtyPercent: o.qtyPercent, limit: o.limit, stop: o.stop, trail, comment: o.comment ?? '', placedBar: bar,
      ...(o.profit != null || o.loss != null ? { profitTicks: o.profit, lossTicks: o.loss } as object : {}) });
  }
  cancel(id: string | null) { this.orders = this.orders.filter(o => id != null && o.id !== id) }

  // ---------- simulation ----------
  private qtyFor(price: number, explicit?: number) {
    if (explicit != null && explicit > 0) return explicit;
    const p = this.props;
    if (p.qtyType === 'cash') return p.qtyValue / price;
    if (p.qtyType === 'percent_of_equity') { const q = (this.equityAt(price) * p.qtyValue / 100) / price; return Number.isFinite(q) && q > 0 ? q : 0 }   // equity <= 0 must not flip the position
    return p.qtyValue;
  }
  private commission(price: number, qty: number) {
    const p = this.props;
    return p.commissionType === 'percent' ? price * qty * p.commissionValue / 100 : p.commissionType === 'cash_per_contract' ? qty * p.commissionValue : p.commissionValue;
  }
  private slip(price: number, side: 'buy' | 'sell') { return price + (side === 'buy' ? 1 : -1) * this.props.slippageTicks * this.props.mintick }

  private openEntry(bar: number, id: string, dir: Dir, price: number, qty: number, comment: string) {
    const side = dir === 'long' ? 'buy' : 'sell', px = this.slip(price, side), c = this.commission(px, qty);
    this.open.push({ id, dir, qty, price: px, bar, comment, commission: c, maxPrice: px, minPrice: px });
    this.cash -= c;
    this.fills.push({ bar, time: this.bars[bar].time, price: px, qty, side, id, comment });
  }
  private closeQty(bar: number, price: number, qty: number, exitId: string, comment: string, filter: (e: Entry) => boolean = () => true) {
    for (const e of [...this.open]) {   // FIFO, like TradingView's default close_entries_rule
      if (qty <= 1e-12) break;
      if (!filter(e)) continue;
      const q = Math.min(qty, e.qty), side = e.dir === 'long' ? 'sell' : 'buy', px = this.slip(price, side);
      const c = this.commission(px, q), entryC = e.commission * (q / e.qty);
      const gross = (px - e.price) * q * (e.dir === 'long' ? 1 : -1);
      const fav = e.dir === 'long' ? (e.maxPrice - e.price) * q : (e.price - e.minPrice) * q;
      const adv = e.dir === 'long' ? (e.price - e.minPrice) * q : (e.maxPrice - e.price) * q;
      this.trades.push({
        entryId: e.id, exitId, dir: e.dir, qty: q, entryBar: e.bar, entryTime: this.bars[e.bar].time, entryPrice: e.price,
        exitBar: bar, exitTime: this.bars[bar].time, exitPrice: px, profit: gross - c - entryC, profitPct: (gross / (e.price * q)) * 100,
        commission: c + entryC, runup: fav, drawdown: adv, comment,
      });
      this.cash += gross - c;
      this.fills.push({ bar, time: this.bars[bar].time, price: px, qty: q, side, id: exitId, comment });
      e.commission -= entryC; e.qty -= q; qty -= q;
      if (e.qty <= 1e-12) this.open.splice(this.open.indexOf(e), 1);
    }
  }
  private fillEntry(bar: number, o: Order, price: number) {
    const dir = o.dir!, pos = this.positionSize;
    const qty = this.qtyFor(price, o.qty);
    if (o.kind === 'entry') {
      if (pos !== 0 && (pos > 0) !== (dir === 'long')) this.closeQty(bar, price, Math.abs(pos), o.id, o.comment); // reverse
      const sameDir = this.open.filter(e => e.dir === dir).length;
      if (sameDir > Math.max(0, this.props.pyramiding - 1) && sameDir > 0) return false;   // pyramiding limit
      this.openEntry(bar, o.id, dir, price, qty, o.comment);
      return true;
    }
    // strategy.order: net position arithmetic, no reversal logic
    if (pos !== 0 && (pos > 0) !== (dir === 'long')) {
      const closing = Math.min(qty, Math.abs(pos));
      this.closeQty(bar, price, closing, o.id, o.comment);
      if (qty > closing) this.openEntry(bar, o.id, dir, price, qty - closing, o.comment);
    } else this.openEntry(bar, o.id, dir, price, qty, o.comment);
    return true;
  }
  /** Path of prices a bar is assumed to travel through. */
  private path(b: Bar) { return Math.abs(b.open - b.high) < Math.abs(b.open - b.low) ? [b.open, b.high, b.low, b.close] : [b.open, b.low, b.high, b.close] }

  /** Process pending orders against bar `bar` (call before running the script on that bar). */
  step(bar: number) {
    const b = this.bars[bar];
    const pending = this.orders.filter(o => o.placedBar < bar || (this.props.processOnClose && o.placedBar === bar));
    // Market orders (no price) fill at the open.
    for (const o of pending) {
      if ((o.kind === 'entry' || o.kind === 'order') && o.limit == null && o.stop == null) { this.fillEntry(bar, o, b.open); this.orders.splice(this.orders.indexOf(o), 1) }
      else if (o.kind === 'close') {
        const matching = this.open.filter(e => !o.id || e.id === o.id), total = matching.reduce((a, e) => a + e.qty, 0);
        const q = o.qty ?? (o.qtyPercent != null ? total * o.qtyPercent / 100 : total);
        this.closeQty(bar, b.open, q, o.id || 'Close', o.comment, e => !o.id || e.id === o.id);
        this.orders.splice(this.orders.indexOf(o), 1);
      }
    }
    // Price orders: walk the intrabar path segment by segment.
    const pts = this.path(b);
    for (let s = 0; s < 3; s++) {
      const a = pts[s], z = pts[s + 1], lo = Math.min(a, z), hi = Math.max(a, z);
      for (const e of this.open) { e.maxPrice = Math.max(e.maxPrice, hi); e.minPrice = Math.min(e.minPrice, lo) }
      for (const o of [...this.orders]) {
        if (!this.orders.includes(o) || o.placedBar >= bar) continue;
        if (o.kind === 'entry' || o.kind === 'order') {
          const buy = o.dir === 'long';
          const lim = o.limit != null && (buy ? lo <= o.limit : hi >= o.limit) ? (buy ? Math.min(a, o.limit) : Math.max(a, o.limit)) : null;
          const stp = o.stop != null && (buy ? hi >= o.stop : lo <= o.stop) ? (buy ? Math.max(a, o.stop) : Math.min(a, o.stop)) : null;
          const px = lim ?? stp;
          if (px != null && (o.limit == null || o.stop == null || lim != null)) { this.fillEntry(bar, o, px); this.orders.splice(this.orders.indexOf(o), 1) }
        } else if (o.kind === 'exit') this.tryExit(bar, o, a, z, lo, hi);
      }
    }
    this.equity[bar] = this.equityAt(b.close);
  }
  private tryExit(bar: number, o: Order & { profitTicks?: number; lossTicks?: number }, from: number, to: number, lo: number, hi: number) {
    const entries = this.open.filter(e => !o.fromEntry || e.id === o.fromEntry);
    if (!entries.length) return;
    for (const e of entries) {
      const long = e.dir === 'long', t = this.props.mintick;
      const tp = o.limit ?? (o.profitTicks != null ? e.price + (long ? 1 : -1) * o.profitTicks * t : undefined);
      let sl = o.stop ?? (o.lossTicks != null ? e.price - (long ? 1 : -1) * o.lossTicks * t : undefined);
      // The trail's high-water mark is kept per entry (two open entries must not share one) and moves along the path: the stop
      // is checked against the mark reached at the segment's START, so a rising segment cannot stop out against its own high.
      const pick = long ? Math.max : Math.min;
      let markAfter: number | undefined;
      if (o.trail) {
        const act = o.trail.activation ?? (o.trail.points != null ? e.price + (long ? 1 : -1) * o.trail.points * t : e.price);
        const best = pick(o.trail.best!.get(e) ?? e.price, e.bar < bar ? from : e.price);   // an entry filled this bar starts at its fill price
        markAfter = pick(best, to);
        if (long ? best >= act : best <= act) {
          const ts = best - (long ? 1 : -1) * o.trail.offset * t;
          sl = sl == null ? ts : long ? Math.max(sl, ts) : Math.min(sl, ts);
        }
      }
      const slHit = sl != null && (long ? lo <= sl : hi >= sl), tpHit = tp != null && (long ? hi >= tp : lo <= tp);
      if (markAfter != null) o.trail!.best!.set(e, markAfter);
      if (!slHit && !tpHit) continue;
      // Within one segment the path is monotonic: whichever level is nearer the segment start is hit first.
      const px = slHit && tpHit ? (Math.abs(from - sl!) < Math.abs(from - tp!) ? sl! : tp!) : slHit ? (long ? Math.min(from, sl!) : Math.max(from, sl!)) : (long ? Math.max(from, tp!) : Math.min(from, tp!));
      const q = o.qty ?? (o.qtyPercent != null ? e.qty * o.qtyPercent / 100 : e.qty);
      this.closeQty(bar, px, q, o.id, o.comment, x => x === e);
    }
    if (!this.open.some(e => !o.fromEntry || e.id === o.fromEntry)) this.orders.splice(this.orders.indexOf(o), 1);
  }
  /** Close everything at the last close so the report reflects final equity (open trades stay listed as open in UI). */
  finalize() { const n = this.bars.length - 1; if (n >= 0) this.equity[n] = this.equityAt(this.bars[n].close) }
}
