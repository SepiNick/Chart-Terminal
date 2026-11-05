// Exit strategies: one entry order that manages its own exits. When the entry fills, a stop and a ladder of
// take-profit targets are placed for it; as each target fills the stop shrinks to the rest of the position, can move to
// breakeven, and can turn into a trailing stop. (The multi-stage exits ATAS and NinjaTrader offer as "Exit Strategy"/ATM.)
// No DOM, no network. The paper engine (trading.ts) runs the plan; the text form below is what the order ticket takes.
//
//   sl 98 | sl 2%                         stop at a price, or a percentage from the entry
//   tp 1R 50%, 3R 50%                     targets: a price, "2R" (twice the stop distance) or "3%" from the entry; then the share of the position
//   be 1 [+0.1%]                          after target 1 fills, move the stop to the entry (plus an optional offset)
//   trail 1% 2 | trail 0.5 2              after target 2 fills, trail the stop 1% (or 0.5 price units) behind the best price
//   separate with ";" or new lines
export type Level = { price: number } | { pct: number } | { r: number };
export interface ExitPlan {
  sl: { price: number } | { pct: number };
  targets: { at: Level; qtyPct: number }[];
  /** `after`: 1-based number of the target whose fill triggers it. */
  breakeven?: { after: number; offsetPct?: number };
  trail?: { after: number; pct?: number; amount?: number };
}

const NUM = /^\d+(?:\.\d+)?$/;
const n = (s: string, what: string) => { if (!NUM.test(s)) throw new Error(`${what}: "${s}" is not a number`); const v = Number(s); if (!(v > 0)) throw new Error(`${what} must be above zero`); return v };
function level(tok: string, what: string): Level {
  if (/r$/.test(tok)) return { r: n(tok.slice(0, -1), what) };
  if (/%$/.test(tok)) return { pct: n(tok.slice(0, -1), what) };
  return { price: n(tok, what) };
}

/** Text → plan. Throws an Error with a readable message. */
export function parseExitPlan(text: string): ExitPlan {
  let sl: ExitPlan['sl'] | undefined, targets: ExitPlan['targets'] = [], breakeven: ExitPlan['breakeven'], trail: ExitPlan['trail'];
  for (const raw of text.toLowerCase().split(/[;\n]+/)) {
    const part = raw.trim().replace(/\s+/g, ' ');
    if (!part) continue;
    const [kw, ...rest] = part.split(' '), arg = rest.join(' ');
    if (kw === 'sl') {
      if (sl) throw new Error('Only one "sl"');
      const l = level(arg, 'Stop'); if ('r' in l) throw new Error('The stop is a price or a percentage, not R');
      sl = l;
    } else if (kw === 'tp') {
      if (targets.length) throw new Error('Only one "tp" line: list the targets with commas');
      const items = arg.split(',').map(s => s.trim()).filter(Boolean);
      if (!items.length) throw new Error('"tp" needs at least one target, e.g. tp 2R 100%');
      targets = items.map((it, i) => {
        const [v, q, ...extra] = it.split(' ');
        if (extra.length) throw new Error(`Target ${i + 1}: use "value share%", e.g. 2R 50%`);
        if (q === undefined && items.length > 1) throw new Error(`Target ${i + 1}: add its share of the position, e.g. ${v} 50%`);
        if (q !== undefined && !/%$/.test(q)) throw new Error(`Target ${i + 1}: the share must end in %`);
        const qtyPct = q === undefined ? 100 : n(q.slice(0, -1), `Target ${i + 1} share`);
        if (qtyPct > 100) throw new Error(`Target ${i + 1}: a share cannot be above 100%`);
        return { at: level(v, `Target ${i + 1}`), qtyPct };
      });
      if (targets.reduce((s, t) => s + t.qtyPct, 0) > 100.0000001) throw new Error('The target shares add up to more than 100%');
    } else if (kw === 'be') {
      if (breakeven) throw new Error('Only one "be"');
      const m = /^(?:after )?(\d+)(?: \+(\d+(?:\.\d+)?)%)?$/.exec(arg);
      if (!m) throw new Error('"be" is like: be 1  or  be 1 +0.1%');
      breakeven = { after: Number(m[1]), ...(m[2] ? { offsetPct: Number(m[2]) } : {}) };
    } else if (kw === 'trail') {
      if (trail) throw new Error('Only one "trail"');
      const m = /^(\d+(?:\.\d+)?%?) (?:after )?(\d+)$/.exec(arg);
      if (!m) throw new Error('"trail" is like: trail 1% 2  (distance, then the target that starts it)');
      const pct = m[1].endsWith('%');
      trail = { after: Number(m[2]), ...(pct ? { pct: n(m[1].slice(0, -1), 'Trail distance') } : { amount: n(m[1], 'Trail distance') }) };
    } else throw new Error(`Unknown "${kw}": use sl, tp, be or trail`);
  }
  if (!sl) throw new Error('An exit plan needs a stop: sl 98 or sl 2%');
  if (!targets.length) throw new Error('An exit plan needs targets: tp 2R 50%, 4R 50%');
  for (const [name, x] of [['be', breakeven], ['trail', trail]] as const) if (x && (x.after < 1 || x.after > targets.length)) throw new Error(`"${name}" refers to target ${x.after}, but there ${targets.length === 1 ? 'is 1 target' : `are ${targets.length} targets`}`);
  return { sl, targets, ...(breakeven ? { breakeven } : {}), ...(trail ? { trail } : {}) };
}

/** Prices of the stop and each target for an entry at `entry`. `dir`: 1 long, -1 short. */
export function resolvePlan(plan: ExitPlan, dir: 1 | -1, entry: number): { sl: number; targets: { price: number; qtyPct: number }[] } {
  const sl = 'price' in plan.sl ? plan.sl.price : entry * (1 - dir * (plan.sl as { pct: number }).pct / 100), risk = Math.abs(entry - sl);
  return {
    sl,
    targets: plan.targets.map(t => ({ qtyPct: t.qtyPct, price: 'price' in t.at ? t.at.price : 'pct' in t.at ? entry * (1 + (dir * t.at.pct) / 100) : entry + dir * t.at.r * risk })),
  };
}
/** Why a plan cannot work for an entry near `ref` (null when it can). */
export function planError(plan: ExitPlan, dir: 1 | -1, ref: number): string | null {
  const r = resolvePlan(plan, dir, ref);
  if (!(r.sl > 0)) return 'The stop would be at or below zero';
  if (dir * (r.sl - ref) >= 0) return `The stop must be ${dir > 0 ? 'below' : 'above'} the entry`;
  for (const [i, t] of r.targets.entries()) if (dir * (t.price - ref) <= 0) return `Target ${i + 1} must be ${dir > 0 ? 'above' : 'below'} the entry`;
  return null;
}
export function describePlan(plan: ExitPlan): string {
  const lv = (l: Level) => ('price' in l ? String(l.price) : 'pct' in l ? `${l.pct}%` : `${l.r}R`);
  return [`stop ${lv(plan.sl)}`, ...plan.targets.map((t, i) => `T${i + 1} ${lv(t.at)} (${t.qtyPct}%)`), ...(plan.breakeven ? [`breakeven after T${plan.breakeven.after}`] : []), ...(plan.trail ? [`trail ${plan.trail.pct ? plan.trail.pct + '%' : plan.trail.amount} after T${plan.trail.after}`] : [])].join(' · ');
}
