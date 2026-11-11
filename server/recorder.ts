// Trade recording (docs/phase5-contracts.md §7): live prints of a user-chosen symbol list kept 30 days in SQLite, so the
// order-flow footprint can show more history than the exchange's recent-trades endpoint gives.
import { db, migration, configGet, configSet } from './core/db.ts';
import { route, bad } from './core/http.ts';
import { isExprSym } from './core/bars.ts';
import { isRemote, splitSym } from '../src/data.ts';
import { watchPrints } from './ccxt.ts';
import type { Print } from '../src/orderflow/model.ts';
import { BarBuilder, parseOfTf } from '../src/orderflow/tfbars.ts';
import type { Bar } from '../src/data.ts';

migration('recorder/1', `
  CREATE TABLE prints (sym TEXT NOT NULL, t REAL NOT NULL, px REAL NOT NULL, qty REAL NOT NULL, buy INTEGER NOT NULL, id INTEGER);
  CREATE INDEX prints_sym_t ON prints (sym, t);
  CREATE TABLE prints_days (sym TEXT NOT NULL, day INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (sym, day));`);

/** A print plus the exchange's trade id when it has a sequential one (Binance aggregate trade id). */
type RecPrint = Print & { id?: number };
/** lastId: Binance's last aggregate trade id; since: time (ms) of the last recorded print, for sources without ids. */
export type Source = (sym: string, lastId: number | undefined, on: (ps: RecPrint[]) => void, since?: number) => () => void;

export const RETENTION_DAYS = 30, MAX_ROWS = 200_000;
const BYTES_PER_ROW = 64;   // row + (sym, t) index entry, measured roughly; stats are approximate by design
const DAY = 86400;

/** `BINANCE:BTCUSDT` and `btcusdt` are the same recording as `BTCUSDT`. */
export const normSym = (s: string) => { const x = s.trim().replace(/^BINANCE:/i, ''); return isRemote(x) ? x : x.toUpperCase() };

// ---------- Binance aggTrade stream with gap backfill ----------
const API = 'https://data-api.binance.vision/api/v3', WS = 'wss://data-stream.binance.vision';
type Agg = { a: number; p: string; q: string; T: number; m: boolean };
const fromAgg = (x: Agg): RecPrint => ({ t: x.T / 1000, px: +x.p, qty: +x.q, buy: !x.m, id: x.a });
type WsLike = { onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; close(): void };
interface BinanceIo { WebSocket: new (url: string) => WsLike; fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>; maxPages: number; maxDelay: number }

/**
 * Live aggTrades for one symbol. Reconnects with exponential backoff; after a (re)connect, pages the REST endpoint from the
 * last id seen so the gap is filled, holding stream messages until the backfill catches up. Ids never repeat or go back.
 */
