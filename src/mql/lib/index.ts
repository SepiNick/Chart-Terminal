// MQL4/MQL5 non-trading standard library runtime (clean-room, from the public documentation).
import type { Install, OutParams } from '../contract.ts';
import { constants } from './constants.ts';
import { sources } from './util.ts';
import { installMath } from './math.ts';
import { installString } from './string.ts';
import { installTime } from './time.ts';
import { installArray } from './array.ts';
import { installStructs, STRUCT_CTORS, CLASS_CTORS } from './structs.ts';
import { installSeries } from './series.ts';
import { installIndicators } from './indicators.ts';
import { installCustom } from './custom.ts';
import { installChart } from './chart.ts';
import { installInfo } from './info.ts';
import { installFiles } from './files.ts';

export const installStd: Install = (rt, env) => {
  Object.assign(rt, constants(env.dialect));
  const srcs = sources(env);
  installStructs(rt);
  installMath(rt);
  installString(rt, env);
  installTime(rt, env);
  installArray(rt, env);
  installInfo(rt, env);
  installSeries(rt, env, srcs);
  installIndicators(rt, env, srcs);
  installCustom(rt, env);
  installChart(rt, env);
  installFiles(rt, env);
};

export const STD_OUT_PARAMS: OutParams = {
  'StringReplace/3': [0], 'StringTrimLeft/1': [0], 'StringTrimRight/1': [0], 'StringToUpper/1': [0], 'StringToLower/1': [0],
  'StringSetCharacter/3': [0], 'StringFill/2': [0], 'StringInit/1': [0], 'StringInit/2': [0], 'StringInit/3': [0], 'StringAdd/2': [0], 'StringSetLength/2': [0],
  'SymbolInfoDouble/3': [2], 'SymbolInfoInteger/3': [2], 'SymbolInfoString/3': [2], 'SymbolExist/2': [1], 'SeriesInfoInteger/4': [3],
  'ObjectGetInteger/5': [4], 'ObjectGetDouble/5': [4], 'ObjectGetString/5': [4],
  'ChartGetInteger/4': [3], 'ChartGetDouble/4': [3], 'ChartGetString/3': [2],
  'GlobalVariableGet/2': [1], 'LinearWeightedMAOnBuffer/7': [6],
};
// MQL5 StringConcatenate(string &out, a1, a2, …): up to 64 arguments.
for (let n = 3; n <= 64; n++) STD_OUT_PARAMS[`StringConcatenate/${n}`] = [0];

export const STD_STRUCTS: string[] = Object.keys(STRUCT_CTORS);
export const STD_CLASSES: string[] = Object.keys(CLASS_CTORS);
const INC = ['MovingAverages.mqh', 'Object.mqh', 'Arrays\\Array.mqh', 'Arrays\\ArrayDouble.mqh', 'Arrays\\ArrayInt.mqh', 'Arrays\\ArrayLong.mqh', 'Arrays\\ArrayString.mqh', 'Arrays\\ArrayObj.mqh', 'Strings\\String.mqh', 'stdlib.mqh', 'stderror.mqh'];
export const NATIVE_INCLUDES: string[] = [...INC, ...INC.filter(p => p.includes('\\')).map(p => p.replace(/\\/g, '/'))];
