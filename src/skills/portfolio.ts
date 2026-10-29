// Portfolio skills (trader-budget, trader-rebalance, trader-risk) on the paper account: target weights → sized buys,
// drift → rebalancing trades, and a per-order rule check. All outputs are PROPOSALS; orders still go through the
// order ticket and the broker guard.
import { money, num, pct, type Ctx, type Skill } from './types.ts';

const EPS = 1e-9;
export interface Rules { cashBufferPct: number; maxPositionPct: number; maxOrder: number; minOrder: number; fractional: boolean; blocked: string[] }
export const RULES: Rules = { cashBufferPct: 10, maxPositionPct: 25, maxOrder: 2000, minOrder: 5, fractional: true, blocked: [] };

/** Proportional to weight; a slice over the cap is pinned at the cap and the rest is shared over the others, repeated. */
export function capped(weights: Record<string, number>, money_: number, cap: number) {
  const alloc: Record<string, number> = {}, capd = new Set<string>(), active = new Map(Object.entries(weights));
  let left = money_;
  while (active.size) {
    const wsum = [...active.values()].reduce((s, w) => s + w, 0), trial = new Map([...active].map(([t, w]) => [t, (left * w) / wsum]));
    const over = [...trial].filter(([, v]) => v > cap + EPS).map(([t]) => t);
    if (!over.length) { for (const [t, v] of trial) alloc[t] = v; break }
    for (const t of over) { alloc[t] = cap; capd.add(t); left -= cap; active.delete(t) }
    if (left <= EPS) { for (const t of active.keys()) alloc[t] = 0; break }
  }
  return { alloc, capd };
}

/** trader-budget: budget + target weights → dollars per symbol (cash buffer, cap, minimum order, whole units if asked). */
export function sizeBudget(weights: Record<string, number>, budget: number, r: Rules, prices: Record<string, number> = {}) {
  if (!(budget > 0)) throw new Error('Enter a budget');
  if (!(r.cashBufferPct >= 0 && r.cashBufferPct < 100)) throw new Error('Cash buffer must be 0–99%');
  if (!(r.maxPositionPct > 0 && r.maxPositionPct <= 100)) throw new Error('Max position must be 1–100%');
  const blocked = new Set(r.blocked.map(b => b.toUpperCase())), dropped: { sym: string; why: string }[] = [];
  let keep = Object.entries(weights).filter(([t, w]) => { if (blocked.has(t)) { dropped.push({ sym: t, why: 'on your blocked list' }); return false } if (!(w > 0)) { dropped.push({ sym: t, why: 'weight is zero or negative' }); return false } return true });
  if (!keep.length) throw new Error('Nothing to size: no weights left');
  const buffer = Math.round(budget * r.cashBufferPct) / 100, investable = Math.round((budget - buffer) * 100) / 100, cap = Math.round(budget * r.maxPositionPct) / 100;
  const whole = !r.fractional;
  if (whole) { const miss = keep.filter(([t]) => !prices[t]).map(([t]) => t); if (miss.length) throw new Error(`Whole units need a price for ${miss.join(', ')}`) }
  for (;;) {
    const tot = keep.reduce((s, [, w]) => s + w, 0), w = Object.fromEntries(keep.map(([t, x]) => [t, (100 * x) / tot]));
    const { alloc, capd } = capped(w, investable, cap), order = Object.keys(alloc).sort((a, b) => alloc[b] - alloc[a]);
    // Round to whole dollars (cents for whole units) and keep the total: the exact total rounded DOWN, the difference
    // given to the biggest uncapped slices, never over the cap.
    const unit = whole ? 0.01 : 1, U = (x: number) => Math.floor(x / unit + EPS), capU = U(cap);
    const u = Object.fromEntries(order.map(t => [t, capd.has(t) ? capU : Math.floor(alloc[t] / unit + 0.5 + EPS)]));
    let diff = U(Object.values(alloc).reduce((s, v) => s + v, 0)) - Object.values(u).reduce((s, v) => s + v, 0);
    for (let g = 0; diff !== 0 && g < 100000; g++) { let moved = false; for (const t of order) { if (!diff) break; if (capd.has(t)) continue; if (diff > 0 && u[t] + 1 <= capU) { u[t]++; diff--; moved = true } else if (diff < 0 && u[t] > 0) { u[t]--; diff++; moved = true } } if (!moved) break }
    let dollars = Object.fromEntries(order.map(t => [t, Math.round(u[t] * unit * 100) / 100]));
    let units: Record<string, number> | null = null;
    if (whole) {
      units = Object.fromEntries(order.map(t => [t, dollars[t] > 0 ? Math.floor(dollars[t] / prices[t] + EPS) : 0]));
      let left = order.reduce((s, t) => s + dollars[t], 0) - order.reduce((s, t) => s + units![t] * prices[t], 0);
      for (;;) {   // one more unit for the slice furthest below its dollars, while cash lasts and the cap holds
        let best: string | null = null, gap = -Infinity;
        for (const t of order) { const p = prices[t]; if (p > left + EPS || (units[t] + 1) * p > cap + EPS) continue; const g = dollars[t] - units[t] * p; if (g > gap + EPS) { best = t; gap = g } }
        if (!best) break;
        units[best]++; left -= prices[best];
      }
      dollars = Object.fromEntries(order.map(t => [t, Math.round(units![t] * prices[t] * 100) / 100]));
    }
    const small = keep.filter(([t]) => dollars[t] < r.minOrder - EPS);
    if (!small.length) {
      const positions = order.map(t => ({ sym: t, weight: w[t], dollars: dollars[t], capped: capd.has(t), price: prices[t], units: units ? units[t] : prices[t] ? +(dollars[t] / prices[t]).toFixed(6) : undefined }));
      const invested = Math.round(positions.reduce((s, p) => s + p.dollars, 0) * 100) / 100;
      return { buffer, investable, cap, positions, invested, idle: Math.round((investable - invested) * 100) / 100, dropped };
    }
    const worst = small.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
    dropped.push({ sym: worst[0], why: whole && units?.[worst[0]] === 0 ? `one unit costs ${money(prices[worst[0]])}, more than its slice` : `its slice (${money(dollars[worst[0]])}) is under your ${money(r.minOrder)} minimum order` });
    keep = keep.filter(([t]) => t !== worst[0]);
    if (!keep.length) throw new Error('Every slice is under your minimum order: raise the budget or hold fewer symbols');
  }
}

