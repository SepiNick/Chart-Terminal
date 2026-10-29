import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circuitBreaker, coach, preTradeGate, weeklyDigest, type JTradeLike } from './journal.ts';

const NOW = Date.UTC(2026, 9, 28, 15) / 1000;   // Wed 2026-10-28 15:00 UTC
const T = (net: number, hoursAgo: number, extra: Partial<JTradeLike> = {}): JTradeLike => ({ sym: 'BTCUSDT', dir: 'long', openTime: NOW - (hoursAgo + 2) * 3600, closeTime: NOW - hoursAgo * 3600, net, r: net / 100, status: 'closed', ...extra });

test('circuit breaker: daily, streak cooldown, weekly and monthly limits', () => {
  assert.equal(circuitBreaker([], 10_000, NOW).recommendation, 'TRADING_ALLOWED');
  assert.equal(circuitBreaker([T(-250, 1)], 10_000, NOW).recommendation, 'HALTED', '2.5% today ≥ 2%');
  const streak = circuitBreaker([T(-50, 30), T(-60, 5)], 10_000, NOW);
  assert.equal(streak.recommendation, 'COOLDOWN'); assert.equal(streak.streak, 2);
  assert.equal(circuitBreaker([T(-50, 60), T(-60, 30)], 10_000, NOW).recommendation, 'TRADING_ALLOWED', 'cooldown over after 24h');
  assert.equal(circuitBreaker([T(-300, 40), T(100, 30), T(-300, 26)], 10_000, NOW).recommendation, 'HALTED', 'week -5%');
  assert.equal(circuitBreaker([T(-50, 50), T(10, 20)], 10_000, NOW).recommendation, 'TRADING_ALLOWED', 'a win breaks the streak');
});

test('pre-trade gate: checklist, risk, breaker and revenge window', () => {
  const ok = { entryInPlan: true, stopPredefined: true, sizeInPlan: true, plannedRisk: 100, actualRisk: 90, breaker: 'TRADING_ALLOWED' as const, recentLosses: [], revengeHours: 24 };
  assert.equal(preTradeGate(ok).decision, 'GO');
  assert.equal(preTradeGate({ ...ok, actualRisk: 120 }).decision, 'NO_GO');
  assert.equal(preTradeGate({ ...ok, plannedRisk: NaN }).decision, 'REVIEW_REQUIRED');
  assert.equal(preTradeGate({ ...ok, stopPredefined: false }).decision, 'NO_GO');
  const r = preTradeGate({ ...ok, recentLosses: [{ sym: 'ETHUSDT', net: -40, at: NOW - 3600 }] });
  assert.equal(r.decision, 'NO_GO'); assert.match(r.reasons[0], /Revenge risk/);
});

test('weekly digest and coach', () => {
  const ts = [T(100, 2, { setup: 'Breakout' }), T(-50, 3, { setup: 'Breakout', mistakes: ['Late entry'] }), T(30, 400)];
  const d = weeklyDigest(ts, '2026-10-26');
  assert.equal(d.n, 2); assert.equal(d.net, 50); assert.equal(d.winRate, 50);
  assert.deepEqual(d.bySetup[0].slice(0, 2), ['Breakout', 2]);
  const c = coach([T(-50, 30), T(-60, 20), T(-70, 10, { r: -2.5 }), T(10, 5, { r: null })], { revengeHours: 24, maxLossR: 1.2, streakN: 3 });
  assert.equal(c.verdict, 'RULE_VIOLATION');
  assert.ok(c.findings.some(f => /without a recorded stop/.test(f.text)) && c.findings.some(f => /beyond 1.2R/.test(f.text)));
  assert.equal(coach([T(-50, 30), T(-60, 20), T(-70, 10)], { revengeHours: 1, maxLossR: 5, streakN: 3 }).verdict, 'COOL_DOWN');
});
