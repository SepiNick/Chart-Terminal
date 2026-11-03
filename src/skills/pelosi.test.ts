import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memberMatch, parsePtr, type IndexRow } from './pelosi.ts';
import { parseIndex } from '../../server/ptr.ts';

const d = JSON.parse(readFileSync(new URL('./fixtures/pelosi.json', import.meta.url), 'utf8')) as { xml: string; idx: IndexRow[]; reports: { text: string; filed: string | null; want: unknown }[]; match: [string, boolean][] };
// Golden values: trader-pelosi's parse_index on the real 2026 House index, parse_ptr_text on real PTRs (pdftotext -layout)
// and member_match.
test('House index, PTR rows and member matching match the original', () => {
  assert.deepEqual(parseIndex(d.xml, 2026), d.idx);
  for (const [i, r] of d.reports.entries()) assert.deepEqual(JSON.parse(JSON.stringify(parsePtr(r.text, r.filed))), r.want, `report ${i}`);
  const qs = ['Pelosi', 'Nancy Pelosi', 'pelosi, n', 'Khanna', ''];
  assert.deepEqual(d.idx.slice(0, 40).flatMap(r => qs.map(q => [r.doc_id, memberMatch(r, q)])), d.match);
});