export function binanceSource(sym: string, lastId: number | undefined, on: (ps: RecPrint[]) => void, io: BinanceIo = { WebSocket: globalThis.WebSocket as never, fetch: globalThis.fetch, maxPages: 100, maxDelay: 60_000 }): () => void {
  let alive = true, ws: WsLike | null = null, delay = 1000, last = lastId, filling = false, held: Agg[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (rows: Agg[]) => {
    const ps = rows.filter(r => last == null || r.a > last);
    if (ps.length && alive) { last = ps.at(-1)!.a; on(ps.map(fromAgg)) }
  };
  const backfill = async () => {
    filling = true;
    try {
      // shortcut: capped at maxPages × 1000 trades per reconnect; a longer outage leaves a hole rather than hammering the API.
      for (let i = 0; i < io.maxPages && alive && last != null; i++) {
        const r = await io.fetch(`${API}/aggTrades?symbol=${sym}&fromId=${last + 1}&limit=1000`);
        if (!r.ok) break;
        const rows = (await r.json()) as Agg[];
        emit(rows);
        if (rows.length < 1000 || (held.length && held[0].a <= last)) break;   // reached the live stream
      }
    } catch { /* network: the stream still runs; the next reconnect retries */ }
    finally { filling = false; const h = held; held = []; emit(h) }
  };
  const connect = () => {
    const s = (ws = new io.WebSocket(`${WS}/ws/${sym.toLowerCase()}@aggTrade`));
    s.onopen = () => { delay = 1000; if (last != null) void backfill() };
    s.onmessage = e => { let a: Agg; try { a = JSON.parse(String(e.data)) } catch { return } if (typeof a.a !== 'number') return; if (filling) held.push(a); else emit([a]) };
    s.onclose = () => { if (!alive || ws !== s) return; timer = setTimeout(connect, Math.min(delay, io.maxDelay)); delay = Math.min(delay * 2, io.maxDelay) };
  };
  connect();
  return () => { alive = false; clearTimeout(timer); ws?.close() };
}

/** Binance plain symbols via the aggTrade stream; EXCH:SYMBOL via CCXT (gap backfill by time, see watchPrints). */
const liveSource: Source = (sym, lastId, on, since) => {
  if (!isRemote(sym)) return binanceSource(sym, lastId, on);
  const { exchange, symbol } = splitSym(sym);
  return watchPrints(exchange, symbol, on, since);
};

/** Swappable for tests. */
export const deps = { source: liveSource, now: () => Date.now(), batchRows: 2000 };

// ---------- storage ----------
const ins = db.prepare('INSERT INTO prints (sym, t, px, qty, buy, id) VALUES (?, ?, ?, ?, ?, ?)');
const bumpDay = db.prepare('INSERT INTO prints_days (sym, day, n) VALUES (?, ?, ?) ON CONFLICT(sym, day) DO UPDATE SET n = n + excluded.n');
let buf: { sym: string; p: RecPrint }[] = [], flushTimer: ReturnType<typeof setTimeout> | undefined;

export function add(sym: string, ps: RecPrint[]) {
  for (const p of ps) if (Number.isFinite(p.t) && Number.isFinite(p.px) && Number.isFinite(p.qty)) buf.push({ sym, p });
  if (buf.length >= deps.batchRows) flush();
  // Armed on demand instead of a 1 s interval, so an idle recorder never wakes the CPU.
  else if (buf.length && !flushTimer && !process.env.CT_NO_AUTOSTART) flushTimer = setTimeout(() => { flushTimer = undefined; flush() }, 1000).unref();
}
/** Write buffered prints in one transaction (called every second and whenever the buffer reaches batchRows). */
export function flush() {
  if (!buf.length) return;
  const rows = buf; buf = [];
  const days = new Map<string, number>();
  db.exec('BEGIN');
  try {
    for (const { sym, p } of rows) {
      ins.run(sym, p.t, p.px, p.qty, p.buy ? 1 : 0, p.id ?? null);
      const k = `${sym}|${Math.floor(p.t / DAY)}`; days.set(k, (days.get(k) ?? 0) + 1);
    }
    for (const [k, n] of days) { const i = k.lastIndexOf('|'); bumpDay.run(k.slice(0, i), +k.slice(i + 1), n) }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); console.error(`[recorder] dropped ${rows.length} prints: ${(e as Error).message}`) }
}

/** Delete prints older than the retention window. */
export function prune(nowMs = deps.now()) {
  flush();
  const cutoff = nowMs / 1000 - RETENTION_DAYS * DAY, cutDay = Math.floor(cutoff / DAY);
  for (const { sym } of db.prepare('SELECT DISTINCT sym FROM prints_days').all() as { sym: string }[]) {
    db.prepare('DELETE FROM prints WHERE sym = ? AND t < ?').run(sym, cutoff);
    const left = db.prepare('SELECT COUNT(*) AS n FROM prints WHERE sym = ? AND t >= ? AND t < ?').get(sym, cutDay * DAY, (cutDay + 1) * DAY) as { n: number };
    db.prepare('UPDATE prints_days SET n = ? WHERE sym = ? AND day = ?').run(left.n, sym, cutDay);
  }
  db.prepare('DELETE FROM prints_days WHERE day < ? OR n = 0').run(cutDay);
}

