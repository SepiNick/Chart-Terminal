import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OF_PRESETS, presetActive, presetToggle } from './presets.ts';
import { defaultOF, ofActive } from './layer.ts';

test('presets: unique ids, a plain-language hint each, valid settings, only "off" is inactive', () => {
  assert.equal(new Set(OF_PRESETS.map(p => p.id)).size, OF_PRESETS.length);
  for (const p of OF_PRESETS) {
    assert.ok(p.label.length > 8 && p.hint.length > 20, p.id);
    const c = { ...defaultOF(), ...p.cfg };
    assert.ok(['off', 'bidask', 'delta', 'volume'].includes(c.footprint));
    assert.equal(ofActive(c), p.id !== 'off', p.id);
  }
  const imb = { ...defaultOF(), ...OF_PRESETS.find(p => p.id === 'imbalance')!.cfg };
  assert.deepEqual([imb.footprint, imb.ratio, imb.absorption], ['bidask', 3, true]);
});

test('presets toggle independently: two on at once, each off on its own', () => {
  const [tape, auction] = ['tape', 'auction'].map(id => OF_PRESETS.find(p => p.id === id)!);
  let of = defaultOF();
  of = { ...of, ...presetToggle(of, tape) }; of = { ...of, ...presetToggle(of, auction) };
  assert.ok(presetActive(of, tape) && presetActive(of, auction));
  of = { ...of, ...presetToggle(of, auction) };
  assert.ok(presetActive(of, tape) && !presetActive(of, auction));
  assert.equal(of.tpo, false); assert.equal(of.cvd, true);
});