export interface Holding { sym: string; qty: number }
/** trader-rebalance: drift from target weights beyond the band → sells first, then buys (scaled to free cash). */
export function rebalance(holdings: Holding[], cash: number, prices: Record<string, number>, weights: Record<string, number>, r: Rules, band = 5) {
  const held = Object.fromEntries(holdings.map(h => [h.sym, h.qty])), need = [...new Set([...Object.keys(held), ...Object.keys(weights)])];
  const miss = need.filter(t => !prices[t]);
  if (miss.length) throw new Error(`No price for ${miss.join(', ')}`);
  const value = Object.fromEntries(need.map(t => [t, (held[t] ?? 0) * prices[t]])), total = cash + Object.values(value).reduce((s, v) => s + v, 0);
  if (total <= 0) throw new Error('The account is empty: use the budget skill for a first buy');
  const buf = (total * r.cashBufferPct) / 100, cap = (total * r.maxPositionPct) / 100, target = capped(weights, total - buf, cap).alloc;
  const rows: (string | number)[][] = [], sells: { sym: string; usd: number; why: string }[] = [], buys: { sym: string; usd: number; why: string }[] = [], notes: string[] = [], orders: { sym: string; side: 'buy' | 'sell'; qty: number; usd: number; why: string }[] = [];
  for (const t of need.sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a.localeCompare(b))) {
    const tgt = target[t] ?? 0, cur = (100 * value[t]) / total, tp = (100 * tgt) / total, drift = cur - tp;
    let action = 'hold';
    if (!(t in weights)) action = 'untracked, left alone';
    else if (Math.abs(drift) > band + EPS) {
      const why = `drifted ${drift >= 0 ? '+' : ''}${drift.toFixed(1)} points from its ${tp.toFixed(1)}% target (band ${band})`, delta = tgt - value[t];
      if (delta < 0) { sells.push({ sym: t, usd: -delta, why }); action = 'sell' } else { buys.push({ sym: t, usd: delta, why }); action = 'buy' }
    }
    rows.push([t, +(held[t] ?? 0).toFixed(6), money(value[t]), pct(cur, 1), pct(tp, 1), `${drift >= 0 ? '+' : ''}${drift.toFixed(1)}`, action]);
  }
  const floorQ = (q: number) => (r.fractional ? Math.floor(q * 10000 + EPS) / 10000 : Math.floor(q + EPS));
  let cashAfter = cash;
  for (const s of sells) {
    let usd = s.usd;
    if (r.maxOrder && usd > r.maxOrder + EPS) { notes.push(`${s.sym} sell cut to your ${money(r.maxOrder)} max order; run again after it fills`); usd = r.maxOrder }
    const qty = Math.min(floorQ(usd / prices[s.sym]), held[s.sym] ?? 0);
    if (qty <= EPS || qty * prices[s.sym] < r.minOrder - EPS) { notes.push(`${s.sym} sell under your minimum order: skipped`); continue }
    cashAfter += qty * prices[s.sym]; orders.push({ sym: s.sym, side: 'sell', qty, usd: qty * prices[s.sym], why: s.why });
  }
  const spendable = Math.max(cashAfter - buf, 0), want = buys.reduce((s, b) => s + b.usd, 0);
  const scale = want > spendable + EPS ? (want ? spendable / want : 0) : 1;
  if (scale < 1) notes.push(`Buys scaled to ${Math.round(scale * 100)}%: only ${money(spendable)} is free above your ${money(buf)} cash buffer`);
  for (const b of buys) {
    let usd = b.usd * scale;
    if (r.maxOrder && usd > r.maxOrder + EPS) { notes.push(`${b.sym} buy cut to your ${money(r.maxOrder)} max order; run again after it fills`); usd = r.maxOrder }
    const qty = floorQ(usd / prices[b.sym]);
    if (qty <= EPS || qty * prices[b.sym] < r.minOrder - EPS) { notes.push(`${b.sym} buy of ${money(usd)} under your minimum order: skipped`); continue }
    orders.push({ sym: b.sym, side: 'buy', qty, usd: qty * prices[b.sym], why: b.why });
  }
  return { total, buffer: buf, cap, rows, orders, notes };
}

