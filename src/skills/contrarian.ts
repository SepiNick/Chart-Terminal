// contrarian-setup-gate: Jason Shapiro's three steps (crowded positioning → news the crowd should have liked fails →
// weekly price action confirms) synthesized by the original fail-closed precedence. Inputs are the three verdicts.
import { num, type Skill } from './types.ts';

export type Crowd = 'CROWDED_LONG' | 'CROWDED_SHORT' | 'NEUTRAL' | 'INVALID';
export type Step = 'CONFIRMED' | 'NOT_CONFIRMED' | 'INSUFFICIENT' | 'PENDING' | 'INVALID';
export type Status = 'READY_FOR_PLAN' | 'WATCHING_PRICE' | 'CROWDED' | 'REJECTED' | 'INSUFFICIENT_EVIDENCE';

export function contrarianGate(crowd: Crowd, news: Step, price: Step, stop?: number): { status: Status; direction?: 'LONG' | 'SHORT'; warnings: string[] } {
  const warnings: string[] = [];
  if (crowd === 'INVALID') return { status: 'INSUFFICIENT_EVIDENCE', warnings: ['crowding report missing or invalid'] };
  if (crowd === 'NEUTRAL') return { status: 'REJECTED', warnings: ['positioning is not crowded'] };
  const direction = crowd === 'CROWDED_LONG' ? 'SHORT' : 'LONG';   // fade the crowd
  if (news === 'INVALID' || news === 'INSUFFICIENT') return { status: 'INSUFFICIENT_EVIDENCE', direction, warnings: [`news step is ${news}`] };
  if (news === 'NOT_CONFIRMED') return { status: 'REJECTED', direction, warnings: ['the market reacted normally to the news'] };
  if (price === 'INVALID' || price === 'INSUFFICIENT') return { status: 'INSUFFICIENT_EVIDENCE', direction, warnings: [`price-action step is ${price}`] };
  if (price === 'NOT_CONFIRMED') return { status: 'REJECTED', direction, warnings: ['weekly price action did not confirm'] };
  if (news === 'PENDING') { if (price === 'CONFIRMED') warnings.push('price action confirmed before the news step: capped at CROWDED'); return { status: 'CROWDED', direction, warnings } }
  if (price === 'PENDING') return { status: 'WATCHING_PRICE', direction, warnings };
  if (!(stop! > 0)) return { status: 'INSUFFICIENT_EVIDENCE', direction, warnings: ['READY_FOR_PLAN needs a positive invalidation level from the price-action step'] };
  return { status: 'READY_FOR_PLAN', direction, warnings };
}

const STEPS = ['PENDING', 'CONFIRMED', 'NOT_CONFIRMED', 'INSUFFICIENT', 'INVALID'];
export const contrarianSkill: Skill = {
  id: 'contrarian-setup-gate', name: 'Contrarian setup gate', group: 'Market regime', from: 'contrarian-setup-gate',
  desc: 'Shapiro\'s contrarian pipeline in one verdict: crowded positioning, a failed reaction to favourable news, and weekly price confirmation. Fail-closed: a bad or missing step never advances.',
  inputs: [
    { key: 'crowd', label: 'Step 1 — COT positioning', type: 'select', options: ['CROWDED_LONG', 'CROWDED_SHORT', 'NEUTRAL', 'INVALID'], default: 'CROWDED_LONG' },
    { key: 'news', label: 'Step 2 — news reaction failure', type: 'select', options: STEPS, default: 'PENDING' },
    { key: 'price', label: 'Step 3 — weekly price action', type: 'select', options: STEPS, default: 'PENDING' },
    { key: 'stop', label: 'Invalidation level (from step 3)', type: 'number', optional: true },
  ],
  run(v) {
    const g = contrarianGate(v.crowd as Crowd, v.news as Step, v.price as Step, num(v.stop, 'Invalidation level', { optional: true }));
    return { verdict: { label: g.status.replace(/_/g, ' '), tone: g.status === 'READY_FOR_PLAN' ? 'up' : g.status === 'REJECTED' || g.status === 'INSUFFICIENT_EVIDENCE' ? 'dn' : 'warn', detail: g.direction ? `direction: ${g.direction} (against the crowd)` : '' }, notes: [...g.warnings, 'Never an order: size a READY setup with the position sizer.'] };
  },
};
