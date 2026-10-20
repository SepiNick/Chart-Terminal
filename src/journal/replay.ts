// Bar Replay and the journal. (1) Replay a recorded trade: open its chart, start Bar Replay some bars before the entry
// and draw entry/exit/stop/target as the bars reach them. (2) Orders placed while a chart is in Replay go to a
// separate simulated account filled at replay prices (never the live paper account) and are logged, with the replay
// time, to a backtest journal account.
import { createSeriesMarkers, LineStyle, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type SeriesType, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { ChartPane } from '../chart.ts';
import { tfSeconds } from '../data.ts';
import { closePosition, newAccount, onPrice, placeOrder, type Account, type Order } from '../trading.ts';
import { applyFill, barIndex, barPath, mark, uid, type JTrade } from '../journal.ts';
import { commitJournal, journal, journalHost } from '../journalui.ts';
import { esc, toast } from '../store.ts';

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v: number) => +v.toPrecision(8);

/** Price lines on a pane's main series; dropped silently when the pane rebuilt its series. */
class Lines {
  series: ISeriesApi<SeriesType> | null = null;
  list: IPriceLine[] = [];
  set(p: ChartPane, lines: { price: number; title: string; color: string; style?: LineStyle }[]) {
    this.clear(p);
    this.series = p.main;
    for (const l of lines) this.list.push(p.main.createPriceLine({ price: l.price, title: l.title, color: l.color, lineStyle: l.style ?? LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true }));
  }
  clear(p: ChartPane) {
    if (this.series && this.series === p.main) for (const l of this.list) try { this.series.removePriceLine(l) } catch {}
    this.list = []; this.series = null;
  }
}

let timer = 0;
const ensureTimer = () => { timer ||= window.setInterval(tick, 250) };   // ponytail: polls the replay position; a chart hook on step would be push-based

// ---------- (2) backtest logging from Replay ----------
interface Sim { pane: ChartPane; sym: string; acct: Account; seen: number; accountId: string; last: number; px: number; lines: Lines }
let sim: Sim | null = null;

/** The backtest account Replay trades go to: the chosen one, else the first backtest account, else a new one. */
function backtestAccount() {
  const j = journal(), bt = (j.accounts ?? []).filter(a => a.kind === 'backtest');
  let a = bt.find(x => x.id === j.replayAccount) ?? bt[0];
  if (!a) { a = { id: uid(), name: 'Bar Replay backtest', initial: 10000, kind: 'backtest', transfers: [] }; (j.accounts ??= []).push(a) }
  if (j.replayAccount !== a.id) { j.replayAccount = a.id; toast(`Replay trades are logged to the backtest account “${a.name}” (change it in Journal → Accounts & settings)`, 6000) }
  return a.id;
}
const isReplaying = (p: ChartPane) => !!p.replay && !p.replay.picking;

