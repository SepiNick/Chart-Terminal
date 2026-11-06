import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latinKey } from './keymap.ts';

test('a Persian layout resolves to the physical Latin key', () => {
  assert.equal(latinKey({ key: 'ش', code: 'KeyA' }), 'A');
  assert.equal(latinKey({ key: '۵', code: 'Digit5' }), '5');
  assert.equal(latinKey({ key: 'ظ', code: 'Slash' }), '/');
  assert.equal(latinKey({ key: 'و', code: 'Comma' }), ',');
  assert.equal(latinKey({ key: 'ю', code: 'Period' }), '.');
});
test('Latin layouts and named keys are left as they are', () => {
  assert.equal(latinKey({ key: 'a', code: 'KeyQ' }), 'a', 'AZERTY: the typed letter wins');
  assert.equal(latinKey({ key: 'Tab', code: 'Tab' }), 'Tab');
  assert.equal(latinKey({ key: 'ArrowLeft', code: 'ArrowLeft' }), 'ArrowLeft');
  assert.equal(latinKey({ key: '/', code: 'Slash' }), '/');
});
test('a non-Latin character on a key with no Latin meaning stays as typed', () => {
  assert.equal(latinKey({ key: 'پ', code: 'BracketRight' }), 'پ');
});
