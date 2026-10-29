import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedFiles } from './scriptsig.ts';

test('usedFiles: includes, literal iCustom and named classes; an unrelated file stays out', () => {
  const f = (name: string, src: string) => ({ name, src });
  const main = f('Ea.mq5', '#include "Lib\\\\Helpers.mqh"\nint h = iCustom(_Symbol, 0, "MyBands", 20);');
  const helpers = f('Helpers.mqh', '#include <Deep.mqh>\nint x;'), deep = f('Deep.mqh', 'int y;'), bands = f('MyBands.mq5', 'int z;'), other = f('Other.mq5', 'int w;');
  const pool = [main, helpers, deep, bands, other];
  assert.deepEqual(usedFiles(main, pool, false).map(x => x.name).sort(), ['Deep.mqh', 'Ea.mq5', 'Helpers.mqh', 'MyBands.mq5']);
  const dyn = f('Dyn.mq5', 'string n = "MyBands"; int h = iCustom(_Symbol, 0, n);');
  assert.equal(usedFiles(dyn, [...pool, dyn], false).length, 6, 'a computed iCustom name keeps every file');
  const st = f('S.cs', 'class S : Strategy { MyInd m; }'), ind = f('M.cs', 'class MyInd : Indicator {}'), x = f('X.cs', 'class Unused : Indicator {}');
  assert.deepEqual(usedFiles(st, [st, ind, x], true).map(y => y.name), ['S.cs', 'M.cs']);
});
