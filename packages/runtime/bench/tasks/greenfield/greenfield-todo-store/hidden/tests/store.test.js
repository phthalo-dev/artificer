import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TodoStore } from '../src/store.js';
import { saveToFile, loadFromFile } from '../src/persistence.js';

test('addTodo returns a todo with an id, the text, and completed=false', () => {
  const store = new TodoStore();
  const todo = store.addTodo('write plan');
  assert.equal(todo.text, 'write plan');
  assert.equal(todo.completed, false);
  assert.equal(typeof todo.id, 'number');
});

test('addTodo rejects empty or whitespace-only text', () => {
  const store = new TodoStore();
  store.addTodo('valid');
  assert.throws(() => store.addTodo(''));
  assert.throws(() => store.addTodo('   '));
  assert.equal(store.listTodos({ includeCompleted: true }).length, 1);
});

test('listTodos excludes completed todos by default', () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  const b = store.addTodo('b');
  store.completeTodo(a.id);
  const open = store.listTodos();
  assert.equal(open.length, 1);
  assert.equal(open[0].id, b.id);
});

test('listTodos({ includeCompleted: true }) returns everything sorted by id', () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  const b = store.addTodo('b');
  store.completeTodo(a.id);
  const all = store.listTodos({ includeCompleted: true });
  assert.deepEqual(all.map((t) => t.id), [a.id, b.id]);
});

test('completeTodo throws for an unknown id', () => {
  const store = new TodoStore();
  store.addTodo('a');
  assert.throws(() => store.completeTodo(999));
});

test('removeTodo removes the todo and throws for an unknown id', () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  store.removeTodo(a.id);
  assert.equal(store.listTodos({ includeCompleted: true }).length, 0);
  assert.throws(() => store.removeTodo(a.id));
});

test('saveToFile then loadFromFile round-trips all todos including completed state', async () => {
  const store = new TodoStore();
  const a = store.addTodo('a');
  store.addTodo('b');
  store.completeTodo(a.id);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-'));
  const file = path.join(dir, 'todos.json');
  await saveToFile(file, store);
  const loaded = await loadFromFile(file);

  const all = loaded.listTodos({ includeCompleted: true });
  assert.equal(all.length, 2);
  assert.equal(all.find((t) => t.id === a.id).completed, true);
});