/** Hook for the order path: true when the order belonged to a chart in Replay and was handled here. */
export function journalReplayOrder(p: ChartPane, o: Omit<Order, 'id'>): boolean {
  if (!isReplaying(p)) return false;
  const bar = p.vb().at(-1);
  if (!bar) return true;
  if (sim && (sim.pane !== p || sim.sym !== o.sym)) endSim();
  sim ??= { pane: p, sym: o.sym, acct: newAccount(), seen: 0, accountId: backtestAccount(), last: bar.time, px: bar.close, lines: new Lines() };
  const err = placeOrder(sim.acct, o, bar.close, bar.time);
  if (err) { toast(err, 5000); return true }
  toast(o.type === 'market' ? `Replay order filled @ ${fmt(bar.close)} (backtest)` : 'Replay order placed (backtest)');
  fold(); ensureTimer();
  return true;
}
/** Fold the simulated account's new fills into the backtest journal account. */
function fold() {
  if (!sim) return;
  const j = journal(), a = sim.acct, fresh = a.fills.slice(0, a.fills.length - sim.seen).reverse();
  sim.seen = a.fills.length;
  const ex = a.orders.filter(o => o.sym === sim!.sym && o.reduceOnly);
  const bracket = { stop: ex.find(o => o.type === 'stop')?.price, target: ex.find(o => o.type === 'limit')?.price };
  const touched: JTrade[] = [];
  for (const f of fresh) {
    const r = applyFill(j, f.sym, { t: f.ts, side: f.side, qty: f.qty, px: f.px, fee: f.fee, realized: f.realized }, { tf: sim.pane.cfg.tf, source: 'Bar Replay', accountId: sim.accountId, ...bracket });
    touched.push(...r.opened, ...r.closed);
  }
  for (const t of j.trades) if (t.status === 'open' && t.accountId === sim.accountId && t.stop == null && t.target == null) Object.assign(t, bracket);
  if (fresh.length) { touched.forEach(t => commitJournal(t)); if (!touched.length) commitJournal() }
  simLines();
}
function simLines() {
  if (!sim) return;
  const p = sim.pane, pos = sim.acct.pos[sim.sym], up = css('--up'), dn = css('--down');
  const lines: Parameters<Lines['set']>[1] = sim.acct.orders.filter(o => o.sym === sim!.sym).map(o => ({ price: o.price!, color: o.side === 'buy' ? up : dn, title: `Replay ${o.reduceOnly ? (o.type === 'limit' ? 'TP' : 'SL') : o.type} ${o.side} ${o.qty}` }));
  if (pos) lines.push({ price: pos.avg, color: pos.qty > 0 ? up : dn, title: `Replay ${pos.qty > 0 ? 'long' : 'short'} ${Math.abs(pos.qty)}`, style: LineStyle.Solid });
  if (p.main) sim.lines.set(p, lines);
}
/** Replay stopped (or moved to another chart): close what is still open at the last replay price. */
function endSim() {
  if (!sim) return;
  const s = sim;
  if (s.acct.pos[s.sym]) { closePosition(s.acct, s.sym, s.px, s.last); toast(`Replay ended: the open backtest position was closed at ${fmt(s.px)}`, 5000) }
  fold(); s.lines.clear(s.pane); sim = null;
}
function simTick() {
  if (!sim) return;
  const p = sim.pane;
  if (!isReplaying(p) || p.cfg.symbol !== sim.sym) return endSim();
  const bars = p.vb();
  let i = bars.length;
  while (i > 0 && bars[i - 1].time > sim.last) i--;
  if (i === bars.length) return;
  const j = journal();
  for (const b of bars.slice(i)) {   // stepping back never un-fills; only new bars are traded
    for (const px of barPath(b)) onPrice(sim.acct, sim.sym, px, b.time);
    mark(j, sim.sym, b.high, sim.accountId); mark(j, sim.sym, b.low, sim.accountId);
    sim.last = b.time; sim.px = b.close;
  }
  fold();
}

// ---------- (1) replay a journal trade ----------
interface Review { pane: ChartPane; t: JTrade; lines: Lines; markers: ISeriesMarkersPluginApi<Time> | null; series: ISeriesApi<SeriesType> | null; box: HTMLElement; shown: string }
let review: Review | null = null;

