// Every in-app skill, in panel order. Add a skill here and it gets a form and a result view for free.
import type { Skill } from './types.ts';
import { positionSizer } from './sizing.ts';
import { circuitBreakerSkill, coachSkill, preTradeGateSkill, weeklyDigestSkill } from './journal.ts';
import { budgetSkill, rebalanceSkill, riskSkill } from './portfolio.ts';
import { optionsSkill } from './options.ts';
import { futuresSizer } from './sizing.ts';
import { taxSkill } from './tax.ts';
import { breakoutSkill } from './breakout.ts';
import { contrarianSkill } from './contrarian.ts';
import { residualSkill } from './residual.ts';
import { cryptoRegimeSkill } from './regime.ts';
import { breadthSkill } from './breadth.ts';
import { sectorSkill, uptrendSkill } from './uptrend.ts';
import { ftdSkill } from './ftd.ts';
import { distributionSkill } from './distribution.ts';
import { marketTopSkill } from './top.ts';
import { macroSkill } from './macro.ts';
import { downtrendSkill } from './downtrend.ts';
import { exposureSkill } from './exposure.ts';
import { druckenmillerSkill } from './druckenmiller.ts';
import { vcpSkill } from './vcp.ts';
import { burstSkill } from './burst.ts';

export const SKILLS: Skill[] = [positionSizer, riskSkill, circuitBreakerSkill, preTradeGateSkill, budgetSkill, rebalanceSkill, weeklyDigestSkill, coachSkill, optionsSkill, futuresSizer, taxSkill, breakoutSkill, contrarianSkill, residualSkill, cryptoRegimeSkill, breadthSkill, uptrendSkill, sectorSkill, ftdSkill, distributionSkill, marketTopSkill, macroSkill, downtrendSkill, exposureSkill, druckenmillerSkill, vcpSkill, burstSkill];
