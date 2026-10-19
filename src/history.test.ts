import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, Snapshots } from './history.ts';

test('snapshots undo and redo drawing edits', () => {
  const h = new History(), state: Record<string, number[]> = { X: [] };
  const s = new Snapshots<string>(h, k => state[k], (k, v) => (state[k] = v as number[]));
  s.seed('X');
  state.X = [1]; s.commit('X', 'add');
  state.X = [1, 2]; s.commit('X', 'add');
  s.commit('X', 'noop'); // unchanged state records nothing
  h.undo(); assert.deepEqual(state.X, [1]);
  h.undo(); assert.deepEqual(state.X, []);
  assert.equal(h.canUndo, false);
  h.redo(); assert.deepEqual(state.X, [1]);
  state.X = [9]; s.commit('X', 'edit'); // new change clears redo
  assert.equal(h.canRedo, false);
  h.undo(); assert.deepEqual(state.X, [1]);
});
