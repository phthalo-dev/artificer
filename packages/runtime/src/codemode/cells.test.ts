import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodemodeCellStore } from './cells.js';

function store(): CodemodeCellStore {
  return new CodemodeCellStore({ maxCells: 4, cellTtlMs: 120_000 });
}

test('kv returns a stable Map per run until disposeRun', () => {
  const cells = store();
  const a = cells.kv('run-1');
  const b = cells.kv('run-1');
  assert.equal(a, b);
  a.set('k', 1);
  assert.equal(b.get('k'), 1);
});

test('kv maps for different runs are independent', () => {
  const cells = store();
  cells.kv('run-1').set('k', 'a');
  cells.kv('run-2').set('k', 'b');
  assert.equal(cells.kv('run-1').get('k'), 'a');
  assert.equal(cells.kv('run-2').get('k'), 'b');
});

test('disposeRun clears that run KV; subsequent kv is empty and fresh', () => {
  const cells = store();
  const first = cells.kv('run-1');
  first.set('k', 1);
  cells.kv('run-2').set('k', 2);

  cells.disposeRun('run-1');

  const after = cells.kv('run-1');
  assert.notEqual(after, first);
  assert.equal(after.size, 0);
  assert.equal(after.get('k'), undefined);
  assert.equal(cells.kv('run-2').get('k'), 2);
});

test('get returns undefined for an unknown cell', () => {
  const cells = store();
  assert.equal(cells.get('run-1', 'cell-1'), undefined);
});

test('disposeExpired is safe on an empty store', () => {
  const cells = store();
  cells.disposeExpired();
  cells.disposeExpired(Date.now());
});
