// parabolic-short-trade-planner: Qullamaggie-style parabolic exhaustion shorts. Phase 1 scores survivors of the
// mode's hard filters on MA extension (30%), acceleration (25%), volume climax (20%), range expansion (15%) and
// liquidity (10%) → A/B/C/D, with the "still in markup" cap. Phase 2 turns A/B names into conditional plans
// (ORL break, first red 5-min, VWAP fail) with fixed-fractional sizing and SSR / borrow gating. Never an order.
import { pyRoundN, type Ctx, type Skill } from './types.ts';
import { barsMany, type Stock } from './vcp.ts';
import type { Bar } from './study20.ts';

const sma = (v: number[], n: number) => (v.length < n ? null : v.slice(-n).reduce((a, b) => a + b, 0) / n);
const tr = (h: number, l: number, pc: number) => Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
function atr(h: number[], l: number[], c: number[], n = 14) { if (h.length < n + 1) return 0; const t = h.slice(1).map((x, i) => tr(x, l[i + 1], c[i])); return t.length < n ? 0 : t.slice(-n).reduce((a, b) => a + b, 0) / n }
const ret = (c: number[], d: number) => (c.length < d + 1 || c[c.length - d - 1] <= 0 ? null : (c.at(-1)! - c[c.length - d - 1]) / c[c.length - d - 1] * 100);
function avgDaily(c: number[], w: number) { if (c.length < w + 1 || c[c.length - w - 1] <= 0) return null; const r: number[] = []; for (let i = c.length - w; i < c.length; i++) if (c[i - 1] > 0) r.push((c[i] - c[i - 1]) / c[i - 1]); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null }
const lin = (x: number | null, a: number, b: number) => (x == null || x <= a ? 0 : x >= b ? 100 : (x - a) / (b - a) * 100);
const clamp = (x: number) => Math.max(0, Math.min(100, x));
export function metrics(bars: Bar[]) {
  const c = bars.map(b => b.close), o = bars.map(b => b.open), h = bars.map(b => b.high), l = bars.map(b => b.low), v = bars.map(b => b.volume), close = c.at(-1)!;
  const d10 = sma(c, 10), d20 = sma(c, 20), d50 = sma(c, 50), pct = (m: number | null) => (m == null || m === 0 ? null : (close - m) / m * 100);
  let a14: number | null = null, extAtr: number | null = null;
  if (d20 != null) { const a = atr(h, l, c); if (a > 0) { a14 = a; extAtr = (close - d20) / a } }
  let streak = 0; for (let i = c.length - 1; i >= 0; i--) { if (c[i] > o[i]) streak++; else break }
  const s3 = avgDaily(c, 3), s10 = avgDaily(c, 10), accel = s3 == null || s10 == null || s10 <= 0 ? null : s3 / s10;
  let expansion: number | null = null;
  if (h.length >= 26) { const t = h.slice(1).map((x, i) => tr(x, l[i + 1], c[i])), rec = t.slice(-5).reduce((a, b) => a + b, 0) / 5, base = t.slice(-25, -5).reduce((a, b) => a + b, 0) / 20; if (base > 0) expansion = rec / base }
  const adv = c.length >= 20 ? c.slice(-20).reduce((a, x, i) => a + x * v.slice(-20)[i], 0) / 20 : null;
  const vavg = v.length >= 21 ? v.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0, vr = v.length >= 21 && vavg > 0 ? v.at(-1)! / vavg : null;
  const liq = adv == null || adv <= 0 ? 0 : Math.log10(adv) <= 7 ? 0 : Math.log10(adv) >= 8.5 ? 10 : 10 * (Math.log10(adv) - 7) / 1.5;
  return { close, d10, d20, d50, ext10: pct(d10), ext20: pct(d20), ext50: pct(d50), atr14: a14, extAtr, r3: ret(c, 3), r5: ret(c, 5), r10: ret(c, 10), r15: ret(c, 15), streak, accel, expansion, adv, vr, liq };
}
export const W = { ma_extension: 0.3, acceleration: 0.25, volume_climax: 0.2, range_expansion: 0.15, liquidity: 0.1 };
export function components(m: ReturnType<typeof metrics>) {
  return {
    ma_extension: clamp(0.5 * lin(m.ext20 || 0, 20, 120) + 0.5 * lin(m.extAtr || 0, 3, 10)),
    acceleration: clamp(0.4 * lin(m.r5 || 0, 20, 100) + 0.2 * lin(m.streak || 0, 2, 5) + 0.2 * lin(m.accel || 0, 1, 2) + 0.2 * lin(m.r3 || 0, 10, 50)),
    volume_climax: lin(m.vr, 1.5, 5), range_expansion: lin(m.expansion, 1.2, 3), liquidity: clamp(m.liq * 10),
  };
}
export const MODES = { safe_largecap: { cap: 2e9, adv: 20e6, price: 5, roc: 30 }, classic_qm: { cap: 300e6, adv: 5e6, price: 5, roc: 100 } };
export function screen(bars: Bar[], cap: number | null, mode: keyof typeof MODES = 'safe_largecap', o = { minExt: 25, minAtrExt: 4, minRoc: null as number | null }) {
  if (bars.length < 21) return null;
  const t = MODES[mode], m = metrics(bars), reasons: string[] = [];
  if (cap != null && cap < t.cap) reasons.push('market_cap'); if (m.adv != null && m.adv < t.adv) reasons.push('adv'); if (m.close < t.price) reasons.push('price');
  if (reasons.length || (m.r5 || 0) < (o.minRoc ?? t.roc) || (m.ext20 || 0) < o.minExt || m.extAtr == null || m.extAtr < o.minAtrExt) return null;
  const c = components(m), score = pyRoundN((Object.keys(W) as (keyof typeof W)[]).reduce((a, k) => a + c[k] * W[k], 0), 1), grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  const l = bars.at(-1)!, pos = l.high > l.low ? (l.close - l.low) / (l.high - l.low) : null, strong = pos != null && pos >= 0.8, at52 = m.close >= Math.max(...bars.slice(-Math.min(252, bars.length)).map(b => b.high)) * 0.999;
  const caps = strong && at52 ? ['still_in_markup'] : [], warnings = strong && m.vr != null && m.vr >= 2 && !caps.length ? ['too_early_to_short'] : [];
  return { m, c, score, grade, caps, warnings, high: l.high, low: l.low };
}
export function sizeRecipe(account: number, riskBps = 50, maxPos = 10, maxShort = 30, cur = 0) {
  const risk = account * riskBps / 10_000, cap = account * maxShort / 100, rem = cap - cur; let mpv = account * maxPos / 100;
  const ok = rem >= mpv; if (rem > 0 && !ok) mpv = Math.max(0, rem); else if (rem <= 0) mpv = 0;
  return { risk: pyRoundN(risk, 2), maxValue: pyRoundN(mpv, 2), ok };
}
/** SEC Rule 201: a ≥ 10% drop from the prior close triggers the uptick rule for that day and the next. */
export const ssr = (prevClose: number, price: number) => (prevClose - price) / prevClose * 100 >= 10;