export interface PropOrder { sym: string; side: 'buy' | 'sell'; qty?: number; notional?: number; type?: 'market' | 'limit' | 'stop'; price?: number }
/** trader-risk: every proposed order against the limits → PASS or BLOCK with reasons (cash, cap, buffer, size, short, duplicates, daily count). */
export function riskCheck(orders: PropOrder[], acct: { cash: number; positions: { sym: string; qty: number; px: number }[] }, prices: Record<string, number>, r: Rules & { maxOrdersPerDay: number; allowShort: boolean; placedToday?: number }) {
  const total = acct.cash + acct.positions.reduce((s, p) => s + p.qty * p.px, 0), buffer = (total * r.cashBufferPct) / 100, limit = (total * r.maxPositionPct) / 100;
  const held = new Map(acct.positions.map(p => [p.sym, p.qty])), blocked = new Set(r.blocked.map(b => b.toUpperCase())), seen = new Set<string>();
  let cash = acct.cash, count = r.placedToday ?? 0;
  return orders.map(o => {
    const reasons: string[] = [], sym = String(o.sym ?? '').toUpperCase();
    if (!sym) reasons.push('format: no symbol');
    if (o.side !== 'buy' && o.side !== 'sell') reasons.push('format: side must be buy or sell');
    if ((o.qty == null) === (o.notional == null)) reasons.push('format: give exactly one of qty or notional');
    if ((o.type === 'limit' || o.type === 'stop') && !(o.price! > 0)) reasons.push(`format: a ${o.type} order needs a price`);
    if (blocked.has(sym)) reasons.push(`blocked: ${sym} is on your blocked list`);
    const fp = JSON.stringify([sym, o.side, o.qty, o.notional, o.type, o.price]);
    if (seen.has(fp)) reasons.push('duplicate: the same order appears twice'); seen.add(fp);
    const ref = o.type === 'limit' || o.type === 'stop' ? o.price : prices[sym];
    const value = o.notional ?? (o.qty != null && ref ? o.qty * ref : undefined);
    if (value == null && o.qty != null) reasons.push(`price: no price for ${sym}`);
    if (value != null) {
      if (value < r.minOrder - 0.01) reasons.push(`size: ${money(value)} is under your ${money(r.minOrder)} minimum order`);
      if (r.maxOrder && value > r.maxOrder + 0.01) reasons.push(`size: ${money(value)} is over your ${money(r.maxOrder)} max order`);
      if (o.side === 'buy') {
        const after = cash - value, posAfter = ((held.get(sym) ?? 0) + (o.qty ?? value / (ref || 1))) * (ref || 0);
        if (after < -0.01) reasons.push(`cash: needs ${money(value)} but only ${money(cash)} cash; that would be margin`);
        else if (after < buffer - 0.01) reasons.push(`cash: leaves ${money(after)} cash, under your ${r.cashBufferPct}% buffer of ${money(buffer)}`);
        if (total > 0 && posAfter > limit + 0.01) reasons.push(`position: ${sym} would be ${money(posAfter)}, ${pct((100 * posAfter) / total, 1)} of the account, over your ${r.maxPositionPct}% cap`);
      } else {
        const q = o.qty ?? value / (ref || 1);
        if (q > (held.get(sym) ?? 0) + 1e-9 && !r.allowShort) reasons.push(`short: selling ${q} ${sym} but only ${held.get(sym) ?? 0} held; short sales are off`);
      }
    }
    if (count + 1 > r.maxOrdersPerDay) reasons.push(`daily limit: more than ${r.maxOrdersPerDay} orders today`);
    const pass = !reasons.length;
    if (pass) { count++; if (value != null) { if (o.side === 'buy') { cash -= value; held.set(sym, (held.get(sym) ?? 0) + (o.qty ?? value / (ref || 1))) } else { cash += value; held.set(sym, (held.get(sym) ?? 0) - (o.qty ?? value / (ref || 1))) } } }
    return { order: o, verdict: pass ? 'PASS' as const : 'BLOCK' as const, reasons };
  });
}

