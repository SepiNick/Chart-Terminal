// Chart bars that come from trades instead of klines: activity intervals (100T, R10, REV5, D500) built live from the
// trade stream, and tick-level Market Replay of the server's trade recording at a chosen speed. Both register as a bar
// source in data.ts and hand the same bar-tagged prints to the order-flow layer, so footprint and candles always agree.
import { barHooks, fetchBars, tfSeconds, type Bar } from '../data.ts';
import { fetchPrints, hasOrderFlow, streamPrints } from './feed.ts';
import { BarBuilder, parseOfTf, type OfTf } from './tfbars.ts';
import type { Print } from './model.ts';
import { api, serverMode } from '../sync.ts';
import { calcPrec } from '../store.ts';

const CAP = 400_000;

/** A print source with its bar builder; listeners get bar-tagged prints (layer) and changed bars (chart). */
export class Feed {
  prints: Print[] = [];
  hist: Bar[] = [];          // klines before `cut` (replay of a clock interval); the builder's own bars start at `cut`
  cut = -Infinity;
  ready: Promise<void> = Promise.resolve();
  onPrints = new Set<(ps: Print[]) => void>();
  onBar = new Set<(b: Bar) => void>();
  stop = () => {};
  private b: BarBuilder | null = null;
  private spec: OfTf;
  constructor(spec: OfTf) { this.spec = spec }

  bars(): Bar[] { return [...this.hist.filter(b => b.time < this.cut), ...(this.b?.bars ?? []).filter(b => b.time >= this.cut)].map(b => ({ ...b })) }
  /** Tag prints with their bar and tell the listeners (not while loading history: `emit` false). */
  push(ps: Print[], emit = true) {
    if (!ps.length) return;
    this.b ??= new BarBuilder(this.spec, 10 ** -calcPrec(ps[0].px));
    const out: Print[] = [], touched = new Set<Bar>();
    for (const p of ps) { const q = { ...p, bar: this.b.push(p) }; out.push(q); this.prints.push(q); touched.add(this.b.bars.at(-1)!) }
    if (this.prints.length > CAP) this.prints = this.prints.slice(-Math.floor(CAP * 0.8));
    if (!emit) return;
    for (const b of touched) if (b.time >= this.cut) this.onBar.forEach(f => f({ ...b }));
    this.onPrints.forEach(f => f(out));
  }
  /** Stop once nobody listens any more (after a grace period, so a chart rebuild can re-subscribe). */
  release(ms = 1000) { setTimeout(() => { if (!this.onBar.size && !this.onPrints.size) this.stop() }, ms) }
}

// ---------- live activity intervals ----------
const live = new Map<string, Feed>();
function liveFeed(sym: string, tf: string, spec: OfTf): Feed {
  const k = `${sym}|${tf}`;
  let f = live.get(k);
  if (f) return f;
  const feed = (f = new Feed(spec));
  live.set(k, feed);
  let pending: Print[] | null = [];
  const stopStream = streamPrints(sym, ps => { if (pending) pending.push(...ps); else feed.push(ps) });
  feed.stop = () => { stopStream(); if (live.get(k) === feed) live.delete(k) };
  feed.ready = fetchPrints(sym, 20).then(async ({ prints }) => {
    // Server mode: bars before the loaded trades come from the server's whole recording (empty when it doesn't record sym).
    if (serverMode && prints.length) {
      const t0 = prints[0].t, tick = 10 ** -calcPrec(prints[0].px);
      const older = await api<Bar[]>(`/api/recorder/bars?${new URLSearchParams({ sym, tf, before: String(t0), days: '30', tick: String(tick) })}`).catch(() => []);
      if (older.length) { feed.hist = older; feed.cut = t0 }
    }
    const last = prints.at(-1)?.t ?? -Infinity;
    feed.push([...prints, ...pending!.filter(p => p.t > last)], false); pending = null;
  }, e => { feed.stop(); throw e });
  return feed;
}

// ---------- Market Replay ----------
interface Replay { sym: string; tf: string; feed: Feed; clock: number; speed: number; paused: boolean; done: boolean; queue: Print[]; qi: number; next: string | null; loading: boolean; timer: number; error: string }
let rp: Replay | null = null;
type Page = { prints: Print[]; next: string | null };
const pageOf = (sym: string, from: number, cursor?: string) => api<Page>(`/api/recorder/page?${new URLSearchParams({ sym, from: String(from), limit: '10000', ...(cursor ? { cursor } : {}) })}`);
const strip = (ps: Print[]) => ps.map(({ t, px, qty, buy }) => ({ t, px, qty, buy }));

