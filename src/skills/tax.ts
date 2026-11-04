// trader-tax (US rules, not tax advice): cost-basis lots of the paper account, unrealized gains by lot with short/long
// term, what a sale would realize (FIFO / highest cost first / specific lots), the 30-day wash-sale check, and
// tax-loss harvesting candidates. Lots come from the account's fills (sells consume the oldest lots, as filed by FIFO).
import { money, num, pct, type Ctx, type Skill } from './types.ts';

const DAY = 86400_000, EPS = 1e-9;
export interface Lot { id: string; sym: string; date: string; shares: number; cost: number }   // date YYYY-MM-DD, cost incl. fees
const FAMILIES = [['GOOGL', 'GOOG'], ['BRK.A', 'BRK.B'], ['FOXA', 'FOX'], ['NWSA', 'NWS'], ['LEN', 'LEN.B'], ['UA', 'UAA']];
const family = (t: string) => new Set(FAMILIES.find(f => f.includes(t)) ?? [t]);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Long term if sold after the first anniversary (a Feb 29 purchase rolls to Feb 28). */
export function anniversary(d: string) { const [y, m, dd] = d.split('-').map(Number); const a = new Date(Date.UTC(y + 1, m - 1, dd)); return a.getUTCMonth() !== m - 1 ? iso(Date.UTC(y + 1, m - 1, 28)) : iso(+a) }
const term = (acquired: string, sold: string) => (sold > anniversary(acquired) ? 'long' as const : 'short' as const);

/** Lots still held, rebuilt from fills in time order (buys open lots, sells close the oldest first). */
export function lotsFromFills(fills: { sym: string; side: 'buy' | 'sell'; qty: number; px: number; fee: number; ts: number }[]): Lot[] {
  const by = new Map<string, Lot[]>(), n = new Map<string, number>();
  for (const f of [...fills].sort((a, b) => a.ts - b.ts)) {
    const lots = by.get(f.sym) ?? [];
    by.set(f.sym, lots);
    if (f.side === 'buy') { const k = (n.get(f.sym) ?? 0) + 1; n.set(f.sym, k); lots.push({ id: `${f.sym}-${k}`, sym: f.sym, date: iso((f.ts > 1e11 ? f.ts : f.ts * 1000)), shares: f.qty, cost: f.qty * f.px + f.fee }) }
    else {
      let left = f.qty;
      while (left > EPS && lots.length) { const l = lots[0], take = Math.min(left, l.shares); l.cost -= (l.cost / l.shares) * take; l.shares -= take; left -= take; if (l.shares <= EPS) lots.shift() }
    }
  }
  return [...by.values()].flat();
}

function unrealized(lots: Lot[], prices: Record<string, number>, today: string) {
  return lots.filter(l => prices[l.sym]).map(l => { const value = l.shares * prices[l.sym]; return { ...l, value, gain: value - l.cost, term: term(l.date, today), longOn: iso(Date.parse(anniversary(l.date)) + DAY) } });
}

export function simulateSale(lots: Lot[], sym: string, shares: number, price: number, sold: string, method: 'fifo' | 'hifo' | 'specific' = 'fifo', ids: string[] = []) {
  const mine = lots.filter(l => l.sym === sym).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), held = mine.reduce((s, l) => s + l.shares, 0);
  if (shares > held + EPS) throw new Error(`Selling ${shares} but only ${+held.toFixed(8)} held`);
  const order = method === 'hifo' ? [...mine].sort((a, b) => b.cost / b.shares - a.cost / a.shares) : method === 'specific' ? ids.map(i => { const l = mine.find(x => x.id === i); if (!l) throw new Error(`No such lot: ${i}`); return l }) : mine;
  if (method === 'specific' && shares > order.reduce((s, l) => s + l.shares, 0) + EPS) throw new Error('The named lots hold fewer shares');
  const used: { id: string; acquired: string; shares: number; basis: number; proceeds: number; gain: number; term: 'short' | 'long' }[] = [];
  let left = shares;
  for (const l of order) { if (left <= EPS) break; const take = Math.min(left, l.shares), basis = (l.cost / l.shares) * take, proceeds = price * take; used.push({ id: l.id, acquired: l.date, shares: take, basis, proceeds, gain: proceeds - basis, term: term(l.date, sold) }); left -= take }
  const sum = (k: 'basis' | 'proceeds') => used.reduce((s, u) => s + u[k], 0), tm = (t: string) => used.filter(u => u.term === t).reduce((s, u) => s + u.gain, 0);
  return { used, proceeds: sum('proceeds'), basis: sum('basis'), gain: sum('proceeds') - sum('basis'), short: tm('short'), long: tm('long') };
}
/** Shares of the same security (or family) bought within 30 days before or after the sale and still held after it. */
export function washCheck(lots: Lot[], sym: string, sold: string, used: { id: string; shares: number }[]) {
  const fam = family(sym), from = new Map(used.map(u => [u.id, u.shares])), lo = iso(Date.parse(sold) - 30 * DAY), hi = iso(Date.parse(sold) + 30 * DAY);
  return lots.filter(l => fam.has(l.sym)).map(l => ({ l, keep: l.shares - (from.get(l.id) ?? 0) })).filter(x => x.keep > EPS && x.l.date >= lo && x.l.date <= hi).map(x => ({ sym: x.l.sym, date: x.l.date, shares: x.keep, lot: x.l.id }));
}
export const disallowed = (loss: number, sold: number, hits: { shares: number }[]) => (loss >= 0 || !hits.length || !sold ? 0 : -loss * Math.min(1, hits.reduce((s, h) => s + h.shares, 0) / sold));