// ---------- panel ----------
const ruleInputs = [
  { key: 'cashBufferPct', label: 'Cash buffer %', type: 'number' as const, default: 10 },
  { key: 'maxPositionPct', label: 'Max position %', type: 'number' as const, default: 25 },
  { key: 'maxOrder', label: 'Max order', type: 'number' as const, default: 2000 },
  { key: 'minOrder', label: 'Min order', type: 'number' as const, default: 5 },
  { key: 'fractional', label: 'Fractional units', type: 'bool' as const, default: true },
  { key: 'blocked', label: 'Blocked symbols', type: 'text' as const, default: '', optional: true },
];
const readRules = (v: Record<string, unknown>): Rules => ({ cashBufferPct: num(v.cashBufferPct, 'Cash buffer', { min: 0, max: 99 }), maxPositionPct: num(v.maxPositionPct, 'Max position', { min: 1, max: 100 }), maxOrder: num(v.maxOrder, 'Max order', { min: 0 }), minOrder: num(v.minOrder, 'Min order', { min: 0 }), fractional: !!v.fractional, blocked: String(v.blocked ?? '').split(/[\s,]+/).filter(Boolean) });
const readWeights = (v: unknown) => {
  let o: unknown;
  try { o = JSON.parse(String(v ?? '{}')) } catch { throw new Error('Target weights: write JSON like {"BTCUSDT": 50, "ETHUSDT": 30}') }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Target weights: an object of symbol → weight');
  return Object.fromEntries(Object.entries(o).map(([k, w]) => [k.toUpperCase().trim(), num(w, `Weight of ${k}`)]));
};
async function pricesFor(syms: string[], ctx: Ctx) {
  const held = new Map(ctx.account().positions.map(p => [p.sym, p.px])), out: Record<string, number> = {};
  for (const s of syms) {
    if (held.get(s)) { out[s] = held.get(s)!; continue }
    try { const b = await ctx.bars(s, '1d'); if (b.length) out[s] = b.at(-1)!.close } catch { /* reported as missing */ }
  }
  return out;
}
const WEIGHTS_IN = { key: 'weights', label: 'Target weights (JSON)', type: 'json' as const, default: '{"BTCUSDT": 50, "ETHUSDT": 30, "SOLUSDT": 20}' };

