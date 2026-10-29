// Risk & sizing skills: position-sizer (fixed fractional, ATR, half-Kelly with position/sector caps).
import { money, num, pct, type Skill } from './types.ts';

/** Whole units unless fractional; floors to `precision` decimals (never rounds up past the risk budget). */
const floorQty = (q: number, fractional: boolean, precision = 4) => (fractional ? Math.floor(q * 10 ** precision + 1e-9) / 10 ** precision : Math.floor(q + 1e-9));

export interface SizeIn { account: number; entry: number; stop?: number; atr?: number; atrMult?: number; riskPct?: number; winRate?: number; avgWin?: number; avgLoss?: number; maxPositionPct?: number; maxSectorPct?: number; sectorExposure?: number; fractional?: boolean }
export interface SizeOut { method: 'fixed' | 'atr' | 'kelly'; stop?: number; riskPerUnit?: number; riskBudget: number; kellyPct?: number; halfKellyPct?: number; byRisk: number; qty: number; binding: string; value: number; riskDollars: number; riskPctFinal: number; caps: { name: string; max: number }[] }

/** position-sizer's three methods; portfolio caps then take the smallest quantity. */
export function sizePosition(p: SizeIn): SizeOut {
  if (!(p.account > 0) || !(p.entry > 0)) throw new Error('Account size and entry price must be positive');
  const frac = !!p.fractional, kelly = p.winRate != null && Number.isFinite(p.winRate);
  let method: SizeOut['method'] = 'fixed', stop = p.stop, kellyPct: number | undefined, halfKellyPct: number | undefined, riskBudget: number;
  if (kelly) {
    if (!(p.avgWin! > 0) || !(p.avgLoss! > 0)) throw new Error('Kelly needs average win and average loss');
    const w = p.winRate! / 100, r = p.avgWin! / p.avgLoss!;
    kellyPct = Math.max(0, w - (1 - w) / r) * 100; halfKellyPct = kellyPct / 2;
    method = 'kelly'; riskBudget = (p.account * halfKellyPct) / 100;
  } else riskBudget = (p.account * (p.riskPct ?? 1)) / 100;
  if (!kelly && p.atr != null && Number.isFinite(p.atr)) { method = 'atr'; stop = p.entry - p.atr * (p.atrMult ?? 2) }
  if (stop != null && Number.isFinite(stop) && stop >= p.entry) throw new Error('The stop must be below the entry (long trades)');
  const riskPerUnit = stop != null && Number.isFinite(stop) ? p.entry - stop : undefined;
  if (!kelly && riskPerUnit == null) throw new Error('Give a stop price or an ATR (or Kelly statistics)');
  // Kelly without a stop: the half-Kelly budget is the position value itself.
  const byRisk = floorQty(riskPerUnit ? riskBudget / riskPerUnit : riskBudget / p.entry, frac);
  const caps: SizeOut['caps'] = [];
  if (p.maxPositionPct) caps.push({ name: `Max position ${p.maxPositionPct}%`, max: floorQty((p.account * p.maxPositionPct) / 100 / p.entry, frac) });
  if (p.maxSectorPct) caps.push({ name: `Max sector ${p.maxSectorPct}%`, max: Math.max(0, floorQty((p.account * (p.maxSectorPct - (p.sectorExposure ?? 0))) / 100 / p.entry, frac)) });   // exposure in % of the account
  let qty = byRisk, binding = 'Risk budget';
  for (const c of caps) if (c.max < qty) { qty = c.max; binding = c.name }
  qty = Math.max(0, qty);
  const riskDollars = riskPerUnit ? qty * riskPerUnit : qty * p.entry;
  return { method, stop, riskPerUnit, riskBudget, kellyPct, halfKellyPct, byRisk, qty, binding, value: qty * p.entry, riskDollars, riskPctFinal: (riskDollars / p.account) * 100, caps };
}

