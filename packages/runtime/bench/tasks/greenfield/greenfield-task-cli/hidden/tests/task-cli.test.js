import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskStore } from '../src/store.js';
import { saveStore, loadStore } from '../src/persistence.js';
import { runCli } from '../src/cli.js';

// --- store.js ---

test('TaskStore#add defaults priority to medium and tags to [], assigns sequential ids', () => {
  const store = new TaskStore();
  const a = store.add({ title: 'first' });
  const b = store.add({ title: 'second' });
  assert.equal(a.priority, 'medium');
  assert.deepEqual(a.tags, []);
  assert.equal(a.done, false);
  assert.equal(b.id, a.id + 1);
});

test('TaskStore#add trims the title and rejects an empty/whitespace-only one', () => {
  const store = new TaskStore();
  const t = store.add({ title: '  padded  ' });
  assert.equal(t.title, 'padded');
  assert.throws(() => store.add({ title: '' }));
  assert.throws(() => store.add({ title: '   ' }));
});

test('TaskStore#add rejects an invalid priority', () => {
  const store = new TaskStore();
  assert.throws(() => store.add({ title: 'x', priority: 'urgent' }));
});

test('TaskStore#complete marks done and throws for an unknown id', () => {
  const store = new TaskStore();
  const t = store.add({ title: 'x' });
  const completed = store.complete(t.id);
  assert.equal(completed.done, true);
  assert.throws(() => store.complete(999));
});

test('TaskStore#remove removes the task and throws for an unknown id', () => {
  const store = new TaskStore();
  const t = store.add({ title: 'x' });
  store.remove(t.id);
  assert.throws(() => store.get(t.id));
  assert.throws(() => store.remove(t.id));
});

test('TaskStore#list combines priority/tag/done filters with AND', () => {
  const store = new TaskStore();
  store.add({ title: 'a', priority: 'high', tags: ['work'] });
  const b = store.add({ title: 'b', priority: 'high', tags: ['home'] });
  store.add({ title: 'c', priority: 'low', tags: ['work'] });
  store.complete(b.id);

  assert.deepEqual(
    store.list({ priority: 'high' }).map((t) => t.title),
    ['a', 'b'],
  );
  assert.deepEqual(
    store.list({ priority: 'high', tag: 'home' }).map((t) => t.title),
    ['b'],
  );
  assert.deepEqual(
    store.list({ priority: 'high', done: false }).map((t) => t.title),
    ['a'],
  );
  assert.deepEqual(
    store.list().map((t) => t.title),
    ['a', 'b', 'c'],
  );
});

// --- persistence.js ---

test('saveStore writes atomically (no leftover .tmp file) and loadStore round-trips tasks/nextId', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-cli-'));
  const file = path.join(dir, 'tasks.json');
  const store = new TaskStore();
  store.add({ title: 'a', priority: 'high', tags: ['x'] });
  const b = store.add({ title: 'b' });
  store.complete(b.id);

  await saveStore(file, store);

  const tmpExists = await fs
    .access(`${file}.tmp`)
    .then(() => true)
    .catch(() => false);
  assert.equal(tmpExists, false);

  const loaded = await loadStore(file);
  assert.deepEqual(loaded.tasks, store.tasks);
  assert.equal(loaded.nextId, store.nextId);

  // The loaded store must be usable, not just a data bag.
  const c = loaded.add({ title: 'c' });
  assert.equal(c.id, store.nextId);
});

// --- cli.js: cross-file integration ---

test('cli "add" with flags creates a task with parsed priority and tags', () => {
  const store = new TaskStore();
  const result = runCli(store, ['add', 'Buy', 'milk', '--priority', 'high', '--tags', 'errand,urgent']);
  assert.equal(result.ok, true);
  assert.equal(result.task.title, 'Buy milk');
  assert.equal(result.task.priority, 'high');
  assert.deepEqual(result.task.tags, ['errand', 'urgent']);
});

test('cli "add" with no title text returns an error result, does not throw, does not add', () => {
  const store = new TaskStore();
  const result = runCli(store, ['add', '--priority', 'high']);
  assert.equal(result.ok, false);
  assert.equal(store.tasks.length, 0);
});

test('cli "add" with an invalid priority returns an error result via the store\'s validation', () => {
  const store = new TaskStore();
  const result = runCli(store, ['add', 'x', '--priority', 'urgent']);
  assert.equal(result.ok, false);
  assert.equal(store.tasks.length, 0);
});

test('cli "list" filters by --priority/--tag/--done, and rejects a malformed --done', () => {
  const store = new TaskStore();
  runCli(store, ['add', 'a', '--priority', 'high']);
  runCli(store, ['add', 'b', '--priority', 'low']);
  runCli(store, ['complete', '1']);

  const highOnly = runCli(store, ['list', '--priority', 'high']);
  assert.equal(highOnly.ok, true);
  assert.deepEqual(highOnly.tasks.map((t) => t.title), ['a']);

  const doneOnly = runCli(store, ['list', '--done', 'true']);
  assert.deepEqual(doneOnly.tasks.map((t) => t.title), ['a']);

  const bad = runCli(store, ['list', '--done', 'yes']);
  assert.equal(bad.ok, false);
});

test('cli "complete" rejects a non-numeric id without touching the store, and surfaces "not found"', () => {
  const store = new TaskStore();
  runCli(store, ['add', 'a']);

  const badId = runCli(store, ['complete', 'abc']);
  assert.equal(badId.ok, false);

  const notFound = runCli(store, ['complete', '999']);
  assert.equal(notFound.ok, false);

  const ok = runCli(store, ['complete', '1']);
  assert.equal(ok.ok, true);
  assert.equal(ok.task.done, true);
});

test('cli returns an error result for an unknown or missing command, never throws', () => {
  const store = new TaskStore();
  assert.equal(runCli(store, ['bogus']).ok, false);
  assert.equal(runCli(store, []).ok, false);
});
