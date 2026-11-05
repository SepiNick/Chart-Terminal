import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// store.ts touches localStorage lazily and guarded; i18n.ts needs no DOM until setLang runs.
const { FA, t, lang } = await import('./i18n.ts');

const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('i18n.ts') ? [p] : [] });
const html = readFileSync('index.html', 'utf8').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const code = walk('src').map(f => readFileSync(f, 'utf8')).join('\n');

test('every translation has a Persian value, and keys that look like UI text really occur in the markup or the code', () => {
  const missing: string[] = [];
  for (const [en, fa] of Object.entries(FA)) {
    assert.ok(fa.trim() && /[؀-ۿ]/.test(fa) || /^[A-Za-zƒ⏰⏪▦⤓⤒＋✂\s\-/.()]+$/.test(fa), `no Persian text for "${en}"`);
    if (/^[a-z ]+$/.test(en)) continue;   // generic words (stock, index…) come from data, not from markup
    if (!html.includes(en) && !code.includes(en)) missing.push(en);
  }
  assert.deepEqual(missing, [], 'these keys occur nowhere, so they can never match (typo or a different hyphen/space?)');
});

test('t() is the identity in English', () => {
  assert.equal(lang(), 'en');
  assert.equal(t('Watchlist'), 'Watchlist');
  assert.ok(FA['Watchlist']);
});