export const parabolicSkill: Skill = {
  id: 'parabolic-short-trade-planner', name: 'Parabolic shorts', group: 'Screeners', from: 'parabolic-short-trade-planner',
  desc: 'Parabolic exhaustion short candidates: stocks ≥ 25% and ≥ 4 ATR above the 20-day MA after a 30%+ 5-day run (safe large-cap mode), scored 0–100 for extension, acceleration, volume climax, range expansion and liquidity, with conditional ORL / first-red / VWAP-fail plans, sizing and SSR/borrow checks. Watchlist only.',
  inputs: [
    { key: 'mode', label: 'Mode', type: 'select', options: ['safe_largecap', 'classic_qm'], default: 'safe_largecap' },
    { key: 'universe', label: 'Universe (largest US stocks)', type: 'number', default: 500 }, { key: 'symbols', label: 'Or these symbols', type: 'symbols', optional: true, default: '' },
    { key: 'riskBps', label: 'Risk per trade (bps of equity)', type: 'number', default: 50 }, { key: 'maxPos', label: 'Max position % of equity', type: 'number', default: 10 },
  ],
  async run(v, ctx: Ctx) {
    const mode = (String(v.mode) === 'classic_qm' ? 'classic_qm' : 'safe_largecap') as keyof typeof MODES, custom = String(v.symbols ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    const all = await ctx.json<Stock[]>('/api/us-stocks').catch(() => [] as Stock[]), caps = new Map(all.map(s => [s.sym, s.cap]));
    const syms = custom.length ? custom : all.filter(s => s.cap >= MODES[mode].cap && s.price >= 5).slice(0, Math.min(1500, Math.max(20, Number(v.universe) || 500))).map(s => s.sym);
    const bars = await barsMany(ctx, syms), acct = ctx.account(), size = sizeRecipe(acct.equity > 0 ? acct.equity : 100_000, Number(v.riskBps) || 50, Number(v.maxPos) || 10);
    const res = [...bars].map(([s, b]) => { const x = b.slice(-60).map(k => ({ date: new Date(k.time * 1000).toISOString().slice(0, 10), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume })); return { s, r: screen(x, caps.get(s) ?? null, mode), prev: x.at(-2)?.close ?? 0, last: x.at(-1)?.close ?? 0 } })
      .filter((x): x is typeof x & { r: NonNullable<typeof x.r> } => x.r != null).sort((a, b) => b.r.score - a.r.score);
    const f = (x: number | null, d = 1) => (x == null ? '–' : x.toFixed(d));
    const plans = res.filter(x => x.r.grade === 'A' || x.r.grade === 'B').map(x => {
      const ssrOn = ssr(x.prev, x.last), block = [...(ssrOn ? ['ssr_carryover'] : []), ...x.r.caps.map(c => `state_cap:${c}`)], adv = ['manual_locate_required', 'check premarket high/low', ...x.r.warnings.map(w => `warning:${w}`)];
      const stop = x.r.high + 0.25 * (x.r.m.atr14 ?? 0), sh = Math.floor(Math.min(size.risk / Math.max(1e-9, stop - x.r.low), size.maxValue / Math.max(1e-9, x.r.low)));
      return [x.s, x.r.grade, `ORL break on ≥ 1.2× volume: entry ORL − 0.05, stop HOD + 0.25 ATR (≈ ${f(stop, 2)})`, 'First red 5-min: entry its low − 0.05, stop its high', 'VWAP fail: lower-high low − 0.05, stop a 5-min close back above VWAP', `targets 10DMA ${f(x.r.m.d10, 2)} / 20DMA ${f(x.r.m.d20, 2)}; ≈ ${sh} sh if entry ≈ ${x.r.low.toFixed(2)}`, block.join(', ') || 'none', adv.join(', ')];
    });
    return {
      verdict: { label: `${res.filter(x => x.r.grade === 'A').length} A · ${res.filter(x => x.r.grade === 'B').length} B · ${res.length} parabolic`, tone: res.length ? 'warn' : 'muted', detail: `${bars.size} stocks read (${mode}); sizing: risk $${size.risk}, max position $${size.maxValue}.` },
      tables: [
        { title: 'Parabolic candidates', cols: ['Symbol', 'Grade', 'Score', 'Close', '5-day', '3-day', '≥ 20DMA', 'ATR ext', 'Green days', 'Vol ×', 'Range ×', 'ADV $M', 'Caps / warnings'], rows: res.slice(0, 40).map(x => [x.s, x.r.grade, x.r.score, x.r.m.close.toFixed(2), `${f(x.r.m.r5)}%`, `${f(x.r.m.r3)}%`, `${f(x.r.m.ext20)}%`, f(x.r.m.extAtr), x.r.m.streak, f(x.r.m.vr), f(x.r.m.expansion, 2), f((x.r.m.adv ?? 0) / 1e6, 0), [...x.r.caps, ...x.r.warnings].join(', ')]) },
        { title: 'Pre-market plans (grade A/B)', cols: ['Symbol', 'Grade', 'ORL', 'First red', 'VWAP fail', 'Targets & size', 'Blocking', 'Advisory'], rows: plans },
      ],
      notes: ['Wait for a trigger: never short a stock still closing at its highs. Borrow/locate, the premarket range and earnings dates are not known here — check them with your broker. SSR = last session fell ≥ 10%, so the uptick rule carries into today.', 'Intraday trigger monitoring (Phase 3) is not built in. No order is placed.'],
    };
  },
};