/** Prints of one symbol, oldest first. With `from`: the first `limit` from there on; without: the newest `limit` up to `to`. */
export function query(sym: string, from?: number, to?: number, limit = MAX_ROWS): RecPrint[] {
  flush();
  const lo = from ?? -Infinity, hi = to ?? Infinity, n = Math.min(MAX_ROWS, Math.max(1, limit));
  const sql = `SELECT t, px, qty, buy, id FROM prints WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t ${from != null ? 'ASC' : 'DESC'}, rowid ${from != null ? 'ASC' : 'DESC'} LIMIT ?`;
  const rows = db.prepare(sql).all(normSym(sym), lo, hi, n) as { t: number; px: number; qty: number; buy: number; id: number | null }[];
  if (from == null) rows.reverse();
  return rows.map(r => (r.id == null ? { t: r.t, px: r.px, qty: r.qty, buy: !!r.buy } : { t: r.t, px: r.px, qty: r.qty, buy: !!r.buy, id: r.id }));
}

/**
 * Forward paging for Market Replay: up to `limit` prints from `from` on (or strictly after `cursor`), plus the cursor of
 * the next page (null at the end). The cursor is "t:rowid", so prints sharing one timestamp are never split or repeated.
 */
export function page(sym: string, from: number, cursor?: string, limit = 10_000): { prints: RecPrint[]; next: string | null } {
  flush();
  const [ct, cr] = cursor ? cursor.split(':').map(Number) : [from, -1], n = Math.min(MAX_ROWS, Math.max(1, limit));
  if (!Number.isFinite(ct) || !Number.isFinite(cr)) throw bad('Bad cursor');
  // t = ct AND rowid > cr, then t > ct: two index range scans instead of one OR the planner might not split.
  const cols = 'rowid AS r, t, px, qty, buy, id';
  const rows = db.prepare(`SELECT * FROM (
      SELECT * FROM (SELECT ${cols} FROM prints WHERE sym = ? AND t = ? AND rowid > ? ORDER BY rowid LIMIT ?)
      UNION ALL SELECT * FROM (SELECT ${cols} FROM prints WHERE sym = ? AND t > ? ORDER BY t, rowid LIMIT ?)
    ) ORDER BY t, r LIMIT ?`).all(normSym(sym), ct, cr, n, normSym(sym), ct, n, n) as { r: number; t: number; px: number; qty: number; buy: number; id: number | null }[];
  const prints = rows.map(r => (r.id == null ? { t: r.t, px: r.px, qty: r.qty, buy: !!r.buy } : { t: r.t, px: r.px, qty: r.qty, buy: !!r.buy, id: r.id }));
  const last = rows.at(-1);
  return { prints, next: rows.length === n && last ? `${last.t}:${last.r}` : null };
}

/**
 * Activity bars (100T, R10, REV5, D500) of the recording before `before`, over the last `days` (at most the retention):
 * far more history than the trades a browser loads itself. The newest `max` bars are returned.
 */
export function recordedBars(sym: string, tf: string, before: number, days: number, tick: number, max = 20_000): Bar[] {
  const spec = parseOfTf(tf);
  if (!spec || spec.kind === 'time') throw bad('tf must be an activity interval such as 100T, R10, REV5 or D500');
  const b = new BarBuilder(spec, tick);
  let cursor: string | undefined, from = before - Math.min(RETENTION_DAYS, Math.max(1, days)) * DAY;
  for (;;) {
    const pg = page(sym, from, cursor, 50_000);
    for (const p of pg.prints) { if (p.t >= before) return b.bars.slice(-max); b.push(p) }
    if (!pg.next) break;
    cursor = pg.next;
    if (b.bars.length > max * 2) b.bars.splice(0, b.bars.length - max - 1);   // keep the forming bar and enough history
  }
  return b.bars.slice(-max);
}