export const positionSizer: Skill = {
  id: 'position-sizer', name: 'Position sizer', group: 'Risk & sizing', from: 'position-sizer',
  desc: 'How many units to buy for a long trade: fixed-fractional risk to a stop, an ATR stop, or half-Kelly from your win statistics, then capped by max position and max sector %.',
  inputs: [
    { key: 'account', label: 'Account size', type: 'number', default: 10000 },
    { key: 'entry', label: 'Entry price', type: 'number', default: 100 },
    { key: 'stop', label: 'Stop price', type: 'number', optional: true, hint: 'leave empty for ATR or Kelly' },
    { key: 'riskPct', label: 'Risk per trade %', type: 'number', default: 1 },
    { key: 'atr', label: 'ATR (instead of a stop)', type: 'number', optional: true },
    { key: 'atrMult', label: 'ATR multiplier', type: 'number', default: 2 },
    { key: 'winRate', label: 'Kelly: win rate %', type: 'number', optional: true },
    { key: 'avgWin', label: 'Kelly: average win', type: 'number', optional: true },
    { key: 'avgLoss', label: 'Kelly: average loss', type: 'number', optional: true },
    { key: 'maxPositionPct', label: 'Max position % of account', type: 'number', optional: true, default: 20 },
    { key: 'maxSectorPct', label: 'Max sector %', type: 'number', optional: true },
    { key: 'sectorExposure', label: 'Already in that sector (% of account)', type: 'number', optional: true },
    { key: 'fractional', label: 'Fractional units', type: 'bool', default: true },
  ],
  run(v) {
    const o = (k: string, name: string) => num(v[k], name, { optional: true });
    const r = sizePosition({
      account: num(v.account, 'Account size', { min: 0 }), entry: num(v.entry, 'Entry price', { min: 0 }), stop: o('stop', 'Stop'), riskPct: num(v.riskPct, 'Risk %', { min: 0, max: 100 }),
      atr: o('atr', 'ATR'), atrMult: num(v.atrMult, 'ATR multiplier', { min: 0 }), winRate: o('winRate', 'Win rate'), avgWin: o('avgWin', 'Average win'), avgLoss: o('avgLoss', 'Average loss'),
      maxPositionPct: o('maxPositionPct', 'Max position %') || undefined, maxSectorPct: o('maxSectorPct', 'Max sector %') || undefined, sectorExposure: o('sectorExposure', 'Sector exposure') || 0, fractional: !!v.fractional,
    });
    return {
      verdict: { label: `Buy ${r.qty} units`, tone: r.qty > 0 ? 'up' : 'warn', detail: `Binding limit: ${r.binding}` },
      kpis: [
        { label: 'Method', value: r.method === 'fixed' ? 'Fixed fractional' : r.method === 'atr' ? 'ATR stop' : 'Half-Kelly' },
        ...(r.stop != null && Number.isFinite(r.stop) ? [{ label: 'Stop', value: money(r.stop) }] : []),
        ...(r.kellyPct != null ? [{ label: 'Full / half Kelly', value: `${pct(r.kellyPct)} / ${pct(r.halfKellyPct!)}` }] : []),
        { label: 'Position value', value: money(r.value) }, { label: 'Risk at stop', value: `${money(r.riskDollars)} (${pct(r.riskPctFinal)})`, tone: 'dn' },
      ],
      tables: [{ title: 'Limits', cols: ['Limit', 'Max units'], rows: [['Risk budget', r.byRisk], ...r.caps.map(c => [c.name, c.max] as [string, number])] }],
      notes: r.kellyPct === 0 ? ['Negative expectancy: Kelly says do not take this trade.'] : [],
    };
  },
};