export function harvest(lots: Lot[], prices: Record<string, number>, today: string, minLoss = 100, minPct = 0) {
  return [...new Set(lots.map(l => l.sym))].flatMap(sym => {
    const p = prices[sym], losers = lots.filter(l => l.sym === sym && p && l.shares * p < l.cost - 0.005);
    if (!losers.length) return [];
    const shares = losers.reduce((s, l) => s + l.shares, 0), cost = losers.reduce((s, l) => s + l.cost, 0), loss = shares * p - cost, lossPct = (100 * loss) / cost;
    if (-loss < minLoss || -lossPct < minPct) return [];
    const sale = simulateSale(lots, sym, shares, p, today, 'specific', losers.map(l => l.id)), wash = washCheck(lots, sym, today, sale.used);
    return [{ sym, shares, loss, lossPct, short: sale.short, long: sale.long, wash, disallowed: disallowed(sale.gain, shares, wash), rebuy: iso(Date.parse(today) + 31 * DAY) }];
  }).sort((a, b) => a.loss - b.loss);
}

export const taxSkill: Skill = {
  id: 'trader-tax', name: 'Tax lots & harvesting (US)', group: 'Portfolio', from: 'trader-tax',
  desc: 'US tax rules, not tax advice. Cost-basis lots of the paper account with short/long term, what a sale would realize by FIFO, highest cost or chosen lots, the 30-day wash-sale check, and tax-loss harvesting candidates.',
  inputs: [
    { key: 'mode', label: 'Show', type: 'select', options: ['Lots and gains', 'Simulate a sale', 'Harvest candidates'], default: 'Lots and gains' },
    { key: 'sym', label: 'Symbol (sale)', type: 'symbol', optional: true },
    { key: 'shares', label: 'Units to sell', type: 'number', optional: true },
    { key: 'price', label: 'Sale price (empty = current)', type: 'number', optional: true },
    { key: 'method', label: 'Lot method', type: 'select', options: ['fifo', 'hifo', 'specific'], default: 'fifo' },
    { key: 'ids', label: 'Specific lot ids', type: 'text', optional: true },
    { key: 'minLoss', label: 'Harvest: min loss', type: 'number', default: 100 },
  ],
  async run(v, ctx: Ctx) {
    const a = ctx.account(), lots = lotsFromFills(a.fills), today = iso(Date.now()), prices: Record<string, number> = Object.fromEntries(a.positions.map(p => [p.sym, p.px]));
    if (!lots.length) return { verdict: { label: 'No lots', tone: 'muted', detail: 'The paper account holds nothing bought through it' } };
    const notes = ['US federal rules (one-year holding period, 30-day wash sale). Not tax advice; check with a tax professional.'];
    if (v.mode === 'Simulate a sale') {
      const sym = String(v.sym || '').toUpperCase(), shares = num(v.shares, 'Units', { min: 0 }), px = num(v.price, 'Price', { optional: true });
      const price = Number.isFinite(px) ? px : prices[sym];
      if (!price) throw new Error(`No price for ${sym}`);
      const s = simulateSale(lots, sym, shares, price, today, v.method as 'fifo', String(v.ids ?? '').split(/[\s,]+/).filter(Boolean)), wash = s.gain < 0 ? washCheck(lots, sym, today, s.used) : [];
      const dis = disallowed(s.gain, shares, wash);
      return {
        verdict: { label: `${s.gain >= 0 ? 'Gain' : 'Loss'} ${money(s.gain)}`, tone: s.gain >= 0 ? 'up' : 'dn', detail: `short term ${money(s.short)}, long term ${money(s.long)}` },
        kpis: [{ label: 'Proceeds', value: money(s.proceeds) }, { label: 'Basis', value: money(s.basis) }, ...(dis ? [{ label: 'Disallowed (wash sale)', value: money(dis), tone: 'warn' as const }] : [])],
        tables: [{ title: 'Lots used', cols: ['Lot', 'Acquired', 'Units', 'Basis', 'Proceeds', 'Gain', 'Term'], rows: s.used.map(u => [u.id, u.acquired, +u.shares.toFixed(8), money(u.basis), money(u.proceeds), money(u.gain), u.term]) },
          { title: 'Wash-sale conflicts', cols: ['Symbol', 'Bought', 'Units', 'Lot'], rows: wash.map(w => [w.sym, w.date, +w.shares.toFixed(8), w.lot]) }],
        notes: [...(s.gain < 0 ? [`Do not buy ${sym} again before ${iso(Date.now() + 31 * DAY)} or the loss is disallowed (wash sale).`] : []), ...notes],
      };
    }
    if (v.mode === 'Harvest candidates') {
      const h = harvest(lots, prices, today, num(v.minLoss, 'Min loss', { min: 0 }));
      return { verdict: { label: h.length ? `${h.length} candidates` : 'Nothing to harvest', tone: h.length ? 'warn' : 'muted' }, tables: [{ title: 'Losing lots (proposals only)', cols: ['Symbol', 'Units', 'Loss', '%', 'Short', 'Long', 'Wash risk', 'Rebuy after'], rows: h.map(c => [c.sym, +c.shares.toFixed(8), money(c.loss), pct(c.lossPct, 1), money(c.short), money(c.long), c.wash.length ? `yes, ${money(c.disallowed)} disallowed` : 'no', c.rebuy]) }], notes };
    }
    const rows = unrealized(lots, prices, today);
    return { tables: [{ title: 'Lots', cols: ['Lot', 'Acquired', 'Units', 'Cost', 'Value', 'Gain', 'Term', 'Long term on'], rows: rows.map(r => [r.id, r.date, +r.shares.toFixed(8), money(r.cost), money(r.value), money(r.gain), r.term, r.longOn]) }], notes };
  },
};
