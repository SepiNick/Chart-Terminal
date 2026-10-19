// Builtin library registry: fully-qualified names -> implementations.
import type { Builtin, Ctx, PineValue } from '../types.ts';
import { TA, TA_VARS } from './ta.ts';
import { MATH, MATH_CONSTS } from './math.ts';
import { STR, FORMAT_CONSTS } from './str.ts';
import { COLOR, COLOR_CONSTS } from './color.ts';
import { ARRAY } from './array.ts';

const ns = <T>(p: string, o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}.${k}`, v]));

export const LIB: Record<string, Builtin> = { ...ns('ta', TA), ...ns('math', MATH), ...ns('str', STR), ...ns('color', COLOR), ...ns('array', ARRAY) };
export const CONSTS: Record<string, PineValue> = { ...ns('math', MATH_CONSTS), ...ns('color', COLOR_CONSTS), ...ns('format', FORMAT_CONSTS) };
export const VARS: Record<string, (ctx: Ctx) => PineValue> = ns('ta', TA_VARS);
export const LIB_NAMES: string[] = [...new Set([...Object.keys(LIB), ...Object.keys(CONSTS), ...Object.keys(VARS)])].sort();
