// Records the live crypto market components (total cap, BTC, ETH, USDT, USDC, stablecoins, top 10) every 5 minutes, so the
// series is exact from the day recording starts. Private mode only (app.ts imports this file there): one small table,
// capped at MAX_ROWS (about 1.4 years at 5 minutes). Nothing is recorded while CoinGecko cannot be reached.
import { db, migration } from '../core/db.ts';
import type { Comp, Snap } from '../../src/market/dominance.ts';
import { dom, setStore } from './index.ts';

migration('dominance/1', `CREATE TABLE dom_snap (t INTEGER PRIMARY KEY, total REAL NOT NULL, btc REAL NOT NULL, eth REAL NOT NULL, usdt REAL NOT NULL, usdc REAL NOT NULL, stable REAL NOT NULL, top10 REAL NOT NULL)`);
export const MAX_ROWS = 150_000, EVERY = 300_000;
type Row = { t: number } & Comp;
const toSnap = ({ t, ...c }: Row): Snap => ({ t, c });

export function add(s: Snap) {
  const c = s.c;
  db.prepare('INSERT OR REPLACE INTO dom_snap (t, total, btc, eth, usdt, usdc, stable, top10) VALUES (?,?,?,?,?,?,?,?)').run(s.t, c.total, c.btc, c.eth, c.usdt, c.usdc, c.stable, c.top10);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM dom_snap').get() as { n: number }).n;
  if (n > MAX_ROWS) db.prepare('DELETE FROM dom_snap WHERE t IN (SELECT t FROM dom_snap ORDER BY t LIMIT ?)').run(n - MAX_ROWS);
}
export const read = (from: number, to: number): Snap[] => (db.prepare('SELECT * FROM dom_snap WHERE t >= ? AND t < ? ORDER BY t LIMIT ?').all(from, to, MAX_ROWS) as unknown as Row[]).map(toSnap);
export const first = (): Snap | null => { const r = db.prepare('SELECT * FROM dom_snap ORDER BY t LIMIT 1').get() as unknown as Row | undefined; return r ? toSnap(r) : null };

/** One recording attempt; a stale snapshot (CoinGecko unreachable) is not recorded as if it were new. */
export async function tick() {
  const n = await dom.now();
  if (!n.stale && n.c.btc > 0 && n.c.eth > 0) add({ t: n.t, c: n.c });
}
setStore({ read, first });
if (!process.env['CT_NO_AUTOSTART']) {
  const run = () => tick().catch(e => console.error(`[dominance] ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 160)}`));
  setTimeout(run, 5000).unref();
  setInterval(run, EVERY).unref();
}