export async function replayTrade(id: string) {
  const t = journal().trades.find(x => x.id === id);
  if (!t || t.kind === 'notrade') return;
  const jw = document.querySelector<HTMLElement>('#jw'); if (jw) jw.hidden = true;   // the chart is under the workspace
  const tf = t.tf || '1h', n = journal().replayBars ?? 50;
  let p: ChartPane;
  try { p = await journalHost().pane(t.sym, tf) } catch { return toast(`Could not open ${t.sym}`) }
  if (!p.bars.length) return toast(`No ${t.sym} data`);
  if (sim?.pane === p) endSim();
  if (p.replay) p.exitReplay(false);
  await p.goTo(t.openTime - (n + 5) * tfSeconds(tf));
  const i = barIndex(p.bars, t.openTime);
  if (i < 0) return toast('The trade is older than the available chart data');
  stopReview();
  p.startReplayAt(p.bars[Math.max(1, i - n)].time);
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:8px;bottom:56px;z-index:7;display:flex;gap:4px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px 6px;box-shadow:0 4px 14px #0003;max-width:calc(100% - 16px)';
  box.onclick = e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-rv]')?.dataset.rv;
    if (!review || !a) return;
    if (a === 'close') { review.pane.exitReplay(); stopReview(); return }
    if (a === 'restart') { void replayTrade(review.t.id); return }
    const to = a === 'entry' ? review.t.openTime : review.t.closeTime;
    if (to == null) return toast('This trade is still open');
    const k = barIndex(review.pane.bars, to);
    if (k >= 1) review.pane.startReplayAt(review.pane.bars[k].time);
  };
  box.onchange = e => { const el = e.target as HTMLInputElement; if (el.dataset.rv === 'bars') { journal().replayBars = Math.max(1, Math.min(2000, Math.round(+el.value) || 50)); commitJournal() } };
  review = { pane: p, t, lines: new Lines(), markers: null, series: null, box, shown: '' };
  ensureTimer(); reviewTick();
}
function stopReview() {
  if (!review) return;
  review.lines.clear(review.pane);
  if (review.series === review.pane.main) try { review.markers?.detach() } catch {}
  review.box.remove(); review = null;
}
function reviewTick() {
  if (!review) return;
  const { pane: p, t } = review;
  if (!isReplaying(p) || p.cfg.symbol !== t.sym || !p.main) return stopReview();
  const b = p.vb(), now = b.at(-1)!.time, tf = tfSeconds(p.cfg.tf);
  const entered = now + tf > t.openTime, exited = t.closeTime != null && now + tf > t.closeTime;
  const key = `${now}|${entered}|${exited}`;
  if (!review.box.isConnected) p.cell.append(review.box);
  if (key === review.shown && review.series === p.main) return;
  review.shown = key;
  const ahead = (x: number) => Math.max(0, barIndex(p.bars, x) - (b.length - 1));
  review.box.innerHTML = `<b class="${t.dir === 'long' ? 'up' : 'dn'}">${t.dir === 'long' ? '▲' : '▼'} ${esc(t.sym)}</b>
    <span class="muted">${!entered ? `entry in ${ahead(t.openTime)} bars` : t.closeTime == null ? 'in the trade (still open)' : !exited ? `exit in ${ahead(t.closeTime)} bars` : `closed ${t.net >= 0 ? '+' : ''}${t.net.toFixed(2)}`}</span>
    <button data-rv="entry" title="Jump to the entry bar">⇥ Entry</button><button data-rv="exit" title="Jump to the exit bar" ${t.closeTime == null ? 'disabled' : ''}>⇥ Exit</button>
    <label class="muted" title="Bars shown before the entry">Bars before <input data-rv="bars" type="number" min="1" max="2000" value="${journal().replayBars ?? 50}" style="width:60px"></label>
    <button data-rv="restart" title="Start again before the entry">↺</button><button data-rv="close" title="Leave the trade replay">✕</button>`;
  // levels appear when the replay reaches them, so the outcome is not given away
  const up = css('--up'), dn = css('--down'), muted = css('--muted');
  const stop = t.stopFinal ?? t.stop, target = t.targetFinal ?? t.target, lines: Parameters<Lines['set']>[1] = [];
  if (entered) {
    lines.push({ price: t.avgEntry, title: `Entry ${t.dir}`, color: muted, style: LineStyle.Solid });
    if (stop != null) lines.push({ price: stop, title: 'SL', color: dn });
    if (target != null) lines.push({ price: target, title: 'TP', color: up });
  }
  if (exited && t.avgExit != null) lines.push({ price: t.avgExit, title: `Exit ${t.net >= 0 ? '+' : ''}${t.net.toFixed(2)}`, color: t.net >= 0 ? up : dn, style: LineStyle.Dotted });
  review.lines.set(p, lines);
  if (review.series !== p.main) { review.markers = createSeriesMarkers(p.main, []); review.series = p.main }
  const fills = t.fills.length ? t.fills : [{ t: t.openTime, side: t.dir === 'long' ? 'buy' : 'sell', qty: t.maxQty }, ...(t.closeTime != null ? [{ t: t.closeTime, side: t.dir === 'long' ? 'sell' : 'buy', qty: t.exitQty || t.maxQty }] : [])];
  const m: SeriesMarker<Time>[] = [];
  for (const f of fills) {
    const k = barIndex(b, f.t);
    if (k < 0 || f.t >= now + tf) continue;
    const buy = f.side === 'buy';
    m.push({ time: b[k].time as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar', color: buy ? up : dn, shape: buy ? 'arrowUp' : 'arrowDown', text: `${f.side} ${+f.qty.toFixed(8)}` });
  }
  review.markers!.setMarkers(m.sort((x, y) => (x.time as number) - (y.time as number)));
}

function tick() {
  simTick(); reviewTick();
  if (!sim && !review) { clearInterval(timer); timer = 0 }
}
