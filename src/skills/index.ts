// Every in-app skill, in panel order. Add a skill here and it gets a form and a result view for free.
import type { Skill } from './types.ts';
import { positionSizer } from './sizing.ts';
import { circuitBreakerSkill, coachSkill, preTradeGateSkill, weeklyDigestSkill } from './journal.ts';
import { budgetSkill, rebalanceSkill, riskSkill } from './portfolio.ts';
import { optionsSkill } from './options.ts';
import { futuresSizer } from './sizing.ts';

export const SKILLS: Skill[] = [positionSizer, riskSkill, circuitBreakerSkill, preTradeGateSkill, budgetSkill, rebalanceSkill, weeklyDigestSkill, coachSkill, optionsSkill, futuresSizer];