export function stats(symbols = config().symbols) {
  flush();
  const syms = [...new Set([...symbols, ...(db.prepare('SELECT DISTINCT sym FROM prints_days').all() as { sym: string }[]).map(r => r.sym)])];
  return syms.map(sym => {
    const count = (db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM prints_days WHERE sym = ?').get(sym) as { n: number }).n;
    const first = db.prepare('SELECT t FROM prints WHERE sym = ? ORDER BY t ASC LIMIT 1').get(sym) as { t: number } | undefined;
    const last = db.prepare('SELECT t FROM prints WHERE sym = ? ORDER BY t DESC LIMIT 1').get(sym) as { t: number } | undefined;
    return { sym, from: first?.t ?? null, to: last?.t ?? null, count, approxBytes: count * BYTES_PER_ROW };
  });
}

// ---------- live recording ----------
export const config = () => configGet<{ symbols: string[] }>('recorder', { symbols: ['BTCUSDT', 'ETHUSDT'] });
const live = new Map<string, () => void>();

/** Start/stop sources so exactly the configured symbols record. */
export function apply() {
  const want = new Set(config().symbols);
  for (const [sym, stop] of live) if (!want.has(sym)) { stop(); live.delete(sym) }
  for (const sym of want) if (!live.has(sym)) {
    // Backfill only a recent gap (e.g. a server restart); an old recording just starts again from now.
    const lastRow = db.prepare('SELECT t, id FROM prints WHERE sym = ? ORDER BY t DESC LIMIT 1').get(sym) as { t: number; id: number | null } | undefined;
    const recent = !!lastRow && deps.now() / 1000 - lastRow.t < 3600;
    const lastId = recent && lastRow!.id != null ? lastRow!.id : undefined, since = recent && lastRow!.id == null ? lastRow!.t * 1000 : undefined;
    try { live.set(sym, deps.source(sym, lastId, ps => add(sym, ps), since)) } catch (e) { console.error(`[recorder] ${sym}: ${(e as Error).message}`) }
  }
}
export function stopAll() { flush(); live.forEach(s => s()); live.clear() }

function setSymbols(b: unknown) {
  const s = (b as { symbols?: unknown } | undefined)?.symbols;
  if (!Array.isArray(s) || s.length > 20) throw bad('symbols: up to 20 symbols');
  const out: string[] = [];
  for (const x of s) {
    if (typeof x !== 'string') throw bad('Bad symbol');
    const sym = normSym(x);
    if (!/^([A-Z0-9]+:)?[A-Za-z0-9_.\-/]{1,40}$/.test(sym) || isExprSym(sym) || sym.startsWith('FX:')) throw bad(`Cannot record ${x}`);
    if (!out.includes(sym)) out.push(sym);
  }
  configSet('recorder', { symbols: out });
  apply();
}

const info = () => ({ symbols: config().symbols, retentionDays: RETENTION_DAYS, stats: stats() });
route('GET', '/api/recorder', info);
route('PUT', '/api/recorder', c => { setSymbols(c.body); return info() });
route('GET', '/api/recorder/trades', c => {
  const q = c.url.searchParams, num = (k: string) => { const v = q.get(k); if (v == null || v === '') return undefined; const n = Number(v); if (!Number.isFinite(n)) throw bad(`Bad ${k}`); return n };
  const sym = q.get('sym');
  if (!sym) throw bad('sym required');
  return query(sym, num('from'), num('to'), num('limit') ?? MAX_ROWS);
});
route('GET', '/api/recorder/page', c => {
  const q = c.url.searchParams, sym = q.get('sym'), from = Number(q.get('from')), limit = Number(q.get('limit') || 10_000);
  if (!sym) throw bad('sym required');
  if (!Number.isFinite(from) || !Number.isFinite(limit)) throw bad('from must be a number (seconds)');
  return page(sym, from, q.get('cursor') || undefined, limit);
});

route('GET', '/api/recorder/bars', c => {
  const q = c.url.searchParams, sym = q.get('sym'), tf = q.get('tf') ?? '', before = Number(q.get('before')), days = Number(q.get('days') || 7), tick = Number(q.get('tick') || 0);
  if (!sym) throw bad('sym required');
  if (![before, days, tick].every(Number.isFinite)) throw bad('before, days and tick must be numbers');
  return recordedBars(sym, tf, before, days, tick);
});

if (!process.env.CT_NO_AUTOSTART) {
  setTimeout(() => { prune(); setInterval(() => prune(), DAY * 1000).unref() }, 60_000).unref();
  setImmediate(apply);
  process.on('exit', flush);
}