export const budgetSkill: Skill = {
  id: 'trader-budget', name: 'Budget sizer', group: 'Portfolio', from: 'trader-budget',
  desc: 'Split a budget over target weights: cash buffer kept, no symbol over the cap (the excess is shared out), slices under the minimum dropped, every dollar used. Proposals only.',
  inputs: [{ key: 'budget', label: 'Budget', type: 'number', default: 5000 }, WEIGHTS_IN, ...ruleInputs],
  async run(v, ctx) {
    const w = readWeights(v.weights), r = readRules(v), prices = await pricesFor(Object.keys(w), ctx), s = sizeBudget(w, num(v.budget, 'Budget', { min: 0 }), r, prices);
    return {
      verdict: { label: `Invest ${money(s.invested)}`, tone: 'up', detail: `cash buffer ${money(s.buffer)}, idle ${money(s.idle)}` },
      tables: [{ title: 'Proposed buys', cols: ['Symbol', 'Weight', 'Amount', 'Units', 'Capped'], rows: s.positions.map(p => [p.sym, pct(p.weight, 1), money(p.dollars), p.units ?? '–', p.capped ? 'yes' : '']) },
        { title: 'Dropped', cols: ['Symbol', 'Why'], rows: s.dropped.map(d => [d.sym, d.why]) }],
      notes: ['Nothing is placed: use the order ticket for each buy (the account guard still applies).'],
    };
  },
};
export const rebalanceSkill: Skill = {
  id: 'trader-rebalance', name: 'Rebalancer', group: 'Portfolio', from: 'trader-rebalance',
  desc: 'Paper account vs. target weights: drift per symbol, trades only beyond the band, sells before buys, buys scaled to the cash above the buffer. Proposals only.',
  inputs: [WEIGHTS_IN, { key: 'band', label: 'Drift band (points)', type: 'number', default: 5 }, ...ruleInputs],
  async run(v, ctx) {
    const w = readWeights(v.weights), a = ctx.account(), prices = await pricesFor([...new Set([...Object.keys(w), ...a.positions.map(p => p.sym)])], ctx);
    const res = rebalance(a.positions.map(p => ({ sym: p.sym, qty: p.qty })), a.cash, prices, w, readRules(v), num(v.band, 'Band', { min: 0 }));
    return {
      verdict: { label: res.orders.length ? `${res.orders.length} trades proposed` : 'Within the band: nothing to do', tone: res.orders.length ? 'warn' : 'up', detail: `account ${money(res.total)}` },
      tables: [{ title: 'Drift', cols: ['Symbol', 'Units', 'Value', 'Now', 'Target', 'Drift', 'Action'], rows: res.rows }, { title: 'Proposed trades (sells first)', cols: ['Side', 'Symbol', 'Units', 'Amount', 'Why'], rows: res.orders.map(o => [o.side, o.sym, o.qty, money(o.usd), o.why]) }],
      notes: res.notes,
    };
  },
};
export const riskSkill: Skill = {
  id: 'trader-risk', name: 'Order risk check', group: 'Portfolio', from: 'trader-risk',
  desc: 'Check proposed orders against your limits before placing them: format, blocked list, min/max order, cash and buffer, position cap after the fill, short sales, duplicates, daily count.',
  inputs: [{ key: 'orders', label: 'Orders (JSON list)', type: 'json', default: '[{"sym": "BTCUSDT", "side": "buy", "notional": 1500}, {"sym": "ETHUSDT", "side": "sell", "qty": 1}]' },
    { key: 'maxOrdersPerDay', label: 'Max orders per day', type: 'number', default: 10 }, { key: 'allowShort', label: 'Allow short sales', type: 'bool', default: false }, ...ruleInputs],
  async run(v, ctx) {
    let orders: PropOrder[];
    try { orders = JSON.parse(String(v.orders)) } catch { throw new Error('Orders: a JSON list like [{"sym":"BTCUSDT","side":"buy","notional":500}]') }
    if (!Array.isArray(orders)) throw new Error('Orders: a JSON list');
    const a = ctx.account(), prices = await pricesFor([...new Set(orders.map(o => String(o.sym ?? '').toUpperCase()).filter(Boolean))], ctx);
    const res = riskCheck(orders, a, prices, { ...readRules(v), maxOrdersPerDay: num(v.maxOrdersPerDay, 'Max orders', { min: 1 }), allowShort: !!v.allowShort });
    const blocked = res.filter(x => x.verdict === 'BLOCK').length;
    return { verdict: { label: blocked ? `${blocked} of ${res.length} blocked` : `All ${res.length} pass`, tone: blocked ? 'dn' : 'up' }, tables: [{ title: 'Verdicts', cols: ['Order', 'Verdict', 'Reasons'], rows: res.map(x => [`${x.order.side} ${x.order.qty ?? money(x.order.notional!)} ${x.order.sym}`, x.verdict, x.reasons.join('; ')]) }] };
  },
};
