import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineSchema } from '../src/schema.js';
import { Table } from '../src/table.js';
import { Database } from '../src/database.js';
import { join, filter, select, orderBy } from '../src/query.js';

// --- schema.js ---

test('schema validate accepts a row with all required columns of the right type', () => {
  const schema = defineSchema({ id: 'number', name: 'string' });
  assert.doesNotThrow(() => schema.validate({ id: 1, name: 'Ada' }));
});

test('schema validate rejects a missing non-id column', () => {
  const schema = defineSchema({ id: 'number', name: 'string' });
  assert.throws(() => schema.validate({ id: 1 }));
});

test('schema validate rejects a wrong-typed column', () => {
  const schema = defineSchema({ id: 'number', name: 'string' });
  assert.throws(() => schema.validate({ id: 1, name: 42 }));
});

test('schema validate allows a missing id column (auto-assigned elsewhere)', () => {
  const schema = defineSchema({ id: 'number', name: 'string' });
  assert.doesNotThrow(() => schema.validate({ name: 'Ada' }));
});

// --- table.js ---

test('Table#insert auto-assigns sequential ids when omitted', () => {
  const table = new Table(defineSchema({ id: 'number', name: 'string' }));
  const a = table.insert({ name: 'Ada' });
  const b = table.insert({ name: 'Grace' });
  assert.equal(typeof a.id, 'number');
  assert.equal(b.id, a.id + 1);
});

test('Table#insert rejects an invalid row via the schema and does not add it', () => {
  const table = new Table(defineSchema({ id: 'number', name: 'string' }));
  assert.throws(() => table.insert({ name: 42 }));
  assert.equal(table.all().length, 0);
});

test('Table#insert stores a copy: mutating the input object after insert does not affect the table', () => {
  const table = new Table(defineSchema({ id: 'number', name: 'string' }));
  const input = { name: 'Ada' };
  const inserted = table.insert(input);
  input.name = 'mutated';
  inserted.name = 'also mutated';
  assert.equal(table.all()[0].name, 'Ada');
});

test('Table#all returns a copy of the rows array, not a live reference', () => {
  const table = new Table(defineSchema({ id: 'number', name: 'string' }));
  table.insert({ name: 'Ada' });
  const rows = table.all();
  rows.push({ id: 999, name: 'intruder' });
  assert.equal(table.all().length, 1);
});

test('Table#find filters rows by a predicate', () => {
  const table = new Table(defineSchema({ id: 'number', name: 'string' }));
  table.insert({ name: 'Ada' });
  table.insert({ name: 'Grace' });
  const found = table.find((r) => r.name === 'Grace');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Grace');
});

// --- database.js ---

test('Database#createTable returns a usable Table and Database#table retrieves it', () => {
  const db = new Database();
  db.createTable('users', defineSchema({ id: 'number', name: 'string' }));
  const users = db.table('users');
  users.insert({ name: 'Ada' });
  assert.equal(db.table('users').all().length, 1);
});

test('Database#createTable rejects creating the same table name twice', () => {
  const db = new Database();
  db.createTable('users', defineSchema({ id: 'number' }));
  assert.throws(() => db.createTable('users', defineSchema({ id: 'number' })));
});

test('Database#table throws for an unknown table name', () => {
  const db = new Database();
  assert.throws(() => db.table('nope'));
});

// --- query.js ---

test('join produces one row per matching pair, with right-side columns winning collisions', () => {
  const left = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
  const right = [{ id: 1, name: 'right-a' }];
  const joined = join(left, right, { on: ['id', 'id'] });
  assert.deepEqual(joined, [{ id: 1, name: 'right-a' }]);
});

test('join drops left rows with no match (inner join) and duplicates left rows with multiple matches', () => {
  const left = [{ id: 1 }, { id: 2 }];
  const right = [{ leftId: 1, tag: 'x' }, { leftId: 1, tag: 'y' }];
  const joined = join(left, right, { on: ['id', 'leftId'] });
  assert.equal(joined.length, 2);
  assert.deepEqual(joined.map((r) => r.tag), ['x', 'y']);
});

test('select projects only the requested columns', () => {
  const rows = [{ a: 1, b: 2, c: 3 }];
  assert.deepEqual(select(rows, ['a', 'c']), [{ a: 1, c: 3 }]);
});

test('orderBy sorts numeric-looking values numerically and is stable for ties', () => {
  const rows = [{ n: '10' }, { n: '2' }, { n: '2' }];
  assert.deepEqual(orderBy(rows, 'n').map((r) => r.n), ['2', '2', '10']);
});

test('filter passes through to a plain predicate filter', () => {
  const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
  assert.deepEqual(filter(rows, (r) => r.n > 1).map((r) => r.n), [2, 3]);
});

// --- end-to-end integration across schema/table/database/query ---

test('end-to-end: two tables joined, filtered, ordered, and projected', () => {
  const db = new Database();
  const users = db.createTable('users', defineSchema({ id: 'number', name: 'string' }));
  const posts = db.createTable(
    'posts',
    defineSchema({ id: 'number', title: 'string', authorId: 'number', views: 'number' }),
  );

  const ada = users.insert({ name: 'Ada' });
  const grace = users.insert({ name: 'Grace' });
  posts.insert({ title: 'First post', authorId: ada.id, views: 50 });
  posts.insert({ title: 'Second post', authorId: ada.id, views: 200 });
  posts.insert({ title: 'Third post', authorId: grace.id, views: 10 });

  const joined = join(posts.all(), users.all(), { on: ['authorId', 'id'] });
  const adasPosts = filter(joined, (r) => r.name === 'Ada');
  const ordered = orderBy(adasPosts, 'views', { desc: true });
  const projected = select(ordered, ['title', 'name', 'views']);

  assert.deepEqual(projected, [
    { title: 'Second post', name: 'Ada', views: 200 },
    { title: 'First post', name: 'Ada', views: 50 },
  ]);
});