// ---------- futures-position-sizer ----------
/** [multiplier, tick size, product] — the original skill's verified table (all quoted in USD). */
export const FUTURES: Record<string, [number, number, string]> = {
  ES: [50, 0.25, 'E-mini S&P 500'], NQ: [20, 0.25, 'E-mini Nasdaq-100'], YM: [5, 1, 'E-mini Dow ($5)'], QR: [50, 0.1, 'E-mini Russell 2000 (RTY)'], VX: [1000, 0.05, 'VIX futures'],
  ZT: [2000, 0.00390625, '2-Year T-Note'], ZF: [1000, 0.0078125, '5-Year T-Note'], ZN: [1000, 0.015625, '10-Year T-Note'], ZB: [1000, 0.03125, '30-Year T-Bond'], DX: [1000, 0.005, 'U.S. Dollar Index'],
  E6: [125000, 0.00005, 'Euro FX (6E)'], J6: [12500000, 0.0000005, 'Japanese Yen (6J)'], B6: [62500, 0.0001, 'British Pound (6B)'], A6: [100000, 0.00005, 'Australian Dollar (6A)'], D6: [100000, 0.00005, 'Canadian Dollar (6C)'], S6: [125000, 0.00005, 'Swiss Franc (6S)'],
  GC: [100, 0.1, 'Gold'], SI: [5000, 0.005, 'Silver'], HG: [25000, 0.0005, 'Copper'], PL: [50, 0.1, 'Platinum'], CL: [1000, 0.01, 'WTI Crude Oil'], NG: [10000, 0.001, 'Henry Hub Natural Gas'], BT: [5, 5, 'Bitcoin (CME BTC)'],
};
export function sizeFutures(p: { symbol: string; long: boolean; entry: number; stop: number; account: number; riskPct: number; maxContracts?: number; multiplier?: number; tick?: number }) {
  const spec = FUTURES[p.symbol.toUpperCase()], mult = p.multiplier ?? spec?.[0], tick = p.tick ?? spec?.[1];
  if (!mult || !tick) throw new Error(`Unknown contract ${p.symbol}: give its multiplier and tick size`);
  if (p.long ? p.stop >= p.entry : p.stop <= p.entry) throw new Error(p.long ? 'A long stop must be below the entry' : 'A short stop must be above the entry');
  const onGrid = (x: number) => Math.abs(x / tick - Math.round(x / tick)) < 1e-6;
  if (!onGrid(p.entry) || !onGrid(p.stop)) throw new Error(`Entry and stop must be on the ${tick} tick grid`);
  const ticks = Math.round(Math.abs(p.entry - p.stop) / tick), rpc = ticks * tick * mult, budget = (p.account * p.riskPct) / 100;
  let contracts = Math.floor(budget / rpc + 1e-12), capped = false;
  if (p.maxContracts && contracts > p.maxContracts) { contracts = p.maxContracts; capped = true }
  return { ticks, points: Math.abs(p.entry - p.stop), rpc, budget, contracts, capped, totalRisk: contracts ? contracts * rpc : null, riskPctFinal: contracts ? (contracts * rpc * 100) / p.account : null, product: spec?.[2] ?? 'custom' };
}
export const futuresSizer: Skill = {
  id: 'futures-position-sizer', name: 'Futures position sizer', group: 'Options & futures', from: 'futures-position-sizer',
  desc: 'Contracts for a futures trade from entry, stop and the risk budget, using each contract\'s multiplier and tick (ES, NQ, GC, CL, ZB, 6E, BTC …). Never rounds up past the budget.',
  inputs: [
    { key: 'symbol', label: 'Contract', type: 'select', options: Object.keys(FUTURES), default: 'ES' },
    { key: 'side', label: 'Direction', type: 'select', options: ['long', 'short'], default: 'long' },
    { key: 'entry', label: 'Entry', type: 'number', default: 5000 }, { key: 'stop', label: 'Stop', type: 'number', default: 4980 },
    { key: 'account', label: 'Account (USD)', type: 'number', default: 100000 }, { key: 'riskPct', label: 'Risk %', type: 'number', default: 1 },
    { key: 'maxContracts', label: 'Max contracts', type: 'number', optional: true },
  ],
  run(v) {
    const r = sizeFutures({ symbol: String(v.symbol), long: v.side !== 'short', entry: num(v.entry, 'Entry', { min: 0 }), stop: num(v.stop, 'Stop', { min: 0 }), account: num(v.account, 'Account', { min: 0 }), riskPct: num(v.riskPct, 'Risk %', { min: 0, max: 100 }), maxContracts: num(v.maxContracts, 'Max contracts', { optional: true, min: 0 }) || undefined });
    return {
      verdict: r.contracts ? { label: `${r.contracts} contract${r.contracts > 1 ? 's' : ''}`, tone: 'up', detail: r.capped ? 'capped by max contracts' : r.product } : { label: 'No trade', tone: 'warn', detail: `one contract risks ${money(r.rpc)}, more than the ${money(r.budget)} budget` },
      kpis: [{ label: 'Stop distance', value: `${r.points} pts · ${r.ticks} ticks` }, { label: 'Risk per contract', value: money(r.rpc) }, { label: 'Risk budget', value: money(r.budget) }, { label: 'Total risk', value: r.totalRisk == null ? '–' : `${money(r.totalRisk)} (${pct(r.riskPctFinal!)})`, tone: 'dn' }],
      notes: ['Exchange margin is broker- and time-dependent and is not computed here.'],
    };
  },
};