export const replayOn = (sym: string, tf?: string) => !!rp && rp.sym === sym && (tf == null || rp.tf === tf);
export const replayActive = () => (rp ? { sym: rp.sym, tf: rp.tf } : null);
export function replayStatus(): string {
  if (!rp) return '';
  const t = new Date(rp.clock * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `▶ Market replay ${t} · ${rp.speed}×${rp.paused ? ' · paused' : ''}${rp.done ? ' · end of recording' : ''}${rp.error ? ` · ${rp.error}` : ''}`;
}

/**
 * Replay `sym` on interval `tf` from `from` (seconds) at `speed`× real time. Clock intervals show klines before `from`;
 * activity intervals are built from the recording before it. Throws when there is nothing recorded after `from`.
 * The caller reloads the charts on (sym, tf) so they pick up the replay as their bar source.
 */
export async function startReplay(sym: string, tf: string, from: number, speed: number): Promise<void> {
  const spec = parseOfTf(tf) ?? { kind: 'time' as const, n: tfSeconds(tf) };
  if (spec.kind === 'time') from = Math.floor(from / spec.n) * spec.n;   // start on a bar boundary: no half-built first bar
  const first = await pageOf(sym, from);
  if (!first.prints.length) throw Error(`No recorded trades of ${sym} after ${new Date(from * 1000).toLocaleString()}. Record it under Settings → Trade recording.`);
  stopReplay();
  const feed = new Feed(spec), r: Replay = { sym, tf, feed, clock: from, speed, paused: false, done: false, queue: strip(first.prints), qi: 0, next: first.next, loading: false, timer: 0, error: '' };
  rp = r;
  if (spec.kind === 'time') feed.cut = from;
  feed.ready = (async () => {
    const [warm, hist] = await Promise.all([
      api<Print[]>(`/api/recorder/trades?${new URLSearchParams({ sym, to: String(from - 0.0005), limit: '20000' })}`).catch(() => [] as Print[]),
      spec.kind === 'time' ? fetchBars(sym, tf, from * 1000 - 1) : Promise.resolve([]),
    ]);
    feed.hist = hist;
    feed.push(strip(warm), false);
    if (!feed.bars().length) feed.push([r.queue[r.qi++]], false);   // a chart needs one bar before it subscribes
  })();
  feed.stop = () => {};
  r.timer = window.setInterval(() => tick(r), 100);
}
function tick(r: Replay) {
  if (r.paused || r.done || rp !== r) return;
  if (r.queue.length - r.qi < 5000 && r.next && !r.loading) load(r);
  const ahead = r.queue[r.qi];
  if (!ahead) { if (!r.next && !r.loading) { r.done = true; r.feed.onPrints.forEach(f => f([])) } return }   // empty push = status refresh
  r.clock += 0.1 * r.speed;
  if (ahead.t > r.clock + 30) r.clock = ahead.t;   // skip quiet stretches and gaps in the recording
  let j = r.qi;
  while (j < r.queue.length && r.queue[j].t <= r.clock) j++;
  if (j > r.qi) { r.feed.push(r.queue.slice(r.qi, j)); r.qi = j }
  if (r.qi > 50_000) { r.queue = r.queue.slice(r.qi); r.qi = 0 }
}
async function load(r: Replay) {
  r.loading = true;
  try {
    const pg = await pageOf(r.sym, 0, r.next!);
    if (rp !== r) return;
    for (const p of strip(pg.prints)) r.queue.push(p);
    r.next = pg.next; r.error = '';
  } catch (e) { r.error = (e as Error).message } finally { r.loading = false }
}
export function stopReplay() { if (rp) { clearInterval(rp.timer); rp = null } }
export function replayControl(c: { paused?: boolean; speed?: number; skip?: number }) {
  if (!rp) return;
  if (c.paused != null) rp.paused = c.paused;
  if (c.speed) rp.speed = c.speed;
  if (c.skip) rp.clock += c.skip;
  rp.feed.onPrints.forEach(f => f([]));
}
export const replayPaused = () => !!rp?.paused;
/** Step back `sec` seconds: the replay starts again from there (prints can't be un-pushed), keeping speed and pause. */
export async function replayBack(sec: number) {
  if (!rp) return;
  const { sym, tf, clock, speed, paused } = rp;
  await startReplay(sym, tf, clock - sec, speed);
  if (rp) rp.paused = paused;
}

/** Prints for the order-flow layer when they come from a feed here (replay, activity interval); null = the normal live path. */
export function ofFeed(sym: string, tf: string): Feed | null {
  if (replayOn(sym, tf)) return rp!.feed;
  const spec = parseOfTf(tf);
  return spec && hasOrderFlow(sym) ? liveFeed(sym, tf, spec) : null;
}

barHooks.push({
  fetch: (sym, tf, end) => {
    if (replayOn(sym, tf)) { const f = rp!.feed; return end != null ? (f.cut > -Infinity ? null : Promise.resolve([])) : f.ready.then(() => f.bars()) }
    const spec = parseOfTf(tf);
    if (!spec) return null;
    if (end != null) return Promise.resolve([]);   // shortcut: no paging further back than the first load (server recording, else the loaded trades)
    if (!hasOrderFlow(sym)) return Promise.reject(Error('Tick, range, reversal and delta intervals need a crypto symbol'));
    const f = liveFeed(sym, tf, spec);
    return f.ready.then(() => { f.release(30_000); return f.bars() });
  },
  stream: (sym, tf, on) => {
    const f = replayOn(sym, tf) ? rp!.feed : parseOfTf(tf) ? live.get(`${sym}|${tf}`) : undefined;
    if (!f) return parseOfTf(tf) ? () => {} : null;
    f.onBar.add(on);
    return () => { f.onBar.delete(on); f.release() };
  },
});
